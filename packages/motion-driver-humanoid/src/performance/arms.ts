import type { SecondOrderCoefficients, SecondOrderState } from '../dynamics'
import type { BodySide } from './channels'
import type { BodyPerformanceInput, BodyRigTraits } from './contracts'

import { advanceSecondOrder, createLagChain, secondOrderCoefficients } from '../dynamics'
import { createActivityGate, createDriftNoise, deriveSeed, gaussian } from '../noise'
import { createRandomStream } from '../random'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, SIDES } from './channels'
import { BodySkeleton } from './skeleton'

/** Angles from a straight-down arm with palm toward thigh, not from an MMD bind pose. */
export interface ArmRestPose {
  readonly clavElev: number
  readonly clavProt: number
  readonly flex: number
  readonly abduct: number
  readonly twist: number
  readonly elbow: number
  readonly pron: number
  readonly wflex: number
  readonly wdev: number
  readonly fingerCurl: readonly (readonly [number, number, number])[]
}

export const DEFAULT_ARM_REST_POSE: ArmRestPose = {
  clavElev: -5 * DEG,
  clavProt: 0,
  flex: 4 * DEG,
  abduct: 12 * DEG,
  twist: 0,
  elbow: 12 * DEG,
  pron: 0,
  wflex: 8 * DEG,
  wdev: 0,
  fingerCurl: [[10 * DEG, 0, 0], [15 * DEG, 20 * DEG, 10 * DEG], [17.25 * DEG, 23 * DEG, 11.5 * DEG], [19.5 * DEG, 26 * DEG, 13 * DEG], [21.75 * DEG, 29 * DEG, 14.5 * DEG]],
}
const relaxed = [2.2, 2.2, 1.15, 1.15, 2, 1.8, 2, 2.2, 2.2] as const
const active = [4, 4, 4.5, 4.5, 4, 4.5, 4, 4.5, 4.5] as const
const damping = [0.7, 0.7, 0.45, 0.45, 0.7, 0.6, 0.7, 0.5, 0.5] as const
/** Per-joint idle noise amplitude of the nine arm angles, degrees, in `BODY_CHANNELS` arm order. */
export const ARM_NOISE_DEGREES = [0.6, 0.3, 0.8, 0.5, 1.5, 1.2, 1.5, 2, 1.5] as const
const offsetDegrees = [0, 0, 2.5, 2, 0, 4, 8, 4, 0] as const
const clampDrag = (x: number, degrees: number) => Math.max(-degrees * DEG, Math.min(degrees * DEG, x))
// The forearm hangs from the upper arm, so the weight reaches the elbow one upper-arm response later: the relaxed
// upper-arm follower's ramp lag, zeta / (pi f) (architecture 3a), after the shoulder link of the weight chain.
const ELBOW_WEIGHT_LAG = damping[2] / (Math.PI * relaxed[2])
/**
 * Architecture 4a joint start offsets, seconds, by arm channel: clavicle and upper arm 0, elbow 30 ms, forearm twist
 * 60 ms, wrist 90 ms, fingers (with spread and opposition) 130 ms.
 */
function startOffset(j: number): number {
  if (j < 5)
    return 0
  if (j === 5)
    return 0.03
  if (j === 6)
    return 0.06
  return j < 9 ? 0.09 : 0.13
}

/** Follower frequency (Hz) and damping of arm channel `j` at activation `used` and tension `tension` (3a). */
export function armResponse(j: number, used: number, tension: number): readonly [number, number] {
  const f0 = j < 9 ? relaxed[j] : 2.5
  const f1 = j < 9 ? active[j] : 4
  const z0 = j < 9 ? damping[j] : 0.6
  const f = (f0 + (f1 - f0) * used) * (0.7 + 0.9 * tension)
  const zeta = Math.min(1, (z0 + ((j === 2 || j === 3) ? 0.35 * used : 0)) * (0.8 + 0.5 * tension))
  return [f, zeta]
}

/**
 * Steady ramp lag `zeta / (pi f)` of arm channel `j`'s follower, seconds (3a with r = 0), at activation `used` and mood
 * tension `tension` in [0, 1]. `j` indexes a side's arm block from `ClavElev`.
 */
export function armRampLag(j: number, used: number, tension: number): number {
  const [f, zeta] = armResponse(j, used, Math.max(0, Math.min(1, tension)))
  return Math.max(0.3, zeta) / (Math.PI * f)
}

/**
 * The cascade link delay of arm channel `j`, seconds: its 4a start offset plus the upper arm's ramp lag beyond its own
 * at the channels' activations `upperUsed` and `used`. Shared arm terms reach channel `j` this much later.
 */
export function armCascadeDelay(j: number, upperUsed: number, used: number, tension: number): number {
  return startOffset(j) + Math.max(0, armRampLag(2, upperUsed, tension) - armRampLag(j, used, tension))
}

/** Independent arm identities feed shared secondary dynamics after layer blending. */
export class BodyArms {
  readonly rest = new Float32Array(BODY_CHANNELS.length)
  private readonly desired = new Float64Array(BODY_CHANNELS.length)
  private readonly random
  private readonly gates
  private readonly noises
  private readonly states: SecondOrderState[]
  private readonly coefficients: SecondOrderCoefficients[]
  private readonly frequencies = new Float64Array(BODY_CHANNELS.length)
  private readonly zetas = new Float64Array(BODY_CHANNELS.length)
  /** Each channel's own idle noise this tick; it reaches its follower directly, never through the cascade. */
  private readonly noise = new Float64Array(BODY_CHANNELS.length)
  /** The proximal-to-distal cascade: one critically damped lag link per arm channel, ahead of its follower. */
  private readonly links: SecondOrderState[]
  private readonly linkCoefficients: SecondOrderCoefficients[]
  private readonly linkDelays = new Float64Array(BODY_CHANNELS.length)
  private readonly skeleton: BodySkeleton
  private readonly shoulder = {
    left: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    right: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  }

  private readonly elbowWeight = createLagChain([ELBOW_WEIGHT_LAG], BODY_TICK)
  private warm = false
  private redraw = 70
  private tension = 0
  private trunkPitch = 0
  /** Rate of the trunk pitch the arms hang from, rad/s; the upper arm's swing in the world is flex rate minus it. */
  private trunkPitchRate = 0

  constructor(private readonly traits: BodyRigTraits, seed: number) {
    this.skeleton = new BodySkeleton(traits)
    this.random = createRandomStream(deriveSeed(seed, 12))
    this.gates = { left: createActivityGate({ seed: deriveSeed(seed, 10) }), right: createActivityGate({ seed: deriveSeed(seed, 11) }) }
    // Streams 32..57 and 64..89 remain independent even when a rig lacks fingers.
    const noise = (base: number) => Array.from({ length: 26 }, (_, i) => createDriftNoise({ seed: deriveSeed(seed, base + i) }))
    this.noises = { left: noise(32), right: noise(64) }
    this.drawRest()
    this.rest.set(this.desired)
    this.states = Array.from(this.rest, value => ({ y: value, v: 0, x: value }))
    this.coefficients = Array.from(this.rest, () => secondOrderCoefficients({ f: 2, zeta: 1, r: 0 }, BODY_TICK))
    this.links = Array.from(this.rest, value => ({ y: value, v: 0, x: value }))
    this.linkCoefficients = Array.from(this.rest, () => secondOrderCoefficients({ f: 2, zeta: 1, r: 0 }, BODY_TICK))
  }

  private drawRest(): void {
    const p = DEFAULT_ARM_REST_POSE
    const base = [p.clavElev, p.clavProt, p.flex, p.abduct, p.twist, p.elbow, p.pron, p.wflex, p.wdev]
    for (const side of SIDES) {
      const start = ARM_START[side]
      for (let j = 0; j < 9; j++)
        this.desired[start + j] = base[j] + (2 * this.random() - 1) * offsetDegrees[j] * DEG
      const scale = 1 + (2 * this.random() - 1) * 0.12
      for (let finger = 0; finger < 5; finger++) {
        for (let joint = 0; joint < 3; joint++)
          this.desired[start + 9 + finger * 3 + joint] = p.fingerCurl[finger][joint] * scale
      }
      this.desired[start + 24] = 0
      this.desired[start + 25] = 10 * DEG
    }
    this.redraw = Math.max(40, Math.min(120, Math.exp(Math.log(70) + 0.3 * gaussian(this.random))))
  }

  /** `shoulderSupport` is the support transfer as the weight chain delivers it to the shoulders. */
  generate(input: BodyPerformanceInput, out: Float64Array, shoulderSupport: number): void {
    const support = this.elbowWeight.step(shoulderSupport)[0]
    this.redraw -= BODY_TICK
    if (this.redraw <= 0)
      this.drawRest()
    for (const side of SIDES) {
      const start = ARM_START[side]
      const gate = this.gates[side].step(BODY_TICK) * input.posture.amplitude
      const sharedCurl = this.noises[side][25].step(BODY_TICK) * 3 * DEG * gate
      for (let j = 0; j < 26; j++) {
        this.rest[start + j] = this.desired[start + j] + (this.rest[start + j] - this.desired[start + j]) * Math.exp(-BODY_TICK / 3)
        let noise = 0
        if (j < 25) {
          const value = this.noises[side][j].step(BODY_TICK) * gate
          noise = j < 9 ? value * ARM_NOISE_DEGREES[j] * DEG : 0.6 * sharedCurl + 0.4 * value * 3 * DEG
        }
        this.noise[start + j] = noise
        out[start + j] += this.rest[start + j] + noise
      }
      const onSupport = (side === 'right' ? 1 : -1) * support > 0
      out[start + 5] += (onSupport ? -2 : 3) * DEG * Math.abs(support)
      out[start + 3] += input.armLift[side]
    }
  }

  /**
   * `activation` is the stack's override weight per channel; `fed` the share of it a layer feeds forward through the
   * followers' inverse (`LayerOutput.fed`), which passes the wrist-placing joints' cascade links.
   */
  follow(input: BodyPerformanceInput, targets: Float64Array, activation: Float64Array, fed: Float64Array): void {
    this.tension = Math.max(0, Math.min(1, input.mood.tension))
    for (const side of SIDES) {
      const start = ARM_START[side]
      for (let j = 0; j < 2; j++)
        targets[start + j] = this.advance(start + j, this.cascade(start + j, targets[start + j], activation, fed), activation[start + j])
    }
    // Shoulder velocity comes from the followed clavicle, not its unfiltered target.
    this.skeleton.update(targets)
    const pitch = targets[7] + targets[10] + targets[13]
    const roll = targets[8] + targets[11] + targets[14]
    this.trunkPitchRate = this.warm ? (pitch - this.trunkPitch) / BODY_TICK : 0
    this.trunkPitch = pitch
    const tau = Math.exp(-BODY_TICK / 0.03)
    for (const side of SIDES) {
      const start = ARM_START[side]
      const sigma = side === 'left' ? 1 : -1
      const position = this.skeleton.arm(side, targets).shoulder
      const previous = this.shoulder[side]
      const arm = this.traits.arms[side]
      const length = (Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z) + Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)) / 2
      const vx = this.warm ? (position.x - previous.x) / BODY_TICK + input.rootVelocity.x : 0
      const vy = this.warm ? (position.y - previous.y) / BODY_TICK + input.rootVelocity.y : 0
      const vz = this.warm ? (position.z - previous.z) / BODY_TICK + input.rootVelocity.z : 0
      previous.vx = vx + (previous.vx - vx) * tau
      previous.vy = vy + (previous.vy - vy) * tau
      previous.vz = vz + (previous.vz - vz) * tau
      previous.x = position.x
      previous.y = position.y
      previous.z = position.z
      targets[start + 2] += (1 - activation[start + 2]) * (0.85 * pitch + clampDrag(-0.09 * previous.vz / length, 10))
      targets[start + 3] += (1 - activation[start + 3]) * (-sigma * 0.85 * roll + clampDrag(-0.09 * sigma * previous.vx / length, 10))
      this.followSide(side, targets, activation, fed)
    }
    this.warm = true
  }

  /**
   * Passes a channel's shared target (everything but its own noise) through its cascade link, so a term several arm
   * joints receive at once (breath, weight, gait swing) reaches the followers in proximal-to-distal order by
   * construction: link delay `s_j + max(0, tau_upper - tau_j)` cancels a faster distal follower's head start and adds
   * the 4a start offset `s_j`. Plan 3.1; the faster distal followers made the lower arm lead (goal-2 finding).
   *
   * The wrist-placing joints (flex, abduct, twist, elbow) take a layer's target past the link where the layer feeds
   * them forward (`fed`): the gesture layer inverts their followers, and a link left in front of an inverted follower
   * is not a delay but a lag that rounds every fast segment's end into a slow approach (a stroke's elbow landed 100 to
   * 150 ms late). The layer feeds a prepared arm only, so a preparation keeps the links' order. The link's state
   * follows what it passes on, so the joint goes back to the link without a step and the link filters the retraction
   * and a clip's claim. With nothing fed the arithmetic is the link's exactly.
   */
  private cascade(index: number, target: number, activation: Float64Array, fed: Float64Array): number {
    const j = (index - ARM_START.left) % 28
    const upper = index - j + 2
    // An override layer replaced `activation` of the noise along with the base; the joint keeps all of its own noise,
    // so a held gesture pose stays a moving hold (4a: "the 3b noise keeps running under it").
    const blended = (1 - activation[index]) * this.noise[index]
    const own = this.noise[index]
    const delay = armCascadeDelay(j, activation[upper], activation[index], this.tension)
    const link = this.links[index]
    if (delay === 0) {
      link.y = link.x = target - blended
      link.v = 0
      return activation[index] === 0 ? target : target - blended + own
    }
    if (Math.abs(delay - this.linkDelays[index]) > 0.01 * delay) {
      this.linkCoefficients[index] = secondOrderCoefficients({ f: 1 / (Math.PI * delay), zeta: 1, r: 0 }, BODY_TICK)
      this.linkDelays[index] = delay
    }
    const input = target - blended
    const previous = link.x
    advanceSecondOrder(link, input, this.linkCoefficients[index])
    // The link carries what it passes on, so a falling activation hands the joint back to it without a step.
    const past = j >= 2 && j <= 5 ? fed[index] : 0
    if (past > 0) {
      link.y += past * (input - link.y)
      link.v += past * ((input - previous) / BODY_TICK - link.v)
    }
    return link.y + own
  }

  private advance(index: number, target: number, used: number): number {
    const j = (index - ARM_START.left) % 28
    const [f, zeta] = armResponse(j, used, this.tension)
    if (Math.abs(f - this.frequencies[index]) > 0.01 * f || Math.abs(zeta - this.zetas[index]) > 0.01 * zeta) {
      this.coefficients[index] = secondOrderCoefficients({ f, zeta, r: 0 }, BODY_TICK)
      this.frequencies[index] = f
      this.zetas[index] = zeta
    }
    advanceSecondOrder(this.states[index], target, this.coefficients[index])
    return this.states[index].y
  }

  private followSide(side: BodySide, targets: Float64Array, activation: Float64Array, fed: Float64Array): void {
    const start = ARM_START[side]
    for (let j = 2; j < 26; j++) {
      const index = start + j
      let drag = 0
      // The forearm trails the upper arm's swing in the world (3a drag). The plumb line's counter-rotation of flex
      // against the trunk pitch is stillness in the world, so it must not swing the forearm.
      if (j === 5)
        drag = clampDrag(-0.045 * (this.states[start + 2].v - this.trunkPitchRate), 8)
      else if (j === 7 || j === 8)
        drag = clampDrag(-0.06 * this.states[start + 5].v, 25)
      else if (j >= 9 && j < 24)
        drag = clampDrag(-0.05 * this.states[start + 7].v, 12)
      // An actively driven joint does not flop: like the upper arm's plumb line and pendulum, the passive trail yields
      // to a layer's activation, and returns as the activation falls (4a: on retraction the wrist drags).
      if (activation[index] > 0)
        drag *= 1 - activation[index]
      targets[index] = this.advance(index, this.cascade(index, targets[index], activation, fed) + drag, activation[index])
    }
  }
}
