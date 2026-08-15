/**
 * dsh-providers-reasoning — host-side capability backfill plugin.
 *
 * The web composer's Effort row renders only when the owning LLM adapter
 * reports `reasoning` metadata for the selected model. `llm-pi-ai` derives
 * that metadata from each model entry's `reasoningEfforts` declaration; the
 * web "custom provider" card deliberately does not write it, so hand-declared
 * third-party models show no reasoning selector. This plugin closes the gap
 * the platform seams allow: it watches the `llm-pi-ai` settings user layer
 * and writes the configured seven-level map onto every model entry that lacks
 * the field.
 *
 * Contract:
 * - missing `reasoningEfforts` → backfill the configured map;
 * - any existing value (map or `false`) → untouched;
 * - composition base → untouched;
 * - writes go through `ctx.settings.mutate` with `expectedRevision`, so a
 *   concurrent web edit is a conflict to retry, never a silent overwrite;
 * - after its own write the watcher computes zero ops, so the loop settles.
 *
 * @module dsh-providers-reasoning
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.settings` merge and the settings event vocabulary.
import type {} from '@deepseek-ai/dsh-settings'
import { settingsNamespace, SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { resolveConfig } from './config.js'
import type { ResolvedConfig } from './config.js'
import { computeEnrichmentOps } from './enrich.js'

export const name = 'dsh-providers-reasoning'

/** The plugin only acts where the settings seam exists. */
export const inject = ['settings']

/** Cordis Loader schema. */
export { Config, DEFAULT_EFFORTS, REASONING_LEVELS } from './config.js'
export type {
  ReasoningEfforts,
  ReasoningLevel,
  ResolvedConfig,
} from './config.js'

/** The namespace `@deepseek-ai/dsh-llm-pi-ai` owns. */
const NS = settingsNamespace('llm-pi-ai')

/**
 * Plugin body. Everything happens inside one effect so HMR / disposal removes
 * the listeners and pending microtask flag with the fiber.
 * @param ctx - host root context.
 * @param config - loader-validated row config (defaults already applied).
 */
export function apply(ctx: Context, config: unknown): void {
  const resolved: ResolvedConfig = resolveConfig(config)
  const logger = ctx.logger('dsh-providers-reasoning')

  ctx.effect(() => {
    let scheduled = false
    let running: Promise<void> = Promise.resolve()

    const run = async (): Promise<void> => {
      const settings = ctx.settings
      if (!settings.writable) return

      let descriptor: SettingsDescriptor | undefined
      try {
        descriptor = settings.describe({ redactSecrets: true }).find(entry => entry.ns === NS)
      } catch (error) {
        logger.warn('settings.describe failed for %s', NS)
        logger.warn(error)
        return
      }
      // Not registered (llm-pi-ai absent or still loading). A later document
      // change or a hot-apply triggers another pass; the patch layer runs
      // after the bundles, so this is normally already present at apply time.
      if (descriptor === undefined) return

      const ops = computeEnrichmentOps(descriptor.user, resolved.efforts)
      if (ops.length === 0) return

      try {
        await settings.mutate(NS, ops, descriptor.revision)
        logger.info('backfilled reasoningEfforts on %s model entries', ops.length)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          // A web edit landed between describe and mutate. One retry pass is
          // enough for the normal write-after-write cadence; a still-moving
          // document is picked up by the events below.
          logger.debug('settings conflict while backfilling; retrying once')
          schedule()
          return
        }
        logger.warn('failed to backfill reasoningEfforts')
        logger.warn(error)
      }
    }

    /** Coalesce event bursts into one pass; own writes settle to a no-op. */
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        running = run().then(undefined, (error: unknown) => {
          logger.warn('unexpected enrichment failure')
          logger.warn(error)
        })
      })
    }

    const onDocumentUpdated = (ns: string): void => {
      if (ns === NS) schedule()
    }
    const onUpdated = (ns: string): void => {
      if (ns === NS) schedule()
    }
    const offDocument = ctx.on('settings/document-updated', onDocumentUpdated)
    const offUpdated = ctx.on('settings/updated', onUpdated)
    // First pass after the fiber settles: covers both the normal boot order
    // (bundles → profile patch layer) and a hot-apply of this very row.
    schedule()

    return () => {
      offDocument()
      offUpdated()
      void running
    }
  }, 'dsh-providers-reasoning: reasoning-effort backfill')
}
