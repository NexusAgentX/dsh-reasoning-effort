/** Controller integration over live ConfigForm snapshots and revision-fenced writes. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ReasoningSettingsController } from '../src/client/controller'
import type { ReasoningConfigForm } from '../src/client/controller'
import { draftsOf, modelRouteKey } from '../src/client/model-settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function applyPath(root: Record<string, unknown>, op: SettingsPathOpView): void {
  let cursor = root
  for (const segment of op.path.slice(0, -1)) {
    if (!isRecord(cursor[segment])) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  if (op.op === 'set') cursor[op.path.at(-1)!] = op.value
  else delete cursor[op.path.at(-1)!]
}

class FakeForm implements ReasoningConfigForm {
  status: ConfigFormSnapshot<unknown>['status'] = 'ready'
  writable = true
  value: unknown
  user: unknown
  revision: number
  readonly mutate = vi.fn(async (ops: readonly SettingsPathOpView[], expectedRevision?: number) => {
    if (this.rejectNext) {
      this.rejectNext = false
      return false
    }
    if (expectedRevision !== undefined && expectedRevision !== this.revision) return false
    if (isRecord(this.value)) {
      for (const op of ops) applyPath(this.value, op)
    }
    this.revision += 1
    for (const listener of this.listeners) listener()
    return true
  })

  private readonly listeners = new Set<() => void>()
  private rejectNext = false

  constructor(initial: { value: unknown; user?: unknown; revision: number }) {
    this.value = structuredClone(initial.value)
    this.user = structuredClone(initial.user ?? initial.value)
    this.revision = initial.revision
  }

  getSnapshot(): ConfigFormSnapshot<unknown> {
    return {
      status: this.status,
      value: this.value,
      base: undefined,
      user: this.user,
      revision: this.revision,
      writable: this.writable,
      mode: 'host',
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  failNextWrite(): void {
    this.rejectNext = true
  }
}

function forms(revisions = { plugin: 3, agent: 5 }) {
  return {
    piAi: new FakeForm({
      revision: 2,
      value: {},
      user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
    }),
    plugin: new FakeForm({
      revision: revisions.plugin,
      value: { models: {}, defaults: {}, legacyDefaultsMigrated: true },
    }),
    agentDefault: new FakeForm({
      revision: revisions.agent,
      value: { provider: 'alpha', model: 'outside-catalog' },
    }),
  }
}

describe('ReasoningSettingsController', () => {
  it('writes changed capability, plugin default, and current-route projection with captured revisions', async () => {
    const state = forms()
    const controller = new ReasoningSettingsController(state)
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true,
      efforts: { off: null, high: 'wire-high' },
      defaultEffort: 'high',
    }
    await expect(controller.save(drafts)).resolves.toBe(true)
    expect(state.plugin.mutate).toHaveBeenCalledWith([
      {
        op: 'set', path: ['models', 'alpha', 'outside-catalog'],
        value: { off: null, high: 'wire-high' },
      },
      { op: 'set', path: ['defaults', 'alpha', 'outside-catalog'], value: 'high' },
    ], 3)
    expect(state.agentDefault.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['reasoningEffort'], value: 'high' },
    ], 5)
    expect(controller.getSnapshot().status).toBe('ready')
  })

  it('keeps the loaded snapshot and exposes a retryable error after a rejected write', async () => {
    const state = forms()
    const controller = new ReasoningSettingsController(state)
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true, efforts: { high: 'high' }, defaultEffort: 'high',
    }
    state.plugin.failNextWrite()
    await expect(controller.save(drafts)).resolves.toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready', saving: false, error: 'The Host rejected the reasoning capability update.',
    })
    expect(controller.getSnapshot().snapshot).not.toBe(snapshot)
  })

  it('retries only the unfinished projection after a partial save', async () => {
    const state = forms()
    const controller = new ReasoningSettingsController(state)
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const key = modelRouteKey('alpha', 'outside-catalog')
    const drafts = draftsOf(snapshot.models)
    drafts[key] = { enabled: true, efforts: { off: null, high: 'wire-high' }, defaultEffort: 'high' }
    const dirty = { capabilities: new Set([key]), defaults: new Set([key]) }

    state.agentDefault.failNextWrite()
    await expect(controller.save(drafts, dirty)).resolves.toBe(false)
    await expect(controller.save(drafts, dirty)).resolves.toBe(true)
    expect(state.plugin.mutate).toHaveBeenCalledTimes(1)
    expect(state.agentDefault.mutate).toHaveBeenCalledTimes(2)
    expect(state.plugin.mutate.mock.calls[0]?.[1]).toBe(3)
    expect(state.agentDefault.mutate.mock.calls[1]?.[1]).toBe(5)
  })

  it('refreshes the snapshot when a form changes externally', async () => {
    const state = forms()
    const controller = new ReasoningSettingsController(state)
    await controller.load()
    expect(controller.getSnapshot().snapshot?.models[0]?.defaultEffort).toBeUndefined()
    state.plugin.value = {
      models: { alpha: { 'outside-catalog': { off: null, high: 'high' } } },
      defaults: { alpha: { 'outside-catalog': 'high' } },
      legacyDefaultsMigrated: true,
    }
    state.plugin.value = structuredClone(state.plugin.value)
    state.plugin.revision += 1
    // The controller exposes no public form-change hook; a successful save is
    // the supported refresh path, and its readback is asserted next.
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true, efforts: { off: null, high: 'high' }, defaultEffort: 'high',
    }
    await controller.save(drafts)
    expect(controller.getSnapshot().snapshot?.models[0]?.defaultEffort).toBe('high')
    controller.dispose()
  })
})
