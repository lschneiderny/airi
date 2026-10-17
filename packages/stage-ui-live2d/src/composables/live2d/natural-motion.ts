import type { GazePoint } from './natural-motion/gaze'
import type { PostureHome, Vec3 } from './natural-motion/posture'
import type { RandomStream } from './natural-motion/random'
import type { Live2DRigProfile } from './natural-motion/rig-profile'

import { NaturalBodyLayer } from './natural-motion/body'
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

// Layer stream indices for `deriveSeed`. Appending layers keeps existing sequences stable.
// Index 4 belonged to the v1 fixation rule and now seeds the gaze layer that replaces it.
const streamIndex = { drift: 0, continuous: 1, gain: 2, shift: 3, gaze: 4, attention: 5, body: 6 }

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
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function lerp(a: number, b: number, weight: number) {
  return a + (b - a) * weight
}

/**
 * Owns autonomous posture, gaze, and body, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes every process and active time; resume continues from the frozen state.
 * Cursor expiry and disabled attention are represented by a null cursor.
 */
export class Live2DNaturalMotion {
  private readonly posture: NaturalPostureLayers
  private readonly gaze: NaturalGazeLayer
  private readonly body: NaturalBodyLayer
  private readonly attention: NaturalAttentionShifts
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
    this.previous = { head: [...home], body: this.body.pose, gaze: { x: 0, y: 0 } }
    this.next = this.integrate()
  }

  /** Returns a fresh normalized pose and the unclamped gaze point (before head compensation) as fixation metadata. */
  advance(nowSeconds: number): { pose: Live2DNaturalMotionPose, fixation: GazePoint } {
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
    const [headX, headY, headZ] = a.head.map((value, axis) => lerp(value, b.head[axis], weight))
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
    }
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
    return {
      head,
      body: this.body.step(step, head),
      gaze: this.gaze.step(step),
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
