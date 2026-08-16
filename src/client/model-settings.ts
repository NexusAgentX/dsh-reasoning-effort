/** Pure projection and save planning for the reasoning settings page. */

import type { ReasoningEfforts } from '../config.js'
import type { ReasoningCapability } from '../plugin-settings.js'
import type { ReasoningNamespaceDocument, ReasoningPathOp } from '../remote-contract.js'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
  REASONING_LEVELS,
} from '../constants.js'
import { resolveModelEfforts } from '../model-catalog.js'

type JsonRecord = Record<string, unknown>

/** One user-added exact model route rendered by the page. */
export interface ReasoningSettingsModel {
  key: string
  provider: string
  providerName: string
  model: string
  modelName: string
  /** Effective capability before local edits; undefined means no declaration or catalog match. */
  capability: ReasoningCapability | undefined
  /** Persisted exact-route default, including the legacy current-route fallback. */
  defaultEffort: string | undefined
}

/** Consistent settings cut used for editing and revision-fenced writes. */
export interface ReasoningSettingsSnapshot {
  writable: boolean
  models: readonly ReasoningSettingsModel[]
  pluginRevision: number
  agentDefaultRevision: number
  currentProvider: string | undefined
  currentModel: string | undefined
  legacyReasoningEffort: string | undefined
}

/** Mutable UI draft for one model. */
export interface ReasoningModelDraft {
  enabled: boolean
  efforts: ReasoningEfforts
  defaultEffort: string | undefined
}

/** Exact fields the user changed; refreshed server data outside this set is never written back. */
export interface ReasoningDirtyFields {
  capabilities: ReadonlySet<string>
  defaults: ReadonlySet<string>
}

/** One validation failure addressed to its exact model row. */
export interface DraftValidationError {
  key: string
  code: 'needs-level' | 'invalid-wire' | 'invalid-default'
}

/** Atomic operations split by their owning settings namespaces. */
export interface ReasoningSavePlan {
  pluginOps: ReasoningPathOp[]
  agentDefaultOps: ReasoningPathOp[]
  errors: DraftValidationError[]
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/** Opaque local key; provider and model ids are never parsed out of it. */
export function modelRouteKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

function capabilityOf(value: unknown): ReasoningCapability | undefined {
  if (value === false) return false
  if (!isRecord(value)) return undefined
  const efforts: ReasoningEfforts = {}
  for (const level of REASONING_LEVELS) {
    if (!hasOwn(value, level)) continue
    const wire = value[level]
    if (typeof wire !== 'string' && wire !== null) return undefined
    efforts[level] = wire
  }
  return efforts
}

function copyCapability(capability: ReasoningCapability | undefined): ReasoningCapability | undefined {
  return capability === undefined || capability === false ? capability : { ...capability }
}

function nestedValue(root: unknown, first: string, second: string): unknown {
  if (!isRecord(root) || !hasOwn(root, first)) return undefined
  const firstValue = root[first]
  return isRecord(firstValue) && hasOwn(firstValue, second) ? firstValue[second] : undefined
}

function namespaceOf(
  namespaces: readonly ReasoningNamespaceDocument[],
  id: string,
): ReasoningNamespaceDocument | undefined {
  return namespaces.find(namespace => namespace.ns === id)
}

/**
 * Project only raw user-added pi-ai `models` entries. Catalog defaults and
 * `modelOverrides` stay out of the page by construction.
 */
export function collectReasoningSettings(
  namespaces: readonly ReasoningNamespaceDocument[],
  writable: boolean,
): ReasoningSettingsSnapshot {
  const piAi = namespaceOf(namespaces, PI_AI_SETTINGS_NAMESPACE_ID)
  const plugin = namespaceOf(namespaces, PLUGIN_SETTINGS_NAMESPACE_ID)
  const agentDefault = namespaceOf(namespaces, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)
  const piAiUser = isRecord(piAi?.user) ? piAi.user : {}
  const providers = isRecord(piAiUser['providers']) ? piAiUser['providers'] : {}
  const pluginValue = isRecord(plugin?.value) ? plugin.value : {}
  const pluginModels = isRecord(pluginValue['models']) ? pluginValue['models'] : {}
  const pluginDefaults = isRecord(pluginValue['defaults']) ? pluginValue['defaults'] : {}
  const legacyDefaultsMigrated = pluginValue['legacyDefaultsMigrated'] === true
  const agentValue = isRecord(agentDefault?.value) ? agentDefault.value : {}
  const oldReasoningDefaults = isRecord(agentValue['reasoningDefaults']) ? agentValue['reasoningDefaults'] : {}
  const currentProvider = nonEmptyString(agentValue['provider'])
  const currentModel = nonEmptyString(agentValue['model'])
  const legacyReasoningEffort = nonEmptyString(agentValue['reasoningEffort'])
  const models: ReasoningSettingsModel[] = []
  const seen = new Set<string>()

  for (const [provider, profileValue] of Object.entries(providers)) {
    if (!isRecord(profileValue) || !Array.isArray(profileValue['models'])) continue
    const providerName = nonEmptyString(profileValue['displayName']) ?? provider
    const providerOverrides = hasOwn(pluginModels, provider) && isRecord(pluginModels[provider])
      ? pluginModels[provider]
      : {}
    for (const entry of profileValue['models']) {
      if (!isRecord(entry)) continue
      const model = nonEmptyString(entry['id'])
      if (model === undefined) continue
      const key = modelRouteKey(provider, model)
      if (seen.has(key)) continue
      seen.add(key)
      const hasExplicit = hasOwn(providerOverrides, model)
      const hasDeclared = hasOwn(entry, 'reasoningEfforts')
      const explicit = hasExplicit ? capabilityOf(providerOverrides[model]) : undefined
      const declared = hasDeclared ? capabilityOf(entry['reasoningEfforts']) : undefined
      // Presence is ownership even when an old hand-written value is invalid
      // (notably null). Only true absence may consult the read-only catalog.
      const capability = hasExplicit
        ? explicit
        : hasDeclared
          ? declared
          : resolveModelEfforts(model)
      const storedDefault = nonEmptyString(nestedValue(pluginDefaults, provider, model))
      const oldStoredDefault = nonEmptyString(nestedValue(oldReasoningDefaults, provider, model))
      const legacyDefault = provider === currentProvider && model === currentModel
        ? legacyReasoningEffort
        : undefined
      models.push({
        key,
        provider,
        providerName,
        model,
        modelName: nonEmptyString(entry['name']) ?? model,
        capability: copyCapability(capability),
        defaultEffort: storedDefault ?? (legacyDefaultsMigrated ? undefined : oldStoredDefault ?? legacyDefault),
      })
    }
  }

  return {
    writable,
    models,
    pluginRevision: plugin?.revision ?? 0,
    agentDefaultRevision: agentDefault?.revision ?? 0,
    currentProvider,
    currentModel,
    legacyReasoningEffort,
  }
}

/** Create detached drafts from one server snapshot. */
export function draftsOf(models: readonly ReasoningSettingsModel[]): Record<string, ReasoningModelDraft> {
  return Object.fromEntries(models.map((model) => {
    const capability = model.capability
    return [model.key, {
      enabled: capability !== undefined && capability !== false,
      efforts: capability !== undefined && capability !== false ? { ...capability } : {},
      defaultEffort: model.defaultEffort,
    } satisfies ReasoningModelDraft]
  }))
}

/** Merge a refreshed server snapshot without replacing fields the user is editing. */
export function mergeRefreshedDrafts(
  models: readonly ReasoningSettingsModel[],
  drafts: Readonly<Record<string, ReasoningModelDraft>>,
  dirty: ReasoningDirtyFields,
): Record<string, ReasoningModelDraft> {
  const refreshed = draftsOf(models)
  return Object.fromEntries(models.map((model) => {
    const fresh = refreshed[model.key]!
    const previous = drafts[model.key]
    if (previous === undefined) return [model.key, fresh]
    const keepCapability = dirty.capabilities.has(model.key)
    return [model.key, {
      enabled: keepCapability ? previous.enabled : fresh.enabled,
      efforts: { ...(keepCapability ? previous.efforts : fresh.efforts) },
      defaultEffort: dirty.defaults.has(model.key) ? previous.defaultEffort : fresh.defaultEffort,
    } satisfies ReasoningModelDraft]
  }))
}

function capabilityEquals(
  left: ReasoningCapability | undefined,
  right: ReasoningCapability,
): boolean {
  if (left === undefined) return right === false
  if (left === false || right === false) return left === right
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([level, wire]) => right[level as keyof ReasoningEfforts] === wire)
}

/** Build path-level writes and validate every changed draft before any request leaves. */
export function buildReasoningSavePlan(
  snapshot: ReasoningSettingsSnapshot,
  drafts: Readonly<Record<string, ReasoningModelDraft>>,
  dirty?: ReasoningDirtyFields,
): ReasoningSavePlan {
  const pluginOps: ReasoningPathOp[] = []
  const agentDefaultOps: ReasoningPathOp[] = []
  const errors: DraftValidationError[] = []

  for (const model of snapshot.models) {
    const draft = drafts[model.key]
    if (draft === undefined) continue
    const errorsBefore = errors.length
    const draftCapability: ReasoningCapability = draft.enabled ? { ...draft.efforts } : false
    const capabilityChanged = !capabilityEquals(model.capability, draftCapability)
    const defaultChanged = draft.defaultEffort !== model.defaultEffort
    const capabilityDirty = dirty?.capabilities.has(model.key) ?? capabilityChanged
    const defaultDirty = dirty?.defaults.has(model.key) ?? defaultChanged
    const validate = dirty === undefined || capabilityDirty || defaultDirty
    const validationCapability = dirty !== undefined && !capabilityDirty
      ? model.capability
      : draftCapability
    const validationDefault = dirty !== undefined && !defaultDirty
      ? model.defaultEffort
      : draft.defaultEffort
    const validationEnabled = validationCapability !== undefined && validationCapability !== false
    const validationEfforts = validationEnabled ? validationCapability : {}
    if (validate && validationEnabled) {
      const thinkingLevels = Object.keys(validationEfforts).filter(level => level !== 'off')
      if (thinkingLevels.length === 0) errors.push({ key: model.key, code: 'needs-level' })
      if (Object.entries(validationEfforts).some(([level, wire]) =>
        (level !== 'off' && (typeof wire !== 'string' || wire.length === 0))
        || (level === 'off' && wire !== null && (typeof wire !== 'string' || wire.length === 0)))) {
        errors.push({ key: model.key, code: 'invalid-wire' })
      }
    }
    if (validate && validationDefault !== undefined
      && (!validationEnabled || !hasOwn(validationEfforts as JsonRecord, validationDefault))) {
      errors.push({ key: model.key, code: 'invalid-default' })
    }
    if (errors.length !== errorsBefore) continue

    if (capabilityDirty && capabilityChanged) {
      pluginOps.push({
        op: 'set',
        path: ['models', model.provider, model.model],
        value: draftCapability,
      })
    }
    if (defaultDirty && defaultChanged) {
      pluginOps.push(draft.defaultEffort === undefined
        ? { op: 'unset', path: ['defaults', model.provider, model.model] }
        : {
            op: 'set',
            path: ['defaults', model.provider, model.model],
            value: draft.defaultEffort,
          })
    }
    if (defaultDirty && model.provider === snapshot.currentProvider && model.model === snapshot.currentModel
      && draft.defaultEffort !== snapshot.legacyReasoningEffort) {
      agentDefaultOps.push(draft.defaultEffort === undefined
        ? { op: 'unset', path: ['reasoningEffort'] }
        : { op: 'set', path: ['reasoningEffort'], value: draft.defaultEffort })
    }
  }

  return { pluginOps, agentDefaultOps, errors }
}
