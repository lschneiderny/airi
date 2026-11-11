export interface SecondOrderParameters {
  /** Positive frequency in Hz. */
  readonly f: number
  /** Damping is limited to [0.3, 1]. */
  readonly zeta: number
  /** Negative response anticipates; 2 removes steady ramp lag. */
  readonly r: number
}

export interface SecondOrderCoefficients {
  readonly dt: number
  readonly k1: number
  readonly k3: number
  readonly m11: number
  readonly m12: number
  readonly m21: number
  readonly m22: number
}

/** Caller-owned mutable scalar state, including the previous target x. */
export interface SecondOrderState {
  y: number
  v: number
  x: number
}

/**
 * Exact transition for y + k1*y' + k2*y'' = x + k3*x'.
 * Inputs must be finite, f > 0 and dt >= 0 seconds. Cache per parameter/tick set.
 */
export function secondOrderCoefficients(params: SecondOrderParameters, dt: number): SecondOrderCoefficients {
  const omega = 2 * Math.PI * params.f
  const zeta = Math.min(1, Math.max(0.3, params.zeta))
  const a = zeta * omega
  const decay = Math.exp(-a * dt)
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  // sin(wd*dt)/wd tends to dt at critical damping.
  const sine = wd === 0 ? dt : Math.sin(wd * dt) / wd
  const cosine = Math.cos(wd * dt)
  return {
    dt,
    k1: 2 * zeta / omega,
    k3: params.r * zeta / omega,
    m11: decay * (cosine + a * sine),
    m12: decay * sine,
    m21: -decay * omega * omega * sine,
    m22: decay * (cosine - a * sine),
  }
}

/**
 * Mutates state without allocating, exactly following a linear target per tick.
 * Slope is limited to 20 units/s (rad/s for angles); larger cuts belong to the
 * inertializer. A zero-duration tick neither changes state nor consumes target.
 */
export function advanceSecondOrder(state: SecondOrderState, target: number, coefficients: SecondOrderCoefficients): void {
  const { dt, k1, k3, m11, m12, m21, m22 } = coefficients
  if (dt === 0)
    return
  const q = Math.min(20, Math.max(-20, (target - state.x) / dt))
  const u0 = state.x + k3 * q
  const lag = k1 * q
  const e0 = state.y - u0 + lag
  const d0 = state.v - q
  state.y = u0 + q * dt - lag + m11 * e0 + m12 * d0
  state.v = q + m21 * e0 + m22 * d0
  state.x = target
}

class LagChain {
  private readonly states: SecondOrderState[]
  private readonly coefficients: SecondOrderCoefficients[]
  private readonly values: number[]

  constructor(delays: readonly number[], dt: number) {
    this.states = delays.map(() => ({ y: 0, v: 0, x: 0 }))
    this.values = delays.map(() => 0)
    this.coefficients = delays.map(delay => secondOrderCoefficients({ f: 1 / (Math.PI * delay), zeta: 1, r: 0 }, dt))
  }

  /** Returns a borrowed buffer, updated in place on the next call. */
  step(driver: number): readonly number[] {
    let target = driver
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i]
      advanceSecondOrder(state, target, this.coefficients[i])
      this.values[i] = state.y
      target = state.y
    }
    return this.values
  }
}

/** Zero-initialised cascade. Each positive delay is in seconds; dt is fixed. */
export function createLagChain(delays: readonly number[], dt: number) {
  return new LagChain(delays, dt)
}

class Inertializer {
  /** Borrowed offset buffers. Read after cut() for the continuous cut instant. */
  readonly positions: Float64Array
  readonly velocities: Float64Array

  constructor(channelCount: number, private readonly dt: number) {
    this.positions = new Float64Array(channelCount)
    this.velocities = new Float64Array(channelCount)
  }

  /** Deltas are previous minus new layer position/velocity; repeated cuts add. */
  cut(channel: number, deltaPosition: number, deltaVelocity: number): void {
    this.positions[channel] += deltaPosition
    this.velocities[channel] += deltaVelocity
  }

  /** Advances the offsets, then returns the borrowed position buffer. */
  step(omega = 9): Float64Array {
    const decay = Math.exp(-omega * this.dt)
    for (let i = 0; i < this.positions.length; i++) {
      const position = this.positions[i]
      const velocity = this.velocities[i]
      const j = velocity + omega * position
      this.positions[i] = decay * (position + j * this.dt)
      this.velocities[i] = decay * (velocity - omega * j * this.dt)
    }
    return this.positions
  }

  reset(): void {
    this.positions.fill(0)
    this.velocities.fill(0)
  }
}

/** channelCount is a nonnegative integer; dt >= 0 seconds; step rate is > 0. */
export function createInertializer(channelCount: number, dt: number) {
  return new Inertializer(channelCount, dt)
}

/** Identity in the middle 80% of [min, max], with tanh knees. Requires min < max. */
export function softLimit(value: number, min: number, max: number): number {
  const centre = (min + max) / 2
  const radius = (max - min) / 2
  const normalized = (value - centre) / radius
  if (Math.abs(normalized) <= 0.8)
    return value
  return centre + radius * Math.sign(normalized) * (0.8 + 0.2 * Math.tanh((Math.abs(normalized) - 0.8) / 0.2))
}

/** Clamped progress with zero velocity and acceleration at both endpoints. */
export function minJerk(u: number): number {
  const x = Math.min(1, Math.max(0, u))
  return x * x * x * (10 - 15 * x + 6 * x * x)
}
