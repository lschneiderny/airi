import type { BrowserWindow, Rectangle } from 'electron'

import { centerWindowOnDisplay } from '../shared/display'
import { toggleWindowShow } from '../shared/window'

const stageWindows = new WeakSet<object>()

/**
 * Records that `window` is the desktop stage, so `userFacingMainWindow` consumers can tell it from the classic window.
 *
 * Use when:
 * - `setupStageWindow` has just created the stage BrowserWindow
 */
export function markStageWindow(window: object): void {
  stageWindows.add(window)
}

/**
 * Whether `window` is the full-screen desktop stage rather than the classic main window.
 *
 * Use when:
 * - A `userFacingMainWindow` consumer must not move, resize or focus the stage
 */
export function isStageWindow(window: object | null | undefined): boolean {
  return window != null && stageWindows.has(window)
}

/**
 * Shows the user-facing window for the tray and the single-instance guard.
 *
 * The desktop stage covers the whole work area and is click-through, so it is shown with `showInactive()` and never
 * focused; focusing it would take keyboard focus from the app the user is working in. The classic window keeps
 * `toggleWindowShow` (restore, show, focus).
 */
export function showUserFacingWindow(window: BrowserWindow | null | undefined): void {
  if (!window)
    return

  if (isStageWindow(window)) {
    if (!window.isDestroyed())
      window.showInactive()
    return
  }

  toggleWindowShow(window)
}

/**
 * Runs `electronCenterMainWindow` for the user-facing window.
 *
 * The desktop stage already covers its display's work area, so it is not moved, and its current bounds are returned.
 */
export function centerUserFacingWindow(window: BrowserWindow | undefined): Rectangle {
  if (window && !window.isDestroyed() && isStageWindow(window))
    return window.getBounds()

  return centerWindowOnDisplay(window)
}
