/**
 * dsh-reasoning-effort — Host-side capability catalog and projection.
 *
 * The plugin watches the DSH settings document for `llm-pi-ai` and fills
 * catalog-derived capabilities only where a user model entry left them
 * undeclared. Its own exact-route overrides/defaults are volatile fields on
 * this plugin entry, so the settings UI can update them live.
 *
 * @module dsh-reasoning-effort
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-reasoning-effort";
/** The plugin only acts where the settings seam exists. */
export declare const inject: string[];
/** Cordis Loader schema. */
export { Config, DEFAULT_EFFORTS, REASONING_LEVELS } from './config.js';
export type { ReasoningEfforts, ReasoningLevel, ResolvedConfig, } from './config.js';
export type { ReasoningCapability, ReasoningPluginSettings } from './plugin-settings.js';
/** Settings entry ids shared with the profile composition. */
export declare const SETTINGS_NAMESPACE = "providers-reasoning";
/**
 * Plugin body. Volatile Config references stay live for the fiber lifetime;
 * every request and settings pass reads their current snapshots.
 * @param ctx - host root context.
 * @param config - loader-validated row config.
 */
export declare function apply(ctx: Context, config: unknown): void;
