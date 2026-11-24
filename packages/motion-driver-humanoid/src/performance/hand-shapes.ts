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

/**
 * How a digit's joints share a shape blend: each moves along a smoothstep over its own window, `ORDER_SPAN` of the
 * hand's way long. The leading joint's window opens as the hand starts, the trailing joint's closes as it ends, and the
 * middle joint's sits between. A half-closed hand has its knuckles 0.84 of the way closed and its fingertips 0.16, and
 * every joint starts and ends at rest, so a hand that has nearly opened again holds no lingering knuckle bend.
 */
const ORDER_SPAN = 0.7
/** The steepest slope of `orderedShare` over the hand's share: smoothstep's 1.5 over its window's length. */
export const ORDER_PEAK_SLOPE = 1.5 / ORDER_SPAN

/** Where the window of a joint of `order` (1 leads, 0 middle, -1 trails) opens, as a share of the hand's way. */
const windowStart = (order: number) => (1 - ORDER_SPAN) * (1 - order) / 2

/**
 * The share of the way one hand channel has gone when the whole hand has gone `share` of the way between two shapes,
 * by the channel's `order` from `handOrder`: 1 leads, 0 is the middle joint, -1 trails. The trailing course is the
 * leading one run backwards, so a hand that opens retraces the way it closed.
 */
export function orderedShare(order: number, share: number): number {
  const x = Math.max(0, Math.min(1, (share - windowStart(order)) / ORDER_SPAN))
  return x * x * (3 - 2 * x)
}

/** The slope of `orderedShare` over the hand's share at `share`. */
export function orderedSlope(order: number, share: number): number {
  const x = Math.max(0, Math.min(1, (share - windowStart(order)) / ORDER_SPAN))
  return 6 * x * (1 - x) / ORDER_SPAN
}

/** The curvature of `orderedShare` over the hand's share at `share` (zero outside the joint's window). */
export function orderedCurve(order: number, share: number): number {
  const x = (share - windowStart(order)) / ORDER_SPAN
  return x <= 0 || x >= 1 ? 0 : 6 * (1 - 2 * x) / ORDER_SPAN ** 2
}

/**
 * Writes the closing order of a hand going from `from` to `to` (each a side's arm block, indexed 9 to 25 from its own
 * start) into `order` (indexed 9 to 25 from 0; other entries untouched). A hand closes as a person closes one, knuckles first,
 * rolling the fingers in, and opens by unrolling, fingertips first:
 *
 * - On a finger that closes (its three curls together grow), the first joint leads and the last trails; on one that
 *   opens, the last joint leads and the first trails.
 * - The thumb, its opposition with it, trails a thumb that closes and leads one that opens: it folds over fingers that
 *   have already curled, instead of crossing the palm to meet half-curled fingertips in a ring.
 * - The spread moves as the four fingers' first joints together: fingers close together as they curl and fan out as
 *   they finish opening.
 */
export function handOrder(from: ArrayLike<number>, to: ArrayLike<number>, order: { [index: number]: number }, fromStart = 0, toStart = 0): void {
  let fingers = 0
  for (let digit = 0; digit < 5; digit++) {
    const first = 9 + digit * 3
    let change = 0
    for (let joint = 0; joint < 3; joint++)
      change += to[toStart + first + joint] - from[fromStart + first + joint]
    const closing = change >= 0 ? 1 : -1
    if (digit === 0) {
      change += to[toStart + 25] - from[fromStart + 25]
      order[9] = order[10] = order[11] = order[25] = change >= 0 ? -1 : 1
      continue
    }
    fingers += change
    order[first] = closing
    order[first + 1] = 0
    order[first + 2] = -closing
  }
  order[24] = fingers >= 0 ? 1 : -1
}

const shaped = new Float64Array(26)
const ordered = new Float64Array(26)

/**
 * Writes one side's hand `share` of the way from `from` to `to` into `out` (each a side's arm block, from its own
 * start, channels 9 to 25), in the closing order of `handOrder`. `out` may be `from`.
 */
export function blendHand(from: ArrayLike<number>, to: ArrayLike<number>, share: number, out: { [index: number]: number }, fromStart = 0, toStart = 0, outStart = 0): void {
  handOrder(from, to, ordered, fromStart, toStart)
  for (let j = 9; j < 26; j++) {
    const a = from[fromStart + j]
    out[outStart + j] = a + orderedShare(ordered[j], share) * (to[toStart + j] - a)
  }
}

/**
 * Moves one side's hand `share` of the way from `rest` toward `shape`, adding to `channels` (both indexed by
 * `BODY_CHANNELS`, the side's arm block from `start`): every finger and thumb curl, the spread (scaled by `spread`) and
 * the opposition, in the closing order of `handOrder`, so a hand partly closed toward a fist leads with its knuckles
 * instead of hooking its fingertips. An additive layer's hand (the emotion layer's open and fist hands).
 */
export function addHandShape(shape: HandShape, share: number, rest: ArrayLike<number>, channels: { [index: number]: number }, start: number, spread = 1): void {
  writeHandShape(shape, shaped)
  shaped[24] *= spread
  handOrder(rest, shaped, ordered, start, 0)
  for (let j = 9; j < 26; j++)
    channels[start + j] += orderedShare(ordered[j], share) * (shaped[j] - rest[start + j])
}
