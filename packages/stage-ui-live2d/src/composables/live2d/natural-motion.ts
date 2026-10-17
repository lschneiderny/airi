import type { PostureHome, Vec3 } from './natural-motion/posture'
import type { RandomStream } from './natural-motion/random'

import { NaturalPostureLayers, postureHomes } from './natural-motion/posture'
import { createRandomStream, deriveSeed } from './natural-motion/random'

interface Point {
  x: number
  y: number
}

export interface Live2DNaturalMotionOptions {
  /** Seeds every layer stream; equal seeds replay equal motion. Takes precedence over `random`. */
  seed?: number
  /** Draws the seed when `seed` is absent. @default Math.random */
  random?: RandomStream
  /** Rest posture; `desk` is the calibration fixture of the liveliness gate. @default 'product' */
  home?: PostureHome
}

// Layer stream indices for `deriveSeed`. Appending layers keeps existing sequences stable.
const streamIndex = { drift: 0, continuous: 1, gain: 2, shift: 3, fixation: 4 }

// Fixed integration grid. Processes advance only in whole steps and the output is
// interpolated between the two grid states around the current time, so frame
// partition never changes the sampled path and draws stay deterministic per seed.
const step = 1 / 120

// v1 critically damped follower time constants (seconds); body and eyes keep v1 behavior until gaze/body layers land.
const followers = {
  cursorX: 0.14,
  cursorY: 0.17,
  bodyX: 0.32,
  bodyY: 0.36,
  bodyZ: 0.38,
  fixationX: 0.024,
  fixationY: 0.028,
}

type Axis = keyof typeof followers

interface Snapshot {
  head: Vec3
  body: Vec3
  fixation: Point
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function lerp(a: number, b: number, weight: number) {
  return a + (b - a) * weight
}

/**
 * Owns autonomous posture and gaze, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes every process and active time; resume continues from the frozen state.
 * Cursor expiry and disabled attention are represented by a null cursor.
 */
export class Live2DNaturalMotion {
  private readonly posture: NaturalPostureLayers
  private readonly fixationRandom: RandomStream
  private cursor: Point | null = null
  private fixationTarget: Point = { x: 0, y: 0 }
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
    this.fixationRandom = stream('fixation')
    this.previous = { head: [...home], body: [0, 0, 0], fixation: { x: 0, y: 0 } }
    this.next = this.integrate()
  }

  /** Returns a fresh normalized pose and unclamped filtered fixation metadata. */
  advance(nowSeconds: number) {
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
    const fixation = { x: lerp(a.fixation.x, b.fixation.x, weight), y: lerp(a.fixation.y, b.fixation.y, weight) }
    return {
      pose: {
        headX,
        headY,
        headZ,
        bodyX,
        bodyY,
        bodyZ,
        eyeX: clamp(fixation.x - headX, 0.95),
        eyeY: clamp(fixation.y - headY, 0.95),
      },
      fixation,
    }
  }

  /** Changes attention after advancing to this timestamp; it takes effect from the next grid step. */
  setCursor(target: Point | null, nowSeconds: number) {
    this.advance(nowSeconds)
    this.cursor = target === null ? null : { x: clamp(target.x, 1), y: clamp(target.y, 1) }
  }

  /** Suspension freezes every layer; resume keeps all state, so output continues without a jump. */
  setSuspended(suspended: boolean, nowSeconds: number) {
    this.advance(nowSeconds)
    this.suspended = suspended
  }

  /** Advances every process by one grid step and returns the new grid state. */
  private integrate(): Snapshot {
    this.stepIndex++
    const c = this.cursor
    // Cursor attention keeps the v1 head bias, smoothed so cursor changes never jump.
    this.follow({
      cursorX: 0.25 * (c?.x ?? 0),
      cursorY: 0.20 * (c?.y ?? 0),
    })
    const head = this.posture.step(step, [this.x.cursorX, this.x.cursorY, 0])
    const shift = this.posture.shiftTarget
    if (this.posture.shiftCount !== this.shiftCount) {
      this.shiftCount = this.posture.shiftCount
      // v1 fixation rule: 35% of posture shifts move fixation with the head (v1 used 0.4 x posture with head 0.36 x posture).
      if (this.fixationRandom() < 0.35)
        this.fixationTarget = { x: 0.4 / 0.36 * shift[0], y: 0.4 / 0.24 * shift[1] }
    }
    // v1 body targets as a fraction of the posture destination (v1 body/head gain ratios).
    this.follow({
      bodyX: 0.30 / 0.36 * shift[0] + 0.08 * (c?.x ?? 0),
      bodyY: 0.18 / 0.24 * shift[1],
      bodyZ: 0.24 / 0.30 * shift[2],
      fixationX: c ? 0.65 * c.x : this.fixationTarget.x,
      fixationY: c ? 0.65 * c.y : this.fixationTarget.y,
    })
    return {
      head,
      body: [clamp(this.x.bodyX, 1), clamp(this.x.bodyY, 1), clamp(this.x.bodyZ, 1)],
      fixation: { x: this.x.fixationX, y: this.x.fixationY },
    }
  }

  /** Exact two-stage critically damped follower update over one grid step. */
  private follow(targets: Partial<Record<Axis, number>>) {
    for (const [axis, target] of Object.entries(targets) as [Axis, number][]) {
      const h = step / followers[axis]
      const e = Math.exp(-h)
      const oldU = this.u[axis]
      this.u[axis] = target + (oldU - target) * e
      this.x[axis] = target + ((this.x[axis] - target) + (oldU - target) * h) * e
    }
  }
}
