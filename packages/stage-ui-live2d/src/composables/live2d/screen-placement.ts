import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'

/**
 * Converts the head center from viewport CSS pixels to Electron DIP screen x.
 *
 * Use when:
 * - The stage window reports its bounds in DIP and the head rectangle is measured in viewport CSS pixels
 *
 * Expects:
 * - `windowBounds` are the content bounds of a frameless window, so its origin is the viewport origin
 * - `clientWidth` is `document.documentElement.clientWidth`; the ratio of the two widths converts CSS px to DIP and absorbs page zoom
 *
 * Returns:
 * - The head center x in DIP screen coordinates, or `null` when the window has no usable width yet
 */
export function headScreenX(
  windowBounds: PlacementRect,
  clientWidth: number,
  headRect: { x: number, width: number },
): number | null {
  if (!(clientWidth > 0) || !(windowBounds.width > 0))
    return null
  const x = windowBounds.x + (headRect.x + headRect.width / 2) * (windowBounds.width / clientWidth)
  return Number.isFinite(x) ? x : null
}
