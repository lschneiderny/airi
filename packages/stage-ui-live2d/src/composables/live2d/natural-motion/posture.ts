import type { RandomStream } from './random'

import { FilteredOu, minJerk, softLimit } from './processes'
import { truncatedLognormal, unitVector3 } from './random'

/** Head axes in normalized model units: X yaw, Y pitch, Z roll. */
export type Vec3 = [number, number, number]

/** Rest posture `mu`. The product home faces the camera slightly downward. */
export const postureHomes = {
  product: [0, -0.1, 0],
  // Desk calibration fixture: matches the reference recording, used by the liveliness gate only.
  // Tuned X from the -0.14 starting value to -0.19, the reference midpoint of X p5/p95
  // ((-20.1 + 8.8) / 2 / 30); at -0.14 the gate failed X p5 (-13.9 to -16.9 vs <= -16.1).
  desk: [-0.19, -0.55, 0],
} satisfies Record<string, Vec3>

export type PostureHome = keyof typeof postureHomes

/** One independent stream per process, so retuning one layer never reshuffles another. */
export interface PostureStreams {
  drift: RandomStream
  continuous: RandomStream
  gain: RandomStream
  shift: RandomStream
}

// Per-axis shift gains: yaw dominates, roll stays small. Tuned from (1, 0.8, 0.3):
// X 1.15 reaches the reference X p5; Y 0.7 keeps desk-home pitch under the 1% near-limit
// hard limit (pitch reached 1.7-3.1% near-limit at 0.8).
const shiftAxisGain: Vec3 = [1.15, 0.7, 0.3]

/**
 * Head posture as `h = softLimit(mu + b + amplitude * (g * n + r) + bias)` per axis.
 *
 * - `b`: slow home drift (OU, tau 90 s, 5 s filter).
 * - `n`: continuous sub-second motion (filtered OU) scaled by gain `g = 0.3 + 1.3 sigmoid(2e)`,
 *   where `e` is a unit OU (6 s) filtered over 0.6 s, so activity waxes and wanes.
 * - `r`: heavy-tailed posture shifts. Each shift moves `r` to `0.7 r + A diag(1, 0.8, 0.3) d`
 *   along a min-jerk path, then holds; there is no overshoot.
 *
 * Time is seconds of active (unsuspended) motion. Callers step with small `dt`
 * (the facade uses 1/120 s) because the filters use a zero-order hold.
 */
export class NaturalPostureLayers {
  /** Multiplies continuous motion and shifts; state presets drive it in a later layer. @default 1 */
  amplitudeScale = 1
  /** Divides shift hold durations; state presets drive it in a later layer. @default 1 */
  shiftRateScale = 1
  /** Increments when a posture shift begins, so coordinated layers can react. */
  shiftCount = 0

  private readonly drift: FilteredOu[]
  private readonly continuous: FilteredOu[]
  private readonly energy: FilteredOu
  private readonly shiftRandom: RandomStream
  private time = 0
  private shiftFrom: Vec3 = [0, 0, 0]
  private shiftTo: Vec3 = [0, 0, 0]
  private shiftStart = 0
  private shiftDuration = 0
  private nextShiftAt: number
  /** Seconds taken from the pending hold by `advanceShift`, returned to the hold after the advanced shift. */
  private holdCarry = 0

  constructor(private readonly home: Vec3, streams: PostureStreams) {
    this.drift = [0.08, 0.12, 0.025].map(sd => new FilteredOu(streams.drift, sd, 90, 5))
    this.continuous = [
      new FilteredOu(streams.continuous, 0.012, 0.20, 0.07),
      new FilteredOu(streams.continuous, 0.010, 0.24, 0.08),
      new FilteredOu(streams.continuous, 0.005, 0.32, 0.10),
    ]
    this.energy = new FilteredOu(streams.gain, 1, 6, 0.6)
    this.shiftRandom = streams.shift
    this.nextShiftAt = this.drawHold()
  }

  /** Destination of the latest posture shift, relative to the drifting home. */
  get shiftTarget(): Readonly<Vec3> {
    return this.shiftTo
  }

  /** Active seconds until the next posture shift begins. */
  get secondsUntilShift() {
    return this.nextShiftAt - this.time
  }

  /** Delays the next shift start, so a coordinated gaze shift can lead it. Later holds keep their drawn durations. */
  postponeShift(seconds: number) {
    this.nextShiftAt += seconds
  }

  /**
   * Starts the next shift up to `seconds` earlier, never before now, so a speech onset can lead it.
   * The advanced time is added to the hold after that shift, so the long-run shift rate is unchanged:
   * shifts move earlier, they are never added.
   */
  advanceShift(seconds: number) {
    const advanced = Math.max(0, Math.min(seconds, this.nextShiftAt - this.time))
    this.nextShiftAt -= advanced
    this.holdCarry += advanced
  }

  /** Advances all processes by `dt` seconds and returns the limited head pose. */
  step(dt: number, bias: Vec3 = [0, 0, 0]): Vec3 {
    this.time += dt
    while (this.time >= this.nextShiftAt)
      this.beginShift(this.nextShiftAt)
    const gain = 0.3 + 1.3 / (1 + Math.exp(-2 * this.energy.step(dt)))
    const shift = this.shiftAt(this.time)
    return [0, 1, 2].map((axis) => {
      const drift = this.drift[axis].step(dt)
      const continuous = this.continuous[axis].step(dt)
      return softLimit(this.home[axis] + drift + this.amplitudeScale * (gain * continuous + shift[axis]) + bias[axis])
    }) as Vec3
  }

  private shiftAt(time: number): Vec3 {
    if (this.shiftDuration === 0 || time >= this.shiftStart + this.shiftDuration)
      return this.shiftTo
    const progress = minJerk((time - this.shiftStart) / this.shiftDuration)
    return this.shiftFrom.map((from, axis) => from + (this.shiftTo[axis] - from) * progress) as Vec3
  }

  private beginShift(at: number) {
    const from = this.shiftAt(at)
    const amplitude = truncatedLognormal(this.shiftRandom, 0.22, 0.7, 0.025, 0.75)
    const direction = unitVector3(this.shiftRandom)
    const to = from.map((value, axis) => 0.7 * value + amplitude * shiftAxisGain[axis] * direction[axis]) as Vec3
    // Larger moves take longer: 0.22 s plus a square-root term of the travelled distance.
    const distance = Math.hypot(...to.map((value, axis) => value - from[axis]))
    this.shiftFrom = from
    this.shiftTo = to
    this.shiftStart = at
    this.shiftDuration = 0.22 + 0.4 * Math.sqrt(distance / 0.35)
    this.nextShiftAt = at + this.shiftDuration + this.drawHold() + this.holdCarry
    this.holdCarry = 0
    this.shiftCount++
  }

  private drawHold() {
    return (0.35 + truncatedLognormal(this.shiftRandom, 1.6, 0.65, 0.15, 9.65)) / this.shiftRateScale
  }
}
