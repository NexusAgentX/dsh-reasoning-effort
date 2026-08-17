/** Composer slider precedence and session-only mutation behavior. */

import { createRequire } from 'node:module'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ModelDirectory,
  ModelDirectoryState,
} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ReasoningSettingsState } from '../src/client/controller'
import {
  commitDirectoryEffort,
  ComposerModelSelect,
  effortIntervalIndex,
  effectiveEffortIndex,
  sliderLevels,
} from '../src/client/composer'
import { modelRouteKey } from '../src/client/model-settings'
import { zh } from '../src/client/locales'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCheckOutline16: () => null,
  IconChevronDownOutline14: () => null,
  IconChevronLeftOutline14: () => null,
  IconChevronRightOutline14: () => null,
}))

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (node: ReactNode) => string
}

const levels: ModelReasoningEffort[] = [
  { id: 'off', name: 'Off' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]

function directoryState(
  currentEffort?: string,
  defaultEffort: string | undefined = 'high',
): ModelDirectoryState {
  return {
    current: {
      provider: 'alpha',
      model: 'model-a',
      ...(currentEffort === undefined ? {} : { reasoningEffort: currentEffort }),
    },
    routable: true,
    groups: [{
      id: 'alpha',
      name: 'Alpha',
      models: [{
        id: 'model-a',
        name: 'Model A',
        reasoning: { efforts: levels, defaultEffort },
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
  }
}

function settingsState(
  status: ReasoningSettingsState['status'] = 'ready',
  defaultEffort: string | undefined = 'max',
): ReasoningSettingsState {
  return {
    status,
    error: status === 'error' ? 'settings unavailable' : null,
    saving: false,
    version: 1,
    snapshot: {
      writable: true,
      models: [{
        key: modelRouteKey('alpha', 'model-a'),
        provider: 'alpha',
        providerName: 'Alpha',
        model: 'model-a',
        modelName: 'Model A',
        capability: { off: null, high: 'high', max: 'max' },
        defaultEffort,
      }],
      pluginRevision: 1,
      agentDefaultRevision: 1,
      currentProvider: undefined,
      currentModel: undefined,
      legacyReasoningEffort: undefined,
    },
  }
}

function translate(key: keyof typeof zh, params?: Record<string, unknown>): string {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}

describe('Composer reasoning effort', () => {
  it('uses session explicit, exact-route, adapter, then midpoint precedence', () => {
    expect(effectiveEffortIndex(levels, directoryState('off'), settingsState())).toBe(0)
    expect(effectiveEffortIndex(levels, directoryState(), settingsState())).toBe(2)
    expect(effectiveEffortIndex(levels, directoryState(), settingsState('loading'))).toBe(1)
    expect(effectiveEffortIndex(levels, directoryState(), settingsState('error'))).toBe(1)
    expect(effectiveEffortIndex(levels, directoryState(undefined, undefined), settingsState('loading'))).toBe(1)
  })

  it('maps continuous positions to equal effort intervals without rounding', () => {
    expect(effortIntervalIndex(0, levels.length)).toBe(0)
    expect(effortIntervalIndex(0.99, levels.length)).toBe(0)
    expect(effortIntervalIndex(1, levels.length)).toBe(1)
    expect(effortIntervalIndex(1.99, levels.length)).toBe(1)
    expect(effortIntervalIndex(levels.length, levels.length)).toBe(levels.length - 1)
  })

  it('hides the slider when the current model exposes fewer than two efforts', () => {
    const state = directoryState()
    state.groups = [{
      ...state.groups[0]!,
      models: [{
        ...state.groups[0]!.models[0]!,
        reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
      }],
    }]
    expect(sliderLevels(state)).toEqual([])
  })

  it('revalidates and writes only the session selection', async () => {
    let state = directoryState()
    const select = vi.fn(async (selection) => {
      state = { ...state, current: selection }
    })
    const directory = {
      store: { getSnapshot: () => state },
      load: vi.fn(async () => undefined),
      select,
    } as unknown as ModelDirectory

    await expect(commitDirectoryEffort(directory, 1.8, 'no efforts')).resolves.toMatchObject({
      index: 1,
      id: 'high',
    })
    expect(select).toHaveBeenCalledWith({
      provider: 'alpha', model: 'model-a', reasoningEffort: 'high',
    })
  })

  it('surfaces selection failures for the caller to roll back', async () => {
    const state = directoryState()
    const directory = {
      store: { getSnapshot: () => state },
      load: vi.fn(async () => undefined),
      select: vi.fn(async () => { throw new Error('rejected') }),
    } as unknown as ModelDirectory

    await expect(commitDirectoryEffort(directory, 2, 'no efforts')).rejects.toThrow('rejected')
  })

  it('returns null for unavailable sessions and renders the native range when available', () => {
    const unavailable = renderToStaticMarkup(createElement(ComposerModelSelect, {
      available: false,
      locked: false,
      directory: undefined as never,
      settings: undefined as never,
      t: translate,
    }))
    expect(unavailable).toBe('')

    const state = directoryState()
    const settingsSnapshot = settingsState()
    const available = renderToStaticMarkup(createElement(ComposerModelSelect, {
      available: true,
      locked: false,
      directory: {
        store: {
          subscribe: () => () => {},
          getSnapshot: () => state,
        },
        load: vi.fn(),
      } as never,
      settings: {
        subscribe: () => () => {},
        getSnapshot: () => settingsSnapshot,
        load: vi.fn(),
      } as never,
      t: translate,
    }))
    expect(available).toContain('dpr-composer-trigger')
    expect(available).toContain('Model A')
    expect(available).toContain('Max')
  })
})
