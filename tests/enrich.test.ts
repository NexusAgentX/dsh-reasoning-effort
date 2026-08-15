/**
 * Pure enrichment derivation tests: which user-layer entries get the
 * reasoning-efforts backfill and which are preserved.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_EFFORTS } from '../src/config'
import { computeEnrichmentOps } from '../src/enrich'

const EFFORTS = { off: null, high: 'high' } as const

describe('computeEnrichmentOps', () => {
  it('is empty for a missing user section', () => {
    expect(computeEnrichmentOps(undefined, DEFAULT_EFFORTS)).toEqual([])
    expect(computeEnrichmentOps(null, DEFAULT_EFFORTS)).toEqual([])
    expect(computeEnrichmentOps([], DEFAULT_EFFORTS)).toEqual([])
    expect(computeEnrichmentOps({}, DEFAULT_EFFORTS)).toEqual([])
  })

  it('replaces each provider models array once, filling only missing entries', () => {
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          models: [
            { id: 'a' },
            { id: 'b', contextWindow: 1000 },
            { id: 'kept', reasoningEfforts: false },
          ],
        },
      },
    }, EFFORTS)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [
        { id: 'a', reasoningEfforts: EFFORTS },
        { id: 'b', contextWindow: 1000, reasoningEfforts: EFFORTS },
        { id: 'kept', reasoningEfforts: false },
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
            { id: 'filled' },
          ],
        },
      },
    }
    const ops = computeEnrichmentOps(user, DEFAULT_EFFORTS)
    expect(ops).toHaveLength(1)
    const value = (ops[0] as { value: unknown[] }).value
    expect(value[0]).toEqual({ id: 'kept-map', reasoningEfforts: { off: null, high: 'high' } })
    expect(value[1]).toEqual({ id: 'kept-false', reasoningEfforts: false })
    expect(value[2]).toEqual({ id: 'kept-null', reasoningEfforts: null })
    expect(value[3]).toEqual({ id: 'filled', reasoningEfforts: DEFAULT_EFFORTS })
  })

  it('replaces a modelOverrides dict once, filling only missing entries', () => {
    const ops = computeEnrichmentOps({
      providers: {
        openai: {
          modelOverrides: {
            'gpt-x': { contextWindow: 1000 },
            'gpt-y': { reasoningEfforts: false },
          },
        },
      },
    }, EFFORTS)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'openai', 'modelOverrides'],
      value: {
        'gpt-x': { contextWindow: 1000, reasoningEfforts: EFFORTS },
        'gpt-y': { reasoningEfforts: false },
      },
    }])
  })

  it('skips malformed entries without failing', () => {
    const ops = computeEnrichmentOps({
      providers: {
        acme: {
          models: [null, 'nope', 42, { reasoningEfforts: false }, { id: 'ok' }],
          modelOverrides: { bad: 'nope' },
        },
        broken: null,
      },
    }, EFFORTS)
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [null, 'nope', 42, { reasoningEfforts: false }, { id: 'ok', reasoningEfforts: EFFORTS }],
    }])
  })
})
