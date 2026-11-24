import { DEG } from './channels'

export type HandShape = 'relaxed' | 'open' | 'flat' | 'point' | 'cup' | 'fist'

/** Curl of one digit's three joints, degrees, knuckle to tip (the thumb: metacarpal, proximal, distal). */
export type DigitCurl = readonly [number, number, number]

/**
 * One hand shape, in degrees, as the MMD adapter's calibrated hand reads it: curl 0 is a joint straight along the palm,
 * spread fans the four fingers about the middle finger from parallel at 0, and opposition turns the thumb from 40
 * degrees round from the side of the index finger toward the palm (library rigs bind it at 42 to 56, about opposition
 * 10).
 */
export interface HandShapeSpec {
  /** Index, middle, ring and little finger. */
  readonly fingers: readonly [DigitCurl, DigitCurl, DigitCurl, DigitCurl]
  readonly spread: number
  readonly thumb: DigitCurl
  readonly opposition: number
}

/**
 * Data only: architecture 4a's hand-shape table, each digit written out (plan H6, reviewed on ten library rigs). A
 * gesture, emotion or act turns a shape into hand channels with `writeHandShape`.
 *
 * - `relaxed`, the rest hand: curl grows from the index to the little finger and is largest at the middle joint, so the
 *   tips fall apart in a cascade; a 4 degree fan keeps the little finger off the ring finger. The thumb lies soft along
 *   the side of the index.
 * - `open`, the presenting hand of palm-up, press, frame and the hair touch: nearly straight with the same cascade, an
 *   8 degree fan and the thumb relaxed out to the side, not a blade.
 * - `flat`, the chop's blade: straight fingers, no fan, the thumb drawn in along the index.
 * - `cup`, a hold: curl at the knuckles more than at the tips, the thumb opposed under the fingers.
 * - `fist`, closed to the knee of each finger joint's limit (`limitChannel`), so the tips reach the palm; the thumb
 *   opposes across the palm and curls over the outside of the index and middle fingers' middle phalanges.
 * - `point`, the index straight and every other digit as in the fist.
 */
export const HAND_SHAPES: Readonly<Record<HandShape, HandShapeSpec>> = {
  relaxed: { fingers: [[14, 20, 9], [17, 24, 11], [21, 28, 13], [25, 32, 15]], spread: 4, thumb: [8, 8, 10], opposition: 10 },
  open: { fingers: [[5, 8, 4], [7, 10, 5], [10, 13, 6], [13, 17, 8]], spread: 8, thumb: [5, 8, 10], opposition: 4 },
  flat: { fingers: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], spread: 0, thumb: [15, 0, 0], opposition: 0 },
  point: { fingers: [[0, 4, 2], [89, 100, 68], [90, 100, 68], [90, 100, 68]], spread: 0, thumb: [0, 40, 60], opposition: 38 },
  cup: { fingers: [[34, 28, 12], [36, 30, 13], [38, 32, 14], [40, 34, 15]], spread: 3, thumb: [15, 15, 10], opposition: 25 },
  fist: { fingers: [[88, 100, 68], [89, 100, 68], [90, 100, 68], [90, 100, 68]], spread: 0, thumb: [0, 40, 60], opposition: 38 },
}

/**
 * Writes a hand shape's finger and thumb curls, spread and thumb opposition into a side's arm block (26 channels from
 * its `ClavElev`; channels 9 to 25), in radians.
 */
export function writeHandShape(shape: HandShape, pose: Float64Array): void {
  const spec = HAND_SHAPES[shape]
  for (let joint = 0; joint < 3; joint++) {
    pose[9 + joint] = spec.thumb[joint] * DEG
    for (let finger = 0; finger < 4; finger++)
      pose[12 + finger * 3 + joint] = spec.fingers[finger][joint] * DEG
  }
  pose[24] = spec.spread * DEG
  pose[25] = spec.opposition * DEG
}

const shaped = new Float64Array(26)

/**
 * Moves one side's hand `share` of the way from `rest` toward `shape`, adding to `channels` (both indexed by
 * `BODY_CHANNELS`, the side's arm block from `start`): every finger and thumb curl, the spread (scaled by `spread`) and
 * the opposition. An additive layer's hand (the emotion layer's open and fist hands).
 */
export function addHandShape(shape: HandShape, share: number, rest: ArrayLike<number>, channels: { [index: number]: number }, start: number, spread = 1): void {
  writeHandShape(shape, shaped)
  shaped[24] *= spread
  for (let j = 9; j < 26; j++)
    channels[start + j] += share * (shaped[j] - rest[start + j])
}
