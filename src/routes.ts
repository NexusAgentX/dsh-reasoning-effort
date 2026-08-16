/** Exact-route reads shared by Host enrichment, migration, and request injection. */

import { resolveConfig } from './config.js'
import type { ReasoningEfforts } from './config.js'
import { resolveModelEfforts } from './model-catalog.js'
import type { ReasoningCapability, ReasoningPluginSettings } from './plugin-settings.js'
import type { ReasoningPathOp } from './remote-contract.js'

type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function own(record: UnknownRecord, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** Parse one declared capability without consulting inherited keys. */
export function capabilityOf(value: unknown): ReasoningCapability | undefined {
  if (value === false) return false
  if (!isRecord(value)) return undefined
  try {
    const parsed = resolveConfig({ efforts: value }).efforts
    return parsed === undefined ? undefined : { ...parsed }
  } catch {
    return undefined
  }
}

/** Read one plugin-owned capability override by exact route. */
export function routeCapability(
  settings: ReasoningPluginSettings,
  provider: string,
  model: string,
): ReasoningCapability | undefined {
  if (!Object.hasOwn(settings.models, provider)) return undefined
  const models = settings.models[provider]
  return models !== undefined && Object.hasOwn(models, model) ? models[model] : undefined
}

/** Read one plugin-owned default by exact route. */
export function routeDefault(
  settings: ReasoningPluginSettings,
  provider: string,
  model: string,
): string | undefined {
  if (!Object.hasOwn(settings.defaults, provider)) return undefined
  const models = settings.defaults[provider]
  return models !== undefined && Object.hasOwn(models, model) ? nonEmptyString(models[model]) : undefined
}

/** Find an exact raw user-added pi-ai model entry. */
export function rawModelEntry(piAiUser: unknown, provider: string, model: string): UnknownRecord | undefined {
  if (!isRecord(piAiUser)) return undefined
  const providers = own(piAiUser, 'providers')
  if (!isRecord(providers) || !Object.hasOwn(providers, provider)) return undefined
  const profile = providers[provider]
  if (!isRecord(profile)) return undefined
  const models = own(profile, 'models')
  if (!Array.isArray(models)) return undefined
  return models.find(entry => isRecord(entry) && own(entry, 'id') === model) as UnknownRecord | undefined
}

/** Resolve the effective selectable effort map for one raw user route. */
export function effectiveRouteCapability(
  settings: ReasoningPluginSettings,
  piAiUser: unknown,
  provider: string,
  model: string,
): ReasoningCapability | undefined {
  const explicit = routeCapability(settings, provider, model)
  if (explicit !== undefined) return explicit
  const entry = rawModelEntry(piAiUser, provider, model)
  if (entry === undefined) return undefined
  if (Object.hasOwn(entry, 'reasoningEfforts')) return capabilityOf(entry.reasoningEfforts)
  const catalog = resolveModelEfforts(model)
  return catalog === undefined ? undefined : { ...catalog }
}

/** Return the stored default only while the route still advertises that level. */
export function validRouteDefault(
  settings: ReasoningPluginSettings,
  piAiUser: unknown,
  provider: string,
  model: string,
): string | undefined {
  const effort = routeDefault(settings, provider, model)
  if (effort === undefined) return undefined
  const capability = effectiveRouteCapability(settings, piAiUser, provider, model)
  return capability !== undefined && capability !== false && Object.hasOwn(capability, effort)
    ? effort
    : undefined
}

function nestedString(root: unknown, provider: string, model: string): string | undefined {
  if (!isRecord(root) || !Object.hasOwn(root, provider)) return undefined
  const models = root[provider]
  return isRecord(models) && Object.hasOwn(models, model) ? nonEmptyString(models[model]) : undefined
}

/** Copy legacy Harness route defaults into plugin ownership without overwriting existing values. */
export function computeLegacyDefaultOps(
  settings: ReasoningPluginSettings,
  piAiUser: unknown,
  agentDefaultValue: unknown,
): ReasoningPathOp[] {
  if (!isRecord(piAiUser) || !isRecord(agentDefaultValue)) return []
  const providers = own(piAiUser, 'providers')
  if (!isRecord(providers)) return []
  const oldDefaults = own(agentDefaultValue, 'reasoningDefaults')
  const currentProvider = nonEmptyString(own(agentDefaultValue, 'provider'))
  const currentModel = nonEmptyString(own(agentDefaultValue, 'model'))
  const legacyEffort = nonEmptyString(own(agentDefaultValue, 'reasoningEffort'))
  const ops: ReasoningPathOp[] = []

  for (const [provider, profile] of Object.entries(providers)) {
    if (!isRecord(profile) || !Array.isArray(profile.models)) continue
    for (const entry of profile.models) {
      if (!isRecord(entry)) continue
      const model = nonEmptyString(own(entry, 'id'))
      if (model === undefined || routeDefault(settings, provider, model) !== undefined) continue
      const old = nestedString(oldDefaults, provider, model)
      const legacy = provider === currentProvider && model === currentModel ? legacyEffort : undefined
      const effort = old ?? legacy
      if (effort === undefined) continue
      const capability = effectiveRouteCapability(settings, piAiUser, provider, model)
      if (capability === undefined || capability === false || !Object.hasOwn(capability, effort)) continue
      ops.push({ op: 'set', path: ['defaults', provider, model], value: effort })
    }
  }
  return ops
}

/** Detached effort map helper for tests and Remote validation. */
export function effortsOf(capability: ReasoningCapability | undefined): ReasoningEfforts | undefined {
  return capability === undefined || capability === false ? undefined : { ...capability }
}
