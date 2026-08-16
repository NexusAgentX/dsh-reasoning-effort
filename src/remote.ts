/** Plugin-owned Typert Remote for settings read/write without ApiProxy namespace exposure. */

import type { Context } from '@deepseek-ai/cordis'
import {
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import type {
  SettingsDescriptor,
  SettingsPathOp,
  SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
} from './constants.js'
import {
  parseJsonValue,
  parseReasoningMutateRequest,
} from './remote-contract.js'
import type {
  JsonObject,
  ReasoningMutationResult,
  ReasoningMutateRequest,
  ReasoningNamespaceDocument,
  ReasoningPathOp,
  ReasoningSettingsDocument,
} from './remote-contract.js'
import {
  isRecord,
} from './routes.js'

const PI_AI_NS = settingsNamespace(PI_AI_SETTINGS_NAMESPACE_ID)
const PLUGIN_NS = settingsNamespace(PLUGIN_SETTINGS_NAMESPACE_ID)
const AGENT_DEFAULT_NS = settingsNamespace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)
const REMOTE_NAMESPACES = [PI_AI_NS, PLUGIN_NS, AGENT_DEFAULT_NS] as const

function jsonObject(value: unknown): JsonObject {
  const parsed = parseJsonValue(value ?? {})
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : Object.create(null) as JsonObject
}

function namespaceDocument(descriptor: SettingsDescriptor | undefined, ns: string): ReasoningNamespaceDocument {
  return {
    ns,
    revision: descriptor?.revision ?? 0,
    value: jsonObject(descriptor?.value),
    user: jsonObject(descriptor?.user),
  }
}

export function describeReasoningSettings(settings: SettingsProvider): ReasoningSettingsDocument {
  const descriptors = settings.describe({ redactSecrets: true })
  return {
    writable: settings.writable,
    namespaces: REMOTE_NAMESPACES.map(ns => namespaceDocument(
      descriptors.find(descriptor => descriptor.ns === ns),
      ns,
    )),
  }
}

function assertPluginOp(op: ReasoningPathOp): void {
  const [root, provider, model, extra] = op.path
  if (extra !== undefined || (root !== 'models' && root !== 'defaults')
    || provider === undefined || model === undefined) {
    throw new TypeError('providers-reasoning Remote: plugin writes must target models/defaults.<provider>.<model>')
  }
  if (op.op === 'unset') return
  if (root === 'defaults') {
    if (typeof op.value !== 'string' || op.value.length === 0) {
      throw new TypeError('providers-reasoning Remote: default writes need a non-empty effort')
    }
    return
  }
  if (op.value !== false && !isRecord(op.value)) {
    throw new TypeError('providers-reasoning Remote: model writes need false or an effort map')
  }
}

function assertAgentDefaultOp(op: ReasoningPathOp): void {
  if (op.path.length !== 1 || op.path[0] !== 'reasoningEffort') {
    throw new TypeError('providers-reasoning Remote: compatibility writes may target only reasoningEffort')
  }
  if (op.op === 'set' && (typeof op.value !== 'string' || op.value.length === 0)) {
    throw new TypeError('providers-reasoning Remote: reasoningEffort needs a non-empty string')
  }
}

function asSettingsOps(ops: readonly ReasoningPathOp[]): SettingsPathOp[] {
  return ops.map(op => op.op === 'set'
    ? { op: 'set', path: [...op.path], value: op.value }
    : { op: 'unset', path: [...op.path] })
}

/** Live service discovered by the generic Typert Gateway SRC fallback. */
export class ReasoningEffortRemoteService extends TypertRemoteService {
  constructor(ctx: Context, private readonly settings: SettingsProvider) {
    super(ctx, 'reasoningEffortRemote', { namespace: 'providersReasoning' })
  }

  @Remote
  describe(): ReasoningSettingsDocument {
    return describeReasoningSettings(this.settings)
  }

  @Remote
  async mutate(request: ReasoningMutateRequest): Promise<ReasoningMutationResult> {
    const parsed = parseReasoningMutateRequest(request)
    for (const op of parsed.pluginOps) assertPluginOp(op)
    for (const op of parsed.agentDefaultOps) assertAgentDefaultOp(op)
    if (!this.settings.writable) throw new Error('providers-reasoning settings are read-only')
    if (parsed.pluginOps.length > 0) {
      await this.settings.mutate(PLUGIN_NS, asSettingsOps(parsed.pluginOps), parsed.expectedPluginRevision)
    }
    if (parsed.agentDefaultOps.length > 0) {
      await this.settings.mutate(
        AGENT_DEFAULT_NS,
        asSettingsOps(parsed.agentDefaultOps),
        parsed.expectedAgentDefaultRevision,
      )
    }
    return { saved: true }
  }

}
