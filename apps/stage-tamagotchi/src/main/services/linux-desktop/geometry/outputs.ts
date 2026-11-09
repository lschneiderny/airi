export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One compositor output in the compositor's logical coordinate space. */
export interface BridgeOutput extends Rect {
  readonly name: string
  readonly scale: number
}

export interface DisplayGeometry {
  readonly bounds: Rect
  readonly workArea: Rect
  readonly scaleFactor: number
}

const sizeTolerancePx = 1
const scaleTolerance = 0.01

function byPosition(a: Rect, b: Rect) {
  return (a.x - b.x) || (a.y - b.y)
}

/**
 * Moves every display into the compositor's coordinate space.
 *
 * Each display is paired with the output of the same size and scale; outputs
 * that share both pair in positional order. Each work area moves by the same
 * offset as its display. Returns `null` unless every display pairs with
 * exactly one output, so a partial mapping never mixes the two spaces.
 */
export function mapDisplaysToOutputs<D extends DisplayGeometry>(displays: readonly D[], outputs: readonly BridgeOutput[]): D[] | null {
  if (displays.length === 0 || displays.length !== outputs.length)
    return null
  const available = [...outputs].sort(byPosition)
  const paired = new Map<D, BridgeOutput>()
  for (const display of [...displays].sort((a, b) => byPosition(a.bounds, b.bounds))) {
    const index = available.findIndex(output => Math.abs(output.width - display.bounds.width) <= sizeTolerancePx
      && Math.abs(output.height - display.bounds.height) <= sizeTolerancePx
      && Math.abs(output.scale - display.scaleFactor) <= scaleTolerance)
    if (index < 0)
      return null
    paired.set(display, available.splice(index, 1)[0]!)
  }
  return displays.map((display) => {
    const output = paired.get(display)!
    const dx = output.x - display.bounds.x
    const dy = output.y - display.bounds.y
    return {
      ...display,
      bounds: { ...display.bounds, x: output.x, y: output.y },
      workArea: { ...display.workArea, x: display.workArea.x + dx, y: display.workArea.y + dy },
    }
  })
}
