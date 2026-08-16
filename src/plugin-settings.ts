/** Plugin-owned persisted capability overrides, keyed by exact provider/model route. */

import z from '@deepseek-ai/schemastery'
import type { ReasoningEfforts } from './config.js'
import { resolveConfig } from './config.js'
import { REASONING_LEVELS } from './constants.js'

/** One exact route either disables reasoning or declares its selectable wire map. */
export type ReasoningCapability = false | ReasoningEfforts

/** User settings owned by this plugin. */
export interface ReasoningPluginSettings {
  /** provider -> model -> explicit capability override. */
  models: Record<string, Record<string, ReasoningCapability>>
}

const reasoningEffortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(REASONING_LEVELS),
) as unknown as z<ReasoningEfforts>

const capabilitySchema = z.union([
  z.const(false),
  reasoningEffortsSchema,
]) as unknown as z<ReasoningCapability>

/** Runtime schema registered under the plugin's settings namespace. */
export const ReasoningPluginSettingsSchema: z<ReasoningPluginSettings> = z.object({
  models: z.dict(z.dict(capabilitySchema)).default({}) as unknown as z<ReasoningPluginSettings['models']>,
})

/** Fresh composition base for one plugin installation. */
export function emptyReasoningPluginSettings(): ReasoningPluginSettings {
  return { models: {} }
}

/** Enforce the semantic constraints schemastery's nested dict cannot express. */
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
}
