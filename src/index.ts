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

import type { Context } from '@deepseek-ai/cordis'
// Type-only: installs the agent/request event contract on Cordis Events.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: installs the settings event vocabulary on Cordis Events.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: installs loader/volatile-update on Cordis Events.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { resolveRuntimeConfig } from './config.js'
import type { ResolvedRuntimeConfig } from './config.js'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
} from './constants.js'
import { computeEnrichmentOps } from './enrich.js'
import { resolveModelCapacity, resolveModelEfforts, resolveModelInput } from './model-catalog.js'
import {
  computeLegacyDefaultOps,
  effectiveRouteCapability,
  nonEmptyString,
  routeCapability,
  validRouteDefault,
} from './routes.js'

export const name = 'dsh-reasoning-effort'

/** The plugin only acts where the settings seam exists. */
export const inject = ['settings']

/** Cordis Loader schema. */
export { Config, DEFAULT_EFFORTS, REASONING_LEVELS } from './config.js'
export type {
  ReasoningEfforts,
  ReasoningLevel,
  ResolvedConfig,
} from './config.js'
export type { ReasoningCapability, ReasoningPluginSettings } from './plugin-settings.js'

/** Settings entry ids shared with the profile composition. */
export const SETTINGS_NAMESPACE = PLUGIN_SETTINGS_NAMESPACE_ID

function findDescriptor(descriptors: readonly SettingsDescriptor[], ns: string): SettingsDescriptor | undefined {
  return descriptors.find(descriptor => String(descriptor.ns) === ns)
}

/**
 * Plugin body. Volatile Config references stay live for the fiber lifetime;
 * every request and settings pass reads their current snapshots.
 * @param ctx - host root context.
 * @param config - loader-validated row config.
 */
export function apply(ctx: Context, config: unknown): void {
  const runtime: ResolvedRuntimeConfig = resolveRuntimeConfig(config)
  const logger = ctx.logger('dsh-reasoning-effort')
  const ownEntry = (ctx.fiber as unknown as { entry?: { options?: { id?: string } } }).entry
  const pluginNs = ownEntry?.options?.id ?? PLUGIN_SETTINGS_NAMESPACE_ID

  ctx.effect(() => ctx.on('agent/request', async (_payload, next) => {
    const call = await next()
    if (call.reasoningEffort !== undefined || call.provider === undefined || call.model === undefined) return call
    try {
      const descriptors = ctx.settings.describe({ redactSecrets: true })
      const piAi = findDescriptor(descriptors, PI_AI_SETTINGS_NAMESPACE_ID)
      if (piAi === undefined) return call
      const settings = runtime.settings()
      let effort = validRouteDefault(settings, piAi.user, call.provider, call.model)
      if (effort === undefined && !settings.legacyDefaultsMigrated) {
        const legacy = findDescriptor(descriptors, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)?.value
        if (legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)) {
          const value = legacy as Record<string, unknown>
          const sameRoute = nonEmptyString(value.provider) === call.provider
            && nonEmptyString(value.model) === call.model
          const candidate = sameRoute ? nonEmptyString(value.reasoningEffort) : undefined
          const capability = effectiveRouteCapability(settings, piAi.user, call.provider, call.model)
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
      const descriptor = findDescriptor(descriptors, PI_AI_SETTINGS_NAMESPACE_ID)
      if (descriptor === undefined) return

      const pluginDescriptor = findDescriptor(descriptors, pluginNs)
      const agentDefault = findDescriptor(descriptors, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)
      const current = runtime.settings()
      if (pluginDescriptor !== undefined && agentDefault !== undefined
        && !current.legacyDefaultsMigrated) {
        const migratedDefaults = computeLegacyDefaultOps(current, descriptor.user, agentDefault.value)
        const migrationOps = [
          ...migratedDefaults,
          { op: 'set' as const, path: ['legacyDefaultsMigrated'], value: true },
        ]
        try {
          if (disposed) return
          await settings.mutate(pluginDescriptor.ns, migrationOps, pluginDescriptor.revision)
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
        return catalogEfforts === undefined ? undefined : runtime.efforts ?? catalogEfforts
      }, (providerId, modelId) => {
        return routeCapability(current, providerId, modelId)
      }, modelId => {
        return resolveModelInput(modelId)
      }, modelId => {
        return resolveModelCapacity(modelId)
      })
      if (ops.length === 0) return

      try {
        if (disposed) return
        await settings.mutate(descriptor.ns, ops, descriptor.revision)
        if (disposed) return
        logger.info('backfilled model capabilities on %s model entries', ops.length)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
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

    const onChange = (): void => schedule()
    const offDocument = ctx.on('settings/document-updated', onChange)
    const offVolatile = ctx.on('loader/volatile-update', onChange)
    schedule()

    return async () => {
      disposed = true
      scheduled = false
      offDocument()
      offVolatile()
      await running
    }
  }, 'dsh-reasoning-effort: reasoning-effort backfill')
}
