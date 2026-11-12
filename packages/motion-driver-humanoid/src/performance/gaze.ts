import type { BodyPerformanceInput } from './contracts'

import { advanceSecondOrder, createLagChain, minJerk, secondOrderCoefficients } from '../dynamics'
import { deriveSeed } from '../noise'
import { createRandomStream } from '../random'
import { BODY_TICK, DEG } from './channels'

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const pursuitCoefficients = secondOrderCoefficients({ f: 5, zeta: 1, r: 0 }, BODY_TICK)
const creepCoefficients = secondOrderCoefficients({ f: 1 / (Math.PI * 1.2), zeta: 1, r: 0 }, BODY_TICK)
const saccadeSeconds = (amplitude: number) => 0.025 + 0.0024 * amplitude / DEG
const headSeconds = (travel: number) => 0.28 + 0.0058 * travel / DEG

/** The share of a minimum-jerk move's time at which it has covered `fraction` of its distance. */
function minJerkTime(fraction: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (minJerk(mid) < fraction)
      lo = mid
    else
      hi = mid
  }
  return (lo + hi) / 2
}

/** The line leads; head then trunk take up the sustained eccentricity underneath it. */
export class BodyGaze {
  readonly line = { yaw: 0, pitch: 0 }
  lidClose = 0
  shifts = 0
  blinks = 0
  private readonly random
  private seq = 0
  private kind: BodyPerformanceInput['gaze']['kind'] = 'sustained'
  private lastYaw = 0
  private lastPitch = 0
  private fromYaw = 0
  private fromPitch = 0
  private toYaw = 0
  private toPitch = 0
  private elapsed = Infinity
  private duration = 0
  private landing = 1
  private readonly pursuit = [{ y: 0, v: 0, x: 0 }, { y: 0, v: 0, x: 0 }]
  private readonly head = [{ y: 0, v: 0, x: 0 }, { y: 0, v: 0, x: 0 }]
  private coefficients = secondOrderCoefficients({ f: 1.5, zeta: 0.72, r: 0.15 }, BODY_TICK)
  /** The neck follows the head goal through its own response, 1.6 times the head's frequency, so it starts the turn. */
  private neckCoefficients = secondOrderCoefficients({ f: 2.4, zeta: 0.9, r: 0 }, BODY_TICK)
  private readonly neck = [{ y: 0, v: 0, x: 0 }, { y: 0, v: 0, x: 0 }]
  private readonly trunk = createLagChain([0.095, 0.06, 0.08], BODY_TICK)
  private readonly trunkDrive = { y: 0, v: 0, x: 0 }
  private headLatency = 0
  private trunkLatency = 0
  private trunkGoal = 0
  private recruited = false
  private blinkElapsed = Infinity

  private sinceRecruit = Infinity

  /** A shift that recruited the head started less than 1.2 s ago: the head and trunk are still on their way. */
  get shifting(): boolean {
    return this.sinceRecruit < 1.2
  }

  private sinceBlink = Infinity
  /** The facing on the previous tick; null until the first tick, so a body created turned does not count as a turn. */
  private facing: number | null = null

  constructor(seed: number) {
    this.random = createRandomStream(deriveSeed(seed, 16))
  }

  step(input: BodyPerformanceInput, out: Float64Array): void {
    const goal = input.gaze
    this.sinceBlink += BODY_TICK
    this.sinceRecruit += BODY_TICK
    const jump = Math.hypot(wrap(goal.yaw - this.lastYaw), goal.pitch - this.lastPitch)
    const triggered = goal.saccadeSeq !== this.seq || goal.kind !== this.kind || jump > 4 * DEG
    this.seq = goal.saccadeSeq
    this.kind = goal.kind
    // A goal that arrives over several display frames, or Natural saccading to where the eyes already go, is the saccade
    // in flight: it is retargeted, not restarted, so the eyes keep moving and the head keeps its plan.
    if (triggered && this.elapsed < this.duration + (this.landing < 1 ? 0.18 : 0)) {
      this.retarget(goal.yaw, goal.pitch, input.facingYaw)
    }
    else if (triggered) {
      const amplitude = Math.hypot(wrap(goal.yaw - this.line.yaw), goal.pitch - this.line.pitch)
      this.shifts++
      this.fromYaw = this.line.yaw
      this.fromPitch = this.line.pitch
      this.toYaw = this.fromYaw + wrap(goal.yaw - this.fromYaw)
      this.toPitch = goal.pitch
      this.duration = saccadeSeconds(amplitude)
      this.elapsed = 0
      this.landing = amplitude > 15 * DEG ? 0.92 + 0.04 * this.random() : 1
      if (amplitude >= 10 * DEG)
        this.recruit(amplitude, goal.yaw, input.facingYaw)
      // Evinger et al. 1994 (Exp Brain Res 100:337): the lid closes with 97 % of gaze shifts larger than 33 degrees.
      const probability = Math.min(0.97, Math.max(0, 0.97 * (amplitude / DEG - 12) / 21))
      if (this.random() < probability && goal.blinkFactor > 0.95 && this.sinceBlink >= 0.4) {
        this.blinkElapsed = 0
        this.sinceBlink = 0
        this.blinks++
      }
    }
    this.lastYaw = goal.yaw
    this.lastPitch = goal.pitch
    this.advanceLine(goal.yaw, goal.pitch)
    // Architecture 5.5: the body turns under a head that is already there. The head and neck responses keep their
    // direction in space while the facing turns, as the vestibulo-collic reflex nulls a body rotation (Land 2004,
    // Exp Brain Res 159:151), so only a change of the goal in space moves them. Their velocity is a velocity in space
    // and is kept. The gaze trunk stays a share of the body and is not held.
    const turned = this.facing === null ? 0 : wrap(input.facingYaw - this.facing)
    this.facing = input.facingYaw
    for (const response of [this.head[0], this.neck[0]]) {
      response.y -= turned
      response.x -= turned
    }
    this.headLatency -= BODY_TICK
    this.trunkLatency -= BODY_TICK
    const relativeYaw = wrap(goal.yaw - input.facingYaw)
    // The trunk starts 120 ms after the head: through its latency it holds where it is, also when the new shift
    // reverses it or, for a free glance, unwinds it.
    if (this.trunkLatency <= 0) {
      this.trunkGoal = goal.kind === 'free'
        ? 0
        : Math.sign(relativeYaw) * Math.min(18 * DEG, 0.3 * Math.max(0, Math.abs(relativeYaw) - 25 * DEG))
    }
    // The gaze lag chain is driven by a turn shaped like the head's (architecture 3a: the head leads and each link
    // arrives its delay after the one below), not by a step, so a fast chain cannot overtake a slow head.
    advanceSecondOrder(this.trunkDrive, this.trunkGoal, this.recruited ? this.coefficients : creepCoefficients)
    const trunk = this.trunk.step(this.trunkDrive.y)
    out[12] += 0.4 * trunk[0]
    out[9] += 0.35 * trunk[1]
    out[6] += 0.25 * trunk[2]
    const trunkYaw = 0.4 * trunk[0] + 0.35 * trunk[1] + 0.25 * trunk[2]
    const eccentricity = (goal.kind === 'free' ? 12 : goal.kind === 'travel' ? 8 : 5) * DEG
    const yaw = relativeYaw - trunkYaw
    const headYaw = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - eccentricity)
    const headPitch = Math.sign(goal.pitch) * Math.max(0, Math.abs(goal.pitch) - eccentricity)
    if (this.headLatency <= 0) {
      const follow = this.recruited || Math.hypot(relativeYaw, goal.pitch) >= 10 * DEG
      const coefficients = this.recruited ? this.coefficients : creepCoefficients
      const neckCoefficients = this.recruited ? this.neckCoefficients : creepCoefficients
      advanceSecondOrder(this.head[0], follow ? headYaw : 0, coefficients)
      advanceSecondOrder(this.head[1], follow ? headPitch : 0, coefficients)
      advanceSecondOrder(this.neck[0], follow ? headYaw : 0, neckCoefficients)
      advanceSecondOrder(this.neck[1], follow ? headPitch : 0, neckCoefficients)
    }
    const neckYaw = this.neck[0].y
    const neckPitch = this.neck[1].y
    out[15] += 0.35 * neckYaw
    out[18] += 0.65 * this.head[0].y
    out[16] += 0.4 * neckPitch
    out[19] += 0.6 * this.head[1].y + 0.012 * Math.abs(this.head[0].v)
    out[20] += 0.006 * this.head[0].v
    this.blinkElapsed += BODY_TICK
    this.lidClose = this.blinkElapsed < 0.07
      ? minJerk(this.blinkElapsed / 0.07)
      : this.blinkElapsed < 0.1
        ? 1
        : 1 - minJerk((this.blinkElapsed - 0.1) / 0.15)
  }

  private recruit(amplitude: number, goalYaw: number, facingYaw: number): void {
    this.recruited = true
    this.sinceRecruit = 0
    this.headLatency = amplitude > 40 * DEG ? 0.02 * this.random() : 0.03 + 0.03 * this.random()
    this.trunkLatency = this.headLatency + 0.12
    this.planHead(Math.abs(wrap(goalYaw - facingYaw) - this.head[0].y))
  }

  private planHead(travel: number): void {
    const f = 0.62 / headSeconds(travel)
    this.coefficients = secondOrderCoefficients({ f, zeta: 0.72, r: 0.15 }, BODY_TICK)
    this.neckCoefficients = secondOrderCoefficients({ f: 1.6 * f, zeta: 0.9, r: 0 }, BODY_TICK)
  }

  /** Points the saccade in flight at the new goal; its clock is re-timed so the line keeps the distance it has covered. */
  private retarget(yaw: number, pitch: number, facingYaw: number): void {
    const covered = Math.hypot(this.line.yaw - this.fromYaw, this.line.pitch - this.fromPitch)
    this.toYaw = this.fromYaw + wrap(yaw - this.fromYaw)
    this.toPitch = pitch
    const amplitude = Math.hypot(this.toYaw - this.fromYaw, this.toPitch - this.fromPitch)
    this.duration = saccadeSeconds(amplitude)
    const fraction = amplitude > 0 ? covered / (amplitude * this.landing) : 1
    this.elapsed = fraction >= 1 ? this.duration : this.duration * minJerkTime(fraction)
    if (amplitude >= 10 * DEG && !this.recruited)
      this.recruit(amplitude, yaw, facingYaw)
    else if (this.recruited)
      this.planHead(Math.abs(wrap(yaw - facingYaw) - this.head[0].y))
  }

  private advanceLine(yaw: number, pitch: number): void {
    this.elapsed += BODY_TICK
    const correctionAt = this.duration + 0.15
    if (this.elapsed < this.duration || (this.landing < 1 && this.elapsed < correctionAt + 0.03)) {
      const first = this.landing * minJerk(this.elapsed / this.duration)
      const correction = (1 - this.landing) * minJerk((this.elapsed - correctionAt) / 0.03)
      const t = first + correction
      this.line.yaw = this.fromYaw + (this.toYaw - this.fromYaw) * t
      this.line.pitch = this.fromPitch + (this.toPitch - this.fromPitch) * t
      this.pursuit[0].y = this.pursuit[0].x = this.line.yaw
      this.pursuit[1].y = this.pursuit[1].x = this.line.pitch
      this.pursuit[0].v = this.pursuit[1].v = 0
      return
    }
    advanceSecondOrder(this.pursuit[0], this.line.yaw + wrap(yaw - this.line.yaw), pursuitCoefficients)
    advanceSecondOrder(this.pursuit[1], pitch, pursuitCoefficients)
    this.line.yaw = this.pursuit[0].y
    this.line.pitch = this.pursuit[1].y
  }
}
