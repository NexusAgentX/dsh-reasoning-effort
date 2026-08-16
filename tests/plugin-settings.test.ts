/** Plugin-owned capability settings schema and semantic validation. */

import { describe, expect, it } from 'vitest'
import {
  ReasoningPluginSettingsSchema,
  validateReasoningPluginSettings,
} from '../src/plugin-settings'

describe('ReasoningPluginSettings', () => {
  it('defaults to an empty exact-route map and accepts false or mapped capabilities', () => {
    expect(ReasoningPluginSettingsSchema({} as never)).toEqual({
      models: {}, defaults: {}, legacyDefaultsMigrated: false,
    })
    const value = ReasoningPluginSettingsSchema({
      models: {
        first: {
          plain: false,
          reasoner: { off: null, high: 'maximum' },
        },
      },
      defaults: { first: { reasoner: 'high' } },
      legacyDefaultsMigrated: false,
    })
    expect(() => validateReasoningPluginSettings(value)).not.toThrow()
  })

  it('rejects semantically unusable maps and empty route keys', () => {
    expect(() => validateReasoningPluginSettings({
      models: { first: { reasoner: { off: null } } },
      defaults: {},
      legacyDefaultsMigrated: false,
    })).toThrow(/at least one level beyond "off"/)
    expect(() => validateReasoningPluginSettings({
      models: { '': { reasoner: false } },
      defaults: {},
      legacyDefaultsMigrated: false,
    })).toThrow(/provider keys must be non-empty/)
  })
})
