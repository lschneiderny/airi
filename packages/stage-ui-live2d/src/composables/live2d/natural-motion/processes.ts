import type { RandomStream } from './random'

import { gaussian } from './random'

/**
 * Low-pass-filtered Ornstein-Uhlenbeck process with stationary SD `sd`.
 *
 * The latent `q` is unit-variance OU with time constant `tau`, stepped with the
 * exact discretization `q = e^{-dt/tau} q + sqrt(1 - e^{-2dt/tau}) xi`. The output
 * follows `dn/dt = (sd * sqrt(1 + filterTau/tau) * q - n) / filterTau`; the gain
 * compensates the variance the filter removes, so `n` keeps SD `sd`. A zero
 * `filterTau` outputs `sd * q` directly. State starts at zero (the process mean).
 */
export class FilteredOu {
  private q = 0
  value = 0

  constructor(
    private readonly random: RandomStream,
    private readonly sd: number,
    private readonly tau: number,
    private readonly filterTau = 0,
  ) {}

  /** Advances by `dt` seconds. Callers keep `dt` small relative to `filterTau`. */
  step(dt: number) {
    const decay = Math.exp(-dt / this.tau)
    this.q = decay * this.q + Math.sqrt(1 - decay * decay) * gaussian(this.random)
    if (this.filterTau <= 0) {
      this.value = this.sd * this.q
      return this.value
    }
    const target = this.sd * Math.sqrt(1 + this.filterTau / this.tau) * this.q
    this.value = target + (this.value - target) * Math.exp(-dt / this.filterTau)
    return this.value
  }
}

/** Minimum-jerk position profile for progress `u` in [0, 1], with zero end velocity and acceleration. */
export function minJerk(u: number) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * x * (10 - 15 * x + 6 * x * x)
}

/** Identity within ±0.8 normalized, then compresses smoothly so output never exceeds ±1. */
export function softLimit(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude <= 0.8)
    return value
  return Math.sign(value) * (0.8 + 0.2 * Math.tanh((magnitude - 0.8) / 0.2))
}
