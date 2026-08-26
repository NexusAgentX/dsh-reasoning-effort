import catalog from '../models.json'
import { describe, expect, it } from 'vitest'
import { REASONING_LEVELS } from '../src/config'
import { resolveModelCapacity, resolveModelEfforts, resolveModelInput } from '../src/model-catalog'

type NumberOrNull = number | null

interface CatalogEntry {
  readonly model: string
  readonly aliases: readonly string[]
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number | null
  readonly maxOutputTokens: number | null
  readonly pricing: {
    readonly currency: string
    readonly unit: string
    readonly input: NumberOrNull
    readonly output: NumberOrNull
    readonly cacheRead: NumberOrNull
    readonly cacheWrite: NumberOrNull
    readonly region?: string
    readonly conditions?: string
    readonly tiers?: readonly Record<string, unknown>[]
  }
  readonly reasoningEfforts: Record<string, string | null>
  readonly sources: { readonly capabilities: string, readonly pricing: string }
}

const entries = catalog.models as readonly CatalogEntry[]
const allowedLevels = new Set<string>(REASONING_LEVELS)
const textOnlyModels = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'qwen3.7-max',
  'glm-5.3',
  'mimo-v2.5-pro',
  'hy3',
])
const expectedModels = [
  'gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8', 'claude-opus-5',
  'claude-sonnet-4.6', 'claude-sonnet-5', 'claude-fable-5',
  'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp',
  'grok-4.5', 'grok-4.6',
  'qwen3.7-max', 'qwen3.7-plus',
  'qwen3.7-flash', 'qwen3.8-max', 'qwen3.8-27b',
  'kimi-k3',
  'glm-5.3',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'hy3',
] as const

function isNonNegativeNumberOrNull(value: unknown): value is NumberOrNull {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

describe('model catalog', () => {
  it('contains exactly the curated 27 unique models', () => {
    expect(catalog.version).toBe(1)
    expect(entries).toHaveLength(27)
    expect(new Set(entries.map(entry => entry.model)).size).toBe(27)
    expect(entries.map(entry => entry.model).sort()).toEqual([...expectedModels].sort())
  })

  it('keeps complete, typed metadata and an explicit off level', () => {
    for (const entry of entries) {
      expect(entry.aliases).toEqual(expect.any(Array))
      expect(entry.aliases.every(alias => typeof alias === 'string' && alias.length > 0)).toBe(true)
      expect(entry.input).toEqual(textOnlyModels.has(entry.model) ? ['text'] : ['text', 'image'])
      expect(entry.contextWindow === null || (Number.isInteger(entry.contextWindow) && entry.contextWindow > 0)).toBe(true)
      expect(entry.maxOutputTokens === null || (Number.isInteger(entry.maxOutputTokens) && entry.maxOutputTokens > 0)).toBe(true)
      expect(entry.pricing.currency).toBe('USD')
      expect(entry.pricing.unit).toBe('per_million_tokens')
      expect(isNonNegativeNumberOrNull(entry.pricing.input)).toBe(true)
      expect(isNonNegativeNumberOrNull(entry.pricing.output)).toBe(true)
      expect(isNonNegativeNumberOrNull(entry.pricing.cacheRead)).toBe(true)
      expect(isNonNegativeNumberOrNull(entry.pricing.cacheWrite)).toBe(true)
      expect(entry.reasoningEfforts.off).toBeNull()
      expect(Object.keys(entry.reasoningEfforts).every(level => allowedLevels.has(level))).toBe(true)
      expect(Object.entries(entry.reasoningEfforts).every(([level, wire]) =>
        level === 'off' ? wire === null : wire === level)).toBe(true)
      for (const tier of entry.pricing.tiers ?? []) {
        expect(typeof tier.condition).toBe('string')
        for (const [key, value] of Object.entries(tier)) {
          if (key !== 'condition') expect(isNonNegativeNumberOrNull(value)).toBe(true)
        }
      }
      expect(new URL(entry.sources.capabilities).protocol).toBe('https:')
      expect(new URL(entry.sources.pricing).protocol).toBe('https:')
    }
  })

  it('does not include an open-weight Qwen model', () => {
    expect(entries.filter(entry => entry.model.includes('qwen3.6'))).toEqual([])
    expect(entries.map(entry => entry.model)).not.toContain('qwen3.8-2.4t-a95b')
  })

  it('resolves normalized user model identifiers without a provider', () => {
    expect(resolveModelEfforts('DeepSeek/DEEPSEEK_V4_FLASH')).toEqual({ off: null, high: 'high', max: 'max' })
  })

  it('resolves curated input modalities without a provider', () => {
    expect(resolveModelInput('DeepSeek/DEEPSEEK_V4_FLASH')).toEqual(['text'])
    expect(resolveModelInput('deepseek-v4-flash-vision-exp')).toEqual(['text', 'image'])
    expect(resolveModelInput('mimo-v2.5-pro')).toEqual(['text'])
  })

  it('resolves curated capacities without a provider', () => {
    expect(resolveModelCapacity('DeepSeek/DEEPSEEK_V4_FLASH')).toEqual({
      contextWindow: 1048576,
      maxTokens: 393216,
    })
    expect(resolveModelCapacity('deepseek-v4-pro')).toEqual({
      contextWindow: 1048576,
      maxTokens: 393216,
    })
    // pi-ai reads `maxTokens`, so the catalog's `maxOutputTokens` spelling is
    // translated by the resolver before it reaches a model entry.
    expect(resolveModelCapacity('gpt-5.4')).toEqual({
      contextWindow: 1050000,
      maxTokens: 128000,
    })
  })

  it('resolves no capacity for an unknown or underspecified model', () => {
    expect(resolveModelCapacity('unknown-model')).toBeUndefined()
    expect(resolveModelCapacity('gpt-5.4-2026-08-15')).toBeUndefined()
  })

  it('accepts a high-confidence typo with a unique best candidate', () => {
    expect(resolveModelEfforts('claude-sonet-4.6')).toEqual({
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('skips suffix variants, low-confidence names, and ambiguous candidates', () => {
    expect(resolveModelEfforts('gpt-5.4-2026-08-15')).toBeUndefined()
    expect(resolveModelEfforts('claude-opus')).toBeUndefined()
    expect(resolveModelEfforts('claude-opus-4.x')).toBeUndefined()
  })
})
