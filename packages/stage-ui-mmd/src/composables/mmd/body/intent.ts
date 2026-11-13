import type { ClipMaskGroup } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { BodyGazeGoal, BodyHeadTerm, BodyIdleAct, BodyPerformanceInput } from '@proj-airi/motion-driver-humanoid/performance'
import type { Vec3 } from '@proj-airi/motion-driver-humanoid/types'
import type { NaturalBodyIntent, NaturalMotionFrame } from '@proj-airi/motion-driver-natural/frame-types'
import type { IdleBehaviourRecord } from '@proj-airi/motion-driver-natural/idle-activities'

/** One Natural head unit is 30 degrees, as the legacy MMD look-at mapped it. */
const HEAD_SPAN = Math.PI / 6
/** Natural's eye residue keeps its fast part only; the slow part is gaze the body already plans. */
const MICRO_TAU = 0.15
/** The performer starts a gaze shift when its goal jumps more than this in one tick (unit D contract, `gaze.ts`). */
const GAZE_CUT = 4 * Math.PI / 180
const GAZE_YAW = 24

const terms = ['emphasis', 'impulse', 'pet', 'held', 'gesture', 'cue'] as const satisfies readonly BodyHeadTerm[]
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/** What the body knows once per display frame; `gaze` is already resolved in the stance frame, in radians. */
export interface MMDBodyIntentFrame {
  readonly intent: NaturalBodyIntent
  readonly frame: NaturalMotionFrame
  readonly dt: number
  readonly gaze: BodyGazeGoal
  /** The viewer's direction in the stance frame, before Natural's fixation deflects it. */
  readonly viewerYaw: number
  readonly energy: number
  readonly stance: BodyPerformanceInput['directive']['stance']
  readonly dragging: boolean
  readonly owned: Readonly<Record<ClipMaskGroup, number>>
  readonly armLift: Readonly<Record<'left' | 'right', number>>
  readonly eyeLimits: { readonly yaw: number, readonly pitch: number }
}

export interface MMDBodyTick {
  /** Share of the display frame this tick closes, in (0, 1]. */
  readonly alpha: number
  readonly facingYaw: number
  readonly allowTurn: boolean
  readonly rootVelocity: Readonly<Vec3>
  readonly gait: BodyPerformanceInput['gait']
}

const rotation = () => ({ yaw: 0, pitch: 0, roll: 0 })

/**
 * Natural's idle behaviour as the performer reads it: its own seconds instead of Natural's clock, and a release only
 * for a behaviour let go before its planned end (one that ran its course is released at its end without a fade).
 */
export function bodyIdleAct(record: IdleBehaviourRecord): BodyIdleAct {
  const early = record.releasedAt !== null && record.releasedAt < record.end
  return {
    seq: record.seq,
    kind: record.kind,
    duration: record.end - record.start,
    release: early ? record.releaseSeconds : null,
    side: record.side,
    period: record.period,
    count: record.count,
    variant: record.variant,
    keys: record.keys,
    glances: record.glances,
  }
}

/**
 * Maps `controller.bodyIntent()` and the body's own state into `BodyPerformanceInput`. Continuous signals are blended
 * linearly across the ticks of one display frame, so a moving target is not a different stair-step at each refresh rate;
 * sequence records are copied once. The returned input is one preallocated object, borrowed until the next `tick`.
 */
export class MMDBodyIntent {
  /** Continuous scalars at the previous and current display frame, in the order `capture` writes them. */
  private readonly from = new Float64Array(40)
  private readonly to = new Float64Array(40)
  private captured = false
  private lowX = 0
  private lowY = 0
  /** The record `input.idle` was mapped from; a new record object is a start or a release. */
  private idleRecord: IdleBehaviourRecord | null = null
  private readonly input = {
    head: {
      attitude: rotation(),
      slow: rotation(),
      terms: { emphasis: rotation(), impulse: rotation(), pet: rotation(), held: rotation(), gesture: rotation(), cue: rotation() },
    },
    posture: { amplitude: 1, shiftRate: 1, support: null },
    gaze: { yaw: 0, pitch: 0, kind: 'sustained' as BodyGazeGoal['kind'], saccadeSeq: 0, blinkFactor: 1, micro: { yaw: 0, pitch: 0 } },
    breath: { phase: 0, period: 4, scale: 1 },
    voice: { speaking: false, level: 0, slow: 0, onsetSeq: 0, emphasis: null as BodyPerformanceInput['voice']['emphasis'] },
    mood: { valence: 0, arousal: 0, tension: 0 },
    energy: { level: 0.5, mode: 'idle' as BodyPerformanceInput['energy']['mode'], away: false, reactingUntil: 0 },
    held: { emotion: null as BodyPerformanceInput['held']['emotion'], strength: 0, level: 0, side: 1 },
    events: {
      impulse: null as BodyPerformanceInput['events']['impulse'],
      gesture: null as BodyPerformanceInput['events']['gesture'],
      cue: null as BodyPerformanceInput['events']['cue'],
      poke: null as BodyPerformanceInput['events']['poke'],
      pet: { level: 0, active: false, x: 0, y: 0 },
      react: null as BodyPerformanceInput['events']['react'],
    },
    directive: { stance: 'stand' as BodyPerformanceInput['directive']['stance'], rest: 'none' as const, act: null },
    facingYaw: 0,
    allowTurn: false,
    viewerYaw: 0,
    dragging: false,
    attention: { approach: 0, cursorShare: 0 },
    rootVelocity: { x: 0, y: 0, z: 0 },
    owned: { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 } as Record<ClipMaskGroup, number>,
    gait: null as BodyPerformanceInput['gait'],
    armLift: { left: 0, right: 0 },
    idle: null as BodyIdleAct | null,
  }

  /** Records a display frame's intent. Call once per frame before its ticks, also on frames that hold no tick. */
  capture(source: MMDBodyIntentFrame): void {
    const { intent, frame, gaze } = source
    const rate = 1 - Math.exp(-source.dt / MICRO_TAU)
    this.lowX += (frame.pose.eyeX - this.lowX) * rate
    this.lowY += (frame.pose.eyeY - this.lowY) * rate
    this.from.set(this.to)
    const to = this.to
    let i = 0
    const head = ([x, y, z]: readonly [number, number, number]) => {
      to[i++] = x * HEAD_SPAN
      to[i++] = -y * HEAD_SPAN
      to[i++] = -z * HEAD_SPAN
    }
    head(intent.head.posture)
    head(intent.head.slow)
    for (const term of terms)
      head(intent.head[term])
    // Angles that wrap are stored unwrapped against the previous frame, so a tick never blends across the seam.
    to[i] = this.captured ? this.from[i] + wrap(gaze.yaw - this.from[i]) : gaze.yaw
    i++
    to[i++] = gaze.pitch
    // A target that jumps is a cut, not motion: blending it would split one shift into one per tick, each with part of
    // the amplitude. It reaches the performer whole on the frame's first tick; continuous pursuit is still blended.
    if (Math.hypot(to[GAZE_YAW] - this.from[GAZE_YAW], to[GAZE_YAW + 1] - this.from[GAZE_YAW + 1]) > GAZE_CUT) {
      this.from[GAZE_YAW] = to[GAZE_YAW]
      this.from[GAZE_YAW + 1] = to[GAZE_YAW + 1]
    }
    to[i++] = (frame.pose.eyeX - this.lowX) * source.eyeLimits.yaw
    to[i++] = -(frame.pose.eyeY - this.lowY) * source.eyeLimits.pitch
    to[i] = this.captured ? this.from[i] + wrap(intent.breath.phase - this.from[i]) : intent.breath.phase
    i++
    to[i++] = intent.voice.level
    to[i++] = intent.voice.slow
    to[i++] = intent.mood.valence
    to[i++] = intent.mood.arousal
    to[i++] = intent.mood.tension
    to[i++] = intent.attention.approach
    to[i++] = intent.attention.cursorShare
    to[i++] = intent.held.level
    to[i++] = intent.touch.pet.level
    to[i++] = intent.touch.pet.x
    to[i++] = intent.touch.pet.y
    if (!this.captured)
      this.from.set(to)
    this.captured = true

    const input = this.input
    input.posture.amplitude = intent.posture.amplitude
    input.posture.shiftRate = intent.posture.shiftRate
    input.gaze.kind = gaze.kind
    input.viewerYaw = source.viewerYaw
    input.gaze.saccadeSeq = intent.gaze.saccadeSeq
    input.gaze.blinkFactor = frame.blink.blinkFactor
    input.breath.period = intent.breath.period
    input.breath.scale = intent.breath.scale
    input.voice.speaking = intent.voice.speaking
    input.voice.onsetSeq = intent.voice.onsetSeq
    input.voice.emphasis = intent.voice.emphasis
    input.energy.level = source.energy
    input.energy.mode = intent.energy.mode
    input.energy.away = intent.energy.away
    input.energy.reactingUntil = intent.energy.reactingUntil
    input.held.emotion = intent.held.emotion
    input.held.strength = intent.held.strength
    input.held.side = intent.held.side
    input.events.impulse = intent.impulse
    input.events.gesture = intent.gesture
    input.events.cue = intent.cue
    input.events.poke = intent.touch.poke
    input.events.pet.active = intent.touch.pet.active
    input.events.react = intent.react
    input.directive.stance = source.stance
    input.dragging = source.dragging
    Object.assign(input.owned, source.owned)
    input.armLift.left = source.armLift.left
    input.armLift.right = source.armLift.right
    const record = intent.idle.behaviour
    if (record !== this.idleRecord) {
      this.idleRecord = record
      input.idle = record && bodyIdleAct(record)
    }
  }

  tick(state: MMDBodyTick): BodyPerformanceInput {
    const { from, to } = this
    const value = (index: number) => from[index] + (to[index] - from[index]) * state.alpha
    const input = this.input
    let i = 0
    const head = (out: { yaw: number, pitch: number, roll: number }) => {
      out.yaw = value(i++)
      out.pitch = value(i++)
      out.roll = value(i++)
    }
    head(input.head.attitude)
    head(input.head.slow)
    for (const term of terms)
      head(input.head.terms[term])
    input.gaze.yaw = wrap(value(i++))
    input.gaze.pitch = value(i++)
    input.gaze.micro.yaw = value(i++)
    input.gaze.micro.pitch = value(i++)
    input.breath.phase = value(i++)
    input.voice.level = value(i++)
    input.voice.slow = value(i++)
    input.mood.valence = value(i++)
    input.mood.arousal = value(i++)
    input.mood.tension = value(i++)
    input.attention.approach = value(i++)
    input.attention.cursorShare = value(i++)
    input.held.level = value(i++)
    input.events.pet.level = value(i++)
    input.events.pet.x = value(i++)
    input.events.pet.y = value(i++)
    input.facingYaw = state.facingYaw
    input.allowTurn = state.allowTurn
    input.rootVelocity.x = state.rootVelocity.x
    input.rootVelocity.y = state.rootVelocity.y
    input.rootVelocity.z = state.rootVelocity.z
    input.gait = state.gait
    return input
  }

  /** The performer was reset: the next capture starts a fresh blend. */
  reset(): void {
    this.captured = false
    this.lowX = 0
    this.lowY = 0
    this.idleRecord = null
    this.input.idle = null
  }
}
