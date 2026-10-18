/**
 * Config schema and semantic gate tests: loader defaults, strict top-level
 * keys, and the wire-spelling rules mirroring llm-pi-ai's own resolution.
 */

import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_EFFORTS, resolveConfig, resolveRuntimeConfig } from '../src/config'

describe('Config schema', () => {
  it('leaves the catalog override absent by default', () => {
    expect(Config({} as never).efforts).toBeUndefined()
  })

  it('keeps an explicit efforts map', () => {
    expect(Config({ efforts: { off: null, high: 'high' } } as never).efforts)
      .toEqual({ off: null, high: 'high' })
  })

  it('rejects unknown levels and non-string wire spellings', () => {
    expect(() => Config({ efforts: { turbo: 'high' } } as never)).toThrow()
    expect(() => Config({ efforts: { high: 3 } } as never)).toThrow()
  })

  it('exposes live defaults for the settings-owned plugin fields', () => {
    const parsed = Config({} as never)
    expect(parsed.models.get()).toEqual({})
    expect(parsed.defaults.get()).toEqual({})
    expect(parsed.legacyDefaultsMigrated.get()).toBe(false)
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

  it('returns no override when configuration omits efforts', () => {
    const resolved = resolveConfig({} as never)
    expect(resolved.efforts).toBeUndefined()
  })

  it('returns a detached explicit override map', () => {
    const resolved = resolveConfig({ efforts: DEFAULT_EFFORTS })
    expect(resolved.efforts).toEqual(DEFAULT_EFFORTS)
    expect(resolved.efforts).not.toBe(DEFAULT_EFFORTS)
  })

  it('resolves volatile settings references into detached plain snapshots', () => {
    const runtime = resolveRuntimeConfig(Config({
      models: { alpha: { 'gpt-5.4': { off: null, high: 'high' } } },
      defaults: { alpha: { 'gpt-5.4': 'high' } },
      legacyDefaultsMigrated: true,
    } as never))
    const settings = runtime.settings()
    expect(settings).toEqual({
      models: { alpha: { 'gpt-5.4': { off: null, high: 'high' } } },
      defaults: { alpha: { 'gpt-5.4': 'high' } },
      legacyDefaultsMigrated: true,
    })
    expect(Object.getPrototypeOf(settings.models)).toBe(Object.prototype)
  })
})
