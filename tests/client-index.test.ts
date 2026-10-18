/** Browser plugin registration without mounting a DOM renderer. */

import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  IconCheckOutlineRegular: () => null,
  IconChevronDownOutlineRegular: () => null,
}))
import {
  apply,
  inject,
  ReasoningSettingsSection,
} from '../src/client/index'
import { ComposerModelSelect } from '../src/client/composer'
import { zh } from '../src/client/locales'

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (node: ReactNode) => string
}

function form(value: unknown, user: unknown = value) {
  return {
    getSnapshot: () => ({
      status: 'ready' as const,
      value,
      user,
      base: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: () => () => {},
    mutate: () => Promise.resolve(true),
  }
}

describe('reasoning settings client plugin', () => {
  it('starts every model reasoning editor collapsed', () => {
    const state = {
      status: 'ready',
      error: null,
      saving: false,
      version: 1,
      snapshot: {
        writable: true,
        models: [{
          key: 'lite-cpa/grok-4.6',
          provider: 'lite-cpa',
          providerName: 'Lite CPA',
          model: 'grok-4.6',
          modelName: 'grok-4.6',
          capability: { off: null, low: 'low' },
          defaultEffort: 'low',
        }],
        pluginRevision: 1,
        agentDefaultRevision: 1,
        currentProvider: undefined,
        currentModel: undefined,
        legacyReasoningEffort: undefined,
      },
    } as const
    const controller = {
      subscribe: () => () => {},
      getSnapshot: () => state,
      load: vi.fn(),
    }

    const markup = renderToStaticMarkup(createElement(ReasoningSettingsSection, {
      controller: controller as never,
      t: key => zh[key],
    }))

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('id="dpr-details-lite-cpa%2Fgrok-4.6" hidden=""')
    expect(markup).toContain(zh.availableEfforts)
  })

  it('registers one localized settings section and the composer control', async () => {
    const ctx = new Context()
    const entries: Array<{ options: Record<string, any>; component: unknown; inject: unknown }> = []
    const forms = new Map<string, ReturnType<typeof form>>([
      ['llm-pi-ai', form({}, { providers: { alpha: { models: [{ id: 'gpt-5.4' }] } } })],
      ['providers-reasoning', form({ models: {}, defaults: {}, legacyDefaultsMigrated: true })],
      ['agent-default-model', form({ provider: 'alpha', model: 'gpt-5.4' })],
    ])
    const configForms = {
      get: (id: string) => forms.get(id)!,
      whileServed: (_namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
        return register(new Set(forms.keys()))
      },
    }
    const slots = {
      inject: (_name: string, register: () => () => void) => {
        const dispose = register()
        ctx.effect(() => dispose, 'test slots.inject')
        return dispose
      },
      register: (options: Record<string, any>, component: unknown) => {
        const entry = { options, component, inject: options.inject }
        entries.push(entry)
        return () => {
          const index = entries.indexOf(entry)
          if (index >= 0) entries.splice(index, 1)
        }
      },
    }
    ctx.provide('configForms', configForms as never)
    ctx.provide('slots', slots as never)
    ctx.provide('modelDirectories', { directoryFor: vi.fn() } as never)
    ctx.provide('sessions', { subagentAddress: vi.fn(() => undefined) } as never)
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: keyof typeof zh) => zh[key],
    } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(entries).toHaveLength(2)
    const settings = entries.find(entry => entry.options.id === 'providers-reasoning')!
    const composer = entries.find(entry => entry.options.name === 'conversation.input.model')!
    expect(settings.component).toBe(ReasoningSettingsSection)
    expect(settings.options).toMatchObject({ id: 'providers-reasoning', order: 15 })
    expect(settings.options.label()).toBe('思考等级')
    expect(composer.component).toBe(ComposerModelSelect)
    expect(composer.options).toMatchObject({ name: 'conversation.input.model', priority: -100 })
    const injected = settings.inject as unknown as () => { controller: unknown; t: (key: keyof typeof zh) => string }
    expect(injected().t('save')).toBe('保存更改')
    expect(injected().controller).toBeDefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
    expect(entries).toHaveLength(0)
  })
})
