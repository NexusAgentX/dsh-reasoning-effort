/**
 * Small in-memory `ctx.settings` test double for the settings forms contract
 * used by this plugin: describe, revision-fenced mutate, and document events.
 */

import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'

type Namespace = SettingsDescriptor['ns']
type Section = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function merge(base: unknown, user: unknown): unknown {
  if (!isRecord(base) || !isRecord(user)) return clone(user)
  const result: Section = { ...base }
  for (const [key, value] of Object.entries(user)) {
    result[key] = isRecord(result[key]) && isRecord(value)
      ? merge(result[key], value)
      : clone(value)
  }
  return result
}

function applyPath(root: Section, path: readonly string[], op: SettingsPathOp): void {
  if (path.length === 0) throw new TypeError('empty settings path')
  let cursor: Record<string, unknown> = root
  for (const segment of path.slice(0, -1)) {
    const value = cursor[segment]
    if (!isRecord(value)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  const last = path.at(-1)!
  if (op.op === 'set') cursor[last] = clone(op.value)
  else delete cursor[last]
}

export class MemorySettings {
  readonly writable = true
  private readonly document: Record<string, unknown> = {}
  private readonly schemas = new Map<string, ((value: any) => unknown) | undefined>()
  private readonly bases = new Map<string, unknown>()
  private readonly revisions = new Map<string, number>()

  constructor(private readonly ctx: Context) {}

  register(ns: string, schema?: (value: any) => unknown, base: unknown = {}): void {
    this.schemas.set(ns, schema)
    this.bases.set(ns, clone(base))
    this.revisions.set(ns, 0)
  }

  seed(document: Record<string, unknown>): void {
    for (const [ns, value] of Object.entries(document)) {
      this.document[ns] = clone(value)
      this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1)
    }
  }

  async update(ns: string, section: Record<string, unknown>): Promise<void> {
    this.document[ns] = clone(section)
    this.changed(ns)
  }

  async mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void> {
    const currentRevision = this.revisions.get(ns) ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new SettingsConflictError(ns as Namespace, expectedRevision, currentRevision)
    }
    const section = isRecord(this.document[ns]) ? clone(this.document[ns]) : {}
    for (const op of ops) applyPath(section, op.path, op)
    this.document[ns] = section
    this.changed(ns)
  }

  describe(): SettingsDescriptor[] {
    return [...this.schemas.keys()].map(ns => {
      const user = this.document[ns]
      const base = this.bases.get(ns)
      let value = merge(base, user)
      const schema = this.schemas.get(ns)
      if (schema !== undefined) {
        try { value = schema(value) } catch { /* keep merged value for diagnostics */ }
      }
      return {
        ns: ns as Namespace,
        autoGenerate: true,
        schema: undefined,
        value,
        base,
        user,
        revision: this.revisions.get(ns) ?? 0,
        applies: 'live',
        secrets: [],
      }
    })
  }

  private changed(ns: string): void {
    const revision = (this.revisions.get(ns) ?? 0) + 1
    this.revisions.set(ns, revision)
    this.ctx.emit('settings/document-updated', ns as Namespace, revision)
  }
}
