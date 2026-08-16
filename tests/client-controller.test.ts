/** Controller wire integration: one describe cut and revision-fenced namespace writes. */

import { describe, expect, it, vi } from 'vitest'
import { ReasoningSettingsController } from '../src/client/controller'
import { draftsOf, modelRouteKey } from '../src/client/model-settings'

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

describe('ReasoningSettingsController', () => {
  it('writes changed capability and default with their captured revisions', async () => {
    const namespaces = [
      {
        ns: 'llm-pi-ai', schema: {}, value: {}, revision: 2, applies: 'live', secrets: [],
        user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
      },
      {
        ns: 'providers-reasoning', schema: {}, value: { models: {} }, revision: 3, applies: 'live', secrets: [],
      },
      {
        ns: 'agent-default-model', schema: {}, value: { provider: 'alpha', model: 'outside-catalog' },
        revision: 5, applies: 'live', secrets: [],
      },
    ]
    const describeSettings = vi.fn().mockResolvedValue(ok({ writable: true, hasDocument: true, namespaces }))
    const mutate = vi.fn().mockResolvedValue(ok(namespaces[1]))
    const controller = new ReasoningSettingsController({
      settings: { describe: describeSettings, mutate } as never,
    } as never)

    await controller.load()
    const snapshot = controller.getSnapshot().snapshot!
    const drafts = draftsOf(snapshot.models)
    drafts[modelRouteKey('alpha', 'outside-catalog')] = {
      enabled: true,
      efforts: { off: null, high: 'wire-high' },
      defaultEffort: 'high',
    }
    await expect(controller.save(drafts)).resolves.toBe(true)
    expect(mutate.mock.calls.map(([request]) => request)).toEqual([
      {
        ns: 'providers-reasoning',
        ops: [{
          op: 'set', path: ['models', 'alpha', 'outside-catalog'],
          value: { off: null, high: 'wire-high' },
        }],
        expectedRevision: 3,
      },
      {
        ns: 'agent-default-model',
        ops: [
          { op: 'set', path: ['reasoningDefaults', 'alpha', 'outside-catalog'], value: 'high' },
          { op: 'set', path: ['reasoningEffort'], value: 'high' },
        ],
        expectedRevision: 5,
      },
    ])
    expect(describeSettings).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded snapshot and exposes a retryable error after a rejected write', async () => {
    const namespaces = [
      {
        ns: 'llm-pi-ai', schema: {}, value: {}, revision: 2, applies: 'live', secrets: [],
        user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
      },
      { ns: 'providers-reasoning', schema: {}, value: { models: {} }, revision: 3, applies: 'live', secrets: [] },
      { ns: 'agent-default-model', schema: {}, value: { provider: 'alpha', model: 'outside-catalog' }, revision: 5, applies: 'live', secrets: [] },
    ]
    const describeSettings = vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces })))
    const controller = new ReasoningSettingsController({
      settings: {
        describe: describeSettings,
        mutate: () => Promise.resolve({
          rpcId: 'test', result: { ok: false as const, error: { code: 'settings-conflict', message: 'stale editor', details: {} } },
        }),
      } as never,
    } as never)
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

  it('retries only the unfinished namespace after a partial two-namespace save', async () => {
    const initial = [
      {
        ns: 'llm-pi-ai', schema: {}, value: {}, revision: 2, applies: 'live', secrets: [],
        user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
      },
      { ns: 'providers-reasoning', schema: {}, value: { models: {} }, revision: 3, applies: 'live', secrets: [] },
      { ns: 'agent-default-model', schema: {}, value: { provider: 'alpha', model: 'outside-catalog' }, revision: 5, applies: 'live', secrets: [] },
    ]
    const partial = [
      initial[0],
      {
        ns: 'providers-reasoning', schema: {}, revision: 4, applies: 'live', secrets: [],
        value: { models: { alpha: { 'outside-catalog': { off: null, high: 'wire-high' } } } },
      },
      initial[2],
    ]
    const complete = [
      initial[0],
      partial[1],
      {
        ns: 'agent-default-model', schema: {}, revision: 6, applies: 'live', secrets: [],
        value: {
          provider: 'alpha', model: 'outside-catalog', reasoningEffort: 'high',
          reasoningDefaults: { alpha: { 'outside-catalog': 'high' } },
        },
      },
    ]
    const describeSettings = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: initial }))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: partial }))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: complete }))
    const mutate = vi.fn()
      .mockResolvedValueOnce(ok(partial[1]))
      .mockResolvedValueOnce({
        rpcId: 'test', result: { ok: false as const, error: { code: 'settings-conflict', message: 'default moved', details: {} } },
      })
      .mockResolvedValueOnce(ok(complete[2]))
    const controller = new ReasoningSettingsController({
      settings: { describe: describeSettings, mutate } as never,
    } as never)
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
        ns: 'providers-reasoning',
        ops: [{
          op: 'set', path: ['models', 'alpha', 'outside-catalog'],
          value: { off: null, high: 'wire-high' },
        }],
        expectedRevision: 3,
      },
      {
        ns: 'agent-default-model',
        ops: [
          { op: 'set', path: ['reasoningDefaults', 'alpha', 'outside-catalog'], value: 'high' },
          { op: 'set', path: ['reasoningEffort'], value: 'high' },
        ],
        expectedRevision: 5,
      },
      {
        ns: 'agent-default-model',
        ops: [
          { op: 'set', path: ['reasoningDefaults', 'alpha', 'outside-catalog'], value: 'high' },
          { op: 'set', path: ['reasoningEffort'], value: 'high' },
        ],
        expectedRevision: 5,
      },
    ])
    expect(describeSettings).toHaveBeenCalledTimes(3)
  })

  it('does not report success when the post-write refresh fails', async () => {
    const namespaces = [
      {
        ns: 'llm-pi-ai', schema: {}, value: {}, revision: 2, applies: 'live', secrets: [],
        user: { providers: { alpha: { models: [{ id: 'outside-catalog' }] } } },
      },
      { ns: 'providers-reasoning', schema: {}, value: { models: {} }, revision: 3, applies: 'live', secrets: [] },
      { ns: 'agent-default-model', schema: {}, value: { provider: 'alpha', model: 'outside-catalog' }, revision: 5, applies: 'live', secrets: [] },
    ]
    const describeSettings = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces }))
      .mockRejectedValueOnce(new Error('refresh offline'))
    const controller = new ReasoningSettingsController({
      settings: {
        describe: describeSettings,
        mutate: () => Promise.resolve(ok(namespaces[1])),
      } as never,
    } as never)
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
})
