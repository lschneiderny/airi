import type { NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'

// Gesture rules and thresholds follow `stage-ui-live2d/src/composables/live2d/touch-gestures.ts`
// (Live2DTouchGestures); stage-ui-mmd must not import stage-ui-live2d.

/**
 * One pointer observation in canvas client pixels. `scale` is the projected head width, so
 * thresholds hold however large the model is drawn.
 */
export interface MMDTouchSample {
  /** Milliseconds on one monotonic clock shared by every call. */
  timeMs: number
  x: number
  y: number
  region: NaturalTouchRegion | null
  scale: number
  /** Offset from the projected head center, x right and y down, in head widths. */
  head?: { x: number, y: number, halfHeight: number }
}

export type MMDTouchEvent
  = | { kind: 'poke', region: NaturalTouchRegion, x: number, y: number }
    | { kind: 'pet-start' }
    | { kind: 'pet-end', durationMs: number }

const pokeMaxMs = 400
const pokeMaxTravel = 0.05
const pokeCommitMs = 90
const petWindowMs = 1500
const petStartTravel = 0.35
const idleStep = 0.03
const headMargin = { side: 0.5, top: 0.5, bottom: 0.15 }
const headExitMargin = { side: 1, top: 1, bottom: 0.6 }
const minInHeadShare = 0.5
const reversalStep = 0.02
const petIdleMs = 600
const petLeaveMs = 250

interface Point {
  timeMs: number
  x: number
  y: number
}

/**
 * Classifies pointer input over an MMD model into pokes and pets.
 *
 * Hover pokes commit after 90 ms of a still press, or on an earlier release. Pets need
 * 0.35 head widths of travel in 1.5 s with at least half the trail inside the head, and a
 * hover pet needs one reversal so a passing cursor never pets. A pet ends after 600 ms
 * without movement over the head or 250 ms off it. With `requireHold`, only held movement
 * counts. `update` must run every frame so pets end while the pointer rests.
 */
export class MMDTouchGestures {
  requireHold: boolean
  private press: (Point & { region: NaturalTouchRegion, scale: number }) | undefined
  private held = false
  private trail: (Point & { inHead: boolean })[] = []
  private moveAnchor: Point | undefined
  private petStartedAtMs: number | undefined
  private lastHeadMoveAtMs = 0
  private leftHeadAtMs: number | undefined

  constructor(options: { requireHold?: boolean } = {}) {
    this.requireHold = options.requireHold ?? false
  }

  get petting() {
    return this.petStartedAtMs !== undefined
  }

  get pressPending(): boolean {
    return this.held && this.press !== undefined
  }

  pressed(sample: MMDTouchSample): MMDTouchEvent[] {
    this.press = sample.region === null ? undefined : { ...sample, region: sample.region }
    this.held = sample.region !== null
    if (this.requireHold) {
      this.trail = []
      this.moveAnchor = undefined
    }
    return []
  }

  moved(sample: MMDTouchSample): MMDTouchEvent[] {
    if (this.press && Math.hypot(sample.x - this.press.x, sample.y - this.press.y) / this.press.scale > pokeMaxTravel)
      this.press = undefined
    const counts = !this.requireHold || this.held
    const head = sample.head
    const margin = this.petting ? headExitMargin : headMargin
    const inZone = head
      ? Math.abs(head.x) <= 0.5 + margin.side
      && head.y >= -head.halfHeight - margin.top && head.y <= head.halfHeight + margin.bottom
      : sample.region === 'head'
    if (!inZone || !counts) {
      if (this.petting) {
        this.leftHeadAtMs ??= sample.timeMs
      }
      else {
        this.trail = []
        this.moveAnchor = undefined
      }
      return this.update(sample.timeMs)
    }

    this.leftHeadAtMs = undefined
    if (!this.moveAnchor || Math.hypot(sample.x - this.moveAnchor.x, sample.y - this.moveAnchor.y) / sample.scale >= idleStep) {
      this.lastHeadMoveAtMs = sample.timeMs
      this.moveAnchor = sample
    }
    const inHead = head ? Math.abs(head.x) <= 0.5 && Math.abs(head.y) <= head.halfHeight : sample.region === 'head'
    this.trail.push({ timeMs: sample.timeMs, x: sample.x, y: sample.y, inHead })
    while (this.trail.length > 0 && sample.timeMs - this.trail[0].timeMs > petWindowMs)
      this.trail.shift()

    if (!this.petting && this.qualifies(sample.scale)) {
      this.petStartedAtMs = sample.timeMs
      this.press = undefined
      return [{ kind: 'pet-start' }]
    }
    return this.update(sample.timeMs)
  }

  released(sample: MMDTouchSample): MMDTouchEvent[] {
    const events: MMDTouchEvent[] = []
    const press = this.press
    this.press = undefined
    this.held = false
    if (this.requireHold && this.petting)
      events.push(this.endPet(sample.timeMs))
    if (press && !this.petting && sample.timeMs - press.timeMs <= pokeMaxMs
      && Math.hypot(sample.x - press.x, sample.y - press.y) / press.scale <= pokeMaxTravel) {
      events.push({ kind: 'poke', region: press.region, x: press.x, y: press.y })
    }
    return [...events, ...this.expire(sample.timeMs)]
  }

  /** The pointer left the canvas or was cancelled; a pet gets the same leave grace as leaving the head. */
  cancelled(timeMs: number): MMDTouchEvent[] {
    this.press = undefined
    this.held = false
    if (this.petting) {
      this.leftHeadAtMs ??= timeMs
      return this.expire(timeMs)
    }
    this.trail = []
    this.moveAnchor = undefined
    return []
  }

  /** Ends any gesture at once, for a model swap or disabled touch. */
  reset(timeMs: number): MMDTouchEvent[] {
    this.press = undefined
    this.held = false
    this.trail = []
    this.moveAnchor = undefined
    return this.petting ? [this.endPet(timeMs)] : []
  }

  update(timeMs: number): MMDTouchEvent[] {
    const press = this.press
    if (!this.requireHold && this.pressPending && press && timeMs - press.timeMs >= pokeCommitMs && !this.petting) {
      this.press = undefined
      return [{ kind: 'poke', region: press.region, x: press.x, y: press.y }]
    }
    return this.expire(timeMs)
  }

  private expire(timeMs: number): MMDTouchEvent[] {
    if (!this.petting)
      return []
    const idle = timeMs - this.lastHeadMoveAtMs > petIdleMs
    const left = this.leftHeadAtMs !== undefined && timeMs - this.leftHeadAtMs > petLeaveMs
    return idle || left ? [this.endPet(timeMs)] : []
  }

  private endPet(timeMs: number): MMDTouchEvent {
    const durationMs = timeMs - (this.petStartedAtMs ?? timeMs)
    this.petStartedAtMs = undefined
    this.leftHeadAtMs = undefined
    this.trail = []
    this.moveAnchor = undefined
    return { kind: 'pet-end', durationMs }
  }

  private qualifies(scale: number) {
    let inHeadMs = 0
    for (let index = 1; index < this.trail.length; index++) {
      if (this.trail[index - 1].inHead)
        inHeadMs += this.trail[index].timeMs - this.trail[index - 1].timeMs
    }
    const durationMs = this.trail[this.trail.length - 1].timeMs - this.trail[0].timeMs
    let travel = 0
    let reversals = 0
    let direction: { x: number, y: number } | undefined
    let anchor = this.trail[0]
    for (const point of this.trail.slice(1)) {
      const dx = (point.x - anchor.x) / scale
      const dy = (point.y - anchor.y) / scale
      if (Math.hypot(dx, dy) < reversalStep)
        continue
      travel += Math.hypot(dx, dy)
      const sign = { x: Math.sign(dx), y: Math.sign(dy) }
      if (direction && ((Math.abs(dx) >= Math.abs(dy) && sign.x !== 0 && sign.x === -direction.x)
        || (Math.abs(dy) > Math.abs(dx) && sign.y !== 0 && sign.y === -direction.y))) {
        reversals++
      }
      direction = sign
      anchor = point
    }
    return travel >= petStartTravel && (this.requireHold || reversals >= 1)
      && durationMs > 0 && inHeadMs / durationMs >= minInHeadShare
  }
}
