/** Controller integration over the plugin-owned Remote and revision-fenced writes. */

import { describe, expect, it, vi } from 'vitest'
import type {
  ReasoningRemoteNamespace,
  ReasoningSettingsDocument,
} from '../src/remote-contract'
import { ReasoningSettingsController } from '../src/client/controller'
import { draftsOf, modelRouteKey } from '../src/client/model-settings'

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function failed(message: string) {
  return { ok: false as const, error: { code: 'settings-conflict', message, details: {} } }
}

function document(
  plugin: Record<string, unknown> = { models: {}, defaults: {} },
  agent: Record<string, unknown> = { provider: 'alpha', model: 'outside-catalog' },
  revisions = { plugin: 3, agent: 5 },
): ReasoningSettingsDocument {
  return {
    writable: true,
    namespaces: [
      {
        ns: 'llm-pi-ai', value: {}, revision: 2,
        user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
      },
      { ns: 'providers-reasoning', value: plugin, user: plugin, revision: revisions.plugin },
      { ns: 'agent-default-model', value: agent, user: agent, revision: revisions.agent },
    ],
  } as ReasoningSettingsDocument
}

function remote(overrides: Partial<ReasoningRemoteNamespace> = {}): ReasoningRemoteNamespace {
  return {
    describe: vi.fn(() => Promise.resolve(ok(document()))),
    mutate: vi.fn(() => Promise.resolve(ok({ saved: true as const }))),
    ...overrides,
  }
}

describe('ReasoningSettingsController', () => {
  it('writes changed capability, plugin default, and current-route projection with captured revisions', async () => {
    const describeSettings = vi.fn(() => Promise.resolve(ok(document())))
    const mutate = vi.fn(() => Promise.resolve(ok({ saved: true as const })))
    const controller = new ReasoningSettingsController(remote({ describe: describeSettings, mutate }))

    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true,
      efforts: { off: null, high: 'wire-high' },
      defaultEffort: 'high',
    }
    await expect(controller.save(drafts)).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith({
      pluginOps: [
        {
          op: 'set', path: ['models', 'alpha', 'outside-catalog'],
          value: { off: null, high: 'wire-high' },
        },
        { op: 'set', path: ['defaults', 'alpha', 'outside-catalog'], value: 'high' },
      ],
      agentDefaultOps: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }],
      expectedPluginRevision: 3,
      expectedAgentDefaultRevision: 5,
    })
    expect(describeSettings).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded snapshot and exposes a retryable error after a rejected write', async () => {
    const describeSettings = vi.fn(() => Promise.resolve(ok(document())))
    const controller = new ReasoningSettingsController(remote({
      describe: describeSettings,
      mutate: () => Promise.resolve(failed('stale editor')),
    }))
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true, efforts: { high: 'high' }, defaultEffort: 'high',
    }
    await expect(controller.save(drafts)).resolves.toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready', saving: false, error: 'stale editor',
    })
    expect(controller.getSnapshot().snapshot).not.toBe(snapshot)
    expect(describeSettings).toHaveBeenCalledTimes(2)
  })

  it('retries only the unfinished legacy projection after a partial Remote save', async () => {
    const initial = document()
    const partial = document({
      models: { alpha: { 'outside-catalog': { off: null, high: 'wire-high' } } },
      defaults: { alpha: { 'outside-catalog': 'high' } },
    }, { provider: 'alpha', model: 'outside-catalog' }, { plugin: 4, agent: 5 })
    const complete = document(partial.namespaces[1]!.value, {
      provider: 'alpha', model: 'outside-catalog', reasoningEffort: 'high',
    }, { plugin: 4, agent: 6 })
    const describeSettings = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(partial))
      .mockResolvedValueOnce(ok(complete))
    const mutate = vi.fn()
      .mockResolvedValueOnce(failed('default moved'))
      .mockResolvedValueOnce(ok({ saved: true as const }))
    const controller = new ReasoningSettingsController(remote({ describe: describeSettings, mutate }))
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    const key = modelRouteKey('alpha', 'outside-catalog')
    drafts[key] = { enabled: true, efforts: { off: null, high: 'wire-high' }, defaultEffort: 'high' }
    const dirty = { capabilities: new Set([key]), defaults: new Set([key]) }

    await expect(controller.save(drafts, dirty)).resolves.toBe(false)
    await expect(controller.save(drafts, dirty)).resolves.toBe(true)
    expect(mutate.mock.calls.map(([request]) => request)).toEqual([
      {
        pluginOps: [
          {
            op: 'set', path: ['models', 'alpha', 'outside-catalog'],
            value: { off: null, high: 'wire-high' },
          },
          { op: 'set', path: ['defaults', 'alpha', 'outside-catalog'], value: 'high' },
        ],
        agentDefaultOps: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }],
        expectedPluginRevision: 3,
        expectedAgentDefaultRevision: 5,
      },
      {
        pluginOps: [],
        agentDefaultOps: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }],
        expectedPluginRevision: 4,
        expectedAgentDefaultRevision: 5,
      },
    ])
    expect(describeSettings).toHaveBeenCalledTimes(3)
  })

  it('does not report success when the post-write refresh fails', async () => {
    const describeSettings = vi.fn()
      .mockResolvedValueOnce(ok(document()))
      .mockRejectedValueOnce(new Error('refresh offline'))
    const controller = new ReasoningSettingsController(remote({ describe: describeSettings }))
    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    const key = modelRouteKey('alpha', 'outside-catalog')
    drafts[key] = { enabled: true, efforts: { high: 'high' }, defaultEffort: 'high' }
    await expect(controller.save(drafts, {
      capabilities: new Set([key]), defaults: new Set([key]),
    })).resolves.toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error', saving: false, error: 'refresh offline',
    })
  })

  it('keeps the newest snapshot when concurrent loads resolve out of order', async () => {
    let resolveFirst!: (value: ReturnType<typeof ok<ReasoningSettingsDocument>>) => void
    let resolveSecond!: (value: ReturnType<typeof ok<ReasoningSettingsDocument>>) => void
    const first = new Promise<ReturnType<typeof ok<ReasoningSettingsDocument>>>(resolve => { resolveFirst = resolve })
    const second = new Promise<ReturnType<typeof ok<ReasoningSettingsDocument>>>(resolve => { resolveSecond = resolve })
    const describeSettings = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const controller = new ReasoningSettingsController(remote({ describe: describeSettings }))

    const olderLoad = controller.load()
    const newerLoad = controller.load()
    resolveSecond(ok(document({
      models: { alpha: { 'outside-catalog': { off: null, high: 'high' } } },
      defaults: { alpha: { 'outside-catalog': 'high' } },
    })))
    await newerLoad
    resolveFirst(ok(document({
      models: { alpha: { 'outside-catalog': { off: null, high: 'high' } } },
      defaults: { alpha: { 'outside-catalog': 'off' } },
    })))
    await olderLoad

    expect(controller.getSnapshot().snapshot?.models[0]?.defaultEffort).toBe('high')
    expect(controller.getSnapshot().status).toBe('ready')
  })
})
