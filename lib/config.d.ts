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
import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { REASONING_LEVELS } from './constants.js';
export { REASONING_LEVELS } from './constants.js';
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
/** One model's declared reasoning efforts: level → wire spelling (null only for `off`). */
export type ReasoningEfforts = Partial<Record<ReasoningLevel, string | null>>;
/** One exact route either disables reasoning or declares its selectable wire map. */
export type ReasoningCapability = false | ReasoningEfforts;
/** User configuration owned by this plugin entry. */
export interface ReasoningPluginSettings {
    /** provider -> model -> explicit capability override. */
    models: Record<string, Record<string, ReasoningCapability>>;
    /** provider -> model -> exact-route default reasoning level. */
    defaults: Record<string, Record<string, string>>;
    /** Prevent legacy Harness defaults from being re-imported after the first migration. */
    legacyDefaultsMigrated: boolean;
}
/** Legacy seven-level preset for users who explicitly override catalog values. */
export declare const DEFAULT_EFFORTS: ReasoningEfforts;
/** Runtime schema for the plugin-owned settings section. */
export declare const ReasoningPluginSettingsSchema: z<ReasoningPluginSettings>;
/** Fresh composition base for one plugin installation. */
export declare function emptyReasoningPluginSettings(): ReasoningPluginSettings;
/** Enforce semantic constraints schemastery's nested dict cannot express. */
export declare function validateReasoningPluginSettings(settings: ReasoningPluginSettings): void;
/** Loader configuration after schemastery validation. */
export interface Config {
    /** Optional legacy catalog override. */
    efforts?: ReasoningEfforts;
    /** Exact-route capability overrides, editable live through settings. */
    models: Volatile<ReasoningPluginSettings['models']>;
    /** Exact-route default efforts, editable live through settings. */
    defaults: Volatile<ReasoningPluginSettings['defaults']>;
    /** One-shot legacy migration marker. */
    legacyDefaultsMigrated: Volatile<boolean>;
}
/** Cordis Loader schema. */
export declare const Config: z<Config>;
/** Runtime contract after the schema and the semantic gate. */
export interface ResolvedConfig {
    /** Optional detached override written only to catalog-matched model entries. */
    efforts?: ReasoningEfforts;
}
/** Live plugin settings plus the ordinary effort override. */
export interface ResolvedRuntimeConfig extends ResolvedConfig {
    /** Read the latest volatile plugin settings snapshot. */
    settings(): ReasoningPluginSettings;
}
/** Validate the ordinary effort override and detach its value. */
export declare function resolveConfig(raw: unknown): ResolvedConfig;
/** Resolve Loader config references into a live settings reader. */
export declare function resolveRuntimeConfig(raw: unknown): ResolvedRuntimeConfig;
