/**
 * In-memory `Settings` provider test double, extending the real abstract
 * `SettingsProvider` from `@deepseek-ai/dsh-settings` so tests exercise the
 * real layering, revision, and commit-event semantics against a synchronous
 * in-memory document.
 */

import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

export class MemorySettings extends SettingsProvider {
  /** In-memory storage never refuses a write. */
  readonly writable = true

  private doc: Record<string, unknown> = {}
  private readonly exposed = new Set<SettingsNamespace>()

  registerConfigurationClientNamespace(ns: SettingsNamespace): () => void {
    if (!this.describe().some(entry => entry.ns === ns)) throw new Error(`settings namespace "${ns}" is not registered`)
    if (this.exposed.has(ns)) throw new Error(`settings namespace "${ns}" is already exposed`)
    this.exposed.add(ns)
    let active = true
    const dispose = (): void => {
      if (!active) return
      active = false
      this.exposed.delete(ns)
    }
    this.ctx.effect(() => dispose)
    return dispose
  }

  configurationClientNamespaces(): readonly SettingsNamespace[] {
    return [...this.exposed]
  }

  protected async load(): Promise<Record<string, unknown>> {
    return structuredClone(this.doc)
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
  }
}
