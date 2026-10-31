import { createRandomStream } from '../random'

const supportStates = ['left', 'both', 'right'] as const
const radiansPerDegree = Math.PI / 180

export type WeightShiftSupport = typeof supportStates[number]

export interface WeightShiftOffsets {
  pelvisLateral: number
  pelvisDrop: number
  pelvisForeAft: number
  lowerBodyRoll: number
  lowerBodyYaw: number
  upperBodyCounterRoll: number
  chestCounterRoll: number
}

export interface WeightShiftOutput {
  state: WeightShiftSupport
  phase: 'dwell' | 'transition'
  dwellSeconds: number
  transitionSeconds: number
  s: number
  offsets: WeightShiftOffsets
}

export interface WeightShiftInput {
  /** Monotonic seconds supplied by the caller. */
  now: number
  /** Hip height in model units. */
  hipY: number
  /** Blend from no shift (0) to full weight shift (1). */
  duck: number
}

export interface NaturalBodyCompositionInput {
  weightShift: WeightShiftOutput
  /** Natural body pitch in normalized units from -1 to 1. */
  naturalBodyX: number
  /** Low-pass Natural body roll in normalized units from -1 to 1. */
  naturalBodyRoll: number
  /** Natural breath in normalized units from -1 to 1. */
  breath: number
}

export interface NaturalBodyComposition {
  pelvisLateral: number
  pelvisDrop: number
  pelvisForeAft: number
  lowerBodyRoll: number
  lowerBodyYaw: number
  upperBodyRoll: number
  chestCounterRoll: number
  spinePitch: number
  chestPitch: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function smootherstep(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function stateValue(state: WeightShiftSupport) {
  if (state === 'left')
    return -1
  if (state === 'right')
    return 1
  return 0
}

function chooseNextState(random: () => number, current: WeightShiftSupport): WeightShiftSupport {
  const candidates = supportStates.filter(state => state !== current)
  return candidates[Math.floor(random() * candidates.length)]
}

function sampleDwell(random: () => number) {
  return Math.exp(Math.log(6) + random() * (Math.log(18) - Math.log(6)))
}

function sampleTransition(random: () => number) {
  return 1.2 + random() * (2 - 1.2)
}

export function createWeightShift({ seed }: { seed: number }) {
  const random = createRandomStream(seed)
  let currentState: WeightShiftSupport = 'both'
  let targetState = chooseNextState(random, currentState)
  let phase: WeightShiftOutput['phase'] = 'dwell'
  let phaseStart = 0
  let lastNow = 0
  let dwellSeconds = sampleDwell(random)
  let transitionSeconds = sampleTransition(random)

  function advance(now: number) {
    while (true) {
      const duration = phase === 'dwell' ? dwellSeconds : transitionSeconds
      if (now < phaseStart + duration)
        return

      phaseStart += duration
      if (phase === 'dwell') {
        phase = 'transition'
      }
      else {
        currentState = targetState
        targetState = chooseNextState(random, currentState)
        dwellSeconds = sampleDwell(random)
        transitionSeconds = sampleTransition(random)
        phase = 'dwell'
      }
    }
  }

  return {
    step({ now, hipY, duck }: WeightShiftInput): WeightShiftOutput {
      lastNow = Math.max(lastNow, now)
      advance(lastNow)

      const progress = phase === 'dwell'
        ? 0
        : smootherstep((lastNow - phaseStart) / transitionSeconds)
      const s = clamp(
        stateValue(currentState) + (stateValue(targetState) - stateValue(currentState)) * progress,
        -1,
        1,
      )
      const blend = clamp(duck, 0, 1)
      const applyDuck = (value: number) => blend === 0 ? 0 : blend * value

      return {
        state: phase === 'dwell' ? currentState : targetState,
        phase,
        dwellSeconds,
        transitionSeconds,
        s,
        offsets: {
          pelvisLateral: applyDuck(0.45 * s * (hipY / 11.5) + 0.04 * Math.sin(2 * Math.PI * 0.23 * lastNow) + 0.025 * Math.sin(2 * Math.PI * 0.37 * lastNow)),
          pelvisDrop: applyDuck(0.06 * Math.abs(s)),
          pelvisForeAft: applyDuck(0.03 * Math.sin(2 * Math.PI * 0.19 * lastNow)),
          lowerBodyRoll: applyDuck(-4 * radiansPerDegree * s),
          lowerBodyYaw: applyDuck(3 * radiansPerDegree * s),
          upperBodyCounterRoll: applyDuck(2.5 * radiansPerDegree * s),
          chestCounterRoll: applyDuck(radiansPerDegree * s),
        },
      }
    },
  }
}

export function composeWeightShift({
  weightShift,
  naturalBodyX,
  naturalBodyRoll,
  breath,
}: NaturalBodyCompositionInput): NaturalBodyComposition {
  const bodyX = clamp(naturalBodyX, -1, 1)
  const bodyRoll = clamp(naturalBodyRoll, -1, 1)
  const breathLevel = clamp(breath, -1, 1)
  const offsets = weightShift.offsets

  return {
    pelvisLateral: offsets.pelvisLateral + 0.15 * bodyRoll,
    pelvisDrop: offsets.pelvisDrop,
    pelvisForeAft: offsets.pelvisForeAft,
    lowerBodyRoll: offsets.lowerBodyRoll,
    lowerBodyYaw: offsets.lowerBodyYaw,
    upperBodyRoll: offsets.upperBodyCounterRoll,
    chestCounterRoll: offsets.chestCounterRoll,
    spinePitch: bodyX * 10 * radiansPerDegree * 0.6,
    chestPitch: bodyX * 10 * radiansPerDegree * 0.4 + breathLevel * 0.6 * radiansPerDegree,
  }
}
