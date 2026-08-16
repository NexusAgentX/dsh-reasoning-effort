/** Browser plugin registration without mounting a DOM renderer. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  IconCheckOutline16: () => null,
}))
import {
  apply,
  inject,
  ReasoningSettingsSection,
} from '../src/client/index'
import { zh } from '../src/client/locales'

describe('reasoning settings client plugin', () => {
  it('registers one localized independent settings section', async () => {
    const ctx = new Context()
    const entries: Array<{ options: Record<string, any>; component: unknown; inject: unknown }> = []
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
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: keyof typeof zh) => zh[key],
    } as never)
    ctx.provide('connection', { api: { settings: {} } } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.component).toBe(ReasoningSettingsSection)
    expect(entries[0]?.options).toMatchObject({ id: 'providers-reasoning', order: 15 })
    expect(entries[0]?.options.label()).toBe('思考等级')
    const injected = entries[0]?.inject as unknown as () => { controller: unknown; t: (key: keyof typeof zh) => string }
    expect(injected().t('save')).toBe('保存更改')
    expect(injected().controller).toBeDefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
