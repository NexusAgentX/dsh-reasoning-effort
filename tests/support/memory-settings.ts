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

  protected async load(): Promise<Record<string, unknown>> {
    return structuredClone(this.doc)
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
  }
}
