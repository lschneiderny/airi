import type { RandomStream } from './random'

import { largeGazeShift } from './blink'
import { FilteredOu } from './processes'

/**
 * Face micro-activity offsets in normalized parameter units. The adapter adds the
 * offsets to the rig defaults and multiplies eye openness, applying its eyelid floor.
 */
export interface NaturalFaceOutput {
  /** Multiplies eye openness; 1 leaves the lids untouched. */
  eyeOpenMultiplier: number
  /**
   * Additive eye openness from emotion impulses; the idle face keeps it at 0.
   * The adapter adds it after the multiplier and skips it on expression-closed eyes.
   */
  eyeOpenHint: number
  /** Shared brow offsets; the per-side values add tiny independent asymmetry. */
  browY: number
  browAngle: number
  browLY: number
  browRY: number
  browLAngle: number
  browRAngle: number
  /** Reserved for emotion impulses; the idle face keeps them at 0. */
  eyeSmile: number
  mouthForm: number
  /** Additive mouth opening during silence; always 0 while speech is active or recent. */
  silentMouthOpen: number
  /** Reserved for emotion impulses; the idle face keeps them at 0. */
  cheek: number
}

// Shared brow OU SD, tuned toward the recording, whose ParamBrowLY SD is 0.0435 (reference
// band floor 0.0304). With the 0.005 per-side term the gate measures about 0.043; at 0.025
// it measured 0.025-0.026 and failed the band.
const browSd = 0.043
const browSideSd = 0.005

// Mean rate of silent mouth openings (per second) and their shape.
const silentOpenRate = 1 / 40
const silentOpenPeak = { min: 0.02, max: 0.06 }
const silentOpenDuration = { min: 0.6, max: 1.4 }
// Brief lid narrowing on a share of large gaze shifts.
const narrowingShare = 0.2
const narrowingDepth = 0.06
const narrowingDuration = 0.25

/** Softening width of the lid multiplier's smooth abs; see `lidSoftAbs`. */
export const lidSoftness = 0.3
/**
 * Smooth stand-in for abs(q): `a * hypot(q, lidSoftness) + b`. For a unit-normal q it has the
 * same mean (sqrt(2/pi)) and SD (sqrt(1 - 2/pi)) as abs(q) but no kink at q = 0.
 */
export const lidSoftAbs = { a: 1.0944891587143082, b: -0.1728563303774483 }

interface Pulse {
  start: number
  duration: number
  peak: number
}

/** Raised-cosine pulse value at `time`; 0 outside the pulse. */
function pulseAt(pulse: Pulse | null, time: number) {
  if (!pulse || time < pulse.start || time >= pulse.start + pulse.duration)
    return 0
  return pulse.peak * 0.5 * (1 - Math.cos(2 * Math.PI * (time - pulse.start) / pulse.duration))
}

/**
 * Slow face micro-activity that keeps an idle face from looking frozen.
 *
 * - Brow Y and brow angle: filtered OU (SD 0.043, tau 3 s, 0.5 s filter), plus a
 *   per-side OU (SD 0.005) for L/R asymmetry.
 * - Mouth form: filtered OU (SD 0.04, tau 4 s, 0.3 s filter), so no frame-rate flicker.
 * - Silent mouth opening: Poisson events at 1 per 40 s, raised-cosine envelope of
 *   0.6-1.4 s, peak at most 0.06. Suppressed while `speechActiveOrRecent`.
 * - Eyelid micro: multiplier `1 - 0.04 s(q)` for a unit filtered OU `q` (tau 2 s, 0.3 s filter)
 *   with the smooth abs `s` (`lidSoftAbs`), and a
 *   -0.06 narrowing over 250 ms on 20% of gaze shifts above 0.15 normalized.
 *
 * Time is seconds of active motion; callers step on a fixed grid.
 */
export class NaturalFaceLayer {
  /** Set by the facade from voice activity; lipsync owns the mouth while true. @default false */
  speechActiveOrRecent = false

  private readonly browY: FilteredOu
  private readonly browAngle: FilteredOu
  private readonly browSide: FilteredOu[]
  private readonly mouthForm: FilteredOu
  private readonly lid: FilteredOu
  private time = 0
  private nextSilentOpenAt: number
  private silentOpen: Pulse | null = null
  private narrowing: Pulse | null = null
  private current: NaturalFaceOutput = NaturalFaceLayer.rest()

  constructor(private readonly random: RandomStream) {
    this.browY = new FilteredOu(random, browSd, 3, 0.5)
    this.browAngle = new FilteredOu(random, browSd, 3, 0.5)
    // Order: left Y, right Y, left angle, right angle.
    this.browSide = [0, 1, 2, 3].map(() => new FilteredOu(random, browSideSd, 3, 0.5))
    this.mouthForm = new FilteredOu(random, 0.04, 4, 0.3)
    this.lid = new FilteredOu(random, 1, 2, 0.3)
    this.nextSilentOpenAt = this.drawWait()
  }

  /** Neutral output: no offsets, eyes fully open. */
  static rest(): NaturalFaceOutput {
    return { eyeOpenMultiplier: 1, eyeOpenHint: 0, browY: 0, browAngle: 0, browLY: 0, browRY: 0, browLAngle: 0, browRAngle: 0, eyeSmile: 0, mouthForm: 0, silentMouthOpen: 0, cheek: 0 }
  }

  get output(): NaturalFaceOutput {
    return this.current
  }

  /** Reports a gaze shift of `size` normalized eye-space units at the current time. */
  onGazeShift(size: number) {
    if (size <= largeGazeShift || this.random() >= narrowingShare)
      return
    this.narrowing = { start: this.time, duration: narrowingDuration, peak: narrowingDepth }
  }

  /** Advances by `dt` seconds and returns the face offsets. */
  step(dt: number): NaturalFaceOutput {
    this.time += dt
    while (this.time >= this.nextSilentOpenAt) {
      // Events drawn during speech are dropped, so silence never replays a backlog.
      if (!this.speechActiveOrRecent) {
        const duration = silentOpenDuration.min + (silentOpenDuration.max - silentOpenDuration.min) * this.random()
        const peak = silentOpenPeak.min + (silentOpenPeak.max - silentOpenPeak.min) * this.random()
        this.silentOpen = { start: this.nextSilentOpenAt, duration, peak }
      }
      this.nextSilentOpenAt += this.drawWait()
    }
    if (this.speechActiveOrRecent)
      this.silentOpen = null
    const browY = this.browY.step(dt)
    const browAngle = this.browAngle.step(dt)
    const [leftY, rightY, leftAngle, rightAngle] = this.browSide.map(side => side.step(dt))
    this.current = {
      eyeOpenMultiplier: (1 - 0.04 * (lidSoftAbs.a * Math.hypot(this.lid.step(dt), lidSoftness) + lidSoftAbs.b)) * (1 - pulseAt(this.narrowing, this.time)),
      eyeOpenHint: 0,
      browY,
      browAngle,
      browLY: browY + leftY,
      browRY: browY + rightY,
      browLAngle: browAngle + leftAngle,
      browRAngle: browAngle + rightAngle,
      eyeSmile: 0,
      mouthForm: this.mouthForm.step(dt),
      silentMouthOpen: pulseAt(this.silentOpen, this.time),
      cheek: 0,
    }
    return this.current
  }

  private drawWait() {
    // Exponential waiting time of a Poisson process.
    return -Math.log(1 - this.random()) / silentOpenRate
  }
}
