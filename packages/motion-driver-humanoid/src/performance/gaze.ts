import type { BodyPerformanceInput } from './contracts'

import { advanceSecondOrder, createLagChain, minJerk, secondOrderCoefficients } from '../dynamics'
import { deriveSeed } from '../noise'
import { createRandomStream } from '../random'
import { BODY_TICK, DEG } from './channels'

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const pursuitCoefficients = secondOrderCoefficients({ f: 5, zeta: 1, r: 0 }, BODY_TICK)
const creepCoefficients = secondOrderCoefficients({ f: 1 / (Math.PI * 1.2), zeta: 1, r: 0 }, BODY_TICK)

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
  private readonly neck = [createLagChain([0.045], BODY_TICK), createLagChain([0.045], BODY_TICK)]
  private readonly trunk = createLagChain([0.095, 0.06, 0.08], BODY_TICK)
  private headLatency = 0
  private trunkLatency = 0
  private recruited = false
  private blinkElapsed = Infinity
  private sinceBlink = Infinity

  constructor(seed: number) {
    this.random = createRandomStream(deriveSeed(seed, 16))
  }

  step(input: BodyPerformanceInput, out: Float64Array): void {
    const goal = input.gaze
    this.sinceBlink += BODY_TICK
    const jump = Math.hypot(wrap(goal.yaw - this.lastYaw), goal.pitch - this.lastPitch)
    if (goal.saccadeSeq !== this.seq || goal.kind !== this.kind || jump > 4 * DEG) {
      const amplitude = Math.hypot(wrap(goal.yaw - this.line.yaw), goal.pitch - this.line.pitch)
      this.shifts++
      this.seq = goal.saccadeSeq
      this.kind = goal.kind
      this.fromYaw = this.line.yaw
      this.fromPitch = this.line.pitch
      this.toYaw = this.fromYaw + wrap(goal.yaw - this.fromYaw)
      this.toPitch = goal.pitch
      this.duration = 0.025 + 0.0024 * amplitude / DEG
      this.elapsed = 0
      this.landing = amplitude > 15 * DEG ? 0.92 + 0.04 * this.random() : 1
      if (amplitude >= 10 * DEG) {
        this.recruited = true
        this.headLatency = amplitude > 40 * DEG ? 0.02 * this.random() : 0.03 + 0.03 * this.random()
        this.trunkLatency = this.headLatency + 0.12
        const duration = 0.28 + 0.0058 * Math.abs(wrap(goal.yaw - input.facingYaw) - this.head[0].y) / DEG
        this.coefficients = secondOrderCoefficients({ f: 0.62 / duration, zeta: 0.72, r: 0.15 }, BODY_TICK)
      }
      const probability = Math.min(0.85, Math.max(0, (amplitude / DEG - 12) / 30))
      if (this.random() < probability && goal.blinkFactor > 0.95 && this.sinceBlink >= 0.4) {
        this.blinkElapsed = 0
        this.sinceBlink = 0
        this.blinks++
      }
    }
    this.lastYaw = goal.yaw
    this.lastPitch = goal.pitch
    this.advanceLine(goal.yaw, goal.pitch)
    this.headLatency -= BODY_TICK
    this.trunkLatency -= BODY_TICK
    const relativeYaw = wrap(goal.yaw - input.facingYaw)
    const trunkGoal = goal.kind === 'free' || this.trunkLatency > 0
      ? 0
      : Math.sign(relativeYaw) * Math.min(18 * DEG, 0.3 * Math.max(0, Math.abs(relativeYaw) - 25 * DEG))
    const trunk = this.trunk.step(trunkGoal)
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
      advanceSecondOrder(this.head[0], follow ? headYaw : 0, coefficients)
      advanceSecondOrder(this.head[1], follow ? headPitch : 0, coefficients)
    }
    const neckYaw = this.neck[0].step(this.head[0].y)[0]
    const neckPitch = this.neck[1].step(this.head[1].y)[0]
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
