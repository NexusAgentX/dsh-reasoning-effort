/** Browser controller over the DSH ConfigForm live settings mirror. */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReasoningNamespaceDocument } from '../settings-contract.js'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
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

/** Minimal live form face shared by the three settings namespaces. */
export interface ReasoningConfigForm<T = unknown> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean>
}

export interface ReasoningSettingsForms {
  piAi: ReasoningConfigForm
  plugin: ReasoningConfigForm
  agentDefault: ReasoningConfigForm
}

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

function objectOf(value: unknown): import('../settings-contract.js').JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as import('../settings-contract.js').JsonObject
    : {}
}

function documentOf(
  ns: string,
  snapshot: ConfigFormSnapshot<unknown>,
): ReasoningNamespaceDocument {
  return {
    ns,
    revision: snapshot.revision ?? 0,
    value: objectOf(snapshot.value),
    user: objectOf(snapshot.user),
  }
}

/** One settings page controller; ConfigForm snapshots remain the fact source. */
export class ReasoningSettingsController {
  private state: ReasoningSettingsState = {
    status: 'idle', error: null, saving: false, version: 0, snapshot: null,
  }

  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeForms: () => void
  private disposed = false

  constructor(private readonly forms: ReasoningSettingsForms) {
    const unsubscribers = [
      forms.piAi.subscribe(() => this.refresh()),
      forms.plugin.subscribe(() => this.refresh()),
      forms.agentDefault.subscribe(() => this.refresh()),
    ]
    this.unsubscribeForms = () => { for (const unsubscribe of unsubscribers) unsubscribe() }
    this.refresh()
  }

  readonly getSnapshot = (): ReasoningSettingsState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(next: ReasoningSettingsState): void {
    if (this.disposed) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Re-derive the page snapshot from the three live forms. */
  private refresh(): void {
    if (this.disposed) return
    const piAi = this.forms.piAi.getSnapshot()
    const plugin = this.forms.plugin.getSnapshot()
    const agentDefault = this.forms.agentDefault.getSnapshot()
    const snapshots = [piAi, plugin, agentDefault]
    if (snapshots.some(snapshot => snapshot.status === 'loading')) {
      this.publish({ ...this.state, status: 'loading', error: null })
      return
    }
    if (snapshots.some(snapshot => snapshot.status === 'unavailable')) {
      this.publish({
        ...this.state,
        status: 'error',
        error: 'Reasoning settings are unavailable in this deployment.',
      })
      return
    }
    const writable = snapshots.every(snapshot => snapshot.writable)
    const namespaces = [
      documentOf(PI_AI_SETTINGS_NAMESPACE_ID, piAi),
      documentOf(PLUGIN_SETTINGS_NAMESPACE_ID, plugin),
      documentOf(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID, agentDefault),
    ]
    this.publish({
      status: 'ready',
      error: null,
      saving: this.state.saving,
      version: this.state.version + 1,
      snapshot: collectReasoningSettings(namespaces, writable),
    })
  }

  /** Refresh from the current form snapshots. */
  async load(): Promise<boolean> {
    this.refresh()
    return this.state.status === 'ready'
  }

  /** True once the page has loaded at least one Host snapshot. */
  loaded(): boolean {
    return this.state.snapshot !== null
  }

  /** Save changed capabilities and defaults through their owning forms. */
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
        const accepted = await this.forms.plugin.mutate(plan.pluginOps, snapshot.pluginRevision)
        if (!accepted) throw new Error('The Host rejected the reasoning capability update.')
      }
      if (plan.agentDefaultOps.length > 0) {
        const accepted = await this.forms.agentDefault.mutate(
          plan.agentDefaultOps,
          snapshot.agentDefaultRevision,
        )
        if (!accepted) throw new Error('The Host rejected the default effort update.')
      }
      this.refresh()
      this.publish({ ...this.state, saving: false })
      return true
    } catch (error) {
      this.refresh()
      this.publish({ ...this.state, saving: false, error: messageOf(error) })
      return false
    }
  }

  /** Release form subscriptions when the owning page registration ends. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeForms()
    this.listeners.clear()
  }
}
