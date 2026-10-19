/** Where a pointer sample lands on the model; `null` is outside the measured model. */
export type Live2DTouchRegion = 'head' | 'body'

/**
 * One pointer observation in model canvas space.
 *
 * `scale` is the length the thresholds are measured against: the head width while the
 * model states a head, otherwise the model width. Measuring in model units keeps the
 * gesture independent of how large the character is drawn.
 */
export interface Live2DTouchSample {
  /** Milliseconds on one monotonic clock shared by every call. */
  timeMs: number
  x: number
  y: number
  region: Live2DTouchRegion | null
  scale: number
}

export type Live2DTouchEvent
  = | { kind: 'poke', region: Live2DTouchRegion, x: number, y: number }
    | { kind: 'pet-start' }
    | { kind: 'pet-end', durationMs: number }

export interface Live2DTouchGestureOptions {
  /** Pets count only while the primary button is held. @default false */
  requireHold?: boolean
}

/** A press released within this time and distance is a poke. */
const pokeMaxMs = 400
const pokeMaxTravel = 0.05
/** Movement over the head inside this window decides whether a pet starts. */
const petWindowMs = 1000
/** Head-relative path length the window must hold before a pet starts. */
const petStartTravel = 0.5
/** Segments shorter than this neither count as a reversal nor reset one. */
const reversalStep = 0.02
/** A pet ends after this long without movement over the head. */
const petIdleMs = 600
/** A pet ends after the pointer has been off the head this long. */
const petLeaveMs = 250

interface Point {
  timeMs: number
  x: number
  y: number
}

/**
 * Classifies pointer input over a Live2D model into pokes and pets.
 *
 * Use when:
 * - A scene forwards press, move, release, and cancel samples already mapped into model space
 *
 * Expects:
 * - `update` runs regularly (once per rendered frame is enough), so a pet ends when the pointer stops
 *
 * Returns:
 * - Events from each call, in order; `petting` reports the current pet state
 *
 * A poke is a short press that barely moves over any part of the model. A pet is movement
 * that stays over the head: half a head width of travel within one second. Without a held
 * button the travel must also reverse direction at least once, so a cursor passing over
 * the head on its way elsewhere is not a pet. With `requireHold`, only movement while the
 * button is held counts, and the press that turns into a pet is never also a poke.
 */
export class Live2DTouchGestures {
  requireHold: boolean
  /** The press that may still become a poke; cleared once it turns into a pet. */
  private press: (Point & { region: Live2DTouchRegion, scale: number }) | undefined
  /** Whether a press that started over the model is still held. */
  private held = false
  private trail: Point[] = []
  private petStartedAtMs: number | undefined
  private lastHeadMoveAtMs = 0
  private leftHeadAtMs: number | undefined

  constructor(options: Live2DTouchGestureOptions = {}) {
    this.requireHold = options.requireHold ?? false
  }

  get petting() {
    return this.petStartedAtMs !== undefined
  }

  pressed(sample: Live2DTouchSample): Live2DTouchEvent[] {
    this.press = sample.region === null ? undefined : { ...sample, region: sample.region }
    this.held = sample.region !== null
    // A held pet starts from this press, so earlier hover movement does not count toward it.
    if (this.requireHold)
      this.trail = []
    return []
  }

  moved(sample: Live2DTouchSample): Live2DTouchEvent[] {
    const counts = !this.requireHold || this.held
    if (sample.region !== 'head' || !counts) {
      this.trail = []
      if (this.petting)
        this.leftHeadAtMs ??= sample.timeMs
      return this.expire(sample.timeMs)
    }

    this.leftHeadAtMs = undefined
    const last = this.trail.at(-1)
    if (!last || Math.hypot(sample.x - last.x, sample.y - last.y) / sample.scale >= reversalStep / 2)
      this.lastHeadMoveAtMs = sample.timeMs
    this.trail.push({ timeMs: sample.timeMs, x: sample.x, y: sample.y })
    while (this.trail.length > 0 && sample.timeMs - this.trail[0].timeMs > petWindowMs)
      this.trail.shift()

    if (!this.petting && this.qualifies(sample.scale)) {
      this.petStartedAtMs = sample.timeMs
      // The press became a pet, so its release is not a poke.
      this.press = undefined
      return [{ kind: 'pet-start' }]
    }
    return this.expire(sample.timeMs)
  }

  released(sample: Live2DTouchSample): Live2DTouchEvent[] {
    const events: Live2DTouchEvent[] = []
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

  /** The pointer left the canvas or the browser cancelled it; any pet ends now. */
  cancelled(timeMs: number): Live2DTouchEvent[] {
    this.press = undefined
    this.held = false
    this.trail = []
    return this.petting ? [this.endPet(timeMs)] : []
  }

  /** Ends a pet whose pointer stopped moving or left the head. */
  update(timeMs: number): Live2DTouchEvent[] {
    return this.expire(timeMs)
  }

  private expire(timeMs: number): Live2DTouchEvent[] {
    if (!this.petting)
      return []
    const idle = timeMs - this.lastHeadMoveAtMs > petIdleMs
    const left = this.leftHeadAtMs !== undefined && timeMs - this.leftHeadAtMs > petLeaveMs
    return idle || left ? [this.endPet(timeMs)] : []
  }

  private endPet(timeMs: number): Live2DTouchEvent {
    const durationMs = timeMs - (this.petStartedAtMs ?? timeMs)
    this.petStartedAtMs = undefined
    this.leftHeadAtMs = undefined
    this.trail = []
    return { kind: 'pet-end', durationMs }
  }

  private qualifies(scale: number) {
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
      // A reversal flips the dominant axis of motion between two significant segments.
      if (direction && ((Math.abs(dx) >= Math.abs(dy) && sign.x !== 0 && sign.x === -direction.x)
        || (Math.abs(dy) > Math.abs(dx) && sign.y !== 0 && sign.y === -direction.y))) {
        reversals++
      }
      direction = sign
      anchor = point
    }
    return travel >= petStartTravel && (this.requireHold || reversals >= 1)
  }
}
