import type { BodyPerformanceInput } from './contracts'

import { createLagChain } from '../dynamics'
import { ARM_START, BODY_TICK, DEG, SIDES } from './channels'

/** Lung volume added by a phrase inhale before speech or at a pause. */
const PHRASE_PEAK = 0.7
/** Architecture 4c: sad's onset is one inhale at depth 1.4. */
const SIGH = 1.4

/** Phase is supplied by the mind; the body never starts an independent breath clock. */
export class BodyBreath {
  speechLift = 0
  inhales = 0
  /** Set by the performer each tick from the emotion modulation (4c breath depth), 1 at baseline. */
  depth = 1
  private speaking = false
  private quiet = 0
  private pauseConsumed = false
  private sinceInhale = Infinity
  private rise = Infinity
  private riseFrom = 0
  private phrase = 0
  private risePeak = PHRASE_PEAK
  private readonly chain = createLagChain([0.06, 0.06, 0.06, 0.04], BODY_TICK)

  /** One inhale at 1.4 times a phrase inhale, released on the following exhale (4c sad onset). */
  sigh(): void {
    this.inhales++
    this.sinceInhale = 0
    this.rise = 0
    this.riseFrom = this.phrase
    this.risePeak = SIGH * PHRASE_PEAK
  }

  step(input: BodyPerformanceInput, out: Float64Array): void {
    this.sinceInhale += BODY_TICK
    if (input.voice.slow < 0.05) {
      this.quiet += BODY_TICK
    }
    else {
      this.quiet = 0
      this.pauseConsumed = false
    }
    const start = input.voice.speaking && !this.speaking
    const pause = input.voice.speaking && this.quiet >= 0.18 && !this.pauseConsumed
    if ((start || pause) && this.sinceInhale >= 1.5) {
      this.inhales++
      this.sinceInhale = 0
      this.rise = 0
      this.riseFrom = this.phrase
      this.risePeak = PHRASE_PEAK
      this.pauseConsumed = true
    }
    this.speaking = input.voice.speaking
    const targetLift = this.speaking ? 1 : 0
    const tau = this.speaking ? 0.35 : 0.9
    this.speechLift = targetLift + (this.speechLift - targetLift) * Math.exp(-BODY_TICK / tau)
    if (this.rise < 0.28) {
      this.rise += BODY_TICK
      const progress = Math.min(1, this.rise / 0.28)
      this.phrase = this.riseFrom + (this.risePeak - this.riseFrom) * (0.5 - 0.5 * Math.cos(Math.PI * progress))
    }
    else if (input.voice.slow > 0.05 || !this.speaking) {
      this.phrase *= Math.exp(-BODY_TICK / 2.5)
    }
    const phase = input.breath.phase / (2 * Math.PI) - 0.75
    const u = phase - Math.floor(phase)
    const lung = u < 0.38
      ? 0.5 - 0.5 * Math.cos(Math.PI * u / 0.38)
      : u < 0.88
        ? 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.38) / 0.5)
        : 0
    const depth = (1 + 0.5 * Math.max(0, input.mood.arousal)) * this.depth
    const volume = depth * input.breath.scale * ((1 - 0.6 * this.speechLift) * (lung - 0.35) + this.phrase)
    const chain = this.chain.step(volume)
    out[7] -= 0.6 * DEG * volume
    out[10] -= DEG * chain[0] + 1.2 * DEG * this.speechLift
    out[13] -= 0.5 * DEG * chain[1]
    // The shoulders rise about 1.6 degrees per quiet breath (4-5 mm at the shoulder tip), enough to read at the default
    // camera; the arm counter-rotates in the same proportion so the hand hangs plumb and rides on the clavicle.
    for (const side of SIDES) {
      const start = ARM_START[side]
      out[start] += 2.2 * DEG * chain[2] + 0.8 * DEG * this.speechLift
      out[start + 1] -= 0.73 * DEG * chain[2]
      out[start + 3] -= 1.65 * DEG * chain[3]
      out[start + 5] += 0.73 * DEG * chain[3]
    }
  }
}
