/** Boundary validation for the plugin-owned strict Client Remote contribution. */

import { describe, expect, it } from 'vitest'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  TYPERT_HOST,
  TYPERT_REMOTE,
  parseReasoningMutateRequest,
  parseReasoningSettingsDocument,
} from '../src/remote-contract'

function resultSchema(method: string) {
  const descriptor = TYPERT_REMOTE.descriptors.find(candidate => candidate.method === method) as InvocationDescriptor
  if (descriptor.result.mode !== 'strict') throw new Error('test expected a strict result codec')
  return descriptor.result.schema
}

describe('providers-reasoning Remote contract', () => {
  it('publishes only strict direct methods under one private namespace', () => {
    expect(TYPERT_REMOTE.package).toBe('dsh-reasoning-effort')
    expect(TYPERT_HOST).toMatchObject({
      package: 'dsh-reasoning-effort', face: 'host', invocations: TYPERT_REMOTE.descriptors,
    })
    expect(TYPERT_REMOTE.descriptors.map(descriptor => ({
      service: descriptor.service,
      namespace: descriptor.namespace,
      method: descriptor.method,
      invocation: descriptor.invocation,
    }))).toEqual([
      { service: 'reasoningEffortRemote', namespace: 'providersReasoning', method: 'describe', invocation: { kind: 'direct' } },
      { service: 'reasoningEffortRemote', namespace: 'providersReasoning', method: 'mutate', invocation: { kind: 'direct' } },
    ])
    for (const descriptor of TYPERT_REMOTE.descriptors) {
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.parameters.every(parameter => parameter.codec.mode === 'strict')).toBe(true)
    }
  })

  it('detaches prototype-named JSON routes and rejects malformed revisions and operations', () => {
    const parsed = parseReasoningSettingsDocument({
      writable: true,
      namespaces: [{
        ns: 'providers-reasoning', revision: 1,
        value: JSON.parse('{"models":{"__proto__":{"toString":false}},"defaults":{}}'),
        user: {},
      }],
    })
    expect(Object.hasOwn(parsed.namespaces[0]!.value.models as object, '__proto__')).toBe(true)
    expect(() => parseReasoningSettingsDocument({ writable: true, namespaces: [{
      ns: 'x', revision: -1, value: {}, user: {},
    }] })).toThrow(/revision/)
    expect(() => parseReasoningMutateRequest({
      pluginOps: [{ op: 'merge', path: ['models'] }],
      agentDefaultOps: [], expectedPluginRevision: 0, expectedAgentDefaultRevision: 0,
    })).toThrow(/expected "set" or "unset"/)
  })

  it('validates Host results before exposing them to the controller', () => {
    expect(resultSchema('describe').parse({ writable: true, namespaces: [] }))
      .toEqual({ writable: true, namespaces: [] })
    expect(() => resultSchema('describe').parse({ writable: 'yes', namespaces: [] })).toThrow(/writable/)
    expect(resultSchema('mutate').parse({ saved: true })).toEqual({ saved: true })
  })
})
