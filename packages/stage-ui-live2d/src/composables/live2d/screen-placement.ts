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

/**
 * Converts the chat window center into Natural's cursor unit: an offset from the eye anchor in head widths, y up.
 *
 * Use when:
 * - Natural should look at a chat window whose bounds are in Electron DIP screen coordinates
 *
 * Expects:
 * - `windowBounds` and `clientWidth` as in {@link headScreenX}; the same ratio converts DIP back to viewport CSS px
 * - `toModel` maps a viewport CSS px point into model canvas px, the space the cursor offset is measured in
 * - `eye` is the measured eye anchor and the unscaled head width in model canvas px
 *
 * Returns:
 * - The offset, or `null` when the window has no usable width yet or the conversion is not finite
 */
export function chatTargetOffset(
  chatBounds: PlacementRect,
  windowBounds: PlacementRect,
  clientWidth: number,
  toModel: (client: { x: number, y: number }) => { x: number, y: number },
  eye: { anchorX: number, anchorY: number, unit: number },
): { x: number, y: number } | null {
  if (!(clientWidth > 0) || !(windowBounds.width > 0) || !(eye.unit > 0))
    return null
  const scale = windowBounds.width / clientWidth
  const model = toModel({
    x: (chatBounds.x + chatBounds.width / 2 - windowBounds.x) / scale,
    y: (chatBounds.y + chatBounds.height / 2 - windowBounds.y) / scale,
  })
  const x = (model.x - eye.anchorX) / eye.unit
  const y = (eye.anchorY - model.y) / eye.unit
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
