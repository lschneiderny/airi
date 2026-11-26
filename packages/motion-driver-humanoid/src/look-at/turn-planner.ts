import { minJerk } from '../dynamics'

export interface TurnInput {
  readonly targetYaw: number
  readonly facingYaw: number
  readonly allowTurn?: boolean
  /**
   * The target is where the body rests facing, such as the viewer: a turn starts above `turnStop` instead of
   * `turnStart` and ends on the target instead of leaving `turnRemainder` to the head and eyes.
   */
  readonly home?: boolean
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
  /**
   * The foot that carries her weight through a square-up: the one that stepped last. Null while the turn's own steps
   * go and between turns.
   */
  readonly stance: TurnStep['foot'] | null
}

const radians = Math.PI / 180
const turnStart = 60 * radians
const turnImmediate = 90 * radians
const turnStop = 20 * radians
const turnRemainder = 15 * radians
const stepDuration = 0.4
const stepYawLimit = 22.5 * radians
const dwellDuration = 0.5
/**
 * A home turn's dwell: the head is already on its way back, and the feet start within it so the return is one turn of
 * head, chest and feet rather than a head that has come back over hips still finishing theirs (stand-life audit rank
 * 7). A home target past `turnStop` is where she rests facing, so there is nothing to wait out.
 */
const homeDwellDuration = 0.15
const refractoryDuration = 1.5
/**
 * A turn ends with both feet on the new facing: when its last step leaves the other foot more than `squareUpFrom` off
 * it, her weight settles onto the foot that stepped last for `squareUpSettle` seconds, then the other foot lifts and
 * sets down on the facing in a step of its own (yaw 0). Without it the foot that did not step last stayed turned by
 * that step, up to 22.5 deg, after every turn (the 3D roadmap's glance foot).
 */
const squareUpFrom = 3 * radians
const squareUpSettle = 0.3
const finite = (value: number) => Number.isFinite(value) ? value : 0
const wrap = (value: number) => Math.atan2(Math.sin(value), Math.cos(value))

class TurnPlanner {
  private time = 0
  private dwell = 0
  private dwellDirection = 0
  private refractoryUntil = 0
  private nextFoot: TurnStep['foot'] = 'left'
  private activeStep: { start: number, yaw: number, elapsed: number, squaring: boolean } | null = null
  /** The facing each foot was last set down on; the first frame's facing until then. */
  private readonly feet = { left: Number.NaN, right: Number.NaN }
  /** Seconds left of the weight settling before a square-up step, or null when none is due. */
  private squareUp: number | null = null
  /** Steps left in a home turn, planned as equal steps of at most `stepYawLimit` over what is left to turn. */
  private homeSteps = 0
  private readonly steps: TurnStep[] = []
  private readonly frame: { facingYaw: number, turning: boolean, turnStarted: boolean, turnSteps: TurnStep[], stance: TurnStep['foot'] | null } = { facingYaw: 0, turning: false, turnStarted: false, turnSteps: this.steps, stance: null }

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
    if (Number.isNaN(this.feet.left))
      this.feet.left = this.feet.right = this.frame.facingYaw
    if (input.allowTurn === false) {
      this.frame.turning = false
      this.activeStep = null
      this.squareUp = null
      // Whatever moves the feet while turns are off (the gait) sets them down on the facing it leaves.
      this.feet.left = this.feet.right = this.frame.facingYaw
      this.homeSteps = 0
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
        if (magnitude <= (input.home ? turnStop : turnStart)) {
          this.dwell = 0
          this.dwellDirection = 0
          this.advance(remaining)
          remaining = 0
          continue
        }
        if (this.dwellDirection !== Math.sign(error))
          this.dwell = 0
        this.dwellDirection = Math.sign(error)
        const dwell = input.home ? homeDwellDuration : dwellDuration
        if (magnitude <= turnImmediate && this.dwell < dwell - 1e-12) {
          const elapsed = Math.min(remaining, dwell - this.dwell)
          this.dwell += elapsed
          this.advance(elapsed)
          remaining -= elapsed
          if (this.dwell < dwell - 1e-12)
            continue
        }
        this.frame.turning = true
        this.frame.turnStarted = true
        this.dwell = 0
      }
      if (!this.activeStep && this.squareUp !== null) {
        const elapsed = Math.min(remaining, this.squareUp)
        this.squareUp -= elapsed
        this.advance(elapsed)
        remaining -= elapsed
        if (this.squareUp > 1e-12)
          continue
        this.squareUp = null
        this.activeStep = { start: this.frame.facingYaw, yaw: 0, elapsed: 0, squaring: true }
        this.pushStep(0)
        continue
      }
      if (!this.activeStep) {
        if (!input.home)
          this.homeSteps = 0
        else
          // Counted again at each step, so a home target that moves away mid-turn adds steps instead of lengthening one.
          this.homeSteps = Math.max(this.homeSteps, Math.ceil(magnitude / stepYawLimit - 1e-9))
        if (input.home ? this.homeSteps === 0 : magnitude < turnStop) {
          this.frame.turning = false
          this.refractoryUntil = this.time + refractoryDuration
          continue
        }
        const yaw = input.home
          ? error / this.homeSteps--
          : Math.sign(error) * Math.min(stepYawLimit, Math.max(0, magnitude - turnRemainder))
        this.activeStep = { start: this.frame.facingYaw, yaw, elapsed: 0, squaring: false }
        this.pushStep(yaw)
      }
      const elapsed = Math.min(remaining, stepDuration - this.activeStep.elapsed)
      this.activeStep.elapsed += elapsed
      // A minimum-jerk step starts and ends at rest, so the facing never steps its velocity at a step boundary and a
      // head held in space against it never counter-steps either.
      this.advance(elapsed, this.activeStep.start + this.activeStep.yaw * minJerk(this.activeStep.elapsed / stepDuration))
      remaining -= elapsed
      if (this.activeStep.elapsed >= stepDuration - 1e-12) {
        const squared = this.activeStep.squaring
        this.activeStep = null
        if (squared || (input.home ? this.homeSteps === 0 : Math.abs(wrap(targetYaw - this.frame.facingYaw)) < turnStop)) {
          // The foot that did not step last is `nextFoot`.
          if (!squared && Math.abs(wrap(this.feet[this.nextFoot] - this.frame.facingYaw)) > squareUpFrom) {
            this.squareUp = squareUpSettle
            continue
          }
          this.frame.turning = false
          this.refractoryUntil = this.time + refractoryDuration
        }
      }
    }
    // While she settles before a square-up the foot that stepped last carries her, and it still does while the other
    // squares up (`nextFoot`, flipped at that step's start).
    this.frame.stance = this.activeStep?.squaring ? this.nextFoot : this.squareUp !== null ? (this.nextFoot === 'left' ? 'right' : 'left') : null
    return this.frame
  }

  /** Starts a step of `nextFoot` by `yaw` from the facing, which then sets it down on the facing the step ends on. */
  private pushStep(yaw: number): void {
    const foot = this.nextFoot
    this.steps.push({ foot, startTime: this.time, duration: stepDuration, yaw })
    this.feet[foot] = this.frame.facingYaw + yaw
    this.nextFoot = foot === 'left' ? 'right' : 'left'
  }
}

export function createTurnPlanner() {
  return new TurnPlanner()
}
