import type { Display, Rectangle } from 'electron'

import type { StageDisplayInfo } from '../../../shared/eventa'
import type { StageConfig } from './config'

import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { resolveHomeDisplay } from './config'

/** How long a move to another display waits for the window's rectangle to arrive there before it is undone. */
export const stageMoveTimeoutMs = 1500

export function toStageDisplayInfos(displays: readonly Display[], primaryId: number): StageDisplayInfo[] {
  return displays.map(display => ({
    id: String(display.id),
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId,
  }))
}

export interface StageScreen {
  getAllDisplays: () => Display[]
  getPrimaryDisplay: () => Display
  on: ((event: 'display-added', listener: () => void) => unknown)
    & ((event: 'display-removed', listener: () => void) => unknown)
    & ((event: 'display-metrics-changed', listener: () => void) => unknown)
  off: ((event: 'display-added', listener: () => void) => unknown)
    & ((event: 'display-removed', listener: () => void) => unknown)
    & ((event: 'display-metrics-changed', listener: () => void) => unknown)
}

export interface StageBoundWindow {
  isDestroyed: () => boolean
  once: (event: 'closed', listener: () => void) => unknown
}

export function readStageDisplays(screen: Pick<StageScreen, 'getAllDisplays' | 'getPrimaryDisplay'>): StageDisplayInfo[] {
  return toStageDisplayInfos(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
}

export interface StageDisplayBinding {
  /**
   * The display the window is confirmed to cover. It is the home display at launch and after every display change, and
   * another display after a confirmed {@link StageDisplayBinding.moveToDisplay}. Runtime state, never persisted.
   */
  stageDisplayId: () => string
  /** Moves the window to the home display's work area now, for a config change such as a new home display. */
  applyHomeBounds: () => void
  /**
   * Moves the window to the work area of `displayId`, for the character walking there.
   *
   * Resolves `true` once the window's rectangle is read back on that work area, and that display is then the stage
   * display. Resolves `false` when the rectangle did not arrive within {@link stageMoveTimeoutMs} (the window is then
   * placed on the display it came from), when a display change or a newer request ended the move, or when the window
   * is destroyed. Rejects for a display that is not connected.
   */
  moveToDisplay: (displayId: string) => Promise<boolean>
  /** Places the window on the stage display's work area again when its rectangle differs, as after a resume. */
  recheck: () => void
  /** Removes the listeners. They are also removed when the window closes. */
  dispose: () => void
}

function sameRect(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** A placed window can be off by a pixel after rounding to another display's scale. */
function nearRect(a: Rectangle, b: Rectangle): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1
}

/**
 * Keeps the stage window on the work area of the stage display: the home display, or the display the character walked
 * to.
 *
 * Use when:
 * - The stage window exists, created on the home display's work area; call once per window
 *
 * Expects:
 * - `getConfig` returns the current stage config
 * - `readRect` and `displays` report the same coordinate space
 *
 * Returns:
 * - The binding. See {@link StageDisplayBinding}.
 *
 * On `display-added`, `display-removed` and `display-metrics-changed` the home display is resolved again (falling back
 * to the primary display when the saved one is gone) and becomes the stage display, the window takes that display's
 * work area when it differs, and `onDisplaysChanged` runs so the renderer receives the new state. A display change
 * therefore always brings the window home, whichever display the character had walked to; the renderer teleports her
 * home on the same change.
 */
export function bindStageWindowToDisplay(params: {
  /** Display change events. */
  screen: Pick<StageScreen, 'on' | 'off'>
  /** Display geometry in the same space as `readRect`. */
  displays: Pick<StageScreen, 'getAllDisplays' | 'getPrimaryDisplay'>
  window: StageBoundWindow
  /** The window's trusted rectangle, or `null` while its origin cannot be read. */
  readRect: () => Rectangle | null
  /** Places the window, through the compositor where Electron cannot. */
  place: (bounds: Rectangle) => void
  /** Calls `listener` whenever the window's trusted rectangle may have changed. Returns the function that stops it. */
  onRectChange: (listener: () => void) => () => void
  getConfig: () => StageConfig
  onDisplaysChanged: () => void
  /** Runs after each confirmed move to another display, before the move resolves. */
  onMoved?: () => void
}): StageDisplayBinding {
  const homeDisplay = () => resolveHomeDisplay(readStageDisplays(params.displays), params.getConfig())
  let stageDisplayId = homeDisplay().id
  /** Ends the move in flight as unconfirmed. */
  let abortMove: (() => void) | null = null

  function bindTo(display: StageDisplayInfo) {
    abortMove?.()
    stageDisplayId = display.id
    const current = params.readRect()
    if (!current || !sameRect(current, display.workArea))
      params.place({ ...display.workArea })

    params.onDisplaysChanged()
  }

  function applyHomeBounds() {
    if (!params.window.isDestroyed())
      bindTo(homeDisplay())
  }

  function recheck() {
    if (params.window.isDestroyed())
      return
    bindTo(readStageDisplays(params.displays).find(display => display.id === stageDisplayId) ?? homeDisplay())
  }

  function moveToDisplay(displayId: string): Promise<boolean> {
    const target = readStageDisplays(params.displays).find(display => display.id === displayId)
    if (!target)
      return Promise.reject(new Error(`electronStageMoveToDisplay: display ${JSON.stringify(displayId)} is not connected`))
    if (params.window.isDestroyed())
      return Promise.resolve(false)

    // A newer request replaces the move in flight.
    abortMove?.()
    const fromId = stageDisplayId
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let stopWatching = () => {}
      const arrived = () => {
        const rect = params.readRect()
        return rect !== null && nearRect(rect, target.workArea)
      }
      let settled = false
      const settle = (confirmed: boolean) => {
        if (settled)
          return
        settled = true
        abortMove = null
        clearTimeout(timer)
        stopWatching()
        if (confirmed) {
          stageDisplayId = target.id
          params.onMoved?.()
        }
        resolve(confirmed)
      }
      abortMove = () => settle(false)

      stopWatching = params.onRectChange(() => {
        if (arrived())
          settle(true)
      })
      timer = setTimeout(() => {
        settle(false)
        // The window may be anywhere between the two displays; the display it came from is still the stage display.
        const from = readStageDisplays(params.displays).find(display => display.id === fromId)
        if (from && !params.window.isDestroyed())
          params.place({ ...from.workArea })
      }, stageMoveTimeoutMs)

      if (!arrived())
        params.place({ ...target.workArea })
      if (arrived())
        settle(true)
    })
  }

  params.screen.on('display-added', applyHomeBounds)
  params.screen.on('display-removed', applyHomeBounds)
  params.screen.on('display-metrics-changed', applyHomeBounds)

  function dispose() {
    abortMove?.()
    params.screen.off('display-added', applyHomeBounds)
    params.screen.off('display-removed', applyHomeBounds)
    params.screen.off('display-metrics-changed', applyHomeBounds)
  }

  onWindowClosed(params.window, dispose)
  return { stageDisplayId: () => stageDisplayId, applyHomeBounds, moveToDisplay, recheck, dispose }
}
