import type { RandomStream } from './random'

import { FilteredOu, minJerk, softLimit } from './processes'
import { gaussian, truncatedLognormal, unitVector3 } from './random'

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
  /** Slow activity regime that modulates shift rate and size; see `NaturalPostureLayers`. */
  regime: RandomStream
}

// Per-axis shift gains, tuned from (1, 0.8, 0.3). Y 0.7 keeps desk-home pitch under the 1% near-limit (0.8 reached
// 1.7-3.1%). X 1.05 (1.15 before the activity spells) keeps angleXp95 in band on every gate seed while X p5 still
// reaches the reference.
const shiftAxisGain: Vec3 = [1.05, 0.7, 0.3]
/** Largest normalized `|home + shift target|` per axis; drift and continuous motion still add on top. */
const shiftTargetLimit = 0.75
/** Regime samples kept for nominal-time reads: 20 s at the facade's 120 Hz grid. */
const regimeHistory = 2400

/** Continuous-motion gain for activity `e`. Floor tuned from 0.3: quiet spells reach true stillness (still05 at least 0.02) as in the recordings. */
function activityGain(e: number) {
  return 0.2 + 1.3 / (1 + Math.exp(-2 * e))
}

/**
 * Head posture as `h = softLimit(mu + b + amplitude * (g * n + r) + bias)` per axis.
 *
 * - `b`: slow home drift (OU, tau 90 s, 5 s filter).
 * - `n`: continuous sub-second motion (filtered OU) scaled by gain `g = 0.2 + 1.3 sigmoid(2e)`,
 *   where `e` is a unit OU (6 s) filtered over 0.6 s, so activity waxes and wanes. `g` moves only
 *   while a shift moves, easing from its held value to the live value along the shift's min-jerk
 *   progress, and holds between shifts, so a held pose never starts shivering mid-hold.
 * - `r`: heavy-tailed posture shifts. Each shift moves `r` to `0.7 r + A diag(1.05, 0.7, 0.3) d`,
 *   clamped so `|mu + r|` stays within 0.75, along a min-jerk path, then holds; there is no overshoot.
 * - Activity spells: a unit OU `x` (tau 120 s) on its own stream sets `rate = exp(0.8 x - 0.32)` and
 *   `amp = exp(0.45 x - 0.10125)`, both mean 1. At each shift start the next hold is divided by `rate` and the
 *   shift amplitude multiplied by `amp`. Shift draws and continuous motion are unchanged, so spells only
 *   reshape when and how far the head moves.
 * - Moved shifts keep the schedule: time taken by `advanceShift` or added by `postponeShift` is returned
 *   through the following holds, and the regime is read at each shift's nominal time (its start without
 *   those moves). Two same-seed runs that differ only by a postponement therefore realign after it.
 *
 * Time is seconds of active (unsuspended) motion. Callers step with small `dt`
 * (the facade uses 1/120 s) because the filters use a zero-order hold.
 */
export class NaturalPostureLayers {
  /** Multiplies continuous motion and shifts; state presets drive it in a later layer. @default 1 */
  amplitudeScale = 1
  /** Divides shift hold durations; state presets drive it in a later layer. @default 1 */
  shiftRateScale = 1
  /**
   * Multiplies the continuous motion term only, not drift or shifts. The facade ducks it under emotion
   * gesture clips so a clip is not masked by idle jitter. @default 1
   */
  continuousScale = 1
  /** Increments when a posture shift begins, so coordinated layers can react. */
  shiftCount = 0

  private readonly drift: FilteredOu[]
  private readonly continuous: FilteredOu[]
  private readonly energy: FilteredOu
  private readonly shiftRandom: RandomStream
  private readonly regime: FilteredOu
  private readonly regimeRateSd: number
  private readonly regimeAmpSd: number
  /** Recent regime values and their times, newest at `regimeHead`, for reads at a shift's nominal time. */
  private readonly regimeTimes = new Float64Array(regimeHistory)
  private readonly regimeValues = new Float64Array(regimeHistory)
  private regimeHead = -1
  private regimeCount = 0
  private time = 0
  private shiftFrom: Vec3 = [0, 0, 0]
  private shiftTo: Vec3 = [0, 0, 0]
  private shiftStart = 0
  private shiftDuration = 0
  private nextShiftAt: number
  /** Net seconds owed to the following holds: positive after `advanceShift`, negative after `postponeShift`. */
  private holdCarry = 0
  /** Continuous-motion gain applied now; it changes only while a shift moves. Starts at the gain of `e = 0`. */
  private gain = activityGain(0)
  /** `gain` when the current shift began, the start of its ease toward the live gain. */
  private shiftStartGain = this.gain
  private slow: Vec3

  /** `options.regime` sets the log SDs of the activity spells' rate and amplitude factors; both 0 make it neutral. */
  constructor(private readonly home: Vec3, streams: PostureStreams, options: { regime?: { rateSd: number, ampSd: number } } = {}) {
    this.regimeRateSd = options.regime?.rateSd ?? 0.8
    this.regimeAmpSd = options.regime?.ampSd ?? 0.45
    this.drift = [0.08, 0.12, 0.025].map(sd => new FilteredOu(streams.drift, sd, 90, 5))
    this.continuous = [
      // Retuned from (0.012, 0.20, 0.06), (0.010, 0.24, 0.07), (0.005, 0.32, 0.09): sd x1.6, tau x5, filterTau x2.
      // The old correlation time reversed yaw 3.9 times as often as the desk recordings; this brings it to about
      // 1.4x (research C40, arm R4).
      new FilteredOu(streams.continuous, 0.0192, 1.00, 0.12),
      new FilteredOu(streams.continuous, 0.016, 1.20, 0.14),
      new FilteredOu(streams.continuous, 0.008, 1.60, 0.18),
    ]
    this.energy = new FilteredOu(streams.gain, 1, 6, 0.6)
    this.shiftRandom = streams.shift
    this.regime = new FilteredOu(streams.regime, 1, 120)
    this.slow = [...home]
    this.nextShiftAt = this.drawHold()
  }

  /** Destination of the latest posture shift, relative to the drifting home. */
  get shiftTarget(): Readonly<Vec3> {
    return this.shiftTo
  }

  /**
   * The pose of the latest `step`, with only the continuous term removed: `softLimit(mu + b + amplitude * r + bias)`
   * per axis. The eyes counter-rotate for this pose, not for the sub-second wobble, which they ignore.
   * Read it after `step` for the same grid step; before the first `step` it is the home pose.
   */
  get slowPose(): Readonly<Vec3> {
    return this.slow
  }

  /** Active seconds until the next posture shift begins. */
  get secondsUntilShift() {
    return this.nextShiftAt - this.time
  }

  /**
   * Delays the next shift start, so a coordinated gaze shift or a gesture can go first. The delay is taken back
   * out of the following holds (none drops below zero), so the schedule realigns and the long-run rate is unchanged.
   */
  postponeShift(seconds: number) {
    this.nextShiftAt += seconds
    this.holdCarry -= seconds
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
    // One gaussian per step on the regime stream, whatever the shift timing.
    this.regimeHead = (this.regimeHead + 1) % regimeHistory
    this.regimeTimes[this.regimeHead] = this.time
    this.regimeValues[this.regimeHead] = this.regime.step(dt)
    this.regimeCount = Math.min(regimeHistory, this.regimeCount + 1)
    while (this.time >= this.nextShiftAt)
      this.beginShift(this.nextShiftAt)
    // The activity process steps every frame so its random stream never depends on shift timing.
    const liveGain = activityGain(this.energy.step(dt))
    if (this.shiftDuration > 0 && this.time < this.shiftStart + this.shiftDuration)
      this.gain = this.shiftStartGain + (liveGain - this.shiftStartGain) * minJerk((this.time - this.shiftStart) / this.shiftDuration)
    const gain = this.gain
    const shift = this.shiftAt(this.time)
    const slow: Vec3 = [0, 0, 0]
    const pose = [0, 1, 2].map((axis) => {
      const drift = this.drift[axis].step(dt)
      const continuous = this.continuous[axis].step(dt)
      slow[axis] = softLimit(this.home[axis] + drift + this.amplitudeScale * shift[axis] + bias[axis])
      return softLimit(this.home[axis] + drift + this.amplitudeScale * (this.continuousScale * gain * continuous + shift[axis]) + bias[axis])
    }) as Vec3
    this.slow = slow
    return pose
  }

  private shiftAt(time: number): Vec3 {
    if (this.shiftDuration === 0 || time >= this.shiftStart + this.shiftDuration)
      return this.shiftTo
    const progress = minJerk((time - this.shiftStart) / this.shiftDuration)
    return this.shiftFrom.map((from, axis) => from + (this.shiftTo[axis] - from) * progress) as Vec3
  }

  /** The latest regime value at or before `time`, clamped to the stored history. */
  private regimeAt(time: number) {
    let index = this.regimeHead
    for (let back = 1; back < this.regimeCount && this.regimeTimes[index] > time; back++)
      index = (this.regimeHead - back + regimeHistory) % regimeHistory
    return this.regimeCount ? this.regimeValues[index] : 0
  }

  private beginShift(at: number) {
    const from = this.shiftAt(at)
    const x = this.regimeAt(at + this.holdCarry)
    const regimeRate = Math.exp(this.regimeRateSd * x - this.regimeRateSd ** 2 / 2)
    const regimeAmp = Math.exp(this.regimeAmpSd * x - this.regimeAmpSd ** 2 / 2)
    // Amplitude tuned from median 0.22, log SD 0.7, max 0.75: the wider draw raises speed-peak log
    // asymmetry from about 1.2 toward the recordings' 1.5-2.0, and the lower median keeps rare large
    // shifts from inflating total power, which would push detrended jitter below its band.
    const amplitude = truncatedLognormal(this.shiftRandom, 0.18, 1, 0.025, 1) * regimeAmp
    const direction = unitVector3(this.shiftRandom)
    // The heavier tail would push the desk-home pitch into the head limit (above 1% near-limit), so each
    // target is clamped to within shiftTargetLimit of center, inside the softLimit knee.
    const to = from.map((value, axis) => Math.min(shiftTargetLimit - this.home[axis], Math.max(-shiftTargetLimit - this.home[axis], 0.7 * value + amplitude * shiftAxisGain[axis] * direction[axis]))) as Vec3
    // Larger moves take longer. Tuned from 0.22 + 0.4 sqrt on rendered rigs: the flatter curve keeps
    // peak speed nearer linear in distance, which restores the speed-peak tail (Bear measured 0.79
    // log asymmetry against the 1.05 floor), and the longer floor trims shift-driven jitter outliers.
    const distance = Math.hypot(...to.map((value, axis) => value - from[axis]))
    this.shiftFrom = from
    this.shiftTo = to
    this.shiftStartGain = this.gain
    this.shiftStart = at
    this.shiftDuration = 0.35 + 0.25 * Math.sqrt(distance / 0.35)
    const hold = this.drawHold() / regimeRate + this.holdCarry
    // A postponement longer than this hold carries the rest to the next one.
    this.holdCarry = Math.min(0, hold)
    this.nextShiftAt = at + this.shiftDuration + Math.max(0, hold)
    this.shiftCount++
  }

  /**
   * Hold before the next shift: lognormal with log-median -0.82 and log SD 1.02, clamped to [0.1, 15] s, divided by
   * 1.5 and by `shiftRateScale`. The distribution is fitted to Luke's desk recordings, with moves above 2 deg/s
   * merged across gaps under 0.1 s (holds median 0.37 s). One gaussian, so exactly two uniforms per hold.
   */
  private drawHold() {
    return Math.min(15, Math.max(0.1, Math.exp(-0.82 + 1.02 * gaussian(this.shiftRandom)))) / (1.5 * this.shiftRateScale)
  }
}
