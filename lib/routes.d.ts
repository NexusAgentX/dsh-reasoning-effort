/** Exact-route reads shared by Host enrichment, migration, and request injection. */
import type { ReasoningEfforts } from './config.js';
import type { ReasoningCapability, ReasoningPluginSettings } from './plugin-settings.js';
import type { ReasoningPathOp } from './settings-contract.js';
type UnknownRecord = Record<string, unknown>;
export declare function isRecord(value: unknown): value is UnknownRecord;
export declare function nonEmptyString(value: unknown): string | undefined;
/** Parse one declared capability without consulting inherited keys. */
export declare function capabilityOf(value: unknown): ReasoningCapability | undefined;
/** Read one plugin-owned capability override by exact route. */
export declare function routeCapability(settings: ReasoningPluginSettings, provider: string, model: string): ReasoningCapability | undefined;
/** Read one plugin-owned default by exact route. */
export declare function routeDefault(settings: ReasoningPluginSettings, provider: string, model: string): string | undefined;
/** Find an exact raw user-added pi-ai model entry. */
export declare function rawModelEntry(piAiUser: unknown, provider: string, model: string): UnknownRecord | undefined;
/** Resolve the effective selectable effort map for one raw user route. */
export declare function effectiveRouteCapability(settings: ReasoningPluginSettings, piAiUser: unknown, provider: string, model: string): ReasoningCapability | undefined;
/** Return the stored default only while the route still advertises that level. */
export declare function validRouteDefault(settings: ReasoningPluginSettings, piAiUser: unknown, provider: string, model: string): string | undefined;
/** Copy legacy Harness route defaults into plugin ownership without overwriting existing values. */
export declare function computeLegacyDefaultOps(settings: ReasoningPluginSettings, piAiUser: unknown, agentDefaultValue: unknown): ReasoningPathOp[];
/** Detached effort map helper for tests and Remote validation. */
export declare function effortsOf(capability: ReasoningCapability | undefined): ReasoningEfforts | undefined;
export {};
