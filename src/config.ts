/**
 * Plugin configuration: the reasoning-effort map backfilled onto every
 * llm-pi-ai model entry that declares none.
 *
 * The default mirrors the pi-ai capability contract (`@deepseek-ai/dsh-llm-pi-ai`):
 * each key is a selectable level shown by the composer, each value is the wire
 * spelling dispatch sends for that level, and `off` may leave the value empty
 * ("selected = send nothing"). The seven levels are pi-ai's canonical
 * escalation order; keeping this list complete means a newly added third-party
 * model gets the full selector out of the box, exactly like the shipped
 * adapters that know their capabilities.
 *
 * @module dsh-providers-reasoning/config
 */

import z from '@deepseek-ai/schemastery'

/** pi-ai's canonical thinking levels, in escalation order. */
export const REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

/** One model's declared reasoning efforts: level → wire spelling (null only for `off`). */
export type ReasoningEfforts = Partial<Record<ReasoningLevel, string | null>>

/** Default map backfilled onto every model missing `reasoningEfforts`. */
export const DEFAULT_EFFORTS: ReasoningEfforts = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** Runtime contract after the schema and the semantic gate. */
export interface ResolvedConfig {
  /** Detached map actually written for a missing model entry. */
  efforts: ReasoningEfforts
}

/**
 * The same dict shape `@deepseek-ai/dsh-llm-pi-ai` accepts on a model entry:
 * keys restricted to the canonical levels, values a wire string or `null`
 * (schemastery passes a nullable `off` through before member schemas run; the
 * semantic gate below decides where null is legal).
 */
const effortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(REASONING_LEVELS),
) as unknown as z<ReasoningEfforts>

/**
 * Cordis Loader schema (strict): defaults the full seven-level map. The
 * semantic rules the schema cannot express — only `off` may be valueless and
 * at least one thinking level must remain — are enforced by
 * {@link resolveConfig}, which `apply` always runs.
 */
export const Config = z.object({
  efforts: effortsSchema.default(DEFAULT_EFFORTS),
})

/** Top-level config keys the Loader may pass. */
const CONFIG_KEYS: ReadonlySet<string> = new Set(['efforts'])

/**
 * Validate the loader output and return the runtime contract. Schemastery
 * merges unknown object keys by default, so top-level strictness is explicit,
 * mirroring the dsh-advisor pattern.
 * @param raw - the plugin row config handed to `apply`.
 * @returns the detached, semantic-checked efforts map.
 */
export function resolveConfig(raw: unknown): ResolvedConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('dsh-providers-reasoning: configuration must be a plain object')
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`dsh-providers-reasoning: unknown config key "${key}"`)
    }
  }
  const parsed = Config(raw)
  const efforts = parsed.efforts as ReasoningEfforts
  const levels = Object.keys(efforts)
  if (levels.length === 0) {
    throw new Error('dsh-providers-reasoning: efforts must declare at least one reasoning level')
  }
  let thinkingLevel = false
  for (const [level, wire] of Object.entries(efforts)) {
    if (!(REASONING_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`dsh-providers-reasoning: unknown reasoning level "${level}"`)
    }
    if (wire === null) {
      if (level !== 'off') {
        throw new Error(`dsh-providers-reasoning: only "off" may leave its wire spelling empty (${level} needs a value)`)
      }
    } else if (typeof wire !== 'string' || wire.length === 0) {
      throw new Error(`dsh-providers-reasoning: reasoningEfforts.${level} must be a non-empty string or, for "off", null`)
    }
    if (level !== 'off') thinkingLevel = true
  }
  if (!thinkingLevel) {
    throw new Error('dsh-providers-reasoning: efforts must offer at least one level beyond "off"')
  }
  // Detached snapshot: the Loader may freeze or reuse its config objects, and
  // every mutate op needs an independent value so one write cannot alias the
  // config instance another write is validating.
  return { efforts: { ...efforts } }
}
