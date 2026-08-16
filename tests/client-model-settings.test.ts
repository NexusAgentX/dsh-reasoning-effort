/** Client projection and revision-fenced save-plan tests. */

import { describe, expect, it } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  buildReasoningSavePlan,
  collectReasoningSettings,
  draftsOf,
  mergeRefreshedDrafts,
  modelRouteKey,
} from '../src/client/model-settings'

function view(input: Partial<SettingsNamespaceView> & Pick<SettingsNamespaceView, 'ns'>): SettingsNamespaceView {
  return {
    schema: {}, value: {}, applies: 'live', secrets: [], revision: 0,
    ...input,
  } as SettingsNamespaceView
}

function fixture() {
  return collectReasoningSettings([
    view({
      ns: 'llm-pi-ai' as never,
      revision: 4,
      base: { providers: { base: { models: [{ id: 'base-only' }] } } },
      user: {
        providers: {
          alpha: {
            displayName: 'Alpha Gateway',
            models: [
              { id: 'gpt-5.4', name: 'GPT routed' },
              { id: 'gpt-5.5', reasoningEfforts: null },
              { id: 'outside-catalog' },
            ],
            modelOverrides: { hidden: { reasoningEfforts: { high: 'high' } } },
          },
          beta: {
            models: [{ id: 'gpt-5.4', reasoningEfforts: { high: 'high' } }],
          },
        },
      },
    }),
    view({
      ns: 'providers-reasoning' as never,
      revision: 7,
      value: {
        models: {
          alpha: { 'gpt-5.4': { off: null, max: 'maximum' } },
        },
      },
    }),
    view({
      ns: 'agent-default-model' as never,
      revision: 9,
      value: {
        provider: 'alpha',
        model: 'gpt-5.4',
        reasoningEffort: 'low',
        reasoningDefaults: {
          alpha: { 'gpt-5.4': 'max' },
          beta: { 'gpt-5.4': 'high' },
        },
      },
    }),
  ], true)
}

describe('collectReasoningSettings', () => {
  it('lists only raw user models and keeps same model ids isolated by provider', () => {
    const snapshot = fixture()
    expect(snapshot.models.map(model => [model.provider, model.model])).toEqual([
      ['alpha', 'gpt-5.4'],
      ['alpha', 'gpt-5.5'],
      ['alpha', 'outside-catalog'],
      ['beta', 'gpt-5.4'],
    ])
    expect(snapshot.models.some(model => model.model === 'base-only' || model.model === 'hidden')).toBe(false)

    const alpha = snapshot.models.find(model => model.key === modelRouteKey('alpha', 'gpt-5.4'))!
    const beta = snapshot.models.find(model => model.key === modelRouteKey('beta', 'gpt-5.4'))!
    expect(alpha.capability).toEqual({ off: null, max: 'maximum' })
    expect(alpha.defaultEffort).toBe('max')
    expect(beta.capability).toEqual({ high: 'high' })
    expect(beta.defaultEffort).toBe('high')
    expect(alpha.key).not.toBe(beta.key)
    expect(snapshot.models.find(model => model.model === 'gpt-5.5')?.capability).toBeUndefined()
  })

  it('uses the legacy effort only for the current exact route', () => {
    const snapshot = collectReasoningSettings([
      view({
        ns: 'llm-pi-ai' as never,
        user: { providers: { first: { models: [{ id: 'same' }] }, second: { models: [{ id: 'same' }] } } },
      }),
      view({ ns: 'providers-reasoning' as never, value: { models: {} } }),
      view({
        ns: 'agent-default-model' as never,
        value: { provider: 'first', model: 'same', reasoningEffort: 'high' },
      }),
    ], true)
    expect(snapshot.models.map(model => model.defaultEffort)).toEqual(['high', undefined])
  })

  it('treats prototype-named provider and model ids as own exact-route keys', () => {
    const inherited = collectReasoningSettings([
      view({
        ns: 'llm-pi-ai' as never,
        user: {
          providers: JSON.parse('{"__proto__":{"models":[{"id":"toString","reasoningEfforts":false}]}}'),
        },
      }),
      view({ ns: 'providers-reasoning' as never, value: { models: {} } }),
      view({ ns: 'agent-default-model' as never, value: { reasoningDefaults: {} } }),
    ], true)
    expect(inherited.models).toHaveLength(1)
    expect(inherited.models[0]).toMatchObject({
      provider: '__proto__', model: 'toString', capability: false, defaultEffort: undefined,
    })

    const owned = collectReasoningSettings([
      view({
        ns: 'llm-pi-ai' as never,
        user: {
          providers: JSON.parse('{"__proto__":{"models":[{"id":"toString","reasoningEfforts":false}]}}'),
        },
      }),
      view({
        ns: 'providers-reasoning' as never,
        value: JSON.parse('{"models":{"__proto__":{"toString":{"off":null,"high":"owned-high"}}}}'),
      }),
      view({
        ns: 'agent-default-model' as never,
        value: JSON.parse('{"reasoningDefaults":{"__proto__":{"toString":"high"}}}'),
      }),
    ], true)
    expect(owned.models[0]).toMatchObject({
      capability: { off: null, high: 'owned-high' }, defaultEffort: 'high',
    })
  })
})

describe('buildReasoningSavePlan', () => {
  it('writes capability and defaults to their owners and mirrors the current legacy field', () => {
    const snapshot = fixture()
    const drafts = draftsOf(snapshot.models)
    const key = modelRouteKey('alpha', 'gpt-5.4')
    drafts[key] = {
      enabled: true,
      efforts: { off: null, high: 'wire-high' },
      defaultEffort: 'high',
    }
    const plan = buildReasoningSavePlan(snapshot, drafts)
    expect(plan.errors).toEqual([])
    expect(plan.pluginOps).toEqual([{
      op: 'set',
      path: ['models', 'alpha', 'gpt-5.4'],
      value: { off: null, high: 'wire-high' },
    }])
    expect(plan.agentDefaultOps).toEqual([
      { op: 'set', path: ['reasoningDefaults', 'alpha', 'gpt-5.4'], value: 'high' },
      { op: 'set', path: ['reasoningEffort'], value: 'high' },
    ])
  })

  it('treats off as explicit, rejects stale defaults, and removes a disabled route default', () => {
    const snapshot = fixture()
    const drafts = draftsOf(snapshot.models)
    const alpha = modelRouteKey('alpha', 'gpt-5.4')
    drafts[alpha] = { enabled: true, efforts: { off: null, high: 'high' }, defaultEffort: 'off' }
    let plan = buildReasoningSavePlan(snapshot, drafts)
    expect(plan.errors).toEqual([])
    expect(plan.agentDefaultOps[0]).toEqual({
      op: 'set', path: ['reasoningDefaults', 'alpha', 'gpt-5.4'], value: 'off',
    })

    drafts[alpha] = { enabled: true, efforts: { off: null, high: 'high' }, defaultEffort: 'max' }
    plan = buildReasoningSavePlan(snapshot, drafts)
    expect(plan.errors).toContainEqual({ key: alpha, code: 'invalid-default' })

    const beta = modelRouteKey('beta', 'gpt-5.4')
    drafts[alpha] = draftsOf(snapshot.models)[alpha]!
    drafts[beta] = { enabled: false, efforts: {}, defaultEffort: undefined }
    plan = buildReasoningSavePlan(snapshot, drafts)
    expect(plan.pluginOps).toEqual([{
      op: 'set', path: ['models', 'beta', 'gpt-5.4'], value: false,
    }])
    expect(plan.agentDefaultOps).toEqual([
      { op: 'unset', path: ['reasoningDefaults', 'beta', 'gpt-5.4'] },
    ])
  })

  it('requires a non-off level with valid wire spelling', () => {
    const snapshot = fixture()
    const drafts = draftsOf(snapshot.models)
    const key = modelRouteKey('alpha', 'outside-catalog')
    drafts[key] = { enabled: true, efforts: { off: null }, defaultEffort: undefined }
    expect(buildReasoningSavePlan(snapshot, drafts).errors)
      .toContainEqual({ key, code: 'needs-level' })
    drafts[key] = { enabled: true, efforts: { high: '' }, defaultEffort: 'high' }
    expect(buildReasoningSavePlan(snapshot, drafts).errors)
      .toContainEqual({ key, code: 'invalid-wire' })
  })

  it('writes only fields the user touched after an external snapshot refresh', () => {
    const original = fixture()
    const drafts = draftsOf(original.models)
    const alpha = modelRouteKey('alpha', 'gpt-5.4')
    drafts[alpha] = {
      enabled: true,
      efforts: { off: null, high: 'high', max: 'maximum' },
      defaultEffort: 'max',
    }
    const refreshed = {
      ...original,
      models: original.models.map(model => model.provider === 'beta'
        ? { ...model, capability: { high: 'changed-elsewhere' }, defaultEffort: 'off' }
        : model.provider === 'alpha' && model.model === 'gpt-5.4'
          ? { ...model, defaultEffort: 'high' }
          : model),
    }
    const plan = buildReasoningSavePlan(refreshed, drafts, {
      capabilities: new Set([alpha]),
      defaults: new Set(),
    })
    expect(plan.errors).toEqual([])
    expect(plan.pluginOps).toEqual([{
      op: 'set',
      path: ['models', 'alpha', 'gpt-5.4'],
      value: { off: null, high: 'high', max: 'maximum' },
    }])
    expect(plan.agentDefaultOps).toEqual([])
  })

  it('merges refreshed unedited capabilities and rejects a now-stale dirty default', () => {
    const original = fixture()
    const alpha = modelRouteKey('alpha', 'gpt-5.4')
    const originalModels = original.models.map(model => model.key === alpha
      ? { ...model, defaultEffort: 'high' }
      : model)
    const drafts = draftsOf(originalModels)
    drafts[alpha] = { ...drafts[alpha]!, defaultEffort: 'max' }
    const refreshed = {
      ...original,
      models: originalModels.map(model => model.key === alpha
        ? { ...model, capability: { off: null, high: 'high' } }
        : model),
    }
    const dirty = {
      capabilities: new Set<string>(),
      defaults: new Set([alpha]),
    }

    const merged = mergeRefreshedDrafts(refreshed.models, drafts, dirty)
    expect(merged[alpha]).toEqual({
      enabled: true,
      efforts: { off: null, high: 'high' },
      defaultEffort: 'max',
    })
    const plan = buildReasoningSavePlan(refreshed, drafts, dirty)
    expect(plan.errors).toContainEqual({ key: alpha, code: 'invalid-default' })
    expect(plan.pluginOps).toEqual([])
  })
})
