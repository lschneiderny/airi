import type { BodyArmForm, BodyChannel, BodyRigTraits, BodySide, HandShape } from '@proj-airi/motion-driver-humanoid/performance'

import { GAIT_STYLE_BOUNDS } from '@proj-airi/motion-driver-humanoid/locomotion'
import { addHandShape, ARM_FORMS, BODY_CHANNELS, BODY_EMOTIONS, channelIndex, GestureKeys, HAND_SHAPES, limitChannel, writeArmFormHand, writeHandShape } from '@proj-airi/motion-driver-humanoid/performance'
import { writeWalkHand } from '@proj-airi/stage-ui-mmd/composables/mmd/body'

const DEG = Math.PI / 180
const SIDES: readonly BodySide[] = ['left', 'right']
/** Channels of one side's arm block, from its `ClavElev`: the 26 values `writeHandShape` writes into. */
const ARM_BLOCK = 26
/** The first finger channel of an arm block (the thumb's metacarpal). */
const HAND_FROM = 9

/** Wrist channels of one cell, degrees: pronation, flexion (palmar positive) and deviation, as `BODY_CHANNELS` signs them. */
export interface WristAngles {
  readonly pron: number
  readonly wflex: number
  readonly wdev: number
}

export interface HandSheetCell {
  readonly name: string
  /** The hand shape written through `writeHandShape`; null keeps the performer's rest hand and wrist, how she stands. */
  readonly shape: HandShape | null
  readonly wrist: WristAngles
  /** A hand part of the way from `shape` to `to`, in the hand's closing order (`addHandShape`), as a blend passes it. */
  readonly blend?: { readonly to: HandShape, readonly share: number }
  /**
   * The rest hand and wrist with the walk's hand curl (`GaitStyle.handCurl`) written by the MMD adapter's
   * `writeWalkHand`, and an emotion's hand blended in from that walking hand by `addHandShape` at full weight, as the
   * emotion layer blends it.
   */
  readonly walk?: { readonly handCurl: number, readonly emotion?: 'angry' }
}

const NEUTRAL: WristAngles = { pron: 0, wflex: 0, wdev: 0 }
/**
 * Wrist angles the sheet shows, degrees: well inside each channel's joint limit (flexion -60 to 65, deviation -20 to 30,
 * pronation -85 to 85) and inside the 60 degrees of pronation the performer holds on a rig without forearm twist bones.
 */
const WRIST = { flex: 45, deviation: 15, pronation: 60 } as const

/**
 * The sheet's cells: her rest hand, every hand shape with the hand in line with the forearm, the halfway points of the
 * blends whose paths matter (the thumb crossing into a fist and a point), the walk's open and closed hands at the ends
 * of the style's range and the angry walk (the closed walking hand under the angry fist), then the relaxed hand at each
 * end of each wrist axis.
 */
export const HAND_SHEET_CELLS: readonly HandSheetCell[] = [
  { name: 'rest', shape: null, wrist: NEUTRAL },
  ...(Object.keys(HAND_SHAPES) as HandShape[]).map(shape => ({ name: shape, shape, wrist: NEUTRAL })),
  { name: 'relaxed-to-fist', shape: 'relaxed', wrist: NEUTRAL, blend: { to: 'fist', share: 0.5 } },
  { name: 'relaxed-to-point', shape: 'relaxed', wrist: NEUTRAL, blend: { to: 'point', share: 0.5 } },
  { name: 'walk-open', shape: null, wrist: NEUTRAL, walk: { handCurl: GAIT_STYLE_BOUNDS.handCurl[0] } },
  { name: 'walk-closed', shape: null, wrist: NEUTRAL, walk: { handCurl: GAIT_STYLE_BOUNDS.handCurl[1] } },
  { name: 'walk-angry', shape: null, wrist: NEUTRAL, walk: { handCurl: GAIT_STYLE_BOUNDS.handCurl[1], emotion: 'angry' } },
  { name: 'wrist-flexed', shape: 'relaxed', wrist: { ...NEUTRAL, wflex: WRIST.flex } },
  { name: 'wrist-extended', shape: 'relaxed', wrist: { ...NEUTRAL, wflex: -WRIST.flex } },
  // Positive deviation is ulnar (its limit, 30, is the larger, as the ulnar range is), negative radial, toward the thumb.
  { name: 'deviated-ulnar', shape: 'relaxed', wrist: { ...NEUTRAL, wdev: WRIST.deviation } },
  { name: 'deviated-radial', shape: 'relaxed', wrist: { ...NEUTRAL, wdev: -WRIST.deviation } },
  { name: 'pronated', shape: 'relaxed', wrist: { ...NEUTRAL, pron: WRIST.pronation } },
  { name: 'supinated', shape: 'relaxed', wrist: { ...NEUTRAL, pron: -WRIST.pronation } },
]

/**
 * A contact cell: both arms at the key the gesture layer solves for a held arm form (`GestureKeys.armForm`, the form's
 * hands by `writeArmFormHand`), or at the speech ready key at energy 0.65 with the relaxed hand. Drawn with the whole
 * mesh around the hand, so the face, the chest or the other hand it meets shows.
 */
export type ContactCell = BodyArmForm | 'ready'

/** Every held arm form, then the ready key. */
export const CONTACT_CELLS: readonly ContactCell[] = [...Object.keys(ARM_FORMS) as BodyArmForm[], 'ready']

/** The energy the ready cell's key is solved at: the middle of the speak scenario's energies. */
const READY_ENERGY = 0.65

/**
 * The performer channels of a contact cell, and the sides whose key solved (a side that does not reach its key keeps
 * its rest arm). A two-hand form solves both arms together, as the gesture layer does.
 */
export function contactChannels(rest: Float32Array, traits: BodyRigTraits, cell: ContactCell): { readonly channels: Float32Array, readonly reached: readonly BodySide[] } {
  const keys = new GestureKeys(traits, rest)
  const channels = rest.slice()
  const reached: BodySide[] = []
  for (const side of SIDES) {
    const start = channelIndex(`${side}ClavElev`)
    const home = Float64Array.from(rest.subarray(start, start + ARM_BLOCK))
    const arm = home.slice()
    if (cell === 'ready')
      writeHandShape('relaxed', arm)
    else
      writeArmFormHand(cell, side, arm)
    if (!(cell === 'ready' ? keys.solve(side, keys.readyKey(READY_ENERGY), arm, home) : keys.armForm(side, cell, arm)))
      continue
    reached.push(side)
    for (let j = 2; j < ARM_BLOCK; j++)
      channels[start + j] = limitChannel(start + j, arm[j])
  }
  return { channels, reached }
}

/**
 * The performer channels of one cell: `rest` (the performer's rest channels, so the arm hangs as she stands) with both
 * hands set to the cell's shape and wrist, through the gesture layer's own `writeHandShape`, or to the walk's hand. The
 * hand channels a cell sets pass the performer's joint limits (`limitChannel`), as every frame's channels do.
 */
export function handSheetChannels(rest: Float32Array, cell: HandSheetCell): Float32Array {
  const channels = rest.slice()
  if (cell.walk) {
    const walk = new Float64Array(BODY_CHANNELS.length)
    for (const side of SIDES) {
      writeWalkHand(cell.walk.handCurl, side, walk)
      const start = channelIndex(`${side}ClavElev`)
      const hands = cell.walk.emotion && BODY_EMOTIONS[cell.walk.emotion].hands
      // The emotion layer blends its shape in from the hand she holds: the rest hand with the walk's.
      if (hands && 'shape' in hands)
        addHandShape(hands.shape, hands.amount, Float64Array.from(rest, (value, c) => value + walk[c]), walk, start, hands.spread)
      for (let j = HAND_FROM; j < ARM_BLOCK; j++)
        channels[start + j] = limitChannel(start + j, rest[start + j] + walk[start + j])
    }
    return channels
  }
  if (!cell.shape)
    return channels
  for (const side of SIDES) {
    const start = channelIndex(`${side}ClavElev`)
    const arm = Float64Array.from(channels.subarray(start, start + ARM_BLOCK))
    writeHandShape(cell.shape, arm)
    if (cell.blend)
      addHandShape(cell.blend.to, cell.blend.share, arm, arm, 0)
    for (let j = HAND_FROM; j < ARM_BLOCK; j++)
      channels[start + j] = limitChannel(start + j, arm[j])
    channels[channelIndex(`${side}Pron`)] = cell.wrist.pron * DEG
    channels[channelIndex(`${side}Wflex`)] = cell.wrist.wflex * DEG
    channels[channelIndex(`${side}Wdev`)] = cell.wrist.wdev * DEG
  }
  return channels
}

/** One side's arm block in degrees, by channel name without the side, for the sheet's index. */
export function armDegrees(channels: Float32Array, side: BodySide): Record<string, number> {
  const start = channelIndex(`${side}ClavElev`)
  return Object.fromEntries(Array.from({ length: ARM_BLOCK }, (_, j) => [
    (BODY_CHANNELS[start + j] as BodyChannel).slice(side.length),
    Math.round(channels[start + j] / DEG * 1000) / 1000,
  ]))
}
