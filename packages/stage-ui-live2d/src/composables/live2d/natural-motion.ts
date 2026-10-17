import type { NaturalBreathOutput } from './natural-motion/breath'
import type { NaturalFaceOutput } from './natural-motion/face'
import type { GazePoint } from './natural-motion/gaze'
import type { PostureHome, Vec3 } from './natural-motion/posture'
import type { RandomStream } from './natural-motion/random'
import type { Live2DRigProfile } from './natural-motion/rig-profile'

import { NaturalBlinkScheduler } from './natural-motion/blink'
import { NaturalBodyLayer } from './natural-motion/body'
import { NaturalBreathLayer } from './natural-motion/breath'
import { NaturalFaceLayer } from './natural-motion/face'
import { NaturalAttentionShifts, NaturalGazeLayer } from './natural-motion/gaze'
import { NaturalPostureLayers, postureHomes } from './natural-motion/posture'
import { createRandomStream, deriveSeed } from './natural-motion/random'

export interface Live2DNaturalMotionOptions {
  /** Seeds every layer stream; equal seeds replay equal motion. Takes precedence over `random`. */
  seed?: number
  /** Draws the seed when `seed` is absent. @default Math.random */
  random?: RandomStream
  /** Rest posture; `desk` is the calibration fixture of the liveliness gate. @default 'product' */
  home?: PostureHome
}

/** Normalized pose commands in [-1, 1]. */
export interface Live2DNaturalMotionPose {
  headX: number
  headY: number
  headZ: number
  /** `null` when rig physics derives this body axis from the head, so the consumer skips the write. */
  bodyX: number | null
  bodyY: number | null
  bodyZ: number | null
  /** Shared by both eyes, so pupils stay conjugate. */
  eyeX: number
  eyeY: number
}

/** Voice activity inputs. The host derives both from speech output and voice detection. */
export interface Live2DNaturalMotionVoice {
  /** Speech output is playing; breath becomes shallower. */
  speaking: boolean
  /** Speech is active or ended moments ago; lipsync owns the mouth, so silent mouth openings stop. */
  speechActiveOrRecent: boolean
}

export interface Live2DNaturalMotionFrame {
  pose: Live2DNaturalMotionPose
  /** Unclamped gaze point before head compensation. */
  fixation: GazePoint
  face: NaturalFaceOutput
  /** `blinkFactor` multiplies eye openness: 1 open, 0 closed. */
  blink: { blinkFactor: number }
  breath: NaturalBreathOutput
}

// Layer stream indices for `deriveSeed`. Appending layers keeps existing sequences stable.
// Index 4 belonged to the v1 fixation rule and now seeds the gaze layer that replaces it.
const streamIndex = { drift: 0, continuous: 1, gain: 2, shift: 3, gaze: 4, attention: 5, body: 6, face: 7, blink: 8, breath: 9 }

// Fixed integration grid. Processes advance only in whole steps and the output is
// interpolated between the two grid states around the current time, so frame
// partition never changes the sampled path and draws stay deterministic per seed.
const step = 1 / 120

// Critically damped follower time constants (seconds) of the v1 cursor head bias.
const followers = {
  cursorX: 0.14,
  cursorY: 0.17,
}

type Axis = keyof typeof followers

interface Snapshot {
  head: Vec3
  body: Vec3
  gaze: GazePoint
  face: NaturalFaceOutput
  blinkFactor: number
  breath: NaturalBreathOutput
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function lerp(a: number, b: number, weight: number) {
  return a + (b - a) * weight
}

function lerpRecord<T extends Record<keyof T, number>>(a: T, b: T, weight: number): T {
  return Object.fromEntries(Object.keys(a).map(key => [key, lerp(a[key as keyof T], b[key as keyof T], weight)])) as T
}

/**
 * Owns autonomous posture, gaze, body, face, blink, and breath, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes every process and active time; resume continues from the frozen state.
 * Cursor expiry and disabled attention are represented by a null cursor.
 */
export class Live2DNaturalMotion {
  private readonly posture: NaturalPostureLayers
  private readonly gaze: NaturalGazeLayer
  private readonly body: NaturalBodyLayer
  private readonly attention: NaturalAttentionShifts
  private readonly face: NaturalFaceLayer
  private readonly blink: NaturalBlinkScheduler
  private readonly breath: NaturalBreathLayer
  private voice: Live2DNaturalMotionVoice = { speaking: false, speechActiveOrRecent: false }
  private saccadeCount = 0
  private cursor: GazePoint | null = null
  private bodyFromHeadPhysics: Live2DRigProfile['bodyFromHeadPhysics'] = { x: false, y: false, z: false }
  private shiftCount = 0
  private readonly u = Object.fromEntries(Object.keys(followers).map(axis => [axis, 0])) as Record<Axis, number>
  private readonly x = { ...this.u }
  private lastTimestamp: number | undefined
  private activeTime = 0
  private stepIndex = 0
  private previous: Snapshot
  private next: Snapshot
  private suspended = false

  constructor(options: Live2DNaturalMotionOptions = {}) {
    const seed = options.seed ?? Math.floor((options.random ?? Math.random)() * 2 ** 32)
    const stream = (layer: keyof typeof streamIndex) => createRandomStream(deriveSeed(seed, streamIndex[layer]))
    const home = postureHomes[options.home ?? 'product']
    this.posture = new NaturalPostureLayers([...home], {
      drift: stream('drift'),
      continuous: stream('continuous'),
      gain: stream('gain'),
      shift: stream('shift'),
    })
    this.gaze = new NaturalGazeLayer(stream('gaze'))
    this.body = new NaturalBodyLayer(stream('body'), home)
    this.attention = new NaturalAttentionShifts(stream('attention'))
    this.face = new NaturalFaceLayer(stream('face'))
    this.blink = new NaturalBlinkScheduler(stream('blink'))
    this.breath = new NaturalBreathLayer(stream('breath'))
    this.previous = { head: [...home], body: this.body.pose, gaze: { x: 0, y: 0 }, face: NaturalFaceLayer.rest(), blinkFactor: 1, breath: this.breath.output }
    this.next = this.integrate()
  }

  /** Returns a fresh normalized pose, the unclamped gaze point (before head compensation), and face, blink, and breath channels. */
  advance(nowSeconds: number): Live2DNaturalMotionFrame {
    const elapsed = this.lastTimestamp === undefined ? 0 : nowSeconds - this.lastTimestamp
    this.lastTimestamp = nowSeconds
    if (!this.suspended && elapsed > 0) {
      this.activeTime += elapsed
      while (this.activeTime > this.stepIndex * step) {
        this.previous = this.next
        this.next = this.integrate()
      }
    }
    const weight = clamp((this.activeTime - (this.stepIndex - 1) * step) / step, 1)
    const { previous: a, next: b } = this
    const breath = lerpRecord(a.breath, b.breath, weight)
    const [headX, postureY, headZ] = a.head.map((value, axis) => lerp(value, b.head[axis], weight))
    // Breath coupling (0.001, see breath.ts) rides on the applied pitch, so eye compensation sees it too.
    const headY = clamp(postureY + breath.headY, 1)
    const [bodyX, bodyY, bodyZ] = a.body.map((value, axis) => lerp(value, b.body[axis], weight))
    const fixation = { x: lerp(a.gaze.x, b.gaze.x, weight), y: lerp(a.gaze.y, b.gaze.y, weight) }
    const eye = NaturalGazeLayer.eye(fixation, { x: headX, y: headY })
    const physics = this.bodyFromHeadPhysics
    return {
      pose: {
        headX,
        headY,
        headZ,
        bodyX: physics.x ? null : bodyX,
        bodyY: physics.y ? null : bodyY,
        bodyZ: physics.z ? null : bodyZ,
        eyeX: clamp(eye.x, 0.95),
        eyeY: clamp(eye.y, 0.95),
      },
      fixation,
      face: {
        ...lerpRecord(a.face, b.face, weight),
        // Grid states integrated before a voice change may still hold an opening.
        ...(this.voice.speechActiveOrRecent ? { silentMouthOpen: 0 } : {}),
      },
      blink: { blinkFactor: lerp(a.blinkFactor, b.blinkFactor, weight) },
      breath,
    }
  }

  /** Applies voice activity from the next grid step; the mouth suppression applies immediately. */
  setVoice(voice: Live2DNaturalMotionVoice) {
    this.voice = { ...voice }
    this.face.speechActiveOrRecent = voice.speechActiveOrRecent
    this.breath.speaking = voice.speaking
  }

  /** Changes attention after advancing to this timestamp; it takes effect from the next grid step. */
  setCursor(target: GazePoint | null, nowSeconds: number) {
    this.advance(nowSeconds)
    this.cursor = target === null ? null : { x: clamp(target.x, 1), y: clamp(target.y, 1) }
  }

  /** Suspension freezes every layer; resume keeps all state, so output continues without a jump. */
  setSuspended(suspended: boolean, nowSeconds: number) {
    this.advance(nowSeconds)
    this.suspended = suspended
  }

  /**
   * Applies rig ownership. Body axes that rig physics derives from the head are
   * reported as `null`; their processes keep running, so ownership changes never reset motion.
   */
  setRigProfile(profile: Pick<Live2DRigProfile, 'bodyFromHeadPhysics'>) {
    this.bodyFromHeadPhysics = { ...profile.bodyFromHeadPhysics }
  }

  /** Advances every process by one grid step and returns the new grid state. */
  private integrate(): Snapshot {
    const stepStart = this.stepIndex * step
    this.stepIndex++
    const c = this.cursor
    this.gaze.setCursor(c, stepStart)
    this.attention.update(this.posture, this.gaze, stepStart, step)
    // Cursor attention keeps the v1 head bias, smoothed so cursor changes never jump.
    this.follow({
      cursorX: 0.25 * (c?.x ?? 0),
      cursorY: 0.20 * (c?.y ?? 0),
    })
    const head = this.posture.step(step, [this.x.cursorX, this.x.cursorY, 0])
    if (this.posture.shiftCount !== this.shiftCount) {
      this.shiftCount = this.posture.shiftCount
      this.body.beginShift()
    }
    const gaze = this.gaze.step(step)
    if (this.gaze.saccadeCount !== this.saccadeCount) {
      this.saccadeCount = this.gaze.saccadeCount
      this.blink.onGazeShift(this.gaze.saccadeSize)
      this.face.onGazeShift(this.gaze.saccadeSize)
    }
    return {
      head,
      body: this.body.step(step, head),
      gaze,
      face: this.face.step(step),
      blinkFactor: this.blink.step(step),
      breath: this.breath.step(step),
    }
  }

  /** Exact two-stage critically damped follower update over one grid step. */
  private follow(targets: Record<Axis, number>) {
    for (const [axis, target] of Object.entries(targets) as [Axis, number][]) {
      const h = step / followers[axis]
      const e = Math.exp(-h)
      const oldU = this.u[axis]
      this.u[axis] = target + (oldU - target) * e
      this.x[axis] = target + ((this.x[axis] - target) + (oldU - target) * h) * e
    }
  }
}
