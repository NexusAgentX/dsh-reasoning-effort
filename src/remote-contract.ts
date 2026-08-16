/** Private Host/Client Remote contract for the plugin-owned settings surface. */

import type {
  InvocationDescriptor,
  RemoteResult,
  TypertClientRemote,
  TypertRemoteContribution,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject { [key: string]: JsonValue }

export interface ReasoningNamespaceDocument {
  ns: string
  revision: number
  value: JsonObject
  user: JsonObject
}

export interface ReasoningSettingsDocument {
  writable: boolean
  namespaces: ReasoningNamespaceDocument[]
}

export type ReasoningPathOp =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

export interface ReasoningMutateRequest {
  pluginOps: ReasoningPathOp[]
  agentDefaultOps: ReasoningPathOp[]
  expectedPluginRevision: number
  expectedAgentDefaultRevision: number
}

export interface ReasoningMutationResult {
  saved: true
}

export interface ReasoningRemoteNamespace {
  describe(): Promise<RemoteResult<ReasoningSettingsDocument>>
  mutate(request: ReasoningMutateRequest): Promise<RemoteResult<ReasoningMutationResult>>
}

export type ReasoningClientRemote = TypertClientRemote & {
  providersReasoning: ReasoningRemoteNamespace
}

function fail(path: string, message: string): never {
  throw new TypeError(`providers-reasoning Remote ${path}: ${message}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'expected an object')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail(path, 'expected a non-empty string')
  return value
}

function revision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(path, 'expected a non-negative safe integer')
  return value as number
}

export function parseJsonValue(value: unknown, path = 'value'): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail(path, 'expected a finite number')
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => parseJsonValue(entry, `${path}[${index}]`))
  const input = record(value, path)
  const output = Object.create(null) as JsonObject
  for (const [key, entry] of Object.entries(input)) output[key] = parseJsonValue(entry, `${path}.${key}`)
  return output
}

function jsonObject(value: unknown, path: string): JsonObject {
  const parsed = parseJsonValue(value, path)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(path, 'expected an object')
  return parsed
}

function parseNamespace(value: unknown, path: string): ReasoningNamespaceDocument {
  const input = record(value, path)
  return {
    ns: text(input.ns, `${path}.ns`),
    revision: revision(input.revision, `${path}.revision`),
    value: jsonObject(input.value, `${path}.value`),
    user: jsonObject(input.user, `${path}.user`),
  }
}

export function parseReasoningSettingsDocument(value: unknown): ReasoningSettingsDocument {
  const input = record(value, 'document')
  if (typeof input.writable !== 'boolean') return fail('document.writable', 'expected a boolean')
  if (!Array.isArray(input.namespaces)) return fail('document.namespaces', 'expected an array')
  return {
    writable: input.writable,
    namespaces: input.namespaces.map((entry, index) => parseNamespace(entry, `document.namespaces[${index}]`)),
  }
}

function parsePath(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return fail(path, 'expected a non-empty string array')
  return value.map((entry, index) => text(entry, `${path}[${index}]`))
}

function parsePathOp(value: unknown, path: string): ReasoningPathOp {
  const input = record(value, path)
  const op = text(input.op, `${path}.op`)
  const parsedPath = parsePath(input.path, `${path}.path`)
  if (op === 'unset') return { op, path: parsedPath }
  if (op === 'set') return { op, path: parsedPath, value: parseJsonValue(input.value, `${path}.value`) }
  return fail(`${path}.op`, 'expected "set" or "unset"')
}

function parseOps(value: unknown, path: string): ReasoningPathOp[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array')
  return value.map((entry, index) => parsePathOp(entry, `${path}[${index}]`))
}

export function parseReasoningMutateRequest(value: unknown): ReasoningMutateRequest {
  const input = record(value, 'mutate')
  return {
    pluginOps: parseOps(input.pluginOps, 'mutate.pluginOps'),
    agentDefaultOps: parseOps(input.agentDefaultOps, 'mutate.agentDefaultOps'),
    expectedPluginRevision: revision(input.expectedPluginRevision, 'mutate.expectedPluginRevision'),
    expectedAgentDefaultRevision: revision(input.expectedAgentDefaultRevision, 'mutate.expectedAgentDefaultRevision'),
  }
}

function literalResult<T extends object>(value: unknown, key: keyof T, expected: unknown, path: string): T {
  const input = record(value, path)
  if (input[key as string] !== expected) return fail(`${path}.${String(key)}`, `expected ${JSON.stringify(expected)}`)
  return { [key]: expected } as T
}

const documentSchema: TypertSchema<ReasoningSettingsDocument> = { parse: parseReasoningSettingsDocument }
const mutateRequestSchema: TypertSchema<ReasoningMutateRequest> = { parse: parseReasoningMutateRequest }
const mutationResultSchema: TypertSchema<ReasoningMutationResult> = {
  parse: value => literalResult<ReasoningMutationResult>(value, 'saved', true, 'mutationResult'),
}

function descriptor(
  method: string,
  parameter: { typeSymbol: string; schema: TypertSchema } | undefined,
  result: { typeSymbol: string; schema: TypertSchema },
): InvocationDescriptor {
  return {
    id: `dsh-reasoning-effort#reasoningEffortRemote/${method}`,
    service: 'reasoningEffortRemote',
    namespace: 'providersReasoning',
    method,
    invocation: { kind: 'direct' },
    parameters: parameter === undefined ? [] : [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: parameter.typeSymbol, schema: parameter.schema },
    }],
    result: { mode: 'strict', typeSymbol: result.typeSymbol, schema: result.schema },
  }
}

/** Strict Client contribution mounted by this plugin's browser entry. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-reasoning-effort',
  descriptors: [
    descriptor('describe', undefined, {
      typeSymbol: 'dsh-reasoning-effort#ReasoningSettingsDocument', schema: documentSchema,
    }),
    descriptor('mutate', {
      typeSymbol: 'dsh-reasoning-effort#ReasoningMutateRequest', schema: mutateRequestSchema,
    }, {
      typeSymbol: 'dsh-reasoning-effort#ReasoningMutationResult', schema: mutationResultSchema,
    }),
  ],
}

/** Host-side strict registration; direct ownership supports late-loaded plugins. */
export const TYPERT_HOST: TypertContribution = {
  package: 'dsh-reasoning-effort',
  face: 'host',
  schemas: [],
  invocations: TYPERT_REMOTE.descriptors,
  model: {
    services: [{
      key: 'reasoningEffortRemote',
      exportName: 'ReasoningEffortRemoteService',
      description: 'Plugin-owned settings boundary for exact-route reasoning capabilities and defaults.',
      summary: 'Exact-route reasoning settings boundary.',
      tags: [],
      members: [
        { kind: 'method', name: 'describe', signature: 'describe(): ReasoningSettingsDocument' },
        { kind: 'method', name: 'mutate', signature: 'mutate(request: ReasoningMutateRequest): Promise<ReasoningMutationResult>' },
      ],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
