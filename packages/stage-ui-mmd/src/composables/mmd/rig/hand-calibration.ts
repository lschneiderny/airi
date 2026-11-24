/** A position or direction in post-parse model axes; the rig profile's `MMDVec3`. */
type V = [number, number, number]

/** The four fingers that curl toward the palm, radial to ulnar. */
export const MMD_PALM_FINGERS = ['index', 'middle', 'ring', 'little'] as const
export type MMDPalmFinger = typeof MMD_PALM_FINGERS[number]

/**
 * Bind positions of one hand, post-parse model units. Each finger lists its three posed joints and its tip, null where
 * the rig has none: the proximal, intermediate and distal joints for the four fingers, and the metacarpal, proximal and
 * distal joints for the thumb.
 */
export interface MMDHandPoints {
  readonly elbow: V | null
  readonly wrist: V
  readonly thumb: readonly [V | null, V | null, V | null, V | null]
  readonly fingers: Readonly<Record<MMDPalmFinger, readonly [V | null, V | null, V | null, V | null]>>
}

/** One finger at bind, in model axes. Angles are radians. */
export interface MMDFingerCalibration {
  /**
   * Unit axis a positive rotation about which flexes the finger toward the palm: the proximal segment's direction in
   * the palm plane crossed with the palm normal.
   */
  readonly curlAxis: V
  /** The proximal segment's turn about the palm normal away from the palm axis, positive toward the thumb. */
  readonly spread: number
  /**
   * Flexion of each joint about `curlAxis`, positive toward the palm: the proximal segment from the palm plane, then
   * the intermediate and distal segments from the segment before. A joint whose segment is unmeasured reads 0.
   */
  readonly bend: readonly [number, number, number]
  /** Flexion of the line from the knuckle to the fingertip (or the last measured joint) from the palm plane. */
  readonly chord: number
}

/** The thumb at bind, in model axes. Angles are radians. */
export interface MMDThumbCalibration {
  /** Unit axis a positive rotation about which curls the thumb; see `THUMB_CURL_PITCH`. */
  readonly curlAxis: V
  /**
   * The thumb's turn about the palm axis from the thumb side of the hand toward the palm normal: 0 beside the index
   * finger, 90 degrees under the palm.
   */
  readonly opposition: number
  /** Curl of the proximal and distal joints about `curlAxis` from the segment before; the metacarpal reads 0. */
  readonly bend: readonly [number, number, number]
}

/**
 * One hand's bind frame and joint bends, read from bone positions alone (PMX local axes are set on too few rigs to
 * rely on). Directions are unit vectors in post-parse model axes.
 */
export interface MMDHandCalibration {
  /** From the wrist to the middle knuckle (or the knuckles' centre when the middle finger is missing). */
  readonly axis: V
  /** Out of the palm, perpendicular to `axis`. */
  readonly normal: V
  /**
   * The hand's bind bend from the forearm line, radians: `flexion` toward the palm about `axis x normal`, `deviation`
   * toward the thumb about the palm normal. Null without an elbow.
   */
  readonly wrist: { readonly flexion: number, readonly deviation: number } | null
  /** Null for a finger without its proximal and intermediate joints. */
  readonly fingers: Readonly<Record<MMDPalmFinger, MMDFingerCalibration | null>>
  /** Null without the thumb's first two joints. */
  readonly thumb: MMDThumbCalibration | null
}

/**
 * Where a thumb curl sends the thumb, as the pitch from the palm plane toward the palm normal of the direction across
 * the palm toward the little finger. 0 would sweep the thumb flat over the palm and 90 degrees would fold it into the
 * palm as a finger folds, through the fingers of a fist; between them it wraps over the curled fingers.
 */
export const THUMB_CURL_PITCH = 35 * Math.PI / 180

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const length = (a: V) => Math.hypot(a[0], a[1], a[2])
/** Unit vector, or null for a degenerate one. */
function unit(a: V): V | null {
  const l = length(a)
  return l > 1e-9 ? scale(a, 1 / l) : null
}
/** `a` with its component along unit `axis` removed. */
const flatten = (a: V, axis: V): V => sub(a, scale(axis, dot(a, axis)))
/** Signed angle from `a` to `b` about unit `axis`, both projected onto the plane perpendicular to it. */
function turn(a: V, b: V, axis: V): number {
  const pa = flatten(a, axis)
  const pb = flatten(b, axis)
  return Math.atan2(dot(cross(pa, pb), axis), dot(pa, pb))
}

/**
 * Reads one hand's calibration; null without a palm, which needs at least two distinct knuckles of the four fingers.
 * `sigma` is +1 for the left hand and -1 for the right; it fixes which side of the palm plane the palm faces, so the
 * frame never depends on how a rig holds its hand at bind.
 */
export function readMMDHandCalibration(sigma: 1 | -1, points: MMDHandPoints): MMDHandCalibration | null {
  const knuckles = MMD_PALM_FINGERS.map(finger => points.fingers[finger][0]).filter((point): point is V => point !== null)
  if (knuckles.length < 2)
    return null
  const centre = points.fingers.middle[0] ?? scale(knuckles.reduce(add), 1 / knuckles.length)
  const axis = unit(sub(centre, points.wrist))
  const across = axis && unit(flatten(sub(knuckles[knuckles.length - 1], knuckles[0]), axis))
  if (!axis || !across)
    return null
  // `across` runs from the index side to the little finger side. On the left hand (+X) with the index forward (+Z),
  // across x axis points down, out of the palm; the right hand mirrors it.
  const normal = scale(cross(across, axis), sigma)
  const forearm = points.elbow && unit(sub(points.wrist, points.elbow))
  const wrist = forearm
    ? { flexion: turn(forearm, axis, cross(axis, normal)), deviation: turn(forearm, axis, scale(normal, sigma)) }
    : null
  const fingers = Object.fromEntries(MMD_PALM_FINGERS.map(finger => [finger, readFinger(sigma, axis, normal, points.fingers[finger])])) as Record<MMDPalmFinger, MMDFingerCalibration | null>
  return { axis, normal, wrist, fingers, thumb: readThumb(sigma, axis, normal, points.thumb) }
}

/** Segment vectors between consecutive present points; a segment with a missing end is null. */
function segments(chain: readonly (V | null)[]): (V | null)[] {
  return [0, 1, 2].map((i) => {
    const from = chain[i]
    const to = chain[i + 1]
    return from && to && length(sub(to, from)) > 1e-9 ? sub(to, from) : null
  })
}

function readFinger(sigma: 1 | -1, axis: V, normal: V, chain: readonly (V | null)[]): MMDFingerCalibration | null {
  const [proximal, intermediate, distal] = segments(chain)
  const direction = proximal && unit(flatten(proximal, normal))
  if (!proximal || !direction)
    return null
  const curlAxis = unit(cross(direction, normal))!
  const end = [...chain].reverse().find(point => point !== null)!
  const line = sub(end, chain[0]!)
  return {
    curlAxis,
    // Turning about sigma * normal moves the palm axis toward the thumb on either hand.
    spread: turn(axis, direction, scale(normal, sigma)),
    bend: [
      Math.atan2(dot(proximal, normal), dot(proximal, direction)),
      intermediate ? turn(proximal, intermediate, curlAxis) : 0,
      intermediate && distal ? turn(intermediate, distal, curlAxis) : 0,
    ],
    chord: Math.atan2(dot(line, normal), dot(line, direction)),
  }
}

function readThumb(sigma: 1 | -1, axis: V, normal: V, chain: readonly (V | null)[]): MMDThumbCalibration | null {
  const [metacarpal, proximal, distal] = segments(chain)
  const base = chain.find(point => point !== null)
  const end = [...chain].reverse().find(point => point !== null)
  const direction = base && end && unit(sub(end, base))
  if (!metacarpal || !direction)
    return null
  // The little finger's side of the palm, and where a curl sends the thumb: across the palm and partly into it.
  const ulnar = scale(cross(axis, normal), sigma)
  const goal = add(scale(ulnar, Math.cos(THUMB_CURL_PITCH)), scale(normal, Math.sin(THUMB_CURL_PITCH)))
  const curlAxis = unit(cross(direction, goal))
  if (!curlAxis)
    return null
  return {
    curlAxis,
    // About sigma * axis, the thumb side of the hand turns toward the palm normal on either hand.
    opposition: turn(scale(ulnar, -1), direction, scale(axis, sigma)),
    bend: [0, proximal ? turn(metacarpal, proximal, curlAxis) : 0, proximal && distal ? turn(proximal, distal, curlAxis) : 0],
  }
}
