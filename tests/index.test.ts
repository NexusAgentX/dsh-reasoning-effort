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
import { DEFAULT_EFFORTS } from '../src/config'
import { apply } from '../src/index'

const NS = settingsNamespace('llm-pi-ai')

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
        { id: 'fresh' },
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
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[0].reasoningEfforts).toEqual(DEFAULT_EFFORTS)
      expect(models[1].reasoningEfforts).toBe(false)
    })
  })

  it('backfills a model added later through a settings document update', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(DEFAULT_EFFORTS)
    })
    await ctx.settings.update(NS, {
      providers: {
        acme: {
          models: [
            { id: 'fresh', reasoningEfforts: DEFAULT_EFFORTS },
            { id: 'kept-false', reasoningEfforts: false },
            { id: 'later' },
          ],
        },
      },
    })
    await vi.waitFor(() => {
      const models = userOf(ctx)?.providers['acme'].models
      expect(models[2].reasoningEfforts).toEqual(DEFAULT_EFFORTS)
    })
  })

  it('writes nothing when every entry already declares a value', async () => {
    const ctx = await boot()
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(DEFAULT_EFFORTS)
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
      expect(userOf(ctx)?.providers['acme'].models[0].reasoningEfforts).toEqual(DEFAULT_EFFORTS)
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
