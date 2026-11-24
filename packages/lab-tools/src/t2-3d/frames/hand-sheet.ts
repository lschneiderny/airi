import type { BodyChannel, BodySide, HandShape } from '@proj-airi/motion-driver-humanoid/performance'

import { BODY_CHANNELS, channelIndex, HAND_SHAPES, writeHandShape } from '@proj-airi/motion-driver-humanoid/performance'

const DEG = Math.PI / 180
const SIDES: readonly BodySide[] = ['left', 'right']
/** Channels of one side's arm block, from its `ClavElev`: the 26 values `writeHandShape` writes into. */
const ARM_BLOCK = 26

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
}

const NEUTRAL: WristAngles = { pron: 0, wflex: 0, wdev: 0 }
/**
 * Wrist angles the sheet shows, degrees: well inside each channel's joint limit (flexion -60 to 65, deviation -20 to 30,
 * pronation -85 to 85) and inside the 60 degrees of pronation the performer holds on a rig without forearm twist bones.
 */
const WRIST = { flex: 45, deviation: 15, pronation: 60 } as const

/**
 * The sheet's cells: her rest hand, every hand shape with the hand in line with the forearm, then the relaxed hand at
 * each end of each wrist axis.
 */
export const HAND_SHEET_CELLS: readonly HandSheetCell[] = [
  { name: 'rest', shape: null, wrist: NEUTRAL },
  ...(Object.keys(HAND_SHAPES) as HandShape[]).map(shape => ({ name: shape, shape, wrist: NEUTRAL })),
  { name: 'wrist-flexed', shape: 'relaxed', wrist: { ...NEUTRAL, wflex: WRIST.flex } },
  { name: 'wrist-extended', shape: 'relaxed', wrist: { ...NEUTRAL, wflex: -WRIST.flex } },
  // Positive deviation is ulnar (its limit, 30, is the larger, as the ulnar range is), negative radial, toward the thumb.
  { name: 'deviated-ulnar', shape: 'relaxed', wrist: { ...NEUTRAL, wdev: WRIST.deviation } },
  { name: 'deviated-radial', shape: 'relaxed', wrist: { ...NEUTRAL, wdev: -WRIST.deviation } },
  { name: 'pronated', shape: 'relaxed', wrist: { ...NEUTRAL, pron: WRIST.pronation } },
  { name: 'supinated', shape: 'relaxed', wrist: { ...NEUTRAL, pron: -WRIST.pronation } },
]

/**
 * The performer channels of one cell: `rest` (the performer's rest channels, so the arm hangs as she stands) with both
 * hands set to the cell's shape and wrist. The shape goes through the gesture layer's own `writeHandShape`.
 */
export function handSheetChannels(rest: Float32Array, cell: HandSheetCell): Float32Array {
  const channels = rest.slice()
  if (!cell.shape)
    return channels
  for (const side of SIDES) {
    const start = channelIndex(`${side}ClavElev`)
    const arm = Float64Array.from(channels.subarray(start, start + ARM_BLOCK))
    writeHandShape(cell.shape, arm)
    channels.set(arm, start)
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
