import type { Display, Rectangle } from 'electron'

import type { StageDisplayInfo } from '../../../shared/eventa'
import type { StageConfig } from './config'

import { resolveHomeDisplay } from './config'

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
  getBounds: () => Rectangle
  setBounds: (bounds: Rectangle) => void
  isDestroyed: () => boolean
  once: (event: 'closed', listener: () => void) => unknown
}

export function readStageDisplays(screen: Pick<StageScreen, 'getAllDisplays' | 'getPrimaryDisplay'>): StageDisplayInfo[] {
  return toStageDisplayInfos(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
}

/**
 * Keeps the stage window on its home display's work area.
 *
 * Use when:
 * - The stage window exists; call once per window
 *
 * Expects:
 * - `getConfig` returns the current stage config
 *
 * Returns:
 * - `applyHomeBounds`, which re-bounds the window now, for a config change such as a new home display
 * - `dispose`, which removes the listeners. They are also removed when the window closes.
 *
 * On `display-added`, `display-removed` and `display-metrics-changed` the home display is resolved again (falling back
 * to the primary display when the saved one is gone), the window takes that display's work area when it differs, and
 * `onDisplaysChanged` runs so the renderer receives the new state.
 */
export function bindStageWindowToHomeDisplay(params: {
  screen: StageScreen
  window: StageBoundWindow
  getConfig: () => StageConfig
  onDisplaysChanged: () => void
}): { applyHomeBounds: () => void, dispose: () => void } {
  function applyHomeBounds() {
    if (params.window.isDestroyed())
      return

    const { workArea } = resolveHomeDisplay(readStageDisplays(params.screen), params.getConfig())
    const current = params.window.getBounds()
    if (current.x !== workArea.x || current.y !== workArea.y || current.width !== workArea.width || current.height !== workArea.height)
      params.window.setBounds({ ...workArea })

    params.onDisplaysChanged()
  }

  params.screen.on('display-added', applyHomeBounds)
  params.screen.on('display-removed', applyHomeBounds)
  params.screen.on('display-metrics-changed', applyHomeBounds)

  function dispose() {
    params.screen.off('display-added', applyHomeBounds)
    params.screen.off('display-removed', applyHomeBounds)
    params.screen.off('display-metrics-changed', applyHomeBounds)
  }

  params.window.once('closed', dispose)
  return { applyHomeBounds, dispose }
}
