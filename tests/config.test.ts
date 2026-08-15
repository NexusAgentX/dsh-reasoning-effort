/**
 * Config schema and semantic gate tests: loader defaults, strict top-level
 * keys, and the wire-spelling rules mirroring llm-pi-ai's own resolution.
 */

import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_EFFORTS, resolveConfig } from '../src/config'

describe('Config schema', () => {
  it('defaults to the full seven-level map', () => {
    expect(Config({}).efforts).toEqual(DEFAULT_EFFORTS)
  })

  it('keeps an explicit efforts map', () => {
    expect(Config({ efforts: { off: null, high: 'high' } }).efforts)
      .toEqual({ off: null, high: 'high' })
  })

  it('rejects unknown levels and non-string wire spellings', () => {
    expect(() => Config({ efforts: { turbo: 'high' } as never })).toThrow()
    expect(() => Config({ efforts: { high: 3 } as never })).toThrow()
  })
})

describe('resolveConfig', () => {
  it('rejects unknown top-level keys', () => {
    expect(() => resolveConfig({ force: true })).toThrow(/unknown config key/)
  })

  it('rejects null wire spellings for levels other than off', () => {
    expect(() => resolveConfig({ efforts: { off: null, high: null } })).toThrow(/only "off"/)
  })

  it('rejects an off-only map and an empty map', () => {
    expect(() => resolveConfig({ efforts: { off: null } })).toThrow(/at least one level beyond "off"/)
    expect(() => resolveConfig({ efforts: {} })).toThrow(/at least one reasoning level/)
  })

  it('returns a detached default map', () => {
    const resolved = resolveConfig({})
    expect(resolved.efforts).toEqual(DEFAULT_EFFORTS)
    expect(resolved.efforts).not.toBe(DEFAULT_EFFORTS)
  })
})
