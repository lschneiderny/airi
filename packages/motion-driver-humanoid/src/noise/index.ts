import type { RandomStream } from '../random'

import { createRandomStream } from '../random'

/** Independent indexed stream seeds. Keep indices stable and append new ones. */
export function deriveSeed(seed: number, index: number): number {
  // Local copy of Natural's SplitMix32-style finalizer; no cross-package coupling.
  let h = (seed ^ Math.imul(index + 1, 0x9E3779B9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Standard normal Box-Muller draw; always consumes two uniforms in [0, 1). */
export function gaussian(random: RandomStream): number {
  const u = 1 - random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

export interface DriftNoiseOptions {
  readonly seed: number
  /** Three positive OU time constants in seconds. */
  readonly taus?: readonly [number, number, number]
  /** Nonnegative seconds; zero bypasses the output low-pass. */
  readonly filterTau?: number
}

class DriftNoise {
  private readonly random: RandomStream
  private readonly q = new Float64Array(3)
  private readonly decay = new Float64Array(3)
  private readonly innovation = new Float64Array(3)
  private readonly taus: readonly [number, number, number]
  private readonly filterTau: number
  private previousDt = -1
  private filterDecay = 0
  private value = 0

  constructor(options: DriftNoiseOptions) {
    this.random = createRandomStream(options.seed)
    this.taus = options.taus ?? [0.9, 3.5, 14]
    this.filterTau = options.filterTau ?? 0.15
  }

  /** Finite dt >= 0 seconds. Zero advances neither time nor the random stream. */
  step(dt: number): number {
    if (dt === 0)
      return this.value
    if (dt !== this.previousDt) {
      for (let i = 0; i < 3; i++) {
        this.decay[i] = Math.exp(-dt / this.taus[i])
        this.innovation[i] = Math.sqrt(-Math.expm1(-2 * dt / this.taus[i]))
      }
      this.filterDecay = this.filterTau === 0 ? 0 : Math.exp(-dt / this.filterTau)
      this.previousDt = dt
    }
    let raw = 0
    for (let i = 0; i < 3; i++) {
      this.q[i] = this.decay[i] * this.q[i] + this.innovation[i] * gaussian(this.random)
      raw += this.q[i]
    }
    raw /= Math.sqrt(3)
    this.value = raw + (this.value - raw) * this.filterDecay
    return this.value
  }
}

/** Zero-initialised normalised drift; caller multiplies by channel SD and gate. */
export function createDriftNoise(options: DriftNoiseOptions) {
  return new DriftNoise(options)
}

export interface ActivityGateOptions {
  readonly seed: number
  /** Positive seconds. */
  readonly tau?: number
  /** Lower bound in [0, 1]. */
  readonly floor?: number
}

class ActivityGate {
  private readonly random: RandomStream
  private readonly tau: number
  private readonly floor: number
  private e = 0
  private previousDt = -1
  private decay = 0
  private innovation = 0

  constructor(options: ActivityGateOptions) {
    this.random = createRandomStream(options.seed)
    this.tau = options.tau ?? 8
    this.floor = options.floor ?? 0.15
  }

  /** Finite dt >= 0 seconds. Zero consumes no draw and returns the current gate. */
  step(dt: number): number {
    if (dt !== 0) {
      if (dt !== this.previousDt) {
        this.decay = Math.exp(-dt / this.tau)
        this.innovation = Math.sqrt(-Math.expm1(-2 * dt / this.tau))
        this.previousDt = dt
      }
      this.e = this.decay * this.e + this.innovation * gaussian(this.random)
    }
    return this.floor + (1 - this.floor) / (1 + Math.exp(-2.5 * this.e))
  }
}

/** One zero-initialised OU activity envelope per region, in [floor, 1]. */
export function createActivityGate(options: ActivityGateOptions) {
  return new ActivityGate(options)
}
