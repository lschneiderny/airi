interface Point {
  x: number
  y: number
}

interface Posture extends Point {
  z: number
}

const followers = {
  headX: 0.14,
  headY: 0.17,
  headZ: 0.19,
  bodyX: 0.32,
  bodyY: 0.36,
  bodyZ: 0.38,
  fixationX: 0.024,
  fixationY: 0.028,
}

type Axis = keyof typeof followers

function createState(): Record<Axis, number> {
  return { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0, fixationX: 0, fixationY: 0 }
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

/**
 * Owns autonomous posture and gaze, without model or renderer state.
 * Times are monotonic seconds. The first advance establishes the time origin.
 * Suspension freezes followers and active time, cancelling the pending follow-up.
 * Cursor expiry and disabled attention are represented by a null cursor.
 */
export class Live2DNaturalMotion {
  private posture: Posture = { x: 0, y: 0, z: 0 }
  private fixation: Point = { x: 0, y: 0 }
  private cursor: Point | null = null
  private u = createState()
  private x = createState()
  private lastTimestamp: number | undefined
  private activeTime = 0
  private primaryDeadline = 1.4
  private followUp: { deadline: number, destination: Posture, strength: number } | undefined
  private suspended = false

  /** @param random Random source in [0,1). Defaults to Math.random. */
  constructor(private readonly random: () => number = Math.random) {}

  /** Returns a fresh normalized pose and unclamped filtered fixation metadata. */
  advance(nowSeconds: number) {
    const elapsed = this.lastTimestamp === undefined ? 0 : nowSeconds - this.lastTimestamp
    this.lastTimestamp = nowSeconds
    if (!this.suspended) {
      const end = this.activeTime + elapsed
      while (this.activeTime < end) {
        const deadline = Math.min(this.primaryDeadline, this.followUp?.deadline ?? Infinity)
        const next = Math.min(end, deadline)
        this.integrate(next - this.activeTime)
        this.activeTime = next
        if (next === deadline) {
          if (this.followUp && next === this.followUp.deadline) {
            this.adjust(this.followUp.destination, this.followUp.strength)
            this.followUp = undefined
          }
          else {
            this.schedulePrimary()
          }
        }
      }
    }
    const { headX, headY, headZ, bodyX, bodyY, bodyZ, fixationX, fixationY } = this.x
    return {
      pose: {
        headX,
        headY,
        headZ,
        bodyX,
        bodyY,
        bodyZ,
        eyeX: clamp(fixationX - headX, 0.95),
        eyeY: clamp(fixationY - headY, 0.95),
      },
      fixation: { x: fixationX, y: fixationY },
    }
  }

  /** Changes attention after advancing the preceding target to this timestamp. */
  setCursor(target: Point | null, nowSeconds: number) {
    this.advance(nowSeconds)
    this.cursor = target === null ? null : { x: clamp(target.x, 1), y: clamp(target.y, 1) }
  }

  /** Resume retains the pose and starts a fresh 1.4 active-second primary hold. */
  setSuspended(suspended: boolean, nowSeconds: number) {
    this.advance(nowSeconds)
    if (this.suspended === suspended)
      return
    this.suspended = suspended
    this.followUp = undefined
    if (!suspended)
      this.primaryDeadline = this.activeTime + 1.4
  }

  private adjust(destination: Posture, strength: number) {
    this.posture = {
      x: (1 - strength) * this.posture.x + strength * destination.x,
      y: (1 - strength) * this.posture.y + strength * destination.y,
      z: (1 - strength) * this.posture.z + strength * destination.z,
    }
  }

  private schedulePrimary() {
    // Fixed draw order: XYZ, strength, fixation choice, follow-up choice,
    // optional delay and strength, quiet-range choice, quiet duration.
    const destination = { x: 2 * this.random() - 1, y: 2 * this.random() - 1, z: 2 * this.random() - 1 }
    this.adjust(destination, 0.25 + 0.35 * this.random())
    if (this.random() < 0.35)
      this.fixation = { x: 0.4 * this.posture.x, y: 0.4 * this.posture.y }
    if (this.random() < 0.45) {
      this.followUp = {
        deadline: this.activeTime + 0.18 + 0.22 * this.random(),
        destination,
        strength: 0.08 + 0.12 * this.random(),
      }
    }
    const quiet = this.random() < 0.15 ? 5 + 4 * this.random() : 1.3 + 3.2 * this.random()
    this.primaryDeadline = this.activeTime + 0.9 + quiet
  }

  private integrate(dt: number) {
    const p = this.posture
    const c = this.cursor
    const target = {
      headX: 0.36 * p.x + 0.25 * (c?.x ?? 0),
      headY: 0.24 * p.y + 0.20 * (c?.y ?? 0),
      headZ: 0.30 * p.z,
      bodyX: 0.30 * p.x + 0.08 * (c?.x ?? 0),
      bodyY: 0.18 * p.y,
      bodyZ: 0.24 * p.z,
      fixationX: c ? 0.65 * c.x : this.fixation.x,
      fixationY: c ? 0.65 * c.y : this.fixation.y,
    }
    for (const axis of Object.keys(followers) as Axis[]) {
      const h = dt / followers[axis]
      const e = Math.exp(-h)
      const g = target[axis]
      const oldU = this.u[axis]
      this.u[axis] = g + (oldU - g) * e
      this.x[axis] = g + ((this.x[axis] - g) + (oldU - g) * h) * e
    }
  }
}
