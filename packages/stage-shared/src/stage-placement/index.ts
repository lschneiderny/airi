/** Rectangle in Electron DIP screen coordinates, with y increasing downwards. */
export interface PlacementRect {
  x: number
  y: number
  width: number
  height: number
}

/** Selects the bottom display layer in Electron DIP screen coordinates, y down. */
export function bottomLayerDisplays(displays: readonly PlacementRect[]): PlacementRect[] {
  return displays.filter(display => !displays.some((other) => {
    if (other.y + other.height / 2 <= display.y + display.height / 2)
      return false

    const overlap = Math.max(0, Math.min(display.x + display.width, other.x + other.width) - Math.max(display.x, other.x))
    return overlap >= 0.2 * Math.min(display.width, other.width)
  }))
}

/** Returns the bottom layer's horizontal center and half-span in Electron DIP screen coordinates, y down. */
export function placementReference(displays: readonly PlacementRect[]): { center: number, halfSpan: number } | null {
  const bottom = bottomLayerDisplays(displays)
  if (bottom.length === 0)
    return null

  const left = Math.min(...bottom.map(display => display.x))
  const right = Math.max(...bottom.map(display => display.x + display.width))
  const halfSpan = (right - left) / 2
  if (halfSpan <= 0)
    return null

  return { center: (left + right) / 2, halfSpan }
}

/**
 * Maps a head x in Electron DIP screen coordinates (y down) to dimensionless inwardness in [-1, 1].
 * Positive means inward is toward screen +x (right).
 */
export function screenInwardness(displays: readonly PlacementRect[], headScreenX: number): number | null {
  const reference = placementReference(displays)
  if (reference === null || !Number.isFinite(headScreenX))
    return null

  return Math.max(-1, Math.min(1, (reference.center - headScreenX) / reference.halfSpan))
}
