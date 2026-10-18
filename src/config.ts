/**
 * Plugin configuration and exact-route reasoning capability schema.
 *
 * The catalog effort override is ordinary configuration. The route capability
 * and default maps are volatile so the DSH settings editor can update them
 * live; `apply` reads them through the stable Config references on every
 * request.
 *
 * @module dsh-reasoning-effort/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { REASONING_LEVELS } from './constants.js'

export { REASONING_LEVELS } from './constants.js'

export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

/** One model's declared reasoning efforts: level → wire spelling (null only for `off`). */
export type ReasoningEfforts = Partial<Record<ReasoningLevel, string | null>>

/** One exact route either disables reasoning or declares its selectable wire map. */
export type ReasoningCapability = false | ReasoningEfforts

/** User configuration owned by this plugin entry. */
export interface ReasoningPluginSettings {
  /** provider -> model -> explicit capability override. */
  models: Record<string, Record<string, ReasoningCapability>>
  /** provider -> model -> exact-route default reasoning level. */
  defaults: Record<string, Record<string, string>>
  /** Prevent legacy Harness defaults from being re-imported after the first migration. */
  legacyDefaultsMigrated: boolean
}

/** Legacy seven-level preset for users who explicitly override catalog values. */
export const DEFAULT_EFFORTS: ReasoningEfforts = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

const reasoningEffortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(REASONING_LEVELS),
) as unknown as z<ReasoningEfforts>

const capabilitySchema = z.union([
  z.const(false),
  reasoningEffortsSchema,
]) as unknown as z<ReasoningCapability>

const modelsSchema = z.dict(z.dict(capabilitySchema)).default({}) as unknown as z<ReasoningPluginSettings['models']>
const defaultsSchema = z.dict(z.dict(z.string())).default({}) as unknown as z<ReasoningPluginSettings['defaults']>
const legacyDefaultsMigratedSchema = z.boolean().default(false) as unknown as z<boolean>

/** Runtime schema for the plugin-owned settings section. */
export const ReasoningPluginSettingsSchema = z.object({
  models: modelsSchema,
  defaults: defaultsSchema,
  legacyDefaultsMigrated: legacyDefaultsMigratedSchema,
}) as unknown as z<ReasoningPluginSettings>

/** Fresh composition base for one plugin installation. */
export function emptyReasoningPluginSettings(): ReasoningPluginSettings {
  return { models: {}, defaults: {}, legacyDefaultsMigrated: false }
}

/** Enforce semantic constraints schemastery's nested dict cannot express. */
export function validateReasoningPluginSettings(settings: ReasoningPluginSettings): void {
  for (const [provider, models] of Object.entries(settings.models)) {
    if (provider.length === 0) {
      throw new Error('dsh-reasoning-effort: provider keys must be non-empty')
    }
    for (const [model, capability] of Object.entries(models)) {
      if (model.length === 0) {
        throw new Error(`dsh-reasoning-effort: model keys under provider "${provider}" must be non-empty`)
      }
      if (capability !== false) resolveConfig({ efforts: capability })
    }
  }
  for (const [provider, models] of Object.entries(settings.defaults)) {
    if (provider.length === 0) {
      throw new Error('dsh-reasoning-effort: default provider keys must be non-empty')
    }
    for (const [model, effort] of Object.entries(models)) {
      if (model.length === 0 || effort.length === 0) {
        throw new Error(`dsh-reasoning-effort: defaults under provider "${provider}" need non-empty model and effort values`)
      }
    }
  }
}

const optionalEffortsSchema = z.union([z.const(undefined), reasoningEffortsSchema]) as unknown as z<ReasoningEfforts | undefined>

/** Loader configuration after schemastery validation. */
export interface Config {
  /** Optional legacy catalog override. */
  efforts?: ReasoningEfforts
  /** Exact-route capability overrides, editable live through settings. */
  models: Volatile<ReasoningPluginSettings['models']>
  /** Exact-route default efforts, editable live through settings. */
  defaults: Volatile<ReasoningPluginSettings['defaults']>
  /** One-shot legacy migration marker. */
  legacyDefaultsMigrated: Volatile<boolean>
}

/** Cordis Loader schema. */
export const Config = z.object({
  efforts: optionalEffortsSchema,
  models: modelsSchema.volatile(),
  defaults: defaultsSchema.volatile(),
  legacyDefaultsMigrated: legacyDefaultsMigratedSchema.volatile(),
}) as unknown as z<Config>

/** Runtime contract after the schema and the semantic gate. */
export interface ResolvedConfig {
  /** Optional detached override written only to catalog-matched model entries. */
  efforts?: ReasoningEfforts
}

/** Live plugin settings plus the ordinary effort override. */
export interface ResolvedRuntimeConfig extends ResolvedConfig {
  /** Read the latest volatile plugin settings snapshot. */
  settings(): ReasoningPluginSettings
}

/** Top-level config keys the Loader may pass. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'efforts', 'models', 'defaults', 'legacyDefaultsMigrated',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function plain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(entry => plain(entry)) as T
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)])) as T
  }
  return value
}

function current<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback
  if (isRecord(value) && typeof value.get === 'function') {
    return plain((value.get as () => T)())
  }
  return plain(value as T)
}

/** Validate the ordinary effort override and detach its value. */
export function resolveConfig(raw: unknown): ResolvedConfig {
  if (!isRecord(raw)) {
    throw new TypeError('dsh-reasoning-effort: configuration must be a plain object')
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`dsh-reasoning-effort: unknown config key "${key}"`)
    }
  }
  const efforts = optionalEffortsSchema(raw.efforts as ReasoningEfforts | undefined)
  if (efforts === undefined) return {}
  const levels = Object.keys(efforts)
  if (levels.length === 0) {
    throw new Error('dsh-reasoning-effort: efforts must declare at least one reasoning level')
  }
  let thinkingLevel = false
  for (const [level, wire] of Object.entries(efforts)) {
    if (!(REASONING_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`dsh-reasoning-effort: unknown reasoning level "${level}"`)
    }
    if (wire === null) {
      if (level !== 'off') {
        throw new Error(`dsh-reasoning-effort: only "off" may leave its wire spelling empty (${level} needs a value)`)
      }
    } else if (typeof wire !== 'string' || wire.length === 0) {
      throw new Error(`dsh-reasoning-effort: reasoningEfforts.${level} must be a non-empty string or, for "off", null`)
    }
    if (level !== 'off') thinkingLevel = true
  }
  if (!thinkingLevel) {
    throw new Error('dsh-reasoning-effort: efforts must offer at least one level beyond "off"')
  }
  return { efforts: { ...efforts } }
}

/** Resolve Loader config references into a live settings reader. */
export function resolveRuntimeConfig(raw: unknown): ResolvedRuntimeConfig {
  const resolved = resolveConfig(raw)
  const config = raw as Record<string, unknown>
  const settings = (): ReasoningPluginSettings => {
    const value: ReasoningPluginSettings = {
      models: current(config.models, emptyReasoningPluginSettings().models),
      defaults: current(config.defaults, emptyReasoningPluginSettings().defaults),
      legacyDefaultsMigrated: current(config.legacyDefaultsMigrated, false),
    }
    validateReasoningPluginSettings(value)
    return value
  }
  // Validate the initial snapshot eagerly so a malformed composition fails
  // while the plugin is mounting rather than on the first request.
  settings()
  return { ...resolved, settings }
}
