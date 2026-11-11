import type { BodyPerformanceInput, BodyRigTraits } from './contracts'

import { advanceSecondOrder, createLagChain, secondOrderCoefficients } from '../dynamics'
import { createActivityGate, createDriftNoise, deriveSeed, gaussian } from '../noise'
import { createRandomStream } from '../random'
import { BODY_TICK, DEG } from './channels'

const axes = ['yaw', 'pitch', 'roll'] as const
const headTerms = ['emphasis', 'impulse', 'pet', 'held', 'gesture', 'cue'] as const

/** Weight starts at the ground. Head attitude travels in the opposite direction. */
export class BodyPosture {
  support = 0
  /** The support transfer as it reaches the shoulders: the weight lag chain's torso-upper link. */
  shoulderSupport = 0
  target = 0
  dwell = 0
  private readonly random
  private readonly transfer = { y: 0, v: 0, x: 0 }
  private transferCoefficients = secondOrderCoefficients({ f: 0.55, zeta: 0.7, r: -0.45 }, BODY_TICK)
  private readonly weight
  private readonly attitude = Array.from({ length: 3 }, () => ({ y: 0, v: 0, x: 0 }))
  private readonly attitudeCoefficients = secondOrderCoefficients({ f: 5, zeta: 1, r: 0 }, BODY_TICK)
  private readonly attitudeNeck = [0, 1, 2].map(() => createLagChain([0.035], BODY_TICK))
  private readonly slow = createLagChain([0.25, 0.15], BODY_TICK)
  private readonly gate
  private readonly drift
  private erect = 0
  private readonly lateralGain: number
  private readonly rotationScale: number

  constructor(private readonly traits: BodyRigTraits, seed: number) {
    // Stream 0 schedules support; 1 gates the torso; 2..7 are permanent sway streams.
    this.random = createRandomStream(deriveSeed(seed, 0))
    this.gate = createActivityGate({ seed: deriveSeed(seed, 1) })
    this.drift = [2, 3, 4, 5, 6, 7].map(index => createDriftNoise({ seed: deriveSeed(seed, index) }))
    this.weight = createLagChain(traits.spineChain.length === 1 ? [0.04, 0.11, 0.07, 0.05] : [0.04, 0.11, 0.08, 0.08, 0.07, 0.05], BODY_TICK)
    this.dwell = this.drawDwell()
    this.lateralGain = 0.38 * Math.abs(traits.feet.left.ankle.x - traits.feet.right.ankle.x) / (2 * traits.legLength)
    this.rotationScale = traits.legIk ? 1 : 0.6
  }

  private drawDwell(): number {
    return Math.max(4, Math.min(75, Math.exp(Math.log(12) + 0.7 * gaussian(this.random))))
  }

  step(input: BodyPerformanceInput, out: Float64Array): void {
    if (input.posture.support === null) {
      this.dwell -= BODY_TICK * input.posture.shiftRate * (1 + 0.6 * Math.max(0, input.mood.arousal))
      if (this.dwell <= 0) {
        let next = this.target
        while (next === this.target) {
          const draw = this.random()
          next = draw < 0.55 ? 1 : draw < 0.85 ? 0.5 : 0
          next *= this.random() < 0.5 ? -1 : 1
        }
        this.target = next
        this.dwell = this.drawDwell()
        this.transferCoefficients = secondOrderCoefficients({ f: 0.55 * (1 + 0.25 * input.mood.arousal) * Math.exp(0.2 * gaussian(this.random)), zeta: 0.7, r: -0.45 }, BODY_TICK)
      }
    }
    else {
      this.target = input.posture.support
    }
    advanceSecondOrder(this.transfer, this.target, this.transferCoefficients)
    const s = this.transfer.y
    this.support = Math.max(-1, Math.min(1, s))
    const gate = this.gate.step(BODY_TICK) * input.posture.amplitude
    const lateral = this.drift[0].step(BODY_TICK) * gate * 0.004
    const forward = this.drift[1].step(BODY_TICK) * gate * 0.006
    // The pelvis cannot sway sideways over planted feet without loading one leg more: lateral sway is a small support
    // shift, so it travels the weight chain like a transfer and the free hip drops with it (architecture 3d).
    const sway = this.traits.legIk && this.lateralGain > 0 ? -lateral / this.lateralGain : 0
    const chain = this.weight.step(s + sway)
    const single = this.traits.spineChain.length === 1
    this.shoulderSupport = chain[single ? 1 : 3]
    const gain = this.rotationScale
    out[3] += 3 * DEG * chain[0] * gain
    out[5] -= 4.5 * DEG * chain[0] * gain
    out[8] += 2.4 * DEG * chain[1] * gain
    // The old 1.4-degree upper share is split over mid and upper, preserving total tilt.
    out[11] += 0.9 * DEG * chain[single ? 1 : 2] * gain
    out[14] += 0.5 * DEG * chain[single ? 1 : 3] * gain
    out[9] -= 2 * DEG * chain[single ? 1 : 2] * gain
    out[17] -= 1.2 * DEG * chain[single ? 2 : 4] * gain
    out[20] -= DEG * chain[single ? 3 : 5] * gain
    if (this.traits.legIk) {
      out[0] += -this.lateralGain * s + lateral
      out[1] -= 0.0065 * Math.abs(s)
      out[2] += forward
    }
    out[7] -= 0.25 * Math.atan2(forward * this.traits.legLength, this.traits.hips.y - this.traits.feet.left.ankle.y)
    out[6] += this.drift[2].step(BODY_TICK) * gate * 0.5 * DEG
    out[8] += this.drift[3].step(BODY_TICK) * gate * 0.5 * DEG
    out[12] += this.drift[4].step(BODY_TICK) * gate * 0.4 * DEG
    out[14] += this.drift[5].step(BODY_TICK) * gate * 0.4 * DEG
    const erect = 0.6 * input.mood.arousal + 0.3 * input.mood.valence
    this.erect = erect + (this.erect - erect) * Math.exp(-BODY_TICK / 4)
    out[7] -= 2 * DEG * this.erect
    out[10] -= 1.5 * DEG * this.erect
    const slow = this.slow.step(input.head.slow.yaw)
    const trunkUpper = 0.25 * slow[0]
    const trunkMid = 0.12 * slow[1]
    const headGain = input.gaze.kind === 'free' ? 1 : 0.6
    out[12] += trunkUpper * headGain
    out[9] += trunkMid * headGain
    for (let axis = 0; axis < 3; axis++) {
      let target = input.head.attitude[axes[axis]]
      for (const term of headTerms)
        target += input.head.terms[term][axes[axis]]
      advanceSecondOrder(this.attitude[axis], target * headGain, this.attitudeCoefficients)
      const attitude = this.attitude[axis].y - (axis === 0 ? (trunkUpper + trunkMid) * headGain : 0)
      const neck = this.attitudeNeck[axis].step(0.35 * attitude)[0]
      out[15 + axis] += neck
      out[18 + axis] += attitude - neck
    }
  }
}
