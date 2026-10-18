/** Backwards-compatible exports for the plugin-owned settings schema. */

export type {
  ReasoningCapability,
  ReasoningPluginSettings,
} from './config.js'
export {
  emptyReasoningPluginSettings,
  ReasoningPluginSettingsSchema,
  validateReasoningPluginSettings,
} from './config.js'
