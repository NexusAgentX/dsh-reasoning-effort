/**
 * Integration tests for the plugin body over a real in-memory settings
 * service: boot-time backfill, event-driven backfill for later-added models,
 * idempotence, conflict retry, read-only and absent-namespace posture.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { MemorySettings } from './support/memory-settings'
import { apply, SETTINGS_NAMESPACE } from '../src/index'
import type { ReasoningEffortRemoteService } from '../src/remote'

const NS = settingsNamespace('llm-pi-ai')
const AGENT_NS = settingsNamespace('agent-default-model')
const GPT_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' }
const GROK_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

/** The raw `llm-pi-ai` user section of the test context. */
function userOf(ctx: Context): Record<string, any> | undefined {
  const descriptor = ctx.settings.describe().find(entry => entry.ns === NS)
  return descriptor?.user as Record<string, any> | undefined
}

function remoteOf(ctx: Context): ReasoningEffortRemoteService {
  return (ctx as unknown as { get(key: string): unknown })
    .get('reasoningEffortRemote') as ReasoningEffortRemoteService
}

/** A provider whose first two models are fillable and preserved respectively. */
function seedProviders(): Record<string, unknown> {
  return {
    acme: {
      models: [
        { id: 'gpt-5.4' },
        { id: 'kept-false', reasoningEfforts: false },
      ],
    },
  }
}

async function boot(seed?: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(MemorySettings)
  if (seed !== undefined) (ctx.settings as MemorySettings).seed(seed)
  ctx.settings.register(NS, z.object({ providers: z.dict(z.any()).default({}) }))
  ctx.settings.register(AGENT_NS, z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    reasoningDefaults: z.dict(z.any()).default({}),
  }))
  if (seed === undefined) await ctx.settings.update(NS, { providers: seedProviders() })
  return ctx
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('apply', () => {
  it('backfills every missing model entry at apply time and preserves declared values', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      const remote = (ctx as unknown as { get(key: string): unknown }).get('reasoningEffortRemote')
      expect(remoteMethods(remote as object).map(method => method.method)).toEqual([
        'describe', 'mutate',
      ])
      expect(ctx.typert.local.list().map(descriptor => descriptor.method)).toEqual([
        'describe', 'mutate',
      ])
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
      expect(models[1].reasoningEfforts).toBe(false)
    })
  })

  it('backfills a model added later through a settings document update', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
    await ctx.settings.update(NS, {
      providers: {
        acme: {
          models: [
            { id: 'gpt-5.4', reasoningEfforts: GPT_EFFORTS },
            { id: 'kept-false', reasoningEfforts: false },
            { id: 'grok-4.5' },
          ],
        },
      },
    })
    await vi.waitFor(() => {
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[2].reasoningEfforts).toEqual(GROK_EFFORTS)
    })
  })

  it('projects an explicit capability override onto only the exact provider route', async () => {
    const ctx = await boot()
    await ctx.settings.update(NS, {
      providers: {
        acme: { models: [{ id: 'gpt-5.4', reasoningEfforts: false }] },
        mirror: { models: [{ id: 'gpt-5.4', reasoningEfforts: false }] },
      },
    })
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(ctx.settings.describe().some(entry => entry.ns === SETTINGS_NAMESPACE)).toBe(true)
    })
    await ctx.settings.update(SETTINGS_NAMESPACE, {
      models: {
        acme: { 'gpt-5.4': { off: null, max: 'maximum' } },
      },
    })
    await vi.waitFor(() => {
      const providers = userOf(ctx)?.providers
      expect(providers['acme'].models[0].reasoningEfforts).toEqual({ off: null, max: 'maximum' })
      expect(providers['mirror'].models[0].reasoningEfforts).toBe(false)
    })
  })

  it('does not project inherited properties for prototype-named routes', async () => {
    const ctx = await boot()
    ;(ctx.settings as unknown as { publish(document: Record<string, unknown>): void }).publish({
      [NS]: {
        providers: JSON.parse('{"__proto__":{"models":[{"id":"toString","reasoningEfforts":false}]}}'),
      },
    })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, {})
    await flush()
    await flush()

    expect(mutate.mock.calls.filter(([ns]) => ns === NS)).toHaveLength(0)
    const providers = userOf(ctx)?.providers as Record<string, { models: Array<{ reasoningEfforts: unknown }> }>
    expect(Object.hasOwn(providers, '__proto__')).toBe(true)
    expect(providers['__proto__']!.models[0]!.reasoningEfforts).toBe(false)
  })

  it('writes nothing when every entry already declares a value', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    // Any raw-document change re-runs the watcher; a no-op pass must not write.
    await ctx.settings.update(NS, {
      providers: {
        acme: { baseURL: 'https://gateway.example/v1' },
      },
    })
    await flush()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('retries once after a revision conflict and still lands the backfill', async () => {
    const ctx = await boot()
    const original = ctx.settings.mutate.bind(ctx.settings)
    let calls = 0
    vi.spyOn(ctx.settings, 'mutate').mockImplementation(async (ns, ops, revision) => {
      calls += 1
      if (calls === 1) throw new SettingsConflictError(NS, 0, 1)
      return original(ns, ops, revision)
    })
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThanOrEqual(2)
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
  })

  it('stays inert when the settings provider is read-only', async () => {
    const ctx = await boot()
    Object.defineProperty(ctx.settings, 'writable', { value: false })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, {})
    await flush()
    expect(mutate).not.toHaveBeenCalled()
    expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toBeUndefined()
  })

  it('stays inert while llm-pi-ai has not registered its namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(MemorySettings)
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, {})
    await flush()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('migrates only a valid current-route legacy default into plugin ownership', async () => {
    const ctx = await boot()
    await ctx.settings.update(AGENT_NS, {
      provider: 'acme', model: 'gpt-5.4', reasoningEffort: 'high',
    })
    apply(ctx, {})

    await vi.waitFor(() => {
      const plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)
      expect(plugin?.user).toMatchObject({
        defaults: { acme: { 'gpt-5.4': 'high' } },
        legacyDefaultsMigrated: true,
      })
    })
  })

  it('does not re-import an explicitly removed default after events or restart-like re-application', async () => {
    const ctx = await boot()
    await ctx.settings.update(AGENT_NS, {
      provider: 'acme', model: 'gpt-5.4', reasoningEffort: 'high',
      reasoningDefaults: { acme: { 'gpt-5.4': 'high' } },
    })
    apply(ctx, {})
    await vi.waitFor(() => {
      const plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)
      expect(plugin?.user).toMatchObject({
        defaults: { acme: { 'gpt-5.4': 'high' } },
        legacyDefaultsMigrated: true,
      })
    })

    let plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)!
    await ctx.settings.mutate(SETTINGS_NAMESPACE, [{
      op: 'unset', path: ['defaults', 'acme', 'gpt-5.4'],
    }], plugin.revision)
    await ctx.settings.update(AGENT_NS, { reasoningEffort: 'low' })
    await flush()
    plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)!
    expect(plugin.user).toMatchObject({ legacyDefaultsMigrated: true })
    expect(plugin.user).not.toMatchObject({ defaults: { acme: { 'gpt-5.4': expect.anything() } } })

    const raw = Object.fromEntries(ctx.settings.describe().map(entry => [entry.ns, entry.user]))
    const restarted = await boot(raw)
    apply(restarted, {})
    await vi.waitFor(() => {
      const next = restarted.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)!
      expect(next.value).toMatchObject({ legacyDefaultsMigrated: true })
      expect(next.value).not.toMatchObject({ defaults: { acme: { 'gpt-5.4': expect.anything() } } })
    })

    const result = await agentEvents(restarted, {} as Agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve({ provider: 'acme', model: 'gpt-5.4' }),
    )
    expect(result.reasoningEffort).toBeUndefined()
  })

  it('injects a valid exact-route default after downstream selection and preserves explicit effort', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
    await ctx.settings.update(SETTINGS_NAMESPACE, {
      models: { acme: { 'gpt-5.4': GPT_EFFORTS } },
      defaults: { acme: { 'gpt-5.4': 'high' } },
    })
    const agent = {} as Agent
    const signal = new AbortController().signal

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal },
      () => Promise.resolve({ provider: 'acme', model: 'gpt-5.4' }),
    )).resolves.toMatchObject({
      provider: 'acme', model: 'gpt-5.4', reasoningEffort: 'high',
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal },
      () => Promise.resolve({
        provider: 'acme', model: 'gpt-5.4', reasoningEffort: ReasoningEffortId('max'),
      }),
    )).resolves.toMatchObject({ reasoningEffort: 'max' })
  })

  it('ignores a stored default after its exact route disables that effort', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(ctx.settings.describe().some(entry => entry.ns === SETTINGS_NAMESPACE)).toBe(true)
    })
    await ctx.settings.update(SETTINGS_NAMESPACE, {
      models: { acme: { 'gpt-5.4': false } },
      defaults: { acme: { 'gpt-5.4': 'high' } },
    })
    const result = await agentEvents(ctx, {} as Agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve({ provider: 'acme', model: 'gpt-5.4' }),
    )
    expect(result.reasoningEffort).toBeUndefined()
  })

  it('restricts Remote writes and exposes a partial two-namespace conflict for retry', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      const plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)
      expect(plugin?.value).toMatchObject({ legacyDefaultsMigrated: true })
    })
    const remote = remoteOf(ctx)
    let plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)!
    let agent = ctx.settings.describe().find(entry => entry.ns === AGENT_NS)!
    await expect(remote.mutate({
      pluginOps: [{ op: 'set', path: ['legacyDefaultsMigrated'], value: true }],
      agentDefaultOps: [],
      expectedPluginRevision: plugin.revision,
      expectedAgentDefaultRevision: agent.revision,
    })).rejects.toThrow('plugin writes must target models/defaults')

    const original = ctx.settings.mutate.bind(ctx.settings)
    vi.spyOn(ctx.settings, 'mutate').mockImplementation(async (ns, ops, revision) => {
      if (ns === AGENT_NS) {
        throw new SettingsConflictError(AGENT_NS, revision ?? 0, (revision ?? 0) + 1)
      }
      return original(ns, ops, revision)
    })
    plugin = ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)!
    agent = ctx.settings.describe().find(entry => entry.ns === AGENT_NS)!
    await expect(remote.mutate({
      pluginOps: [{ op: 'set', path: ['defaults', 'acme', 'gpt-5.4'], value: 'high' }],
      agentDefaultOps: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }],
      expectedPluginRevision: plugin.revision,
      expectedAgentDefaultRevision: agent.revision,
    })).rejects.toBeInstanceOf(SettingsConflictError)
    expect(ctx.settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ defaults: { acme: { 'gpt-5.4': 'high' } } })
    expect(ctx.settings.describe().find(entry => entry.ns === AGENT_NS)?.value)
      .not.toMatchObject({ reasoningEffort: 'high' })
  })

  it('waits for an in-flight settings write and schedules no follow-up after disposal', async () => {
    const ctx = await boot()
    let enterWrite!: () => void
    let releaseWrite!: () => void
    const entered = new Promise<void>(resolve => { enterWrite = resolve })
    const release = new Promise<void>(resolve => { releaseWrite = resolve })
    const mutate = vi.spyOn(ctx.settings, 'mutate').mockImplementationOnce(async () => {
      enterWrite()
      await release
    })
    apply(ctx, {})
    await entered
    ctx.emit('settings/updated', NS, {}, {}, 'provider')
    await flush()

    let disposed = false
    const disposing = ctx.fiber.dispose().then(() => { disposed = true })
    await flush()
    expect(disposed).toBe(false)
    releaseWrite()
    await disposing
    await flush()

    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
