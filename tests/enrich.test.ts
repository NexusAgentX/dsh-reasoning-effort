/**
 * Pure enrichment derivation tests: which user-layer entries get the
 * reasoning-efforts backfill and which are preserved.
 */

import { describe, expect, it } from 'vitest'
import { computeEnrichmentOps } from '../src/enrich'

const EFFORTS = { off: null, high: 'high' } as const
const resolveKnown = (modelId: string) => modelId === 'known' || modelId === 'override-known' ? EFFORTS : undefined

describe('computeEnrichmentOps', () => {
  it('is empty for a missing user section', () => {
    expect(computeEnrichmentOps(undefined, resolveKnown)).toEqual([])
    expect(computeEnrichmentOps(null, resolveKnown)).toEqual([])
    expect(computeEnrichmentOps([], resolveKnown)).toEqual([])
    expect(computeEnrichmentOps({}, resolveKnown)).toEqual([])
  })

  it('replaces each provider models array once, filling only missing entries', () => {
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          models: [
            { id: 'known' },
            { id: 'unknown', contextWindow: 1000 },
            { id: 'kept', reasoningEfforts: false },
          ],
        },
      },
    }, resolveKnown)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [
        { id: 'known', reasoningEfforts: EFFORTS },
        { id: 'unknown', contextWindow: 1000 },
        { id: 'kept', reasoningEfforts: false },
      ],
    }])
  })

  it('backfills missing input and preserves an explicit input value', () => {
    const resolveInput = (modelId: string) => modelId === 'vision'
      ? ['text', 'image'] as const
      : modelId === 'text-only' ? ['text'] as const : undefined
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          models: [
            { id: 'vision' },
            { id: 'text-only', input: ['text'] },
            { id: 'kept', input: ['custom'] },
            { id: 'unknown' },
          ],
        },
      },
    }, () => undefined, undefined, resolveInput)

    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [
        { id: 'vision', input: ['text', 'image'] },
        { id: 'text-only', input: ['text'] },
        { id: 'kept', input: ['custom'] },
        { id: 'unknown' },
      ],
    }])
  })

  it('preserves an existing map, an explicit false, and null', () => {
    const user = {
      providers: {
        acme: {
          models: [
            { id: 'kept-map', reasoningEfforts: { off: null, high: 'high' } },
            { id: 'kept-false', reasoningEfforts: false },
            { id: 'kept-null', reasoningEfforts: null },
            { id: 'known' },
          ],
        },
      },
    }
    const ops = computeEnrichmentOps(user, resolveKnown)
    expect(ops).toHaveLength(1)
    const value = (ops[0] as { value: unknown[] }).value
    expect(value[0]).toEqual({ id: 'kept-map', reasoningEfforts: { off: null, high: 'high' } })
    expect(value[1]).toEqual({ id: 'kept-false', reasoningEfforts: false })
    expect(value[2]).toEqual({ id: 'kept-null', reasoningEfforts: null })
    expect(value[3]).toEqual({ id: 'known', reasoningEfforts: EFFORTS })
  })

  it('applies an explicit override only to its exact provider and model', () => {
    const override = { off: null, max: 'maximum' } as const
    const ops = computeEnrichmentOps({
      providers: {
        first: { models: [{ id: 'same', reasoningEfforts: false }] },
        second: { models: [{ id: 'same', reasoningEfforts: false }] },
      },
    }, () => undefined, (provider, model) =>
      provider === 'first' && model === 'same' ? override : undefined)

    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'first', 'models'],
      value: [{ id: 'same', reasoningEfforts: override }],
    }])
  })

  it('settles when a stored explicit override already has the same value', () => {
    const override = { off: null, high: 'high' } as const
    expect(computeEnrichmentOps({
      providers: {
        acme: { models: [{ id: 'known', reasoningEfforts: { ...override } }] },
      },
    }, resolveKnown, () => override)).toEqual([])
  })

  it('replaces a modelOverrides dict once, filling only missing entries', () => {
    const ops = computeEnrichmentOps({
      providers: {
        openai: {
          modelOverrides: {
            known: { contextWindow: 1000 },
            'gpt-y': { reasoningEfforts: false },
          },
        },
      },
    }, resolveKnown)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'openai', 'modelOverrides'],
      value: {
        known: { contextWindow: 1000, reasoningEfforts: EFFORTS },
        'gpt-y': { reasoningEfforts: false },
      },
    }])
  })

  it('backfills input in modelOverrides without replacing an explicit null', () => {
    const resolveInput = (modelId: string) => modelId === 'vision' ? ['text', 'image'] as const : undefined
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          modelOverrides: {
            vision: { contextWindow: 1000 },
            kept: { input: null },
          },
        },
      },
    }, () => undefined, undefined, resolveInput)

    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'modelOverrides'],
      value: {
        vision: { contextWindow: 1000, input: ['text', 'image'] },
        kept: { input: null },
      },
    }])
  })

  it('preserves an own __proto__ model override while rebuilding the dictionary', () => {
    const overrides = JSON.parse('{"__proto__":{"reasoningEfforts":false},"known":{"contextWindow":1000}}')
    const ops = computeEnrichmentOps({
      providers: { openai: { modelOverrides: overrides } },
    }, resolveKnown)
    const value = (ops[0] as { value: Record<string, unknown> }).value

    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(value['__proto__']).toEqual({ reasoningEfforts: false })
    expect(value['known']).toEqual({ contextWindow: 1000, reasoningEfforts: EFFORTS })
  })

  it('skips malformed entries without failing', () => {
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          models: [null, 'nope', 42, { reasoningEfforts: false }, { id: 'known' }],
          modelOverrides: { bad: 'nope' },
        },
        broken: null,
      },
    }, resolveKnown)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [null, 'nope', 42, { reasoningEfforts: false }, { id: 'known', reasoningEfforts: EFFORTS }],
    }])
  })
})
