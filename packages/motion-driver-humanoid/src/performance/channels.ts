import type { ClipMaskGroup } from '../clip-mask'

import { softLimit } from '../dynamics'

export const BODY_TICK = 1 / 120
export const DEG = Math.PI / 180
export const SIDES = ['left', 'right'] as const
export type BodySide = typeof SIDES[number]

/** Stable indices; append channels rather than inserting them. Pelvis is in leg lengths, all angles in radians. */
export const BODY_CHANNELS = [
  'pelvisX',
  'pelvisY',
  'pelvisZ',
  'hipsYaw',
  'hipsPitch',
  'hipsRoll',
  'lowerYaw',
  'lowerPitch',
  'lowerRoll',
  'midYaw',
  'midPitch',
  'midRoll',
  'upperYaw',
  'upperPitch',
  'upperRoll',
  'neckYaw',
  'neckPitch',
  'neckRoll',
  'headYaw',
  'headPitch',
  'headRoll',
  'leftClavElev',
  'leftClavProt',
  'leftFlex',
  'leftAbduct',
  'leftTwist',
  'leftElbow',
  'leftPron',
  'leftWflex',
  'leftWdev',
  'leftThumb0',
  'leftThumb1',
  'leftThumb2',
  'leftIndex0',
  'leftIndex1',
  'leftIndex2',
  'leftMiddle0',
  'leftMiddle1',
  'leftMiddle2',
  'leftRing0',
  'leftRing1',
  'leftRing2',
  'leftLittle0',
  'leftLittle1',
  'leftLittle2',
  'leftSpread',
  'leftOpposition',
  'leftFootPitch',
  'leftToeBend',
  'rightClavElev',
  'rightClavProt',
  'rightFlex',
  'rightAbduct',
  'rightTwist',
  'rightElbow',
  'rightPron',
  'rightWflex',
  'rightWdev',
  'rightThumb0',
  'rightThumb1',
  'rightThumb2',
  'rightIndex0',
  'rightIndex1',
  'rightIndex2',
  'rightMiddle0',
  'rightMiddle1',
  'rightMiddle2',
  'rightRing0',
  'rightRing1',
  'rightRing2',
  'rightLittle0',
  'rightLittle1',
  'rightLittle2',
  'rightSpread',
  'rightOpposition',
  'rightFootPitch',
  'rightToeBend',
] as const

export type BodyChannel = typeof BODY_CHANNELS[number]

export function channelIndex(channel: BodyChannel): number {
  return BODY_CHANNELS.indexOf(channel)
}

export function channelGroup(channel: BodyChannel): ClipMaskGroup {
  if (channel.startsWith('pelvis') || channel.startsWith('hips'))
    return 'lowerBody'
  if (channel.startsWith('neck') || channel.startsWith('head'))
    return 'head'
  for (const side of SIDES) {
    if (channel.startsWith(side)) {
      const index = channelIndex(channel) - channelIndex(`${side}ClavElev`)
      if (index >= 26)
        return `${side}LegIk`
      return index >= 9 ? `${side}Fingers` : `${side}Arm`
    }
  }
  return 'upperBody'
}

/** Each channel's clip-mask group, in `BODY_CHANNELS` order, so a tick never rescans the channel names. */
export const CHANNEL_GROUPS: readonly ClipMaskGroup[] = BODY_CHANNELS.map(channelGroup)

const torsoLimits = [
  [-12, 12],
  [-10, 15],
  [-10, 10],
  [-15, 15],
  [-12, 25],
  [-12, 12],
  [-12, 12],
  [-10, 18],
  [-10, 10],
  [-8, 8],
  [-6, 10],
  [-6, 6],
  [-30, 30],
  [-22, 25],
  [-15, 15],
  [-40, 40],
  [-28, 32],
  [-20, 20],
] as const
const armLimits = [
  [-6, 22],
  [-14, 14],
  [-35, 150],
  [-35, 110],
  [-70, 60],
  [3, 142],
  [-85, 85],
  [-60, 65],
  [-20, 30],
] as const

/** Bounds align with BODY_CHANNELS. Float32 endpoints include the returned buffer's rounding. */
export const JOINT_LIMITS: readonly (readonly [number, number])[] = BODY_CHANNELS.map((_, index) => {
  if (index < 3)
    return [-0.12, 0.12]
  if (index < 21) {
    const [min, max] = torsoLimits[index - 3]
    return [Math.fround(min * DEG), Math.fround(max * DEG)]
  }
  const arm = (index - 21) % 28
  const bounds = arm < 9
    ? armLimits[arm]
    : arm < 24
      ? ([[-10, 90], [0, 100], [0, 70]] as const)[(arm - 9) % 3]
      : ([[-15, 15], [0, 60], [-35, 20], [0, 45]] as const)[arm - 24]
  return [Math.fround(bounds[0] * DEG), Math.fround(bounds[1] * DEG)]
})

/** Nonnegative joints need a zero fixed point: a tanh lower knee would bend a neutral toe. */
export function limitChannel(index: number, value: number): number {
  const [min, max] = JOINT_LIMITS[index]
  const knee = 0.1 * max
  if (min === 0 && value < knee) {
    if (value <= 0)
      return 0
    const t = value / knee
    // C1 at zero and at the identity region, with no change to the upper tanh knee.
    return knee * t * t * (2 - t)
  }
  return softLimit(value, min, max)
}

/** Contiguous blocks let the stack and FK use numeric buffers without property allocation. */
export const ARM_START = { left: 21, right: 49 } as const
export const TORSO_START = [6, 9, 12] as const
