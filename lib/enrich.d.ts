/**
 * Pure derivation of the settings path-ops that backfill missing model
 * capabilities. The plugin owns no UI and no model state; this module is the
 * whole decision: which user-layer entries need a capability declaration.
 *
 * Only the user layer of `llm-pi-ai` is scanned. A model entry the user added
 * through the web "custom provider" card (or wrote into settings.yaml) lives
 * there; the composition base is owned by its own bundle and is never
 * rewritten. Entries that already carry `reasoningEfforts`, `input`, or
 * capacities are always left alone. The plugin only fills absence.
 *
 * Each provider gets ONE `set` op for its whole `models` array (and one for
 * its `modelOverrides` dict) rather than a per-index op: the settings seam's
 * path mutation treats arrays as opaque values, so an index-addressed op would
 * replace the array with an object. Replacing the whole array also mirrors
 * how the web Models page writes its model lists.
 *
 * @module dsh-reasoning-effort/enrich
 */
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings';
import type { ReasoningEfforts } from './config.js';
import type { ModelCapacity, ModelInput } from './model-catalog.js';
import type { ReasoningCapability } from './plugin-settings.js';
export type ModelEffortResolver = (modelId: string) => ReasoningEfforts | undefined;
export type ModelInputResolver = (modelId: string) => ModelInput | undefined;
export type ModelCapacityResolver = (modelId: string) => ModelCapacity | undefined;
export type ModelCapabilityOverrideResolver = (providerId: string, modelId: string) => ReasoningCapability | undefined;
/**
 * Compute the `set` ops that give only catalog-recognized model entries missing
 * `reasoningEfforts`, `input`, or capacities their supported capability
 * declarations. Capacities come from the same catalog match, so a third-party
 * DeepSeek route stops falling back to the adapter's 262,144 guess.
 * @param user - the raw `llm-pi-ai` user section (detached descriptor copy).
 * @param resolveEfforts - returns a supported map for a recognized model.
 * @param resolveOverride - returns an explicit exact-route user override.
 * @param resolveInput - returns supported input modalities for a recognized model.
 * @param resolveCapacity - returns supported capacities for a recognized model.
 * @returns path ops addressing `providers.<route>.models` and
 *   `providers.<route>.modelOverrides`, in document order.
 */
export declare function computeEnrichmentOps(user: unknown, resolveEfforts: ModelEffortResolver, resolveOverride?: ModelCapabilityOverrideResolver, resolveInput?: ModelInputResolver, resolveCapacity?: ModelCapacityResolver): readonly SettingsPathOp[];
