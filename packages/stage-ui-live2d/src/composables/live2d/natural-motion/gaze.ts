import type { NaturalPostureLayers } from './posture'
import type { RandomStream } from './random'

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
}
const targetJitter = 0.02
// Share of fixation choices that land on an active cursor.
const cursorWeight = 0.8
// Cursor attention looks most of the way toward the cursor, as in v1.
const cursorGaze = 0.65

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
 * The eye command is `gaze - K h` for the applied head pose `h`, with `K = (0.31, 0.40)`.
 *
 * Time is seconds of active motion; callers step on a fixed grid. Both eyes share
 * the output, so pupils stay conjugate.
 */
export class NaturalGazeLayer {
  /** Probability that an autonomous fixation targets the camera; state presets drive it in a later layer. @default 0.5 */
  cameraFixationProbability = 0.5
  /** Increments when a saccade begins, so blink and face layers can react to gaze shifts. */
  saccadeCount = 0
  /** Normalized eye-space distance of the latest saccade. */
  saccadeSize = 0

  private time = 0
  private from: GazePoint = { x: 0, y: 0 }
  private target: Target = { x: 0, y: 0 }
  private saccadeStart = 0
  private saccadeDuration = 0
  private nextFixationAt: number
  private cursor: GazePoint | null = null

  constructor(private readonly random: RandomStream) {
    this.nextFixationAt = this.drawHold()
  }

  /**
   * Updates cursor attention. A newly active cursor and a released cursor both
   * saccade at `at`: attention moves to the cursor, and release returns to the camera.
   */
  setCursor(cursor: GazePoint | null, at: number) {
    const previous = this.cursor
    // Release starts from the cursor-based gaze, so the saccade begins before the cursor is cleared.
    if (previous !== null && cursor === null)
      this.saccadeTo(this.jittered(targets.camera), at)
    this.cursor = cursor
    if (previous === null && cursor !== null)
      this.saccadeTo('cursor', at)
  }

  /**
   * Starts an attention shift at `at`: the gaze moves to a newly drawn target first,
   * and the caller starts the matching posture shift slightly later.
   */
  beginAttentionShift(at: number) {
    this.saccadeTo(this.drawTarget(), at)
  }

  /** Advances by `dt` seconds and returns the gaze point before head compensation. */
  step(dt: number): GazePoint {
    this.time += dt
    while (this.time >= this.nextFixationAt)
      this.saccadeTo(this.drawTarget(), this.nextFixationAt)
    return this.gazeAt(this.time)
  }

  /** Eye command for gaze `gaze` under applied head pose `head` (normalized units). */
  static eye(gaze: GazePoint, head: GazePoint): GazePoint {
    return { x: gaze.x - compensation.x * head.x, y: gaze.y - compensation.y * head.y }
  }

  private resolve(target: Target): GazePoint {
    if (target !== 'cursor')
      return target
    const cursor = this.cursor ?? { x: 0, y: 0 }
    return { x: cursorGaze * cursor.x, y: cursorGaze * cursor.y }
  }

  private gazeAt(time: number): GazePoint {
    const to = this.resolve(this.target)
    if (this.saccadeDuration === 0 || time >= this.saccadeStart + this.saccadeDuration)
      return to
    const progress = minJerk((time - this.saccadeStart) / this.saccadeDuration)
    return { x: this.from.x + (to.x - this.from.x) * progress, y: this.from.y + (to.y - this.from.y) * progress }
  }

  private saccadeTo(target: Target, at: number) {
    const from = this.gazeAt(at)
    const to = this.resolve(target)
    // Amplitude in approximate degrees: 20 per normalized eye unit.
    const amplitude = 20 * Math.hypot(to.x - from.x, to.y - from.y)
    this.from = from
    this.target = target
    this.saccadeStart = at
    this.saccadeDuration = Math.min(0.090, Math.max(0.035, 0.030 + 0.0025 * amplitude))
    this.nextFixationAt = at + this.saccadeDuration + this.drawHold()
    this.saccadeSize = amplitude / 20
    this.saccadeCount++
  }

  private drawTarget(): Target {
    if (this.cursor && this.random() < cursorWeight)
      return 'cursor'
    const choice = this.random()
    if (choice < this.cameraFixationProbability)
      return this.jittered(targets.camera)
    // The remainder splits evenly between desk and a randomly sided peripheral target.
    if (choice < this.cameraFixationProbability + (1 - this.cameraFixationProbability) / 2)
      return this.jittered(targets.desk)
    const side = this.random() < 0.5 ? -1 : 1
    return this.jittered({ x: side * targets.peripheral.x, y: targets.peripheral.y })
  }

  private jittered(point: GazePoint): GazePoint {
    return { x: point.x + targetJitter * gaussian(this.random), y: point.y + targetJitter * gaussian(this.random) }
  }

  private drawHold() {
    return truncatedLognormal(this.random, 1, 0.7, 0.18, 5)
  }
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
