/** Browser plugin registration without mounting a DOM renderer. */

import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  IconCheckOutline16: () => null,
  IconChevronDownOutline14: () => null,
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

  it('unmounts its Remote contribution when dependent setup fails', async () => {
    const unmountRemote = vi.fn(() => Promise.resolve())
    const ctx = {
      remote: { $mount: () => Promise.resolve(unmountRemote) },
      plugin: () => Promise.reject(new Error('client setup failed')),
    }

    await expect(apply(ctx as never)).rejects.toThrow('client setup failed')
    expect(unmountRemote).toHaveBeenCalledOnce()
  })

  it('disposes its dependent client scope and Remote contribution', async () => {
    const disposeClient = vi.fn(() => Promise.resolve())
    const disposeRemote = vi.fn(() => Promise.resolve())
    const ctx = {
      remote: { $mount: () => Promise.resolve(disposeRemote) },
      plugin: () => Promise.resolve({ dispose: disposeClient }),
    }

    const cleanup = await apply(ctx as never)
    await cleanup()
    expect(disposeClient).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('registers one localized independent settings section', async () => {
    const ctx = new Context()
    const entries: Array<{ options: Record<string, any>; component: unknown; inject: unknown }> = []
    const unmountRemote = vi.fn(() => Promise.resolve())
    const describeSettings = vi.fn(() => Promise.resolve({ ok: true as const, value: { writable: true, namespaces: [] } }))
    const slots = {
      inject: (_name: string, register: () => () => void) => {
        const dispose = register()
        ctx.effect(() => dispose, 'test slots.inject')
      },
      register: (options: Record<string, any>, component: unknown) => {
        const entry = { options, component, inject: options.inject }
        entries.push(entry)
        return () => {
          const index = entries.indexOf(entry)
          if (index >= 0) entries.splice(index, 1)
        }
      },
      entries: () => entries,
    }
    ctx.provide('slots', slots as never)
    ctx.provide('modelDirectories', { directoryFor: vi.fn() } as never)
    ctx.provide('sessions', { subagentAddress: vi.fn(() => undefined) } as never)
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: keyof typeof zh) => zh[key],
    } as never)
    ctx.provide('connection', { api: {} } as never)
    const remoteNamespace = {
      describe: describeSettings,
      mutate: () => Promise.resolve({ ok: true, value: { saved: true } }),
    }
    ctx.provide('remote', {
      $mount: () => Promise.resolve(unmountRemote),
      $on: () => () => {},
      providersReasoning: remoteNamespace,
    } as never)
    ctx.provide('remote.providersReasoning', remoteNamespace as never)

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
    expect(describeSettings).not.toHaveBeenCalled()

    await fiber.dispose()
    expect(unmountRemote).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(entries).toHaveLength(0)
  })
})
