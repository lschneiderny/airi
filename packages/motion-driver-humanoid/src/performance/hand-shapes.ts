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
 * Data only: architecture 4a's hand-shape table, each finger's curl written out (the middle, ring and little fingers of
 * `relaxed`, `open` and `cup` at the rest pose's per-finger scale of the index curl). A gesture, emotion or act turns a
 * shape into finger channels with `writeHandShape`.
 */
export const HAND_SHAPES: Readonly<Record<HandShape, HandShapeSpec>> = {
  relaxed: { fingers: [[15, 20, 10], [17.25, 23, 11.5], [19.5, 26, 13], [21.75, 29, 14.5]], spread: 0, thumb: [10, 0, 0], opposition: 10 },
  open: { fingers: [[5, 5, 3], [5.75, 5.75, 3.45], [6.5, 6.5, 3.9], [7.25, 7.25, 4.35]], spread: 8, thumb: [0, 0, 0], opposition: 10 },
  flat: { fingers: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], spread: 0, thumb: [5, 0, 0], opposition: 10 },
  point: { fingers: [[0, 5, 0], [75, 85, 50], [75, 85, 50], [75, 85, 50]], spread: 0, thumb: [40, 0, 0], opposition: 40 },
  cup: { fingers: [[25, 30, 15], [28.75, 34.5, 17.25], [32.5, 39, 19.5], [36.25, 43.5, 21.75]], spread: 3, thumb: [20, 0, 0], opposition: 10 },
  fist: { fingers: [[60, 70, 40], [60, 70, 40], [60, 70, 40], [60, 70, 40]], spread: 0, thumb: [45, 0, 0], opposition: 40 },
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
