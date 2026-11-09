import type { BrowserWindow, Point, Rectangle } from 'electron'

import { placeOwnWindow } from '../../services/electron/coordinates'

type BoundsWindow = Pick<BrowserWindow, 'setBounds'>
type PositionWindow = Pick<BrowserWindow, 'setPosition' | 'getBounds'>

/**
 * Moves a window to `bounds`, or to `point` at its current size.
 *
 * On kwin in a native Wayland session with a live window origin, a KWin
 * actuator places the bound compositor window, because Electron cannot
 * position a native Wayland window. Everywhere else, and for a partial
 * rectangle, Electron places it exactly as `setBounds` or `setPosition` would.
 */
export function placeWindow(window: BoundsWindow, bounds: Partial<Rectangle>): void
export function placeWindow(window: PositionWindow, point: Point): void
export function placeWindow(window: BoundsWindow | PositionWindow, target: Partial<Rectangle> | Point): void {
  const { x, y } = target
  if ('setPosition' in window && !('width' in target) && !('height' in target) && x !== undefined && y !== undefined) {
    const { width, height } = window.getBounds()
    if (!placeOwnWindow(window, { x, y, width, height }))
      window.setPosition(x, y)
    return
  }
  if (!('setBounds' in window))
    return
  const { width, height } = target as Partial<Rectangle>
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined && placeOwnWindow(window, { x, y, width, height }))
    return
  window.setBounds(target)
}
