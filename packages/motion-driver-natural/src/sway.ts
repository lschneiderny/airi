import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { SecondOrderFollower } from './processes'
import { gaussian } from './random'

/** Probability that a new swing leans to the other side than the previous one. */
const SIDE_CHANGE_PROBABILITY = 0.75
/** Normalized head-roll units (1 is 30 degrees on Live2D): median lean target of a swing. */
const SWING_SIZE_MEDIAN = 0.15
/** Log-space SD of the swing size. */
const SWING_SIZE_LOG_SD = 0.35
/** Standard deviations: the size and interval draws are clamped to this many, so no swing is extreme. */
const DRAW_CLAMP = 2.5
/** Seconds: median interval between swings while she talks. */
const TALK_INTERVAL_MEDIAN = 0.75
/** Seconds: median interval between swings while she is silent. */
const QUIET_INTERVAL_MEDIAN = 1.6
/** Log-space SD of the swing interval. */
const INTERVAL_LOG_SD = 0.35
/** Seconds: a speech onset starts the next swing only when the running swing is at least this old. */
const ONSET_MIN_AGE = 0.3
/** Hz and damping ratio of the body lean follower: a fast attack, an overshoot and a slow settle. */
const LEAN_HZ = 1.1
const LEAN_ZETA = 0.55
/** Hz and damping ratio of the head tilt follower, faster than the lean, so the head trails the torso. */
const HEAD_HZ = 1.8
const HEAD_ZETA = 0.7
/** Hz and damping ratio of the head pitch dip each swing start kicks. */
const DIP_HZ = 2
const DIP_ZETA = 0.7
/** Seconds: the dip follower's target is held down this long at a swing start, then released, so it dips and recovers. */
const DIP_PULSE_SECONDS = 0.12
/** Normalized head-pitch units: dip peak of a swing that travels from one median lean to the other side's. */
const DIP_PEAK = 0.06
/** Unitless cap on the dip of a large swing, in multiples of `DIP_PEAK`. */
const DIP_TRAVEL_MAX = 2
/** Normalized head-roll units per unit of trailing head tilt. */
const HEAD_ROLL_GAIN = 1
/** Head yaw per unit of head roll: a small counter turn. */
const COUNTER_YAW = -0.2
/** Normalized body-roll units per unit of lean. */
const BODY_ROLL_GAIN = 1
/** Share of the head pitch dip the body pitch takes. */
const BODY_DIP_SHARE = 0.5
/** Unitless cap on the posture amplitude scale the sway takes. */
const MAX_AMPLITUDE = 2
/** Seconds: the amplitude and duck factor eases with this time constant, so a jump in either never pops. */
const GAIN_EASE_SECONDS = 0.15

const zero: Readonly<Vec3> = [0, 0, 0]

export interface NaturalSwayInput {
  /** Whether she talks: onsets start swings, and swings come at the talking interval. */
  talking: boolean
  /** `NaturalSpeechEmphasis.onsetCount`; a change is a fresh onset. */
  onsetCount: number
  /** Eased pep in [0, 1]. */
  pep: number
  /** The posture amplitude scale after every modulation of the step. */
  amplitude: number
  /** The posture continuous scale: steps back under gesture clips, cue gestures and idle acts. */
  duck: number
}

export interface NaturalSwayOutput {
  /** Additive head term, yaw, pitch, roll in normalized units. */
  head: Readonly<Vec3>
  /** Additive body term, yaw, pitch, roll in normalized units. */
  body: Readonly<Vec3>
}

/**
 * Pep's whole-upper-body sway. A scheduler draws swings, each a side, a size and the interval to the next, from five
 * uniforms (one side, two size, two interval) whatever the values, so the stream position depends only on the number
 * of swings. While she talks a fresh speech onset starts the next swing at once when the running one is at least
 * 0.3 s old. The lean follows the swing target through an underdamped follower, the head tilt trails the lean
 * through a faster one, and each swing start kicks a pitch dip that recovers.
 *
 * The layer steps every grid step whatever the weight, so its draws depend only on time and the inputs. The weight is
 * `pep x min(amplitude, 2) x duck`, the last two eased; at pep 0 both outputs are exactly zero.
 */
export class NaturalSwayLayer {
  /** Increments at every swing start. */
  swingCount = 0
  private readonly lean: SecondOrderFollower
  private readonly head: SecondOrderFollower
  private readonly dip: SecondOrderFollower
  private readonly gainEase: number
  private gain = 1
  private target = 0
  private side: -1 | 1 = 1
  private age = 0
  private intervalZ: number
  private seenOnsets = 0
  /** Target of the dip follower while its pulse holds; 0 after it. */
  private dipTarget = 0
  /** Peak of the dip follower's response to a unit pulse, so `DIP_PEAK` is the dip's peak. */
  private readonly dipPeakPerUnit: number

  constructor(private readonly random: RandomStream, private readonly dt: number) {
    this.lean = new SecondOrderFollower(LEAN_HZ, LEAN_ZETA, dt)
    this.head = new SecondOrderFollower(HEAD_HZ, HEAD_ZETA, dt)
    this.dip = new SecondOrderFollower(DIP_HZ, DIP_ZETA, dt)
    this.gainEase = 1 - Math.exp(-dt / GAIN_EASE_SECONDS)
    this.intervalZ = this.drawZ()
    const probe = new SecondOrderFollower(DIP_HZ, DIP_ZETA, dt)
    let peak = 0
    for (let i = 0; i < 2 / dt; i++)
      peak = Math.max(peak, probe.step(i * dt < DIP_PULSE_SECONDS ? 1 : 0))
    this.dipPeakPerUnit = peak
  }

  /** Advances one grid step and returns the weighted head and body terms. */
  step(input: NaturalSwayInput): NaturalSwayOutput {
    this.age += this.dt
    const fresh = input.onsetCount !== this.seenOnsets
    this.seenOnsets = input.onsetCount
    const interval = (input.talking ? TALK_INTERVAL_MEDIAN : QUIET_INTERVAL_MEDIAN) * Math.exp(INTERVAL_LOG_SD * this.intervalZ)
    if ((input.talking && fresh && this.age >= ONSET_MIN_AGE) || this.age >= interval)
      this.startSwing()
    const lean = this.lean.step(this.target)
    const tilt = this.head.step(lean)
    const dip = this.dip.step(this.age < DIP_PULSE_SECONDS ? this.dipTarget : 0)
    this.gain += (Math.min(MAX_AMPLITUDE, input.amplitude) * input.duck - this.gain) * this.gainEase
    const weight = input.pep * this.gain
    if (weight === 0)
      return { head: zero, body: zero }
    const roll = weight * HEAD_ROLL_GAIN * tilt
    return {
      head: [COUNTER_YAW * roll, -weight * dip, roll],
      body: [0, -weight * BODY_DIP_SHARE * dip, weight * BODY_ROLL_GAIN * lean],
    }
  }

  private startSwing() {
    this.swingCount++
    this.age = 0
    // Fixed draw order and count: side, size, interval.
    const change = this.random() < SIDE_CHANGE_PROBABILITY
    const size = SWING_SIZE_MEDIAN * Math.exp(SWING_SIZE_LOG_SD * this.drawZ())
    this.intervalZ = this.drawZ()
    if (change)
      this.side = this.side === 1 ? -1 : 1
    const next = this.side * size
    const travel = Math.min(DIP_TRAVEL_MAX, Math.abs(next - this.target) / (2 * SWING_SIZE_MEDIAN))
    this.target = next
    this.dipTarget = DIP_PEAK * travel / this.dipPeakPerUnit
  }

  private drawZ() {
    return Math.max(-DRAW_CLAMP, Math.min(DRAW_CLAMP, gaussian(this.random)))
  }
}
