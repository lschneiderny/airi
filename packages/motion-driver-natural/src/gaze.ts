import type { GazeTargetWeights } from './energy'
import type { NaturalPostureLayers } from './posture'
import type { RandomStream } from './random'

import { cursorGaze } from './cursor-attention'
import { minJerk } from './processes'
import { createRandomStream, gaussian, truncatedLognormal } from './random'

/** Normalized eye-space point; X right, Y up, matching ParamEyeBallX/Y. */
export interface GazePoint {
  x: number
  y: number
}

/**
 * Eye counter-rotation per unit of slow head pose. Partial compensation keeps the
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

/**
 * Who asked for a held glance. Every caller of {@link NaturalGazeLayer.glance} names one, and the gaze layer ranks
 * the request by {@link GLANCE_PRIORITY}; `chat-sent` and `chat-unfold` are chat reads, which give up their hold when
 * the chat hides. `cursor-notice` is the notice saccade of {@link NaturalGazeLayer.orient}.
 */
export type GlanceSource
  = | 'pet-end' | 'poke' | 'desktop-wake' | 'sleep-wake' | 'chat-sent' | 'chat-unfold' | 'voice-cue'
    | 'look-tool' | 'cue-gesture' | 'emotion' | 'screen-change' | 'cursor-notice' | 'idle-act'

/**
 * The gaze arbiter's priorities; higher wins. A request starts unless the running glance ranks higher, so equal
 * priority keeps "the latest wins" within a class. A lower request is dropped, not queued: a late glance would land
 * after the moment it answers. Autonomous fixations (free, typing, cursor pursuit) rank below every glance.
 */
export const GLANCE_PRIORITY: Readonly<Record<GlanceSource, number>> = {
  // The user's hand on her.
  'pet-end': 7,
  'poke': 7,
  // She meets the user on a return or on waking.
  'desktop-wake': 6,
  'sleep-wake': 6,
  // The user wrote to her, or she is about to speak or has just declined.
  'chat-sent': 5,
  'chat-unfold': 5,
  'voice-cue': 5,
  // The model's cues.
  'look-tool': 4,
  'cue-gesture': 4,
  'emotion': 4,
  // Something changed on the desktop.
  'screen-change': 3,
  // A noticed cursor: the episode still engages, and the autonomous draw picks the cursor after the hold.
  'cursor-notice': 2,
  // Her own idle acts.
  'idle-act': 1,
}

/**
 * Where walking ranks among glances while she travels ({@link NaturalGazeLayer.setTravel}): below the touch, wake, and
 * chat classes, above the model's cues. A glance below it is refused while she walks, so the eyes follow the travel
 * line; a glance at or above it holds over the walk, briefly ({@link TRAVEL_GLANCE_MAX_SECONDS}).
 */
export const TRAVEL_PRIORITY = 4.5

/**
 * Seconds a glance may hold over the travel line while she walks, after its approach saccade. A chat read can ask for
 * up to 3 s, which reads as a stumble mid-walk. A tuning value (CM9 plan, D17).
 */
export const TRAVEL_GLANCE_MAX_SECONDS = 1.5

/** The arbiter's answer: point is null for a missing target, and hold is null for a cursor notice. */
export interface GlanceOutcome {
  at: number
  source: GlanceSource | 'chat-typing'
  outcome: 'started' | 'refused'
  point: GazePoint | null
  hold: number | null
}

/** A held glance: saccade to `point`, then hold it for `hold` seconds. A null point reports a refusal without moving. */
export interface GlanceRequest {
  source: GlanceSource
  point: GazePoint | null
  hold: number
}

/**
 * What the eyes are aimed at, for a reviewer's readout. `desk`, `side` and `side-up` are the autonomous fixation
 * points; `screen` is the desk fixation moved toward the screen content; `glance` is a held look another layer asked
 * for (an idle act, an emotion, a chat read); `override` is a target the controller forces, such as the petting hand.
 */
export type GazeTargetKind = 'camera' | 'desk' | 'screen' | 'side' | 'side-up' | 'cursor' | 'chat' | 'aside' | 'glance' | 'override'

/**
 * Share of posture shifts that are attention shifts without pep: the gaze moves first and the
 * posture shift starts 30-80 ms later. Other shifts keep the current fixation.
 */
export const attentionShare = 0.3
const attentionLead = { min: 0.03, max: 0.08 }
// A fully wide attention shift places its desk and side fixations this many times as far from the camera, so the head
// that follows it makes a move a viewer sees.
const wideReach = 2.5
// Seconds a fully wide attention shift adds to its fixation, so the eyes are still there when the head arrives.
const wideHoldSeconds = 0.8

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
  /** The current autonomous fixation was selected from the typing chat branch. */
  onChat = false
  /** What the latest saccade aimed at. It draws nothing and no layer reads it. */
  targetKind: GazeTargetKind = 'camera'

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
  private inward = 0
  private screenPointActive = false
  private chatPoint: GazePoint | null = null
  private chatTyping = false
  /** An explicit sent/unfold read owns the current fixation independently of the typing branch. */
  private chatRead = false
  /** The running glance and the active-time end of its hold, or null while autonomous fixations run. */
  private claimed: { source: GlanceSource, until: number } | null = null
  /** The body walks; the renderer that owns the gait sets it ({@link NaturalGazeLayer.setTravel}). */
  private traveling = false

  /**
   * @param report Receives every glance the arbiter starts or refuses, and every typing fixation on the chat. It draws
   * nothing, so attaching it never changes motion.
   */
  constructor(
    private readonly random: RandomStream,
    private readonly chatRandom: RandomStream = createRandomStream(14),
    private readonly report?: (outcome: GlanceOutcome) => void,
  ) {
    this.nextFixationAt = this.drawHold()
  }

  /** Stores an eye-space chat target; hiding chat immediately replaces an active chat fixation. */
  setChatTarget(point: GazePoint | null, typing: boolean, at = this.time) {
    this.chatPoint = point
    this.chatTyping = typing
    if (point === null && (this.onChat || this.chatRead))
      this.fixateNext(at)
  }

  /** Eased placement inwardness; positive means toward screen +x. Does not draw or change the current fixation. */
  setInward(w: number) {
    this.inward = w
  }

  /** Only watching and screen attention move autonomous desk fixations inward. */
  setScreenPointActive(active: boolean) {
    this.screenPointActive = active
  }

  /** Inward screen-content point in normalized eye space, independent of the current attention mode. */
  screenPoint(): GazePoint {
    return { x: 0.30 * this.inward, y: targets.desk.y }
  }

  /** Stores an already mapped eye target and its fixation weight without moving the gaze. */
  setCursorTarget(target: GazePoint | null, weight: number) {
    this.cursor = target
    this.weight = weight
  }

  /**
   * Starts the notice saccade toward the current cursor target, ranked as a `cursor-notice` glance; its first fixation
   * holds the claim. Returns whether it started. Without a cursor target nothing is asked, so nothing is reported.
   */
  orient(at: number) {
    if (!this.cursor)
      return false
    if (!this.admits('cursor-notice')) {
      this.report?.({ at, source: 'cursor-notice', outcome: 'refused', point: { ...this.cursor }, hold: null })
      return false
    }
    this.saccadeTo('cursor', at)
    this.claimed = { source: 'cursor-notice', until: this.nextFixationAt }
    this.report?.({ at, source: 'cursor-notice', outcome: 'started', point: { ...this.cursor }, hold: null })
    return true
  }

  /** The running glance until its hold ends, its owner ends it, or an override or aside change starts a new fixation. */
  get claim(): Readonly<{ source: GlanceSource, until: number }> | null {
    return this.claimed
  }

  /**
   * Whether a glance that outranks travel holds the eyes. While it is true a renderer that aims the gaze along the walk
   * shows the fixation instead.
   */
  get held(): boolean {
    return this.claimed !== null && GLANCE_PRIORITY[this.claimed.source] >= TRAVEL_PRIORITY
  }

  /**
   * Makes walking an input of the arbiter from `at`: while `walking`, a request below {@link TRAVEL_PRIORITY} is
   * refused and a granted hold is capped at {@link TRAVEL_GLANCE_MAX_SECONDS}. A walk that starts under a lower claim
   * ends it at `at`; a higher claim keeps holding, capped from `at`. Ending the walk lifts both limits for later
   * requests and does not lengthen a capped hold.
   */
  setTravel(walking: boolean, at: number) {
    if (walking === this.traveling)
      return
    this.traveling = walking
    if (!walking || this.claimed === null)
      return
    if (!this.held) {
      this.nextFixationAt = Math.min(this.nextFixationAt, at)
      this.claimed = null
      return
    }
    this.nextFixationAt = Math.min(this.nextFixationAt, at + TRAVEL_GLANCE_MAX_SECONDS)
    this.claimed = { ...this.claimed, until: this.nextFixationAt }
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
    this.fixateNext(at)
  }

  /** Overrides autonomous fixations and pursuit; each change starts one saccade. */
  setOverride(point: GazePoint | null, at: number) {
    if (point?.x === this.override?.x && point?.y === this.override?.y)
      return
    this.override = point
    this.fixateNext(at)
  }

  /**
   * Whether a request from `source` may start now. While an override (the petting hand) holds, only the pet-end glance
   * starts: no look-up and no camera snap while a pet runs. While she walks, a source below travel is refused.
   * Otherwise it starts unless the running glance ranks higher.
   */
  private admits(source: GlanceSource) {
    if (this.override && source !== 'pet-end')
      return false
    if (this.traveling && GLANCE_PRIORITY[source] < TRAVEL_PRIORITY)
      return false
    return this.claimed === null || GLANCE_PRIORITY[this.claimed.source] <= GLANCE_PRIORITY[source]
  }

  get onCursor(): boolean {
    return this.target === 'cursor'
  }

  /** Where the current fixation rests, or where the saccade in flight will land. */
  get fixationPoint(): Readonly<GazePoint> {
    return this.onCursor ? this.pursuit : this.endpoint
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
    this.claimed = null
    if (active) {
      if (at - this.asideReleasedAt > asideSideMemory)
        this.asideSide = this.random() < 0.5 - 0.15 * this.inward ? -1 : 1
      this.aside = { x: this.asideSide * targets.aside.x, y: targets.aside.y }
      this.saccadeTo(this.jittered(this.aside), at)
      this.targetKind = 'aside'
      return
    }
    this.aside = null
    this.asideReleasedAt = at
    this.saccadeTo(this.jittered(targets.camera), at)
    this.targetKind = 'camera'
  }

  /**
   * Starts an attention shift at `at`: the gaze moves to a newly drawn target first,
   * and the caller starts the matching posture shift slightly later. `wide`, 0 to 1, is how far the shift carries
   * the head: a wide shift places its desk and side fixations up to 2.5 times as far from the camera and holds the
   * fixation up to 0.8 s longer. At 0 the shift is an ordinary fixation, with the same draws.
   */
  beginAttentionShift(at: number, wide = 0) {
    this.fixateNext(at, wide)
  }

  /**
   * Asks the gaze arbiter for a held glance at `at`. When it starts, the gaze saccades to the request's point and holds
   * it for its hold before autonomous fixations resume, and the request holds the claim until then. Returns the
   * active-time end of the hold, including the approach saccade, or null when the arbiter refused the request: a
   * running glance ranks higher, an override holds, she walks and the source ranks below travel, or the target is
   * missing. A refusal is dropped, never queued. While she walks the hold is capped at {@link TRAVEL_GLANCE_MAX_SECONDS},
   * and the report carries the capped hold. A chat read relinquishes its hold when the chat target is cleared,
   * including while talking.
   */
  glance(request: GlanceRequest, at: number): number | null {
    const point = request.point === null ? null : { ...request.point }
    if (request.point === null || !this.admits(request.source)) {
      this.report?.({ at, source: request.source, outcome: 'refused', point, hold: request.hold })
      return null
    }
    const read = request.source === 'chat-sent' || request.source === 'chat-unfold'
    const hold = this.traveling ? Math.min(request.hold, TRAVEL_GLANCE_MAX_SECONDS) : request.hold
    this.saccadeTo(request.point, at, hold)
    this.chatRead = read
    this.targetKind = read ? 'chat' : 'glance'
    this.claimed = { source: request.source, until: this.nextFixationAt }
    this.report?.({ at, source: request.source, outcome: 'started', point, hold })
    return this.nextFixationAt
  }

  /** Realises a look tool in eye space; away draws an aside side, and a missing target is reported as refused. */
  look(target: GazePoint | 'away' | null, hold: number, at: number): number | null {
    const point = target === 'away'
      ? { x: (this.random() < 0.5 - 0.15 * this.inward ? -1 : 1) * targets.aside.x, y: targets.aside.y }
      : target
    return this.glance({ source: 'look-tool', point, hold }, at)
  }

  /**
   * Ends the running glance early when one of `sources` holds it: the next autonomous fixation is drawn at `at`.
   * A glance another caller started since keeps its hold, so releasing a lower glance never cuts a higher one.
   * A no-op once the hold has passed.
   */
  endHold(at: number, sources: ReadonlySet<GlanceSource>) {
    if (this.claimed === null || !sources.has(this.claimed.source))
      return
    this.nextFixationAt = Math.min(this.nextFixationAt, at)
    this.claimed = null
  }

  /** Advances by `dt` seconds and returns the gaze point before head compensation. */
  step(dt: number): GazePoint {
    const previousTime = this.time
    this.time += dt
    while (this.time >= this.nextFixationAt)
      this.fixateNext(this.nextFixationAt)
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
    this.onChat = false
    this.chatRead = false
    if (target === 'cursor')
      this.targetKind = 'cursor'
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

  /** `reach` multiplies how far the desk and side fixations lie from the camera. */
  private drawTarget(reach = 1): Target {
    this.onChat = false
    if (this.override) {
      this.targetKind = 'override'
      return this.jittered(this.override)
    }
    // Aside attention outranks the camera-fixation probability, so a hold that raises it cannot pull the gaze back.
    if (this.aside) {
      this.targetKind = 'aside'
      return this.jittered(this.aside)
    }
    if (this.chatPoint && this.chatTyping && this.chatRandom() < 0.35) {
      this.onChat = true
      this.targetKind = 'chat'
      return this.jitteredWith(this.chatPoint, this.chatRandom)
    }
    if (this.cursor && this.weight > 0 && this.random() < cursorWeight * this.weight)
      return 'cursor'
    const choice = this.random()
    if (choice < this.cameraFixationProbability) {
      this.targetKind = 'camera'
      return this.jittered(targets.camera)
    }
    // The remainder splits by weight between desk and randomly sided peripheral targets.
    // With the default weights (1, 1, 0) the thresholds equal the even desk/peripheral split.
    const { desk, peripheral, peripheralUp } = this.targetWeights
    const rest = 1 - this.cameraFixationProbability
    const total = desk + peripheral + peripheralUp
    if (choice < this.cameraFixationProbability + rest * desk / total) {
      this.targetKind = this.screenPointActive ? 'screen' : 'desk'
      return this.jittered(this.screenPointActive ? this.screenPoint() : { x: targets.desk.x, y: reach * targets.desk.y })
    }
    const side = this.random() < 0.5 - 0.15 * this.inward ? -1 : 1
    const up = peripheralUp > 0 && choice >= this.cameraFixationProbability + rest * (desk + peripheral) / total
    const sideTarget = up ? targets.peripheralUp : targets.peripheral
    this.targetKind = up ? 'side-up' : 'side'
    return this.jittered({ x: reach * side * sideTarget.x, y: reach * sideTarget.y })
  }

  private jittered(point: GazePoint): GazePoint {
    return { x: point.x + targetJitter * gaussian(this.random), y: point.y + targetJitter * gaussian(this.random) }
  }

  private jitteredWith(point: GazePoint, random: RandomStream): GazePoint {
    return { x: point.x + targetJitter * gaussian(random), y: point.y + targetJitter * gaussian(random) }
  }

  private fixateNext(at: number, wide = 0) {
    this.claimed = null
    const target = this.drawTarget(1 + (wideReach - 1) * wide)
    const onChat = this.onChat
    const hold = onChat ? this.drawHold(this.chatRandom) : wide === 0 ? undefined : this.drawHold() + wideHoldSeconds * wide
    this.saccadeTo(target, at, hold)
    this.onChat = onChat
    if (onChat && target !== 'cursor' && hold !== undefined)
      this.report?.({ at, source: 'chat-typing', outcome: 'started', point: target, hold })
  }

  private drawHold(random = this.random) {
    return truncatedLognormal(random, 1, 0.7, 0.18, 5)
  }
}

/** Saccade duration in seconds for an amplitude in approximate degrees. */
function saccadeSeconds(amplitude: number) {
  return Math.min(0.090, Math.max(0.035, 0.030 + 0.0025 * amplitude))
}

/**
 * Turns a share of posture shifts into gaze-led attention shifts: about 30% without pep.
 * Call `update` once per grid step, before stepping posture and gaze over `[stepStart, stepStart + dt]`.
 * The gaze saccade starts at the scheduled shift time, and the shift is postponed by 30-80 ms (uniform).
 */
export class NaturalAttentionShifts {
  /** Share of posture shifts the gaze leads. @default 0.3 */
  share = attentionShare
  /** How wide each led shift is, 0 to 1; see {@link NaturalGazeLayer.beginAttentionShift}. @default 0 */
  wide = 0
  private decidedFor = -1
  /** `shiftCount` of the latest posture shift that the gaze led, or -1 before the first. */
  ledShift = -1

  constructor(private readonly random: RandomStream) {}

  update(posture: Pick<NaturalPostureLayers, 'shiftCount' | 'secondsUntilShift' | 'postponeShift'>, gaze: NaturalGazeLayer, stepStart: number, dt: number) {
    const untilShift = posture.secondsUntilShift
    // Decide once per shift, in the step where it would begin.
    if (this.decidedFor === posture.shiftCount || untilShift > dt)
      return
    this.decidedFor = posture.shiftCount
    if (this.random() >= this.share)
      return
    gaze.beginAttentionShift(stepStart + untilShift, this.wide)
    this.ledShift = posture.shiftCount + 1
    posture.postponeShift(attentionLead.min + (attentionLead.max - attentionLead.min) * this.random())
  }
}
