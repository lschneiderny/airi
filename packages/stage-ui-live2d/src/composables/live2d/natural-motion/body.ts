import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { FilteredOu } from './processes'

// Normalized body-per-head gain. Body ranges are a third of head ranges (±10 vs ±30),
// so X/Y 0.99 is about 0.33 in recording units; roll couples less.
const gain: Vec3 = [0.99, 0.99, 0.6]
// Independent residual (0.15 body units). Its time scales are not specified by the
// reference; 2 s OU filtered over 0.4 s keeps it slower than continuous head motion.
const residualSd = 0.015
const residualTau = 2
const residualFilter = 0.4

/**
 * Body posture that follows the head with a per-shift lag of 150-300 ms.
 *
 * Each axis is a two-stage critically damped follower with time constant `lag / 2`,
 * so its mean delay equals `lag`, plus an independent filtered-OU residual.
 * Callers draw a new lag at each posture shift through `beginShift`.
 */
export class NaturalBodyLayer {
  private readonly residual: FilteredOu[]
  private readonly u: Vec3
  private readonly x: Vec3
  private lag: number

  /** Starts settled on `head`, so the first frames carry no catch-up transient. */
  constructor(private readonly random: RandomStream, head: Readonly<Vec3>) {
    this.u = head.map((value, axis) => gain[axis] * value) as Vec3
    this.x = [...this.u]
    this.residual = [0, 1, 2].map(() => new FilteredOu(random, residualSd, residualTau, residualFilter))
    this.lag = this.drawLag()
  }

  /** Current follower pose without the residual. */
  get pose(): Vec3 {
    return this.x.map(value => Math.max(-1, Math.min(1, value))) as Vec3
  }

  /** Draws the lag used until the next posture shift. */
  beginShift() {
    this.lag = this.drawLag()
  }

  /** Advances by `dt` seconds toward the applied head pose and returns the clamped body pose. */
  step(dt: number, head: Readonly<Vec3>): Vec3 {
    const h = dt / (this.lag / 2)
    const e = Math.exp(-h)
    return [0, 1, 2].map((axis) => {
      const target = gain[axis] * head[axis]
      const oldU = this.u[axis]
      this.u[axis] = target + (oldU - target) * e
      this.x[axis] = target + ((this.x[axis] - target) + (oldU - target) * h) * e
      return Math.max(-1, Math.min(1, this.x[axis] + this.residual[axis].step(dt)))
    }) as Vec3
  }

  private drawLag() {
    return 0.15 + 0.15 * this.random()
  }
}
