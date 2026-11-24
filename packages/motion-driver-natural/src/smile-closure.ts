import type { RandomStream } from './random'

import { gaussian } from './random'

/** Closures per minute at pep 1 and full valence. */
const MAX_RATE_PER_MINUTE = 6
/** Mood valence at or below which no closure is due. */
const VALENCE_FLOOR = 0.15
/** Mood valence at or above which the rate is full. */
const VALENCE_FULL = 0.65
/** Seconds: median length of a closure, before its ease out. */
const DURATION_MEDIAN = 0.7
/** Log-space SD of the closure length. */
const DURATION_LOG_SD = 0.45
/** Seconds: shortest and longest closure. */
const DURATION_MIN = 0.35
const DURATION_MAX = 1.6
/** Seconds: the eyes close into the smile over this time. */
const EASE_IN_SECONDS = 0.12
/** Seconds: the eyes reopen over this time after the closure's length. */
const EASE_OUT_SECONDS = 0.2
/** Eye smile units added at full closure. */
const EYE_SMILE = 0.5
/** Share of the lid closed at full closure, applied through the blink factor. */
const LID_CLOSE = 0.9

export interface NaturalSmileClosureInput {
  /** Eased pep in [0, 1]. */
  pep: number
  /** Natural's mood valence. */
  valence: number
  /** True while a closure must not start; a closure due then is dropped, not queued. */
  blocked: boolean
}

export interface NaturalSmileClosureOutput {
  eyeSmile: number
  lidClose: number
}

const rest: Readonly<NaturalSmileClosureOutput> = { eyeSmile: 0, lidClose: 0 }

function smoothstep(u: number) {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

/**
 * Pep's closed-eye smile. Closures fall due as a Poisson process of rate `6 per minute x pep x valence share`, where
 * the share rises from 0 at valence 0.15 to 1 at 0.65. Each due closure draws three uniforms (the next due threshold
 * and a lognormal length) whether it starts or not. One that falls due while blocked or while another runs is dropped.
 *
 * The layer steps every grid step, so its draws depend only on time and the inputs; at pep 0 nothing falls due.
 */
export class NaturalSmileClosure {
  /** Increments at every closure start. */
  startCount = 0
  /** Increments at every due closure that was dropped. */
  dropCount = 0
  private hazard = 0
  private threshold: number
  private age = 0
  private duration = 0
  private running = false

  constructor(private readonly random: RandomStream, private readonly dt: number) {
    this.threshold = this.drawThreshold()
  }

  /** Advances one grid step and returns the closure at its end. */
  step(input: NaturalSmileClosureInput): Readonly<NaturalSmileClosureOutput> {
    const share = smoothstep((input.valence - VALENCE_FLOOR) / (VALENCE_FULL - VALENCE_FLOOR))
    const rate = MAX_RATE_PER_MINUTE / 60 * input.pep * share
    if (rate > 0)
      this.hazard += rate * this.dt
    if (this.running) {
      this.age += this.dt
      if (this.age >= this.duration + EASE_OUT_SECONDS)
        this.running = false
    }
    if (this.hazard >= this.threshold) {
      this.hazard = 0
      this.threshold = this.drawThreshold()
      const duration = Math.max(DURATION_MIN, Math.min(DURATION_MAX, DURATION_MEDIAN * Math.exp(DURATION_LOG_SD * gaussian(this.random))))
      if (input.blocked || this.running) {
        this.dropCount++
      }
      else {
        this.startCount++
        this.running = true
        this.age = 0
        this.duration = duration
      }
    }
    if (!this.running)
      return rest
    const level = smoothstep(this.age / EASE_IN_SECONDS) * (1 - smoothstep((this.age - this.duration) / EASE_OUT_SECONDS))
    return { eyeSmile: EYE_SMILE * level, lidClose: LID_CLOSE * level }
  }

  private drawThreshold() {
    return -Math.log(1 - this.random())
  }
}
