/**
 * Integration tests for the plugin body over a real in-memory settings
 * service: boot-time backfill, event-driven backfill for later-added models,
 * idempotence, conflict retry, read-only and absent-namespace posture.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MemorySettings } from './support/memory-settings'
import { apply, SETTINGS_NAMESPACE } from '../src/index'

const NS = settingsNamespace('llm-pi-ai')
const GPT_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' }
const GROK_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

/** The raw `llm-pi-ai` user section of the test context. */
function userOf(ctx: Context): Record<string, any> | undefined {
  const descriptor = ctx.settings.describe().find(entry => entry.ns === NS)
  return descriptor?.user as Record<string, any> | undefined
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

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  ctx.settings.register(NS, z.object({ providers: z.dict(z.any()).default({}) }))
  await ctx.settings.update(NS, { providers: seedProviders() })
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
      expect((ctx.settings as MemorySettings).configurationClientNamespaces()).toContain(SETTINGS_NAMESPACE)
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

    expect(mutate).not.toHaveBeenCalled()
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
    await ctx.plugin(MemorySettings)
    const mutate = vi.spyOn(ctx.settings, 'mutate')
    apply(ctx, {})
    await flush()
    expect(mutate).not.toHaveBeenCalled()
  })
})
