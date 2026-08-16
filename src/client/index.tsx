/** Plugin-provided settings section for exact-route reasoning capabilities and defaults. */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only imports install the settings and locale context/slot merges.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
  PI_AI_SETTINGS_NAMESPACE_ID,
  PLUGIN_SETTINGS_NAMESPACE_ID,
  REASONING_LEVELS,
} from '../constants.js'
import { TYPERT_REMOTE } from '../remote-contract.js'
import type { ReasoningClientRemote } from '../remote-contract.js'
import { ReasoningSettingsController } from './controller.js'
import type { ReasoningSettingsState } from './controller.js'
import {
  buildReasoningSavePlan,
  draftsOf,
  mergeRefreshedDrafts,
} from './model-settings.js'
import type {
  DraftValidationError,
  ReasoningDirtyFields,
  ReasoningModelDraft,
  ReasoningSettingsModel,
} from './model-settings.js'
import { en, zh } from './locales.js'
import type { ReasoningSettingsLocaleKey } from './locales.js'
import { styles } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Exact-route reasoning capabilities and defaults. */
    'settings.providers-reasoning': ReasoningSettingsLocaleKey
  }
}

const LOCALE_NAMESPACE = 'settings.providers-reasoning'
const STYLE_ID = 'dsh-reasoning-effort/settings'

/** Services required by the browser half. */
export const inject = ['slots', 'locale', 'connection', 'remote']

export interface ReasoningSettingsInjected {
  controller: ReasoningSettingsController
  t: (key: ReasoningSettingsLocaleKey) => string
}

export type ReasoningSettingsSectionProps = Partial<ReasoningSettingsInjected>

function initialDraft(model: ReasoningSettingsModel): ReasoningModelDraft {
  const capability = model.capability
  return {
    enabled: capability !== undefined && capability !== false,
    efforts: capability !== undefined && capability !== false ? { ...capability } : {},
    defaultEffort: model.defaultEffort,
  }
}

function validationText(
  error: DraftValidationError,
  t: ReasoningSettingsInjected['t'],
): string {
  if (error.code === 'needs-level') return t('needsLevel')
  if (error.code === 'invalid-wire') return t('invalidWire')
  return t('invalidDefault')
}

function providerGroups(models: readonly ReasoningSettingsModel[]): Array<{
  provider: string
  name: string
  models: ReasoningSettingsModel[]
}> {
  const groups = new Map<string, { provider: string; name: string; models: ReasoningSettingsModel[] }>()
  for (const model of models) {
    let group = groups.get(model.provider)
    if (group === undefined) {
      group = { provider: model.provider, name: model.providerName, models: [] }
      groups.set(model.provider, group)
    }
    group.models.push(model)
  }
  return [...groups.values()]
}

/** Slot component wrapper; the renderer may mount before injection settles. */
export function ReasoningSettingsSection(props: ReasoningSettingsSectionProps): ReactNode {
  if (props.controller === undefined || props.t === undefined) return null
  return <Loaded controller={props.controller} t={props.t} />
}

function Loaded({ controller, t }: ReasoningSettingsInjected): ReactNode {
  const state: ReasoningSettingsState = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [drafts, setDrafts] = useState<Record<string, ReasoningModelDraft>>({})
  const [dirty, setDirty] = useState<ReasoningDirtyFields>(() => ({
    capabilities: new Set(), defaults: new Set(),
  }))
  const [saved, setSaved] = useState(false)
  const [expandedModels, setExpandedModels] = useState<ReadonlySet<string>>(() => new Set())
  const snapshot = state.snapshot
  const editing = dirty.capabilities.size > 0 || dirty.defaults.size > 0

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (snapshot !== null) {
      setDrafts(previous => mergeRefreshedDrafts(snapshot.models, previous, dirty))
    }
  }, [dirty, snapshot, state.version])

  const plan = useMemo(
    () => snapshot === null
      ? { pluginOps: [], agentDefaultOps: [], errors: [] }
      : buildReasoningSavePlan(snapshot, drafts, dirty),
    [dirty, drafts, snapshot],
  )
  const errorsByKey = useMemo(() => {
    const result = new Map<string, DraftValidationError[]>()
    for (const error of plan.errors) {
      const list = result.get(error.key) ?? []
      list.push(error)
      result.set(error.key, list)
    }
    return result
  }, [plan.errors])
  const groups = useMemo(() => providerGroups(snapshot?.models ?? []), [snapshot?.models])
  const hasChanges = plan.pluginOps.length > 0 || plan.agentDefaultOps.length > 0

  const updateDraft = (
    key: string,
    update: (draft: ReasoningModelDraft) => ReasoningModelDraft,
    model: ReasoningSettingsModel,
    fields: 'capability' | 'default' | 'both',
  ): void => {
    setDrafts(previous => ({
      ...previous,
      [key]: update(previous[key] ?? initialDraft(model)),
    }))
    setDirty(previous => ({
      capabilities: fields === 'default'
        ? previous.capabilities
        : new Set([...previous.capabilities, key]),
      defaults: fields === 'capability'
        ? previous.defaults
        : new Set([...previous.defaults, key]),
    }))
    setSaved(false)
  }

  const reset = (): void => {
    if (snapshot === null) return
    setDrafts(draftsOf(snapshot.models))
    setDirty({ capabilities: new Set(), defaults: new Set() })
    setSaved(false)
  }

  const save = (): void => {
    if (!hasChanges || plan.errors.length > 0) return
    void controller.save(drafts, dirty).then((accepted) => {
      if (!accepted) return
      setDirty({ capabilities: new Set(), defaults: new Set() })
      setSaved(true)
    })
  }

  if (state.status === 'idle' || (state.status === 'loading' && snapshot === null)) {
    return <p className="dpr-empty">{t('loading')}</p>
  }
  if (state.status === 'error' && snapshot === null) {
    return (
      <div className="dpr-section">
        <p className="dpr-error" role="alert">{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <div><Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button></div>
      </div>
    )
  }
  if (snapshot === null) return null
  const controlsDisabled = !snapshot.writable || state.saving

  return (
    <div className="dpr-section">
      <h2 className="dpr-title">{t('title')}</h2>
      {!snapshot.writable ? <p className="dpr-notice">{t('readOnly')}</p> : null}
      {state.error !== null ? <p className="dpr-error" role="alert">{state.error}</p> : null}
      {saved ? <p className="dpr-status" role="status" aria-live="polite">{t('saved')}</p> : null}
      {groups.length === 0 ? <p className="dpr-empty">{t('empty')}</p> : null}

      {groups.map(group => (
        <section className="dpr-provider" key={group.provider}>
          <div className="dpr-provider-head">
            <h3 className="dpr-provider-name">{group.name}</h3>
            {group.name === group.provider ? null : <span className="dpr-provider-id">{group.provider}</span>}
          </div>
          <ul className="dpr-model-list">
            {group.models.map((model) => {
              const draft = drafts[model.key] ?? initialDraft(model)
              const rowErrors = errorsByKey.get(model.key) ?? []
              const selectedEfforts = REASONING_LEVELS.filter(level =>
                Object.prototype.hasOwnProperty.call(draft.efforts, level))
              const staleDefault = draft.defaultEffort !== undefined
                && !selectedEfforts.includes(draft.defaultEffort as typeof REASONING_LEVELS[number])
              const defaultSelectId = `dpr-default-${encodeURIComponent(model.key)}`
              const detailsId = `dpr-details-${encodeURIComponent(model.key)}`
              const expanded = expandedModels.has(model.key)
              return (
                <li key={model.key}>
                  <fieldset className="dpr-model">
                    <legend className="dpr-sr-only">{model.modelName}</legend>
                    <div className="dpr-model-head">
                      <button
                        className="dpr-model-toggle"
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => setExpandedModels((previous) => {
                          const next = new Set(previous)
                          if (!next.delete(model.key)) next.add(model.key)
                          return next
                        })}
                      >
                        <span className="dpr-model-identity">
                          <span className="dpr-model-name">{model.modelName}</span>
                          {model.modelName === model.model ? null : <span className="dpr-model-id">{model.model}</span>}
                        </span>
                        <span className="dpr-model-chevron" aria-hidden="true">
                          <IconChevronDownOutline14 size={14} />
                        </span>
                      </button>
                      <label className="dpr-switch-label">
                        <input
                          className="dpr-switch"
                          type="checkbox"
                          role="switch"
                          disabled={controlsDisabled}
                          checked={draft.enabled}
                          onChange={event => updateDraft(model.key, current => ({
                            ...current,
                            enabled: event.target.checked,
                            defaultEffort: event.target.checked ? current.defaultEffort : undefined,
                          }), model, !event.target.checked && draft.defaultEffort !== undefined
                            ? 'both'
                            : 'capability')}
                        />
                        <span>{t('supportsReasoning')}</span>
                      </label>
                    </div>

                    <div id={detailsId} hidden={!expanded}>
                      {draft.enabled ? (
                        <div className="dpr-efforts">
                          <div className="dpr-effort-header" aria-hidden="true">
                            <span>{t('availableEfforts')}</span>
                            <span>{t('wireValue')}</span>
                          </div>
                          {REASONING_LEVELS.map((level) => {
                            const enabled = Object.prototype.hasOwnProperty.call(draft.efforts, level)
                            const wire = draft.efforts[level]
                            return (
                              <div className="dpr-effort-row" key={level}>
                                <label className="dpr-level-check">
                                  <input
                                    className="dpr-checkbox"
                                    type="checkbox"
                                    disabled={controlsDisabled}
                                    checked={enabled}
                                    onChange={event => updateDraft(model.key, (current) => {
                                      const efforts = { ...current.efforts }
                                      if (event.target.checked) efforts[level] = level === 'off' ? null : level
                                      else delete efforts[level]
                                      return {
                                        ...current,
                                        efforts,
                                        defaultEffort: !event.target.checked && current.defaultEffort === level
                                          ? undefined
                                          : current.defaultEffort,
                                      }
                                    }, model, !event.target.checked && draft.defaultEffort === level
                                      ? 'both'
                                      : 'capability')}
                                  />
                                  <span>{level}</span>
                                </label>
                                {level === 'off'
                                  ? <span className="dpr-off-wire">{t('notSent')}</span>
                                  : (
                                    <input
                                      className="dpr-wire"
                                      type="text"
                                      aria-label={`${level} ${t('wireValue')}`}
                                      disabled={controlsDisabled || !enabled}
                                      value={typeof wire === 'string' ? wire : ''}
                                      onChange={event => updateDraft(model.key, current => ({
                                        ...current,
                                        efforts: { ...current.efforts, [level]: event.target.value },
                                      }), model, 'capability')}
                                    />
                                  )}
                              </div>
                            )
                          })}
                        </div>
                      ) : null}

                      <div className="dpr-default-row">
                        <label className="dpr-default-label" htmlFor={defaultSelectId}>{t('defaultEffort')}</label>
                        <select
                          id={defaultSelectId}
                          className="dpr-default-select"
                          disabled={controlsDisabled || !draft.enabled}
                          value={draft.defaultEffort ?? ''}
                          onChange={event => updateDraft(model.key, current => ({
                            ...current,
                            defaultEffort: event.target.value === '' ? undefined : event.target.value,
                          }), model, 'default')}
                        >
                          <option value="">{t('providerDefault')}</option>
                          {staleDefault ? <option value={draft.defaultEffort}>{draft.defaultEffort}</option> : null}
                          {selectedEfforts.map(level => <option value={level} key={level}>{level}</option>)}
                        </select>
                      </div>
                      {rowErrors.length > 0 ? (
                        <div className="dpr-row-errors" role="alert">
                          {rowErrors.map(error => (
                            <p className="dpr-error" key={error.code}>{validationText(error, t)}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </fieldset>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {groups.length > 0 ? (
        <div className="dpr-actions">
          <Button variant="outline" disabled={!editing || state.saving} onClick={reset}>{t('reset')}</Button>
          <Button
            variant="primary"
            icon={<IconCheckOutline16 size={14} />}
            disabled={!snapshot.writable || state.saving || !hasChanges || plan.errors.length > 0}
            onClick={save}
          >
            {t('save')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Register the private Remote and settings page. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const remote = ctx.remote as ReasoningClientRemote
  const disposeRemote = await remote.$mount(TYPERT_REMOTE)
  try {
    await ctx.plugin({
      name: 'dsh-reasoning-effort:client',
      inject: ['remote.providersReasoning'],
      apply: (scope: ClientContext) => {
        installClient(scope, (scope.remote as ReasoningClientRemote).providersReasoning)
      },
    })
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => { await disposeRemote() }
}

function installClient(ctx: ClientContext, remoteNamespace: ReasoningClientRemote['providersReasoning']): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'providers-reasoning: dictionaries')
  const controller = new ReasoningSettingsController(remoteNamespace)
  const t = ctx.locale.bind(LOCALE_NAMESPACE) as ReasoningSettingsInjected['t']

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-reasoning-effort'
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'providers-reasoning: styles')

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.loaded()) void controller.load()
    }
    const settings = new Set([
      PI_AI_SETTINGS_NAMESPACE_ID,
      PLUGIN_SETTINGS_NAMESPACE_ID,
      AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID,
    ])
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (settings.has(namespace)) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'providers-reasoning: invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'providers-reasoning',
    order: 15,
    label: () => t('nav'),
    inject: (): ReasoningSettingsInjected => ({ controller, t }),
  }, ReasoningSettingsSection))
}
