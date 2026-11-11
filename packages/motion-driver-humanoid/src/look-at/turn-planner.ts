export interface TurnInput {
  readonly targetYaw: number
  readonly facingYaw: number
  readonly allowTurn?: boolean
}

export interface TurnStep {
  readonly foot: 'left' | 'right'
  /** Seconds since controller creation; emitted only at step start. */
  readonly startTime: number
  readonly duration: number
  readonly yaw: number
}

export interface TurnFrame {
  readonly facingYaw: number
  readonly turning: boolean
  readonly turnStarted: boolean
  readonly turnSteps: readonly TurnStep[]
}

const radians = Math.PI / 180
const turnStart = 60 * radians
const turnImmediate = 90 * radians
const turnStop = 20 * radians
const turnRemainder = 15 * radians
const stepDuration = 0.4
const stepYawLimit = 22.5 * radians
const dwellDuration = 0.5
const refractoryDuration = 1.5
const finite = (value: number) => Number.isFinite(value) ? value : 0
const wrap = (value: number) => Math.atan2(Math.sin(value), Math.cos(value))

export class TurnPlanner {
  private time = 0
  private dwell = 0
  private dwellDirection = 0
  private refractoryUntil = 0
  private nextFoot: TurnStep['foot'] = 'left'
  private activeStep: { start: number, yaw: number, elapsed: number } | null = null
  private readonly steps: TurnStep[] = []
  private readonly frame = { facingYaw: 0, turning: false, turnStarted: false, turnSteps: this.steps }

  private advance(elapsed: number, nextFacing = this.frame.facingYaw): void {
    this.frame.facingYaw = nextFacing
    this.time += elapsed
  }

  /** Borrowed frame and event array, valid until the next step; step event objects are immutable. */
  step(input: TurnInput, dt: number): TurnFrame {
    const targetYaw = wrap(finite(input.targetYaw))
    let remaining = Math.max(0, finite(dt))
    this.frame.facingYaw = finite(input.facingYaw)
    this.frame.turnStarted = false
    this.steps.length = 0
    if (input.allowTurn === false) {
      this.frame.turning = false
      this.activeStep = null
      this.dwell = 0
      this.dwellDirection = 0
      this.advance(remaining)
      remaining = 0
    }
    // Split at dwell, step, and refractory boundaries rather than quantizing them to frames.
    while (remaining > 1e-12) {
      const error = wrap(targetYaw - this.frame.facingYaw)
      const magnitude = Math.abs(error)
      if (!this.frame.turning) {
        if (this.time < this.refractoryUntil) {
          const elapsed = Math.min(remaining, this.refractoryUntil - this.time)
          this.advance(elapsed)
          remaining -= elapsed
          continue
        }
        if (magnitude <= turnStart) {
          this.dwell = 0
          this.dwellDirection = 0
          this.advance(remaining)
          remaining = 0
          continue
        }
        if (this.dwellDirection !== Math.sign(error))
          this.dwell = 0
        this.dwellDirection = Math.sign(error)
        if (magnitude <= turnImmediate && this.dwell < dwellDuration - 1e-12) {
          const elapsed = Math.min(remaining, dwellDuration - this.dwell)
          this.dwell += elapsed
          this.advance(elapsed)
          remaining -= elapsed
          if (this.dwell < dwellDuration - 1e-12)
            continue
        }
        this.frame.turning = true
        this.frame.turnStarted = true
        this.dwell = 0
      }
      if (!this.activeStep && magnitude < turnStop) {
        this.frame.turning = false
        this.refractoryUntil = this.time + refractoryDuration
        continue
      }
      if (!this.activeStep) {
        const yaw = Math.sign(error) * Math.min(stepYawLimit, Math.max(0, magnitude - turnRemainder))
        this.activeStep = { start: this.frame.facingYaw, yaw, elapsed: 0 }
        this.steps.push({ foot: this.nextFoot, startTime: this.time, duration: stepDuration, yaw })
        this.nextFoot = this.nextFoot === 'left' ? 'right' : 'left'
      }
      const elapsed = Math.min(remaining, stepDuration - this.activeStep.elapsed)
      this.activeStep.elapsed += elapsed
      this.advance(elapsed, this.activeStep.start + this.activeStep.yaw * this.activeStep.elapsed / stepDuration)
      remaining -= elapsed
      if (this.activeStep.elapsed >= stepDuration - 1e-12) {
        this.activeStep = null
        if (Math.abs(wrap(targetYaw - this.frame.facingYaw)) < turnStop) {
          this.frame.turning = false
          this.refractoryUntil = this.time + refractoryDuration
        }
      }
    }
    return this.frame
  }
}

export function createTurnPlanner() {
  return new TurnPlanner()
}
