/** Pure projection and save planning for the reasoning settings page. */
import type { ReasoningEfforts } from '../config.js';
import type { ReasoningCapability } from '../plugin-settings.js';
import type { ReasoningNamespaceDocument, ReasoningPathOp } from '../settings-contract.js';
/** One user-added exact model route rendered by the page. */
export interface ReasoningSettingsModel {
    key: string;
    provider: string;
    providerName: string;
    model: string;
    modelName: string;
    /** Effective capability before local edits; undefined means no declaration or catalog match. */
    capability: ReasoningCapability | undefined;
    /** Persisted exact-route default, including the legacy current-route fallback. */
    defaultEffort: string | undefined;
}
/** Consistent settings cut used for editing and revision-fenced writes. */
export interface ReasoningSettingsSnapshot {
    writable: boolean;
    models: readonly ReasoningSettingsModel[];
    pluginRevision: number;
    agentDefaultRevision: number;
    currentProvider: string | undefined;
    currentModel: string | undefined;
    legacyReasoningEffort: string | undefined;
}
/** Mutable UI draft for one model. */
export interface ReasoningModelDraft {
    enabled: boolean;
    efforts: ReasoningEfforts;
    defaultEffort: string | undefined;
}
/** Exact fields the user changed; refreshed server data outside this set is never written back. */
export interface ReasoningDirtyFields {
    capabilities: ReadonlySet<string>;
    defaults: ReadonlySet<string>;
}
/** One validation failure addressed to its exact model row. */
export interface DraftValidationError {
    key: string;
    code: 'needs-level' | 'invalid-wire' | 'invalid-default';
}
/** Atomic operations split by their owning settings namespaces. */
export interface ReasoningSavePlan {
    pluginOps: ReasoningPathOp[];
    agentDefaultOps: ReasoningPathOp[];
    errors: DraftValidationError[];
}
/** Opaque local key; provider and model ids are never parsed out of it. */
export declare function modelRouteKey(provider: string, model: string): string;
/**
 * Project only raw user-added pi-ai `models` entries. Catalog defaults and
 * `modelOverrides` stay out of the page by construction.
 */
export declare function collectReasoningSettings(namespaces: readonly ReasoningNamespaceDocument[], writable: boolean): ReasoningSettingsSnapshot;
/** Create detached drafts from one server snapshot. */
export declare function draftsOf(models: readonly ReasoningSettingsModel[]): Record<string, ReasoningModelDraft>;
/** Merge a refreshed server snapshot without replacing fields the user is editing. */
export declare function mergeRefreshedDrafts(models: readonly ReasoningSettingsModel[], drafts: Readonly<Record<string, ReasoningModelDraft>>, dirty: ReasoningDirtyFields): Record<string, ReasoningModelDraft>;
/** Build path-level writes and validate every changed draft before any request leaves. */
export declare function buildReasoningSavePlan(snapshot: ReasoningSettingsSnapshot, drafts: Readonly<Record<string, ReasoningModelDraft>>, dirty?: ReasoningDirtyFields): ReasoningSavePlan;
