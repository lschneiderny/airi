import type { GazeTargetWeights } from './energy'
import type { NaturalPostureLayers } from './posture'
import type { RandomStream } from './random'

import { cursorGaze } from './cursor-attention'
import { minJerk } from './processes'
import { gaussian, truncatedLognormal } from './random'

/** Normalized eye-space point; X right, Y up, matching ParamEyeBallX/Y. */
export interface GazePoint {
  x: number
  y: number
}

/**
 * Eye counter-rotation per unit of applied head pose. Partial compensation keeps the
 * eyes negatively correlated with the head (reference corr(eyeX, headX) about -0.8)
 * instead of the v1 full world-locked fixation.
 */
const compensation = { x: 0.31, y: 0.40 }

// Autonomous fixation targets in eye space; each selection adds Gaussian jitter.
const targets = {
  camera: { x: 0, y: 0 },
  desk: { x: 0, y: -0.18 },
  peripheral: { x: 0.12, y: 0 },
  // Thinking glances aside and up; selected only when its weight is above 0.
  peripheralUp: { x: 0.15, y: 0.12 },
  // Aside attention looks clearly off camera and slightly down; the side is drawn per cue.
  aside: { x: 0.55, y: -0.15 },
}
const targetJitter = 0.02
// Aside attention can lapse briefly within one cue, for example between speech clips.
// Re-entering within this many seconds keeps the side, so one cue looks to one side.
const asideSideMemory = 2
// Share of fixation choices that land on an active cursor.
const cursorWeight = 0.8
// Pursuit speeds are in normalized eye units per second; time constants are seconds.
const pursuitMaxSpeed = 1.5
const pursuitVelocityTau = 0.1
const pursuitPositionTau = 0.2
const targetVelocityTau = 0.06
const catchUpError = 0.1
const catchUpRefractory = 0.12
// A catch-up saccade aims where the cursor will be when it lands, at most this far ahead.
const catchUpMaxLead = 0.1
// Seconds of one-way cursor motion before the catch-up lead and carried pursuit reach full strength,
// so a jump or a reversal never extrapolates.
const motionConfidenceSeconds = 0.1
// Seconds without cursor movement that end a motion run; covers cursor feeds down to about 33 Hz.
const motionStillGap = 0.03

type Target = GazePoint | 'cursor'

// Share of posture shifts that are attention shifts: the gaze moves first and the
// posture shift starts 30-80 ms later. Other shifts keep the current fixation.
const attentionShare = 0.3
const attentionLead = { min: 0.03, max: 0.08 }

/**
 * Gaze as fixations joined by min-jerk saccades, independent of head motion.
 *
 * Fixations hold for a truncated lognormal duration (median 1 s, logSD 0.7, 0.18-5 s),
 * then move to camera, desk, or a peripheral side. Saccades last
 * `clip(0.030 + 0.0025 A, 0.035, 0.090)` s with amplitude `A = 20 ||delta eye||`.
 * Catch-up saccades during cursor pursuit aim ahead by the cursor's sustained velocity over
 * their flight and land still pursuing at that velocity, both bounded, so a fast sweep is not
 * chased by stale endpoints that restart pursuit from rest.
 * The eye command is `gaze - K h` for the slow head pose `h` (the applied head without its sub-second
 * continuous wobble, which the eyes ignore), with `K = (0.31, 0.40)`.
 *
 * Time is seconds of active motion; callers step on a fixed grid. Both eyes share
 * the output, so pupils stay conjugate.
 */
export class NaturalGazeLayer {
  /** Probability that an autonomous fixation targets the camera; state presets drive it in a later layer. @default 0.5 */
  cameraFixationProbability = 0.5
  /** Relative weights of the non-camera targets; state presets drive them. @default desk 1, peripheral 1, peripheralUp 0 */
  targetWeights: Readonly<GazeTargetWeights> = { desk: 1, peripheral: 1, peripheralUp: 0 }
  /** Increments when a saccade begins, so blink and face layers can react to gaze shifts. */
  saccadeCount = 0
  /** Normalized eye-space distance of the latest saccade. */
  saccadeSize = 0

  private time = 0
  private from: GazePoint = { x: 0, y: 0 }
  private target: Target = { x: 0, y: 0 }
  private endpoint: GazePoint = { x: 0, y: 0 }
  private pursuit: GazePoint = { x: 0, y: 0 }
  private velocity: GazePoint = { x: 0, y: 0 }
  private targetVelocity: GazePoint = { x: 0, y: 0 }
  private previousCursor: GazePoint | null = null
  /** Seconds the cursor has kept moving one way, bridging still gaps up to `motionStillGap`. */
  private motionSeconds = 0
  private stillSeconds = 0
  private catchingUp = false
  private saccadeStart = 0
  private saccadeDuration = 0
  private nextFixationAt: number
  private cursor: GazePoint | null = null
  private weight = 0
  private override: GazePoint | null = null
  /** The off-camera fixation of aside attention, with its side already drawn, or `null` when inactive. */
  private aside: GazePoint | null = null
  private asideSide = 1
  private asideReleasedAt = Number.NEGATIVE_INFINITY

  constructor(private readonly random: RandomStream) {
    this.nextFixationAt = this.drawHold()
  }

  /** Stores an already mapped eye target and its fixation weight without moving the gaze. */
  setCursorTarget(target: GazePoint | null, weight: number) {
    this.cursor = target
    this.weight = weight
  }

  /** Starts the notice saccade toward the current cursor target. */
  orient(at: number) {
    if (this.cursor && !this.override)
      this.saccadeTo('cursor', at)
  }

  /** Ends pursuit in place, letting the next autonomous fixation resume within 300 ms. */
  disengage(at: number) {
    if (!this.onCursor)
      return
    const point = this.gazeAt(at)
    this.target = point
    this.endpoint = point
    this.saccadeDuration = 0
    this.nextFixationAt = Math.min(this.nextFixationAt, at + 0.3)
  }

  /** Deliberately looks away from a cursor fixation, including an in-flight notice saccade. */
  dismiss(at: number) {
    if (!this.onCursor)
      return
    this.weight = 0
    this.saccadeTo(this.drawTarget(), at)
  }

  /** Overrides autonomous fixations and pursuit; each change starts one saccade. */
  setOverride(point: GazePoint | null, at: number) {
    if (point?.x === this.override?.x && point?.y === this.override?.y)
      return
    this.override = point
    this.saccadeTo(this.drawTarget(), at)
  }

  get onCursor(): boolean {
    return this.target === 'cursor'
  }

  /**
   * Turns aside attention on or off at `at`. Turning it on draws a side and saccades
   * off camera; autonomous fixations then stay near that point, so glances return to it.
   * Turning it on again within {@link asideSideMemory} seconds keeps the side. Turning
   * it off returns the gaze to the camera.
   */
  setAside(active: boolean, at: number) {
    if (active === (this.aside !== null))
      return
    if (active) {
      if (at - this.asideReleasedAt > asideSideMemory)
        this.asideSide = this.random() < 0.5 ? -1 : 1
      this.aside = { x: this.asideSide * targets.aside.x, y: targets.aside.y }
      this.saccadeTo(this.jittered(this.aside), at)
      return
    }
    this.aside = null
    this.asideReleasedAt = at
    this.saccadeTo(this.jittered(targets.camera), at)
  }

  /**
   * Starts an attention shift at `at`: the gaze moves to a newly drawn target first,
   * and the caller starts the matching posture shift slightly later.
   */
  beginAttentionShift(at: number) {
    this.saccadeTo(this.drawTarget(), at)
  }

  /**
   * Saccades to `point` at `at` and holds it for `hold` seconds before autonomous
   * fixations resume. Used by emotion impulses and desktop reactions.
   * Returns the active-time end of the hold, including the approach saccade.
   */
  glance(point: GazePoint, hold: number, at: number) {
    this.saccadeTo(point, at, hold)
    return this.nextFixationAt
  }

  /** Advances by `dt` seconds and returns the gaze point before head compensation. */
  step(dt: number): GazePoint {
    const previousTime = this.time
    this.time += dt
    while (this.time >= this.nextFixationAt)
      this.saccadeTo(this.drawTarget(), this.nextFixationAt)
    if (this.onCursor && this.cursor && !this.override) {
      const previous = this.previousCursor ?? this.cursor
      this.trackMotion(this.cursor.x - previous.x, this.cursor.y - previous.y, dt)
      const alpha = 1 - Math.exp(-dt / targetVelocityTau)
      this.targetVelocity = {
        x: this.targetVelocity.x + ((this.cursor.x - previous.x) / dt - this.targetVelocity.x) * alpha,
        y: this.targetVelocity.y + ((this.cursor.y - previous.y) / dt - this.targetVelocity.y) * alpha,
      }
      const landedAt = this.saccadeStart + this.saccadeDuration
      if (this.time >= landedAt) {
        if (previousTime < landedAt) {
          this.pursuit = { ...this.endpoint }
          this.velocity = this.catchingUp ? this.carriedVelocity() : { x: 0, y: 0 }
        }
        const pursuitDt = this.time - Math.max(previousTime, landedAt)
        this.pursue(pursuitDt)
        if (Math.hypot(this.cursor.x - this.pursuit.x, this.cursor.y - this.pursuit.y) > catchUpError
          && this.time - this.saccadeStart >= catchUpRefractory) {
          this.saccadeTo('cursor', this.time, undefined, true)
        }
      }
    }
    this.previousCursor = this.cursor && { ...this.cursor }
    return this.gazeAt(this.time)
  }

  /** Eye command for gaze `gaze` under head pose `head` (the facade passes the slow pose) (normalized units). */
  static eye(gaze: GazePoint, head: GazePoint): GazePoint {
    return { x: gaze.x - compensation.x * head.x, y: gaze.y - compensation.y * head.y }
  }

  private resolve(target: Target): GazePoint {
    if (target !== 'cursor')
      return target
    return this.cursor ?? { x: 0, y: 0 }
  }

  private gazeAt(time: number): GazePoint {
    const to = this.endpoint
    if (this.saccadeDuration === 0 || time >= this.saccadeStart + this.saccadeDuration)
      return this.onCursor ? this.pursuit : to
    const progress = minJerk((time - this.saccadeStart) / this.saccadeDuration)
    return { x: this.from.x + (to.x - this.from.x) * progress, y: this.from.y + (to.y - this.from.y) * progress }
  }

  private pursue(dt: number) {
    const target = this.cursor!
    let x = 0.9 * this.targetVelocity.x + (target.x - this.pursuit.x) / pursuitPositionTau
    let y = 0.9 * this.targetVelocity.y + (target.y - this.pursuit.y) / pursuitPositionTau
    const speed = Math.hypot(x, y)
    if (speed > pursuitMaxSpeed) {
      x *= pursuitMaxSpeed / speed
      y *= pursuitMaxSpeed / speed
    }
    const alpha = 1 - Math.exp(-dt / pursuitVelocityTau)
    // Velocity starts at zero after a saccade, or at the bounded carried velocity after a
    // catch-up. Convex blends toward a bounded command keep its magnitude <= pursuitMaxSpeed.
    this.velocity = { x: this.velocity.x + (x - this.velocity.x) * alpha, y: this.velocity.y + (y - this.velocity.y) * alpha }
    this.pursuit = { x: this.pursuit.x + this.velocity.x * dt, y: this.pursuit.y + this.velocity.y * dt }
  }

  /** Accumulates how long the cursor has kept moving one way; a reversal or a long stop resets it. */
  private trackMotion(dx: number, dy: number, dt: number) {
    if (dx === 0 && dy === 0) {
      this.stillSeconds += dt
      if (this.stillSeconds > motionStillGap)
        this.motionSeconds = 0
      return
    }
    const onward = dx * this.targetVelocity.x + dy * this.targetVelocity.y > 0
    this.motionSeconds = onward ? this.motionSeconds + this.stillSeconds + dt : 0
    this.stillSeconds = 0
  }

  private get motionConfidence() {
    return Math.min(1, this.motionSeconds / motionConfidenceSeconds)
  }

  /** The cursor's sustained velocity, weighted by motion confidence and limited to pursuit speed. */
  private carriedVelocity(): GazePoint {
    const speed = Math.hypot(this.targetVelocity.x, this.targetVelocity.y)
    const scale = this.motionConfidence * (speed > pursuitMaxSpeed ? pursuitMaxSpeed / speed : 1)
    return { x: this.targetVelocity.x * scale, y: this.targetVelocity.y * scale }
  }

  /** Where a catch-up saccade from `from` meets the cursor, kept inside the cursor mapping's range. */
  private catchUpTarget(from: GazePoint): GazePoint {
    const now = this.resolve('cursor')
    const flight = saccadeSeconds(20 * Math.hypot(now.x - from.x, now.y - from.y)) * this.motionConfidence
    let dx = this.targetVelocity.x * flight
    let dy = this.targetVelocity.y * flight
    const lead = Math.hypot(dx, dy)
    if (lead > catchUpMaxLead) {
      dx *= catchUpMaxLead / lead
      dy *= catchUpMaxLead / lead
    }
    const ahead = { x: now.x + dx, y: now.y + dy }
    const magnitude = Math.hypot(ahead.x, ahead.y)
    return magnitude > cursorGaze ? { x: ahead.x * cursorGaze / magnitude, y: ahead.y * cursorGaze / magnitude } : ahead
  }

  private saccadeTo(target: Target, at: number, hold?: number, catchUp = false) {
    const from = this.gazeAt(at)
    const to = catchUp ? this.catchUpTarget(from) : this.resolve(target)
    // Amplitude in approximate degrees: 20 per normalized eye unit.
    const amplitude = 20 * Math.hypot(to.x - from.x, to.y - from.y)
    this.from = from
    this.target = target
    this.endpoint = { ...to }
    this.pursuit = { ...to }
    this.velocity = { x: 0, y: 0 }
    this.catchingUp = catchUp
    this.saccadeStart = at
    this.saccadeDuration = saccadeSeconds(amplitude)
    this.nextFixationAt = at + this.saccadeDuration + (hold ?? this.drawHold())
    this.saccadeSize = amplitude / 20
    this.saccadeCount++
  }

  private drawTarget(): Target {
    if (this.override)
      return this.jittered(this.override)
    // Aside attention outranks the camera-fixation probability, so a hold that raises it cannot pull the gaze back.
    if (this.aside)
      return this.jittered(this.aside)
    if (this.cursor && this.weight > 0 && this.random() < cursorWeight * this.weight)
      return 'cursor'
    const choice = this.random()
    if (choice < this.cameraFixationProbability)
      return this.jittered(targets.camera)
    // The remainder splits by weight between desk and randomly sided peripheral targets.
    // With the default weights (1, 1, 0) the thresholds equal the even desk/peripheral split.
    const { desk, peripheral, peripheralUp } = this.targetWeights
    const rest = 1 - this.cameraFixationProbability
    const total = desk + peripheral + peripheralUp
    if (choice < this.cameraFixationProbability + rest * desk / total)
      return this.jittered(targets.desk)
    const side = this.random() < 0.5 ? -1 : 1
    const sideTarget = peripheralUp > 0 && choice >= this.cameraFixationProbability + rest * (desk + peripheral) / total
      ? targets.peripheralUp
      : targets.peripheral
    return this.jittered({ x: side * sideTarget.x, y: sideTarget.y })
  }

  private jittered(point: GazePoint): GazePoint {
    return { x: point.x + targetJitter * gaussian(this.random), y: point.y + targetJitter * gaussian(this.random) }
  }

  private drawHold() {
    return truncatedLognormal(this.random, 1, 0.7, 0.18, 5)
  }
}

/** Saccade duration in seconds for an amplitude in approximate degrees. */
function saccadeSeconds(amplitude: number) {
  return Math.min(0.090, Math.max(0.035, 0.030 + 0.0025 * amplitude))
}

/**
 * Turns about 30% of posture shifts into gaze-led attention shifts.
 * Call `update` once per grid step, before stepping posture and gaze over `[stepStart, stepStart + dt]`.
 * The gaze saccade starts at the scheduled shift time, and the shift is postponed by 30-80 ms (uniform).
 */
export class NaturalAttentionShifts {
  private decidedFor = -1

  constructor(private readonly random: RandomStream) {}

  update(posture: Pick<NaturalPostureLayers, 'shiftCount' | 'secondsUntilShift' | 'postponeShift'>, gaze: NaturalGazeLayer, stepStart: number, dt: number) {
    const untilShift = posture.secondsUntilShift
    // Decide once per shift, in the step where it would begin.
    if (this.decidedFor === posture.shiftCount || untilShift > dt)
      return
    this.decidedFor = posture.shiftCount
    if (this.random() >= attentionShare)
      return
    gaze.beginAttentionShift(stepStart + untilShift)
    posture.postponeShift(attentionLead.min + (attentionLead.max - attentionLead.min) * this.random())
  }
}
