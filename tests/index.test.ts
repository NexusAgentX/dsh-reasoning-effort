/** Host integration tests over an in-memory settings document. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
} from '../src/constants'
import { apply, Config, SETTINGS_NAMESPACE } from '../src/index'
import type { ReasoningPluginSettings } from '../src/plugin-settings'
import { MemorySettings } from './support/memory-settings'

const NS = PI_AI_SETTINGS_NAMESPACE_ID
const AGENT_NS = AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID
const GPT_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' }
const GROK_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

function runtimeConfig(value: Partial<ReasoningPluginSettings> = {}): Config {
  return Config({
    models: value.models ?? {},
    defaults: value.defaults ?? {},
    legacyDefaultsMigrated: value.legacyDefaultsMigrated ?? true,
  } as never)
}

/** The raw `llm-pi-ai` user section of the test context. */
function userOf(ctx: Context): Record<string, any> | undefined {
  const descriptor = ctx.settings.describe().find(entry => String(entry.ns) === NS)
  return descriptor?.user as Record<string, any> | undefined
}

function pluginUser(ctx: Context): Record<string, any> | undefined {
  return ctx.settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)?.user as
    | Record<string, any>
    | undefined
}

function userProjection(ctx: Context): Record<string, any> | undefined {
  return ctx.settings.describe().find(entry => String(entry.ns) === NS)?.value as
    | Record<string, any>
    | undefined
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
  const settings = new MemorySettings(ctx)
  ctx.provide('settings', settings as never)
  settings.register(NS, z.object({ providers: z.dict(z.any()).default({}) }))
  settings.register(AGENT_NS, z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    reasoningDefaults: z.dict(z.any()).default({}),
  }))
  settings.register(SETTINGS_NAMESPACE)
  if (seed !== undefined) settings.seed(seed)
  else await settings.update(NS, { providers: seedProviders() })
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
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
      expect(models[1].reasoningEfforts).toBe(false)
    })
  })

  it('backfills a model added later through a settings document update', async () => {
    const ctx = await boot()
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
    await (ctx.settings as unknown as MemorySettings).update(NS, {
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

  it('backfills capacities so a third-party DeepSeek route keeps its 1M window', async () => {
    const ctx = await boot({
      [NS]: {
        providers: {
          'lite-cpa': {
            models: [
              { id: 'deepseek-v4-flash', reasoningEfforts: { off: null, high: 'high', max: 'max' }, input: ['text'] },
              { id: 'deepseek-v4-flash-vision-exp' },
            ],
          },
        },
      },
    })
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      const models = userOf(ctx)?.providers['lite-cpa'].models
      expect(models[0]).toMatchObject({
        id: 'deepseek-v4-flash',
        contextWindow: 1048576,
        maxTokens: 393216,
      })
      expect(models[1]).toMatchObject({
        id: 'deepseek-v4-flash-vision-exp',
        contextWindow: 1048576,
        maxTokens: 384000,
      })
    })
  })

  it('preserves user-sized capacities while backfilling only the missing half', async () => {
    const ctx = await boot({
      [NS]: {
        providers: {
          acme: {
            models: [
              { id: 'deepseek-v4-flash', contextWindow: 131072 },
              { id: 'deepseek-v4-pro', maxTokens: 8192, reasoningEfforts: false },
            ],
          },
        },
      },
    })
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[0]).toMatchObject({ id: 'deepseek-v4-flash', contextWindow: 131072, maxTokens: 393216 })
      expect(models[1]).toMatchObject({ id: 'deepseek-v4-pro', contextWindow: 1048576, maxTokens: 8192 })
    })
  })

  it('projects an explicit capability override onto only the exact provider route', async () => {
    const ctx = await boot({
      [NS]: {
        providers: {
          acme: { models: [{ id: 'gpt-5.4', reasoningEfforts: false }] },
          mirror: { models: [{ id: 'gpt-5.4', reasoningEfforts: false }] },
        },
      },
    })
    await (ctx.settings as unknown as MemorySettings).update(SETTINGS_NAMESPACE, {
      models: { acme: { 'gpt-5.4': { off: null, max: 'maximum' } } },
    })
    apply(ctx, runtimeConfig({
      models: { acme: { 'gpt-5.4': { off: null, max: 'maximum' } } },
    }))
    await vi.waitFor(() => {
      const providers = userOf(ctx)?.providers
      expect(providers['acme'].models[0].reasoningEfforts).toEqual({ off: null, max: 'maximum' })
      expect(providers['mirror'].models[0].reasoningEfforts).toBe(false)
    })
  })

  it('does not project inherited properties for prototype-named routes', async () => {
    const ctx = await boot()
    ctx.emit('settings/document-updated', NS as never, 1)
    const settings = ctx.settings as unknown as MemorySettings
    settings.seed({
      [NS]: { providers: JSON.parse('{"__proto__":{"models":[{"id":"toString","reasoningEfforts":false}]}}') },
    })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, runtimeConfig())
    await flush()
    await flush()

    expect(mutate.mock.calls.filter(([ns]) => String(ns) === NS)).toHaveLength(0)
    const providers = userOf(ctx)?.providers as Record<string, { models: Array<{ reasoningEfforts: unknown }> }>
    expect(Object.hasOwn(providers, '__proto__')).toBe(true)
    expect(providers['__proto__']!.models[0]!.reasoningEfforts).toBe(false)
  })

  it('writes nothing when every entry already declares a value', async () => {
    const ctx = await boot()
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    await (ctx.settings as unknown as MemorySettings).update(NS, {
      providers: { acme: { baseURL: 'https://gateway.example/v1' } },
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
      if (calls === 1) throw new SettingsConflictError(ns as never, 0, 1)
      return original(ns, ops, revision)
    })
    apply(ctx, runtimeConfig())
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThanOrEqual(2)
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
    })
  })

  it('stays inert when the settings provider is read-only', async () => {
    const ctx = await boot()
    Object.defineProperty(ctx.settings, 'writable', { value: false })
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, runtimeConfig())
    await flush()
    expect(mutate).not.toHaveBeenCalled()
    expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toBeUndefined()
  })

  it('stays inert while llm-pi-ai has not registered its namespace', async () => {
    const ctx = new Context()
    const settings = new MemorySettings(ctx)
    ctx.provide('settings', settings as never)
    const mutate = vi.spyOn(settings, 'mutate')
    apply(ctx, runtimeConfig())
    await flush()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('migrates only a valid current-route legacy default into plugin ownership', async () => {
    const ctx = await boot()
    await (ctx.settings as unknown as MemorySettings).update(AGENT_NS, {
      provider: 'acme', model: 'gpt-5.4', reasoningEffort: 'high',
      reasoningDefaults: { acme: { 'gpt-5.4': 'high' } },
    })
    apply(ctx, {
      models: { get: () => pluginUser(ctx)?.models ?? {} },
      defaults: { get: () => pluginUser(ctx)?.defaults ?? {} },
      legacyDefaultsMigrated: { get: () => pluginUser(ctx)?.legacyDefaultsMigrated === true },
    })

    await vi.waitFor(() => {
      expect(pluginUser(ctx)).toMatchObject({
        defaults: { acme: { 'gpt-5.4': 'high' } },
        legacyDefaultsMigrated: true,
      })
    })
  })

  it('injects a valid exact-route default and preserves an explicit effort', async () => {
    const ctx = await boot()
    apply(ctx, runtimeConfig({
      models: { acme: { 'gpt-5.4': GPT_EFFORTS } },
      defaults: { acme: { 'gpt-5.4': 'high' } },
    }))
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(GPT_EFFORTS)
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
    apply(ctx, runtimeConfig({
      models: { acme: { 'gpt-5.4': false } },
      defaults: { acme: { 'gpt-5.4': 'high' } },
    }))
    const result = await agentEvents(ctx, {} as Agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve({ provider: 'acme', model: 'gpt-5.4' }),
    )
    expect(result.reasoningEffort).toBeUndefined()
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
    apply(ctx, runtimeConfig())
    await entered
    ctx.emit('settings/document-updated', NS as never, 1)
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
