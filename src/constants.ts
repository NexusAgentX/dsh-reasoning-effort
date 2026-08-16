/** Shared identifiers and the canonical reasoning-level order. */

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

/** Plugin-owned settings section containing exact-route capability overrides. */
export const PLUGIN_SETTINGS_NAMESPACE_ID = 'providers-reasoning'

/** Harness-owned pi-ai provider settings section. */
export const PI_AI_SETTINGS_NAMESPACE_ID = 'llm-pi-ai'

/** Harness-owned default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID = 'agent-default-model'
