/** Host-backed controller for the reasoning settings section. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
} from '../constants.js'
import {
  buildReasoningSavePlan,
  collectReasoningSettings,
} from './model-settings.js'
import type {
  ReasoningDirtyFields,
  ReasoningModelDraft,
  ReasoningSettingsSnapshot,
} from './model-settings.js'

/** Immutable controller view consumed through useSyncExternalStore. */
export interface ReasoningSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  saving: boolean
  version: number
  snapshot: ReasoningSettingsSnapshot | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One settings page controller; Host settings remain the fact source. */
export class ReasoningSettingsController {
  private state: ReasoningSettingsState = {
    status: 'idle', error: null, saving: false, version: 0, snapshot: null,
  }

  private readonly listeners = new Set<() => void>()
  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  readonly getSnapshot = (): ReasoningSettingsState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(next: ReasoningSettingsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Load all three participating settings namespaces in one describe call. */
  async load(): Promise<boolean> {
    const generation = ++this.generation
    this.publish({ ...this.state, status: 'loading', error: null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return this.state.status === 'ready'
      const { writable, namespaces } = response.result.value
      this.publish({
        status: 'ready',
        error: null,
        saving: this.state.saving,
        version: this.state.version + 1,
        snapshot: collectReasoningSettings(namespaces, writable),
      })
      return true
    } catch (error) {
      if (generation !== this.generation) return this.state.status === 'ready'
      this.publish({ ...this.state, status: 'error', error: messageOf(error) })
      return false
    }
  }

  /** True once the page has loaded at least one Host snapshot. */
  loaded(): boolean {
    return this.state.snapshot !== null
  }

  /** Save changed capabilities and defaults through their owning namespaces. */
  async save(
    drafts: Readonly<Record<string, ReasoningModelDraft>>,
    dirty?: ReasoningDirtyFields,
  ): Promise<boolean> {
    const snapshot = this.state.snapshot
    if (snapshot === null || !snapshot.writable || this.state.saving) return false
    const plan = buildReasoningSavePlan(snapshot, drafts, dirty)
    if (plan.errors.length > 0) return false
    this.publish({ ...this.state, saving: true, error: null })
    try {
      if (plan.pluginOps.length > 0) {
        const response = await this.api.settings.mutate({
          ns: PLUGIN_SETTINGS_NAMESPACE_ID,
          ops: plan.pluginOps,
          expectedRevision: snapshot.pluginRevision,
        })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      if (plan.agentDefaultOps.length > 0) {
        const response = await this.api.settings.mutate({
          ns: AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
          ops: plan.agentDefaultOps,
          expectedRevision: snapshot.agentDefaultRevision,
        })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      const reloaded = await this.load()
      this.publish({ ...this.state, saving: false })
      return reloaded && this.state.status === 'ready'
    } catch (error) {
      const writeError = messageOf(error)
      // A two-namespace save can land its first mutation before the second
      // conflicts. Refresh revisions so retrying the preserved UI draft can
      // converge instead of replaying an already-stale expectedRevision.
      await this.load()
      this.publish({ ...this.state, saving: false, error: writeError })
      return false
    }
  }
}
