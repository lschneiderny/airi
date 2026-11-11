export type HandShape = 'relaxed' | 'open' | 'flat' | 'point' | 'cup' | 'fist'

/**
 * One hand shape of architecture 4a, in degrees. `index` is the index finger's proximal, intermediate and distal
 * curl. `others` gives the middle, ring and little fingers: `scaled` applies the rest pose's per-finger curl scale to
 * the index curl, `same` copies the index curl, and a tuple sets their curl directly. `thumbAcross` folds the thumb
 * across the palm instead of curling it along its own axis.
 */
export interface HandShapeSpec {
  readonly index: readonly [number, number, number]
  readonly others: 'scaled' | 'same' | readonly [number, number, number]
  readonly spread: number
  readonly thumb: number
  readonly thumbAcross: boolean
}

/** Data only: architecture 4a's hand-shape table. A gesture or emotion layer turns a shape into finger channels. */
export const HAND_SHAPES: Readonly<Record<HandShape, HandShapeSpec>> = {
  relaxed: { index: [15, 20, 10], others: 'scaled', spread: 0, thumb: 10, thumbAcross: false },
  open: { index: [5, 5, 3], others: 'scaled', spread: 8, thumb: 0, thumbAcross: false },
  flat: { index: [0, 0, 0], others: 'same', spread: 0, thumb: 5, thumbAcross: false },
  point: { index: [0, 5, 0], others: [75, 85, 50], spread: 0, thumb: 40, thumbAcross: true },
  cup: { index: [25, 30, 15], others: 'scaled', spread: 3, thumb: 20, thumbAcross: false },
  fist: { index: [60, 70, 40], others: 'same', spread: 0, thumb: 45, thumbAcross: true },
}
