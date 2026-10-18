/**
 * Bundled, provider-independent model capability catalog. The matcher is
 * intentionally conservative: a low-confidence candidate must not cause an
 * unsupported reasoning parameter to be sent to a user's provider.
 *
 * @module dsh-reasoning-effort/model-catalog
 */
import type { ReasoningEfforts } from './config.js';
export type ModelInput = readonly ('text' | 'image')[];
export interface CatalogPricingTier {
    readonly condition: string;
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
}
export interface CatalogPricing {
    readonly currency: string;
    readonly unit: string;
    readonly input: number | null;
    readonly output: number | null;
    readonly cacheRead: number | null;
    readonly cacheWrite: number | null;
    readonly tiers?: readonly CatalogPricingTier[];
    readonly region?: string;
    readonly conditions?: string;
}
export interface CatalogSources {
    readonly capabilities: string;
    readonly pricing: string;
}
export interface CatalogModel {
    readonly model: string;
    readonly aliases: readonly string[];
    readonly input: ModelInput;
    readonly contextWindow: number | null;
    readonly maxOutputTokens: number | null;
    readonly pricing: CatalogPricing;
    readonly reasoningEfforts: ReasoningEfforts;
    readonly sources: CatalogSources;
}
export interface CatalogDocument {
    readonly version: number;
    readonly models: readonly CatalogModel[];
}
/** Capacities a pi-ai model entry should declare. `maxTokens` is pi-ai's spelling of `maxOutputTokens`. */
export interface ModelCapacity {
    readonly contextWindow: number;
    readonly maxTokens: number;
}
export declare const modelCatalog: CatalogDocument;
/**
 * Resolve a user-entered model identifier to its curated effort map. Exact
 * normalized model names and aliases win; fuzzy matches need a high score and
 * a clear lead over every other candidate.
 */
export declare function resolveModelEfforts(modelId: unknown): ReasoningEfforts | undefined;
/** Resolve a user-entered model identifier to its curated input modalities. */
export declare function resolveModelInput(modelId: unknown): ModelInput | undefined;
/**
 * Resolve a user-entered model identifier to its curated capacities. Only a
 * fully known pair is returned: `llm-pi-ai` defaults an undeclared context
 * window to 262,144, which is wrong for models the catalog sizes (notably the
 * 1M DeepSeek family), so a missing declaration must not fall through to the
 * adapter's conservative guess. A catalog entry with a null capacity has no
 * answer and stays absent from the model entry.
 */
export declare function resolveModelCapacity(modelId: unknown): ModelCapacity | undefined;
