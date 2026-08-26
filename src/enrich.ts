/**
 * Pure derivation of the settings path-ops that backfill missing model
 * capabilities. The plugin owns no UI and no model state; this module is the
 * whole decision: which user-layer entries need a capability declaration.
 *
 * Only the user layer of `llm-pi-ai` is scanned. A model entry the user added
 * through the web "custom provider" card (or wrote into settings.yaml) lives
 * there; the composition base is owned by its own bundle and is never
 * rewritten. Entries that already carry `reasoningEfforts`, `input`, or
 * capacities are always left alone. The plugin only fills absence.
 *
 * Each provider gets ONE `set` op for its whole `models` array (and one for
 * its `modelOverrides` dict) rather than a per-index op: the settings seam's
 * path mutation treats arrays as opaque values, so an index-addressed op would
 * replace the array with an object. Replacing the whole array also mirrors
 * how the web Models page writes its model lists.
 *
 * @module dsh-reasoning-effort/enrich
 */

import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ReasoningEfforts } from './config.js'
import type { ModelCapacity, ModelInput } from './model-catalog.js'
import type { ReasoningCapability } from './plugin-settings.js'

export type ModelEffortResolver = (modelId: string) => ReasoningEfforts | undefined
export type ModelInputResolver = (modelId: string) => ModelInput | undefined
export type ModelCapacityResolver = (modelId: string) => ModelCapacity | undefined
export type ModelCapabilityOverrideResolver = (
  providerId: string,
  modelId: string,
) => ReasoningCapability | undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A detached efforts object, so each stored op owns its own JSON value. */
function copyEfforts(efforts: ReasoningEfforts): ReasoningEfforts {
  return { ...efforts }
}

function copyInput(input: ModelInput): ModelInput {
  return [...input]
}

function copyCapability(capability: ReasoningCapability): ReasoningCapability {
  return capability === false ? false : copyEfforts(capability)
}

/** Compare the small, flat capability value without serializing user data. */
function capabilityEquals(value: unknown, expected: ReasoningCapability): boolean {
  if (expected === false) return value === false
  if (!isPlainObject(value)) return false
  const valueEntries = Object.entries(value)
  const expectedEntries = Object.entries(expected)
  if (valueEntries.length !== expectedEntries.length) return false
  return expectedEntries.every(([level, wire]) => value[level] === wire)
}

/**
 * One model entry with the capability declaration added when it was missing;
 * otherwise the entry is returned untouched (identity, not value, matters only
 * for the enclosing array — a deep-equal no-op array never becomes an op).
 */
function modelIdFor(entry: Record<string, unknown>, fallback?: string): string | undefined {
  for (const key of ['id', 'model', 'name']) {
    const value = entry[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return fallback
}

function enrichedEntry(
  entry: unknown,
  resolveEfforts: ModelEffortResolver,
  resolveOverride: ModelCapabilityOverrideResolver,
  resolveInput: ModelInputResolver,
  resolveCapacity: ModelCapacityResolver,
  providerId: string,
  fallbackModelId?: string,
): unknown {
  if (!isPlainObject(entry)) return entry
  const modelId = modelIdFor(entry, fallbackModelId)
  if (modelId === undefined) return entry
  const changes: Record<string, unknown> = {}
  const override = resolveOverride(providerId, modelId)
  if (override !== undefined) {
    if (!capabilityEquals(entry['reasoningEfforts'], override)) {
      changes.reasoningEfforts = copyCapability(override)
    }
  } else if (entry['reasoningEfforts'] === undefined) {
    const efforts = resolveEfforts(modelId)
    if (efforts !== undefined) changes.reasoningEfforts = copyEfforts(efforts)
  }
  if (entry['input'] === undefined) {
    const input = resolveInput(modelId)
    if (input !== undefined) changes.input = copyInput(input)
  }
  if (entry['contextWindow'] === undefined || entry['maxTokens'] === undefined) {
    const capacity = resolveCapacity(modelId)
    if (capacity !== undefined) {
      // The pi-ai model entry reads `maxTokens`, not the catalog's
      // `maxOutputTokens` spelling. Backfill only the missing half so a
      // user-sized model keeps its own values.
      if (entry['contextWindow'] === undefined) changes.contextWindow = capacity.contextWindow
      if (entry['maxTokens'] === undefined) changes.maxTokens = capacity.maxTokens
    }
  }
  return Object.keys(changes).length === 0 ? entry : { ...entry, ...changes }
}

/**
 * Compute the `set` ops that give only catalog-recognized model entries missing
 * `reasoningEfforts`, `input`, or capacities their supported capability
 * declarations. Capacities come from the same catalog match, so a third-party
 * DeepSeek route stops falling back to the adapter's 262,144 guess.
 * @param user - the raw `llm-pi-ai` user section (detached descriptor copy).
 * @param resolveEfforts - returns a supported map for a recognized model.
 * @param resolveOverride - returns an explicit exact-route user override.
 * @param resolveInput - returns supported input modalities for a recognized model.
 * @param resolveCapacity - returns supported capacities for a recognized model.
 * @returns path ops addressing `providers.<route>.models` and
 *   `providers.<route>.modelOverrides`, in document order.
 */
export function computeEnrichmentOps(
  user: unknown,
  resolveEfforts: ModelEffortResolver,
  resolveOverride: ModelCapabilityOverrideResolver = () => undefined,
  resolveInput: ModelInputResolver = () => undefined,
  resolveCapacity: ModelCapacityResolver = () => undefined,
): readonly SettingsPathOp[] {
  if (!isPlainObject(user)) return []
  const providers = user['providers']
  if (!isPlainObject(providers)) return []
  const ops: SettingsPathOp[] = []

  for (const [route, profileValue] of Object.entries(providers)) {
    if (!isPlainObject(profileValue)) continue
    const profile = profileValue

    const models = profile['models']
    if (Array.isArray(models)) {
      const next = models.map(entry =>
        enrichedEntry(entry, resolveEfforts, resolveOverride, resolveInput, resolveCapacity, route))
      if (next.some((entry, index) => entry !== models[index])) {
        ops.push({
          op: 'set',
          path: ['providers', route, 'models'],
          value: next,
        })
      }
    }

    const overrides = profile['modelOverrides']
    if (isPlainObject(overrides)) {
      const next: Record<string, unknown> = {}
      let changed = false
      for (const [model, entry] of Object.entries(overrides)) {
        const enriched = enrichedEntry(
          entry, resolveEfforts, resolveOverride, resolveInput, resolveCapacity, route, model,
        )
        Object.defineProperty(next, model, {
          value: enriched, enumerable: true, configurable: true, writable: true,
        })
        changed ||= enriched !== entry
      }
      if (changed) {
        ops.push({
          op: 'set',
          path: ['providers', route, 'modelOverrides'],
          value: next,
        })
      }
    }
  }

  return ops
}
