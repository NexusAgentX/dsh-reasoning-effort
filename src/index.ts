/**
 * dsh-reasoning-effort — Host-side capability catalog and projection.
 *
 * The web composer's Effort row renders only when the owning LLM adapter
 * reports `reasoning` metadata for the selected model. `llm-pi-ai` derives
 * that metadata from each model entry's `reasoningEfforts` declaration; the
 * web "custom provider" card deliberately does not write it, so hand-declared
 * third-party models show no reasoning selector. This plugin closes the gap
 * the platform seams allow: it watches the `llm-pi-ai` settings user layer
 * and writes catalog-derived `reasoningEfforts` and `input` declarations only
 * onto supported model entries that lack the corresponding fields.
 *
 * Contract:
 * - missing `reasoningEfforts` on a catalog-matched model → backfill its map;
 * - missing `input` on a catalog-matched model → backfill its modalities;
 * - any existing value (map or `false`) → untouched;
 * - composition base → untouched;
 * - writes go through `ctx.settings.mutate` with `expectedRevision`, so a
 *   concurrent web edit is a conflict to retry, never a silent overwrite;
 * - after its own write the watcher computes zero ops, so the loop settles.
 *
 * @module dsh-reasoning-effort
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: installs the agent/request event contract on Cordis Events.
import type {} from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `ctx.settings` merge and the settings event vocabulary.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: extends ctx.typert with generated-contribution registration.
import type {} from '@deepseek-ai/dsh-typert-registry'
import { installSettingsSection, settingsNamespace, SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { resolveConfig } from './config.js'
import type { ResolvedConfig } from './config.js'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
} from './constants.js'
import { computeEnrichmentOps } from './enrich.js'
import { resolveModelEfforts, resolveModelInput } from './model-catalog.js'
import {
  emptyReasoningPluginSettings,
  ReasoningPluginSettingsSchema,
  validateReasoningPluginSettings,
} from './plugin-settings.js'
import type { ReasoningPluginSettings } from './plugin-settings.js'
import { ReasoningEffortRemoteService } from './remote.js'
import { TYPERT_HOST } from './remote-contract.js'
import {
  computeLegacyDefaultOps,
  effectiveRouteCapability,
  nonEmptyString,
  routeCapability,
  validRouteDefault,
} from './routes.js'

export const name = 'dsh-reasoning-effort'

/** The plugin only acts where the settings seam exists. */
export const inject = ['settings', 'typert']

/** Cordis Loader schema. */
export { Config, DEFAULT_EFFORTS, REASONING_LEVELS } from './config.js'
export type {
  ReasoningEfforts,
  ReasoningLevel,
  ResolvedConfig,
} from './config.js'
export type { ReasoningCapability, ReasoningPluginSettings } from './plugin-settings.js'

/** The namespace `@deepseek-ai/dsh-llm-pi-ai` owns. */
const PI_AI_NS = settingsNamespace(PI_AI_SETTINGS_NAMESPACE_ID)
/** This plugin's exact-route capability overrides. */
export const SETTINGS_NAMESPACE = settingsNamespace(PLUGIN_SETTINGS_NAMESPACE_ID)
const AGENT_DEFAULT_NS = settingsNamespace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)

/**
 * Plugin body. Everything happens inside one effect so HMR / disposal removes
 * the listeners and pending microtask flag with the fiber.
 * @param ctx - host root context.
 * @param config - loader-validated row config (defaults already applied).
 */
export function apply(ctx: Context, config: unknown): void {
  const resolved: ResolvedConfig = resolveConfig(config)
  const logger = ctx.logger('dsh-reasoning-effort')
  const entry = emptyReasoningPluginSettings()
  let settingsSource: () => ReasoningPluginSettings = () => entry
  let notifySettingsChange = (): void => {}

  installSettingsSection(ctx, SETTINGS_NAMESPACE, ReasoningPluginSettingsSchema, entry, {
    setSource: (current) => { settingsSource = current },
    onChange: () => { notifySettingsChange() },
    validate: validateReasoningPluginSettings,
  })
  new ReasoningEffortRemoteService(ctx, ctx.settings)
  ctx.effect(
    () => ctx.typert.register(TYPERT_HOST),
    'dsh-reasoning-effort: strict Remote contribution',
  )

  ctx.effect(() => ctx.on('agent/request', async (_payload, next) => {
    const call = await next()
    if (call.reasoningEffort !== undefined || call.provider === undefined || call.model === undefined) return call
    try {
      const descriptors = ctx.settings.describe({ redactSecrets: true })
      const piAi = descriptors.find(descriptor => descriptor.ns === PI_AI_NS)
      if (piAi === undefined) return call
      const current = settingsSource()
      let effort = validRouteDefault(current, piAi.user, call.provider, call.model)
      if (effort === undefined && !current.legacyDefaultsMigrated) {
        const legacy = descriptors.find(descriptor => descriptor.ns === AGENT_DEFAULT_NS)?.value
        if (legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)) {
          const value = legacy as Record<string, unknown>
          const sameRoute = nonEmptyString(value.provider) === call.provider
            && nonEmptyString(value.model) === call.model
          const candidate = sameRoute ? nonEmptyString(value.reasoningEffort) : undefined
          const capability = effectiveRouteCapability(current, piAi.user, call.provider, call.model)
          if (candidate !== undefined && capability !== undefined && capability !== false
            && Object.hasOwn(capability, candidate)) effort = candidate
        }
      }
      return effort === undefined ? call : { ...call, reasoningEffort: ReasoningEffortId(effort) }
    } catch (error) {
      logger.warn('failed to resolve an exact-route reasoning default')
      logger.warn(error)
      return call
    }
  }, { global: true, prepend: true }), 'dsh-reasoning-effort: request defaults')

  ctx.effect(() => {
    let scheduled = false
    let disposed = false
    let running: Promise<void> = Promise.resolve()

    const run = async (): Promise<void> => {
      if (disposed) return
      const settings = ctx.settings
      if (!settings.writable) return

      let descriptors: SettingsDescriptor[]
      try {
        descriptors = settings.describe({ redactSecrets: true })
      } catch (error) {
        logger.warn('settings.describe failed')
        logger.warn(error)
        return
      }
      const descriptor = descriptors.find(entry => entry.ns === PI_AI_NS)
      // Not registered (llm-pi-ai absent or still loading). A later document
      // change or a hot-apply triggers another pass; the patch layer runs
      // after the bundles, so this is normally already present at apply time.
      if (descriptor === undefined) return

      const pluginDescriptor = descriptors.find(entry => entry.ns === SETTINGS_NAMESPACE)
      const agentDefault = descriptors.find(entry => entry.ns === AGENT_DEFAULT_NS)
      if (pluginDescriptor !== undefined && agentDefault !== undefined
        && !settingsSource().legacyDefaultsMigrated) {
        const migratedDefaults = computeLegacyDefaultOps(settingsSource(), descriptor.user, agentDefault.value)
        const migrationOps = [
          ...migratedDefaults,
          { op: 'set' as const, path: ['legacyDefaultsMigrated'], value: true },
        ]
        try {
          if (disposed) return
          await settings.mutate(SETTINGS_NAMESPACE, migrationOps, pluginDescriptor.revision)
          if (disposed) return
          logger.info('migrated %s exact-route reasoning defaults into plugin settings', migratedDefaults.length)
          schedule()
          return
        } catch (error) {
          if (error instanceof SettingsConflictError) {
            logger.debug('settings conflict while migrating reasoning defaults; retrying once')
            schedule()
            return
          }
          logger.warn('failed to migrate exact-route reasoning defaults')
          logger.warn(error)
        }
      }

      const ops = computeEnrichmentOps(descriptor.user, modelId => {
        const catalogEfforts = resolveModelEfforts(modelId)
        return catalogEfforts === undefined ? undefined : resolved.efforts ?? catalogEfforts
      }, (providerId, modelId) => {
        return routeCapability(settingsSource(), providerId, modelId)
      }, modelId => {
        return resolveModelInput(modelId)
      })
      if (ops.length === 0) return

      try {
        if (disposed) return
        await settings.mutate(PI_AI_NS, ops, descriptor.revision)
        if (disposed) return
        logger.info('backfilled model capabilities on %s model entries', ops.length)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          // A web edit landed between describe and mutate. One retry pass is
          // enough for the normal write-after-write cadence; a still-moving
          // document is picked up by the events below.
          logger.debug('settings conflict while backfilling; retrying once')
          schedule()
          return
        }
        logger.warn('failed to backfill model capabilities')
        logger.warn(error)
      }
    }

    /** Coalesce event bursts into one pass; own writes settle to a no-op. */
    const schedule = (): void => {
      if (disposed || scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (disposed) return
        running = running.then(run).then(undefined, (error: unknown) => {
          if (disposed) return
          logger.warn('unexpected enrichment failure')
          logger.warn(error)
        })
      })
    }

    const onDocumentUpdated = (ns: string): void => {
      if (ns === PI_AI_NS || ns === SETTINGS_NAMESPACE || ns === AGENT_DEFAULT_NS) schedule()
    }
    const onUpdated = (ns: string): void => {
      if (ns === PI_AI_NS || ns === SETTINGS_NAMESPACE || ns === AGENT_DEFAULT_NS) schedule()
    }
    const offDocument = ctx.on('settings/document-updated', onDocumentUpdated)
    const offUpdated = ctx.on('settings/updated', onUpdated)
    notifySettingsChange = schedule
    // First pass after the fiber settles: covers both the normal boot order
    // (bundles → profile patch layer) and a hot-apply of this very row.
    schedule()

    return async () => {
      disposed = true
      scheduled = false
      notifySettingsChange = () => {}
      offDocument()
      offUpdated()
      await running
    }
  }, 'dsh-reasoning-effort: reasoning-effort backfill')
}
