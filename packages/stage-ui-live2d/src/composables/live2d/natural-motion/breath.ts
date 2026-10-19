import type { RandomStream } from './random'

import { gaussian } from './random'

export interface NaturalBreathOutput {
  /** ParamBreath value in [0, 1]. */
  value: number
  /** Normalized head pitch offset, at most 0.003 in magnitude; the facade adds it to head Y. */
  headY: number
}

const center = 0.45
const amplitude = 0.12
// Head coupling is 0.001 normalized. Couplings of 0.003 and 0.0015 added a pitch-speed ripple
// that lowered seed 1 speedPeakLogAsymmetry of the liveliness gate below its 1.0509 floor.
const headCoupling = 0.001
// The period wanders around 4.8 s as an OU on its logarithm (SD 0.15, tau 20 s).
// The free OU leaves 3.5-6.5 s about 4% of the time, so the log-period reflects at
// those bounds: the path stays continuous and keeps wandering instead of sticking to a clamp.
const medianPeriod = 4.8
const logPeriodSd = 0.15
const logPeriodTau = 20
const logPeriodLimits = { min: Math.log(3.5 / medianPeriod), max: Math.log(6.5 / medianPeriod) }
// Speaking shallows the breath; the amplitude eases over this time constant so a
// voice change never jumps ParamBreath.
const speakingScale = 0.6
const amplitudeTau = 0.5

/**
 * Breathing as `ParamBreath = 0.45 + 0.12 a sin(phase)`, with a wandering period
 * and amplitude scale `a` (1 idle, 0.6 while speaking). Breath is the only periodic
 * signal in natural motion; the liveliness loop detector scores head channels only.
 *
 * Time is seconds of active motion; callers step on a fixed grid.
 */
export class NaturalBreathLayer {
  /** Set by the facade from voice activity. @default false */
  speaking = false

  /** Scales the wandering period without changing its random process. @default 1 */
  periodScale = 1

  private logPeriod = 0
  private phase = 0
  private scale = 1
  private current: NaturalBreathOutput = { value: center, headY: 0 }

  constructor(private readonly random: RandomStream) {}

  get output(): NaturalBreathOutput {
    return this.current
  }

  /** Instantaneous breath period in seconds. */
  get period() {
    return medianPeriod * Math.exp(this.logPeriod)
  }

  /** Advances by `dt` seconds and returns the breath value and head coupling. */
  step(dt: number): NaturalBreathOutput {
    // Exact OU step in log space, then reflection into the limits.
    const decay = Math.exp(-dt / logPeriodTau)
    let next = decay * this.logPeriod + logPeriodSd * Math.sqrt(1 - decay * decay) * gaussian(this.random)
    if (next > logPeriodLimits.max)
      next = 2 * logPeriodLimits.max - next
    if (next < logPeriodLimits.min)
      next = 2 * logPeriodLimits.min - next
    this.logPeriod = next
    this.phase = (this.phase + 2 * Math.PI * dt / (this.period * this.periodScale)) % (2 * Math.PI)
    const target = this.speaking ? speakingScale : 1
    this.scale = target + (this.scale - target) * Math.exp(-dt / amplitudeTau)
    const wave = this.scale * Math.sin(this.phase)
    this.current = { value: center + amplitude * wave, headY: headCoupling * wave }
    return this.current
  }
}
