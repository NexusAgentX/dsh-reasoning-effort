/**
 * Pure derivation of the settings path-ops that backfill missing reasoning
 * efforts. The plugin owns no UI and no model state; this module is the whole
 * decision: which user-layer entries need a capability declaration.
 *
 * Only the user layer of `llm-pi-ai` is scanned. A model entry the user added
 * through the web "custom provider" card (or wrote into settings.yaml) lives
 * there; the composition base is owned by its own bundle and is never
 * rewritten. Entries that already carry `reasoningEfforts` — a partial map,
 * the full map, or an explicit `false` ("non-reasoning model") — are always
 * left alone. The plugin only fills absence.
 *
 * Each provider gets ONE `set` op for its whole `models` array (and one for
 * its `modelOverrides` dict) rather than a per-index op: the settings seam's
 * path mutation treats arrays as opaque values, so an index-addressed op would
 * replace the array with an object. Replacing the whole array also mirrors
 * how the web Models page writes its model lists.
 *
 * @module dsh-providers-reasoning/enrich
 */

import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ReasoningEfforts } from './config.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A detached efforts object, so each stored op owns its own JSON value. */
function copyEfforts(efforts: ReasoningEfforts): ReasoningEfforts {
  return { ...efforts }
}

/**
 * One model entry with the capability declaration added when it was missing;
 * otherwise the entry is returned untouched (identity, not value, matters only
 * for the enclosing array — a deep-equal no-op array never becomes an op).
 */
function enrichedEntry(entry: unknown, efforts: ReasoningEfforts): unknown {
  if (!isPlainObject(entry)) return entry
  if (entry['reasoningEfforts'] !== undefined) return entry
  return { ...entry, reasoningEfforts: copyEfforts(efforts) }
}

/**
 * Compute the `set` ops that give every model entry missing `reasoningEfforts`
 * the configured map.
 * @param user - the raw `llm-pi-ai` user section (detached descriptor copy).
 * @param efforts - the validated map to backfill.
 * @returns path ops addressing `providers.<route>.models` and
 *   `providers.<route>.modelOverrides`, in document order.
 */
export function computeEnrichmentOps(user: unknown, efforts: ReasoningEfforts): readonly SettingsPathOp[] {
  if (!isPlainObject(user)) return []
  const providers = user['providers']
  if (!isPlainObject(providers)) return []
  const ops: SettingsPathOp[] = []

  for (const [route, profileValue] of Object.entries(providers)) {
    if (!isPlainObject(profileValue)) continue
    const profile = profileValue

    const models = profile['models']
    if (Array.isArray(models) && models.some(entry => entry !== undefined
      && isPlainObject(entry) && entry['reasoningEfforts'] === undefined)) {
      ops.push({
        op: 'set',
        path: ['providers', route, 'models'],
        value: models.map(entry => enrichedEntry(entry, efforts)),
      })
    }

    const overrides = profile['modelOverrides']
    if (isPlainObject(overrides) && Object.values(overrides).some(entry =>
      isPlainObject(entry) && entry['reasoningEfforts'] === undefined)) {
      const next: Record<string, unknown> = {}
      for (const [model, entry] of Object.entries(overrides)) {
        next[model] = enrichedEntry(entry, efforts)
      }
      ops.push({
        op: 'set',
        path: ['providers', route, 'modelOverrides'],
        value: next,
      })
    }
  }

  return ops
}
