/**
 * Bundled, provider-independent model capability catalog. The matcher is
 * intentionally conservative: a low-confidence candidate must not cause an
 * unsupported reasoning parameter to be sent to a user's provider.
 *
 * @module dsh-reasoning-effort/model-catalog
 */

import catalog from '../models.json'
import type { ReasoningEfforts } from './config.js'

export type ModelInput = readonly ('text' | 'image')[]

interface CatalogModel {
  readonly model: string
  readonly aliases: readonly string[]
  readonly input: ModelInput
  readonly reasoningEfforts: ReasoningEfforts
}

interface CatalogDocument {
  readonly version: number
  readonly models: readonly CatalogModel[]
}

export const modelCatalog = catalog as CatalogDocument

const MATCH_THRESHOLD = 0.9
const MINIMUM_MARGIN = 0.08

function normalizeModelName(value: string): string {
  const pathTail = value.trim().toLowerCase().split('/').at(-1) ?? ''
  return pathTail.replace(/[^a-z0-9]/g, '')
}

function similarity(left: string, right: string): number {
  if (left === right) return 1
  if (left.length === 0 || right.length === 0) return 0

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + cost,
      )
      diagonal = above
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length)
}

function resolveCatalogModel(modelId: unknown): CatalogModel | undefined {
  if (typeof modelId !== 'string') return undefined
  const normalized = normalizeModelName(modelId)
  if (normalized.length === 0) return undefined

  for (const model of modelCatalog.models) {
    if ([model.model, ...model.aliases].some(name => normalizeModelName(name) === normalized)) {
      return model
    }
  }

  const scored = modelCatalog.models
    .map(model => ({
      model,
      score: Math.max(...[model.model, ...model.aliases].map(name => similarity(normalized, normalizeModelName(name)))),
    }))
    .sort((left, right) => right.score - left.score)
  const [best, runnerUp] = scored
  if (best === undefined || best.score < MATCH_THRESHOLD) return undefined
  if (runnerUp !== undefined && best.score - runnerUp.score < MINIMUM_MARGIN) return undefined
  return best.model
}

function copyEfforts(efforts: ReasoningEfforts): ReasoningEfforts {
  return { ...efforts }
}

function copyInput(input: ModelInput): ModelInput {
  return [...input]
}

/**
 * Resolve a user-entered model identifier to its curated effort map. Exact
 * normalized model names and aliases win; fuzzy matches need a high score and
 * a clear lead over every other candidate.
 */
export function resolveModelEfforts(modelId: unknown): ReasoningEfforts | undefined {
  const model = resolveCatalogModel(modelId)
  return model === undefined ? undefined : copyEfforts(model.reasoningEfforts)
}

/** Resolve a user-entered model identifier to its curated input modalities. */
export function resolveModelInput(modelId: unknown): ModelInput | undefined {
  const model = resolveCatalogModel(modelId)
  return model === undefined ? undefined : copyInput(model.input)
}
