import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'

import { isMacOS } from 'std-env'

import { setWindowAlwaysOnTop } from '../shared/window'

/**
 * Builds BrowserWindow options for the full-screen desktop stage.
 *
 * Use when:
 * - Creating the stage window over the home display's work area
 * - Testing the stage window flags without starting Electron
 *
 * Expects:
 * - `workArea` is the home display's work area in Electron DIP screen coordinates
 * - `preloadPath` is an absolute path to the renderer preload script
 *
 * Returns:
 * - Options for a frameless, transparent, hidden window that stays out of the taskbar. Unlike the desktop overlay it
 *   is focusable (the Controls Island and touch need input) and has no content protection (screenshots and OBS must
 *   see the character).
 */
export function createStageWindowOptions(params: {
  workArea: Rectangle
  preloadPath: string
}): BrowserWindowConstructorOptions {
  return {
    title: 'AIRI',
    x: params.workArea.x,
    y: params.workArea.y,
    width: params.workArea.width,
    height: params.workArea.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    // A panel window can stay above full-screen apps on macOS, as the classic main window does.
    type: isMacOS ? 'panel' : undefined,
    webPreferences: {
      preload: params.preloadPath,
      sandbox: false,
      backgroundThrottling: false,
    },
  }
}

/**
 * Makes the stage window click-through and keeps it above other windows on every workspace.
 *
 * The renderer captures the mouse again only over the character's pixels.
 */
export function applyStageInputIsolation(
  window: Pick<BrowserWindow, 'setAlwaysOnTop' | 'setHiddenInMissionControl' | 'setIgnoreMouseEvents' | 'setVisibleOnAllWorkspaces' | 'setWindowButtonVisibility'>,
): void {
  window.setIgnoreMouseEvents(true, { forward: true })
  setWindowAlwaysOnTop(window, true)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
    window.setHiddenInMissionControl(true)
  }
}
