/** Session-scoped Composer model selector with a continuous reasoning-effort slider. */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type {
  ModelProviderGroup,
  ModelReasoningEffort,
  ModelSelection,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelDirectory,
  ModelDirectoryState,
} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ReasoningSettingsController, ReasoningSettingsState } from './controller.js'
import type { ReasoningSettingsLocaleKey } from './locales.js'
import { modelRouteKey } from './model-settings.js'

type Translate = (
  key: ReasoningSettingsLocaleKey,
  params?: Record<string, unknown>,
) => string

export interface ComposerModelSelectInjected {
  available: boolean
  directory: ModelDirectory
  settings: ReasoningSettingsController
  t: Translate
}

export type ComposerModelSelectProps = ComposerModelSelectInjected & { locked: boolean }

type DirectoryModel = ModelProviderGroup['models'][number]

export function currentModel(state: ModelDirectoryState): DirectoryModel | undefined {
  if (state.current === null) return undefined
  const group = state.groups.find(candidate => candidate.id === state.current?.provider)
  return group?.models.find(candidate => candidate.id === state.current?.model)
}

export function sliderLevels(state: ModelDirectoryState): readonly ModelReasoningEffort[] {
  const efforts = currentModel(state)?.reasoning?.efforts
  return efforts !== undefined && efforts.length >= 2 ? efforts : []
}

export function effortIndex(levels: readonly ModelReasoningEffort[], id: string | undefined): number {
  return levels.findIndex(level => level.id === id)
}

function exactRouteDefault(
  settings: ReasoningSettingsState,
  selection: ModelSelection | null,
): string | undefined {
  if (settings.status !== 'ready' || settings.snapshot === null || selection === null) return undefined
  const key = modelRouteKey(selection.provider, selection.model)
  return settings.snapshot.models.find(model => model.key === key)?.defaultEffort
}

/** Index displayed by Composer, matching the request-time precedence. */
export function effectiveEffortIndex(
  levels: readonly ModelReasoningEffort[],
  directory: ModelDirectoryState,
  settings: ReasoningSettingsState,
): number {
  if (levels.length === 0) return -1
  const explicit = effortIndex(levels, directory.current?.reasoningEffort)
  if (explicit >= 0) return explicit
  const persisted = effortIndex(levels, exactRouteDefault(settings, directory.current))
  if (persisted >= 0) return persisted
  const adapter = effortIndex(levels, currentModel(directory)?.reasoning?.defaultEffort)
  if (adapter >= 0) return adapter
  return Math.floor((levels.length - 1) / 2)
}

function clampPosition(value: number, count: number): number {
  if (count <= 0 || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(count, value))
}

export function effortIntervalIndex(position: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(count - 1, Math.floor(clampPosition(position, count)))
}

function positionForEffortIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count, Math.max(0, index + 0.5))
}

export interface CommittedEffort {
  index: number
  id: string
}

/** Revalidate against the fresh directory, then write only the session selection. */
export async function commitDirectoryEffort(
  directory: ModelDirectory,
  raw: number,
  noEffortsMessage: string,
): Promise<CommittedEffort> {
  await directory.load()
  const fresh = directory.store.getSnapshot()
  const levels = sliderLevels(fresh)
  const index = effortIntervalIndex(raw, levels.length)
  const next = levels[index]?.id
  if (fresh.current === null || next === undefined) throw new Error(noEffortsMessage)

  await directory.select({
    provider: fresh.current.provider,
    model: fresh.current.model,
    reasoningEffort: next,
  })

  const accepted = effortIndex(levels, directory.store.getSnapshot().current?.reasoningEffort)
  const settled = accepted >= 0 ? accepted : index
  return { index: settled, id: levels[settled]?.id ?? next }
}

interface RadiationState {
  progress: number
  dragging: boolean
}

function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const isDark = document.body.hasAttribute('data-ds-dark-theme')
  const cell = 4
  const speed = state.dragging ? 2.8 : 1

  context.clearRect(0, 0, width, height)
  if (origin <= 0) return

  context.save()
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))
    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32)
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const red = isDark
        ? Math.round(42 + 124 * nearness + 75 * wave)
        : Math.round(28 + 58 * nearness + 15 * wave)
      const green = isDark
        ? Math.round(56 + 58 * nearness + 44 * crest)
        : Math.round(88 + 72 * nearness + 30 * crest)
      const blue = isDark
        ? Math.round(175 + 72 * nearness + 8 * wave)
        : Math.round(182 + 62 * nearness)
      const alpha = isDark
        ? Math.min(0.88, columnEnergy * 0.72)
        : Math.min(0.62, columnEnergy * 0.54)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
      context.fillRect(x, 0, cell - 1, height)
    }

    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const grain = 0.72 + 0.28 * Math.sin(x * 0.73 + y * 1.31 + time * 0.006)
      const alpha = Math.min(0.96, (columnEnergy * 0.88 + halo + crest * 0.19) * verticalShape * grain)
      if (alpha < 0.035) continue

      const hot = Math.max(0, 1 - radial / 2.4)
      const red = isDark
        ? Math.round(54 + 148 * hot + 42 * wave + 35 * crest)
        : Math.round(25 + 72 * hot + 12 * wave)
      const green = isDark
        ? Math.round(68 + 78 * hot + 46 * crest)
        : Math.round(98 + 72 * hot + 24 * crest)
      const blue = isDark
        ? Math.round(186 + 64 * hot)
        : Math.round(194 + 56 * hot)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${isDark ? alpha : alpha * 0.72})`
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const travel = (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23)
      % Math.max(30, origin + 64)
    const particleX = origin - travel
    if (particleX < -24 || particleX > width + 16) continue
    const particleY = 3 + ((i * 13 + Math.sin(time * 0.003 + i) * 5) % Math.max(7, height - 6))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0)
    const alpha = 0.28 + (i % 5) * 0.1
    const streak = context.createLinearGradient(particleX, 0, particleX + length, 0)
    streak.addColorStop(0, isDark ? 'rgba(72,118,255,0)' : 'rgba(24,94,184,0)')
    streak.addColorStop(0.68, isDark
      ? `rgba(112,135,255,${alpha})`
      : `rgba(36,108,202,${alpha * 0.72})`)
    streak.addColorStop(1, isDark
      ? `rgba(236,222,255,${Math.min(1, alpha + 0.26)})`
      : `rgba(103,175,248,${Math.min(0.82, alpha + 0.18)})`)
    context.fillStyle = streak
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.86)')
  glow.addColorStop(0.14, isDark ? 'rgba(183,190,255,.54)' : 'rgba(162,210,255,.48)')
  glow.addColorStop(0.44, isDark ? 'rgba(103,74,255,.28)' : 'rgba(37,112,207,.22)')
  glow.addColorStop(1, isDark ? 'rgba(86,31,210,0)' : 'rgba(25,91,181,0)')
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)
  context.restore()
}

interface EffortSliderProps {
  directory: ModelDirectory
  directoryState: ModelDirectoryState
  levels: readonly ModelReasoningEffort[]
  settledIndex: number
  locked: boolean
  t: Translate
}

function EffortSlider({
  directory,
  directoryState,
  levels,
  settledIndex,
  locked,
  t,
}: EffortSliderProps) {
  const initialIndex = Math.max(0, Math.min(levels.length - 1, settledIndex))
  const initialPosition = positionForEffortIndex(initialIndex, levels.length)
  const [preview, setPreview] = useState(initialPosition)
  const [committing, setCommitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(levels[initialIndex]?.id ?? '')
  const committedPositionRef = useRef(initialPosition)
  const pendingPositionRef = useRef<{ id: string; position: number } | null>(null)
  const committingRef = useRef(false)
  const previewRef = useRef(initialPosition)
  const draggingRef = useRef(false)
  const pointerActiveRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const globalPointerMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerEndRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerCancelRef = useRef<((event: PointerEvent) => void) | null>(null)
  const radiationRef = useRef<RadiationState>({
    progress: initialPosition / Math.max(1, levels.length),
    dragging: false,
  })
  const redrawRef = useRef<(() => void) | null>(null)
  const busy = committing || directoryState.status === 'selecting'
  const error = localError

  useEffect(() => {
    if (committingRef.current || draggingRef.current) return
    const index = Math.max(0, Math.min(levels.length - 1, settledIndex))
    const currentId = levels[index]?.id
    const pending = pendingPositionRef.current
    if (pending !== null) {
      if (effortIndex(levels, pending.id) >= 0) {
        if (pending.id === currentId) {
          pendingPositionRef.current = null
          committedRef.current = pending.id
          committedPositionRef.current = pending.position
          setLocalError(null)
        }
        return
      }
      pendingPositionRef.current = null
    }
    const position = positionForEffortIndex(index, levels.length)
    committedRef.current = currentId ?? ''
    committedPositionRef.current = position
    previewRef.current = position
    setPreview(position)
    setLocalError(null)
  }, [levels, settledIndex])

  useEffect(() => {
    previewRef.current = preview
    radiationRef.current.progress = clampPosition(preview, levels.length) / Math.max(1, levels.length)
    redrawRef.current?.()
  }, [preview, levels.length])

  useEffect(() => {
    draggingRef.current = dragging
    radiationRef.current.dragging = dragging
    redrawRef.current?.()
  }, [dragging])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 1
    let height = 1
    let frame = 0

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const draw = (time = performance.now()): void => {
      drawRadiation(context, width, height, time, radiationRef.current)
    }
    const loop = (time: number): void => {
      draw(time)
      frame = window.requestAnimationFrame(loop)
    }
    const stopAnimation = (): void => {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    const syncMotion = (): void => {
      stopAnimation()
      if (reducedMotion.matches) draw()
      else frame = window.requestAnimationFrame(loop)
    }
    const redraw = (): void => {
      if (reducedMotion.matches) draw()
    }
    const resizeObserver = new ResizeObserver(() => {
      resize()
      draw()
    })
    const themeObserver = new MutationObserver(() => { draw() })

    resizeObserver.observe(canvas)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    reducedMotion.addEventListener('change', syncMotion)
    redrawRef.current = redraw
    resize()
    draw()
    syncMotion()

    return () => {
      stopAnimation()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      reducedMotion.removeEventListener('change', syncMotion)
      redrawRef.current = null
    }
  }, [])

  const restore = useCallback((): void => {
    const previous = committedRef.current
    const position = clampPosition(committedPositionRef.current, levels.length)
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    previewRef.current = position
    setPreview(position)
    setDragging(false)
  }, [levels])

  const commit = useCallback(async (raw: number): Promise<void> => {
    if (committingRef.current || locked) return
    committingRef.current = true
    const previous = committedRef.current
    const previousPosition = committedPositionRef.current
    setDragging(false)
    setCommitting(true)
    setLocalError(null)

    const position = clampPosition(raw, levels.length)
    const targetIndex = effortIntervalIndex(position, levels.length)
    const targetId = levels[targetIndex]?.id
    pendingPositionRef.current = targetId === undefined ? null : { id: targetId, position }
    previewRef.current = position
    setPreview(position)

    try {
      const settled = await commitDirectoryEffort(directory, raw, t('composerNoEfforts'))
      pendingPositionRef.current = { id: settled.id, position }
      committedRef.current = settled.id
      committedPositionRef.current = position
      previewRef.current = position
      setPreview(position)
    } catch (cause) {
      pendingPositionRef.current = null
      const position = clampPosition(previousPosition, levels.length)
      committedRef.current = previous
      previewRef.current = position
      setPreview(position)
      const message = cause instanceof Error ? cause.message : String(cause)
      setLocalError(t('composerSelectionFailed', { message }))
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
  }, [directory, levels, locked, t])

  const rawFromPointer = (input: HTMLInputElement, clientX: number): number => {
    const bounds = input.getBoundingClientRect()
    if (bounds.width <= 0) return previewRef.current
    return Math.max(0, Math.min(
      levels.length,
      (clientX - bounds.left) / bounds.width * levels.length,
    ))
  }

  const showPreview = (raw: number): void => {
    previewRef.current = raw
    setPreview(raw)
  }

  const beginDragging = (input: HTMLInputElement, pointerId: number, clientX: number): void => {
    if (busy || locked) return
    pointerActiveRef.current = true
    activePointerIdRef.current = pointerId
    draggingRef.current = true
    setDragging(true)
    showPreview(rawFromPointer(input, clientX))
    try {
      if (!input.hasPointerCapture(pointerId)) input.setPointerCapture(pointerId)
    } catch {
      // Window listeners below remain the pointer-capture fallback.
    }
  }

  const moveDragging = (input: HTMLInputElement, pointerId: number, clientX: number): void => {
    if (!pointerActiveRef.current || activePointerIdRef.current !== pointerId) return
    showPreview(rawFromPointer(input, clientX))
  }

  const stopDragging = (input: HTMLInputElement, pointerId?: number, clientX?: number): void => {
    if (!pointerActiveRef.current) return
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return
    const raw = clientX === undefined ? previewRef.current : rawFromPointer(input, clientX)
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    if (pointerId !== undefined && input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId)
    showPreview(raw)
    void commit(raw)
  }

  globalPointerMoveRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) moveDragging(input, event.pointerId, event.clientX)
  }
  globalPointerEndRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) stopDragging(input, event.pointerId, event.clientX)
  }
  globalPointerCancelRef.current = (event) => {
    if (activePointerIdRef.current === event.pointerId) restore()
  }

  useEffect(() => {
    const move = (event: PointerEvent): void => { globalPointerMoveRef.current?.(event) }
    const end = (event: PointerEvent): void => { globalPointerEndRef.current?.(event) }
    const cancel = (event: PointerEvent): void => { globalPointerCancelRef.current?.(event) }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const current = clampPosition(Number(event.currentTarget.value), levels.length)
    let target: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      target = Math.max(0, current - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      target = Math.min(levels.length, current + 1)
    } else if (event.key === 'Home') {
      target = 0
    } else if (event.key === 'End') {
      target = levels.length
    }
    if (target === undefined) return
    event.preventDefault()
    void commit(target)
  }

  const count = levels.length
  const previewIndex = effortIntervalIndex(preview, count)
  const effortName = levels[previewIndex]?.name ?? levels[previewIndex]?.id ?? ''
  const isTop = previewIndex === count - 1
  const progress = clampPosition(preview, count) / Math.max(1, count) * 100
  const style = { '--dpr-composer-progress': `${progress}%` } as CSSProperties

  return (
    <div className={`dpr-composer-effort${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}${error === null ? '' : ' is-error'}`}>
      <div className="dpr-composer-slider" data-top={isTop ? 'true' : undefined} style={style}>
        <div className="dpr-composer-track" aria-hidden="true" />
        <div className="dpr-composer-fx" aria-hidden="true">
          <canvas ref={canvasRef} className="dpr-composer-canvas" />
          <span className="dpr-composer-flare" />
        </div>
        <input
          ref={inputRef}
          className="dpr-composer-range"
          type="range"
          min="0"
          max={count}
          step="0.01"
          value={preview}
          disabled={locked || busy}
          aria-label={t('composerEffort')}
          aria-valuetext={effortName}
          onChange={event => { showPreview(Number(event.currentTarget.value)) }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.focus()
            beginDragging(event.currentTarget, event.pointerId, event.clientX)
          }}
          onPointerMove={event => { moveDragging(event.currentTarget, event.pointerId, event.clientX) }}
          onPointerUp={event => { stopDragging(event.currentTarget, event.pointerId, event.clientX) }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            restore()
          }}
          onBlur={event => { stopDragging(event.currentTarget) }}
          onKeyDown={onKeyDown}
        />
        <span className="dpr-composer-whale" aria-hidden="true" />
      </div>
      {error === null ? null : (
        <span className="dpr-composer-sr" role="status" aria-live="polite">{error}</span>
      )}
    </div>
  )
}

export function ComposerModelSelect(props: ComposerModelSelectProps) {
  if (!props.available) return null
  return <AvailableComposerModelSelect {...props} />
}

function AvailableComposerModelSelect({
  locked,
  directory,
  settings,
  t,
}: ComposerModelSelectProps) {
  const subscribeDirectory = useCallback(
    (notify: () => void) => directory.store.subscribe(notify),
    [directory],
  )
  const getDirectorySnapshot = useCallback(() => directory.store.getSnapshot(), [directory])
  const directoryState = useSyncExternalStore(
    subscribeDirectory,
    getDirectorySnapshot,
    getDirectorySnapshot,
  )
  const settingsState = useSyncExternalStore(
    settings.subscribe,
    settings.getSnapshot,
    settings.getSnapshot,
  )
  const [open, setOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    setModelsOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }, [])

  const loadDirectory = useCallback((): void => {
    void directory.load().catch(() => { /* surfaced by the directory store */ })
  }, [directory])

  useEffect(() => {
    loadDirectory()
    const status = settings.getSnapshot().status
    if (status === 'idle' || status === 'error') void settings.load()
  }, [loadDirectory, settings])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setModelsOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (modelsOpen) setModelsOpen(false)
      else close(true)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [close, modelsOpen, open])

  useEffect(() => {
    if (locked) {
      setOpen(false)
      setModelsOpen(false)
    }
  }, [locked])

  const onBlur = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const choice = currentModel(directoryState)
  const levels = sliderLevels(directoryState)
  const settledIndex = effectiveEffortIndex(levels, directoryState, settingsState)
  const effortName = settledIndex >= 0 ? levels[settledIndex]?.name ?? levels[settledIndex]?.id : undefined
  const modelLabel = choice?.name ?? directoryState.current?.model ?? t('composerSelectModel')
  const triggerLabel = effortName === undefined
    ? modelLabel
    : t('composerTrigger', { model: modelLabel, effort: effortName })
  const busy = directoryState.status === 'loading' || directoryState.status === 'selecting'

  const chooseModel = async (provider: string, model: string): Promise<void> => {
    if (directoryState.current?.provider === provider && directoryState.current.model === model) {
      setModelsOpen(false)
      return
    }
    try {
      await directory.select({ provider, model })
      setModelsOpen(false)
    } catch {
      // The shared directory store exposes the error and retains the previous selection.
    }
  }

  return (
    <div ref={rootRef} className="dpr-composer-root" onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="dpr-composer-trigger"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else {
            setOpen(true)
            setModelsOpen(false)
            loadDirectory()
          }
        }}
      >
        <span className="dpr-composer-trigger-model">{modelLabel}</span>
        {effortName === undefined ? null : (
          <span className="dpr-composer-trigger-effort">{effortName}</span>
        )}
        <IconChevronDownOutline14
          size={14}
          className={`dpr-composer-trigger-chevron${open ? ' is-open' : ''}`}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          className="dpr-composer-menu"
          role="dialog"
          aria-label={t('composerMenu')}
          aria-busy={busy}
        >
          {modelsOpen ? (
            <div className="dpr-composer-model-pane">
              <button
                type="button"
                className="dpr-composer-back"
                onClick={() => { setModelsOpen(false) }}
              >
                <IconChevronLeftOutline14 size={14} />
                <span>{t('composerBack')}</span>
              </button>
              {directoryState.status === 'loading' && directoryState.groups.length === 0 ? (
                <div className="dpr-composer-status">{t('composerLoadingModels')}</div>
              ) : null}
              <div className="dpr-composer-model-scroll">
                {directoryState.groups.map(group => (
                  <section className="dpr-composer-model-group" key={group.id}>
                    <div className="dpr-composer-model-group-title">{group.name}</div>
                    {group.models.map(model => {
                      const selected = directoryState.current?.provider === group.id
                        && directoryState.current.model === model.id
                      return (
                        <button
                          type="button"
                          aria-pressed={selected}
                          className="dpr-composer-model-option"
                          disabled={busy}
                          key={model.id}
                          onClick={() => { void chooseModel(group.id, model.id) }}
                        >
                          <span className="dpr-composer-model-copy">
                            <span className="dpr-composer-model-name">{model.name}</span>
                            {model.description === undefined ? null : (
                              <span className="dpr-composer-model-description">{model.description}</span>
                            )}
                          </span>
                          <span className="dpr-composer-model-check" aria-hidden="true">
                            {selected ? <IconCheckOutline16 size={16} /> : null}
                          </span>
                        </button>
                      )
                    })}
                  </section>
                ))}
              </div>
              {directoryState.status === 'ready'
                && directoryState.groups.every(group => group.models.length === 0) ? (
                  <div className="dpr-composer-status">{t('composerNoModels')}</div>
                ) : null}
            </div>
          ) : (
            <>
              <div className="dpr-composer-effort-area">
                {levels.length >= 2 ? (
                  <EffortSlider
                    directory={directory}
                    directoryState={directoryState}
                    levels={levels}
                    settledIndex={settledIndex}
                    locked={locked}
                    t={t}
                  />
                ) : (
                  <div className="dpr-composer-status">{t('composerNoEfforts')}</div>
                )}
              </div>
              <div className="dpr-composer-separator" />
              <button
                type="button"
                className="dpr-composer-current-model"
                disabled={busy}
                onClick={() => { setModelsOpen(true) }}
              >
                <span className="dpr-composer-current-model-name">{modelLabel}</span>
                {effortName === undefined ? null : (
                  <span className="dpr-composer-current-effort">{effortName}</span>
                )}
                <IconChevronRightOutline14 size={14} aria-hidden="true" />
              </button>
            </>
          )}

          {directoryState.error === null ? null : (
            <div className="dpr-composer-error" role="alert">
              <span>{directoryState.error}</span>
              <button type="button" onClick={loadDirectory}>{t('composerRetry')}</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
