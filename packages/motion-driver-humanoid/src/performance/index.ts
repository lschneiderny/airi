import type { Vec3 } from '../types'
import type { BodyPerformanceFrame, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { PerformanceContext, PerformanceLayer } from './stack'

import { createLagChain } from '../dynamics'
import { createTurnPlanner } from '../look-at'
import { BodyArms } from './arms'
import { BodyBreath } from './breath'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, limitChannel, SIDES } from './channels'
import { BodyCollision } from './collision'
import { BodyRigError } from './contracts'
import { BodyGaze } from './gaze'
import { BodyPosture } from './posture'
import { BodySkeleton } from './skeleton'
import { PerformanceStack } from './stack'

export type { ArmAngles, ArmKey, ArmKeyRig } from './arm-key'
export { solveArmKey } from './arm-key'
export type { ArmRestPose } from './arms'
export { ARM_NOISE_DEGREES, DEFAULT_ARM_REST_POSE } from './arms'
export type { BodyChannel, BodySide } from './channels'
export { BODY_CHANNELS, BODY_TICK, channelGroup, channelIndex, JOINT_LIMITS } from './channels'
export { BodyCollision, colliderDistance, proxyColliders } from './collision'
export { BodyRigError } from './contracts'
export type * from './contracts'
export type { GestureFormSpec, SpeechGestureForm } from './gesture-forms'
export { GESTURE_FORMS } from './gesture-forms'
export type { GestureLayerOptions } from './gestures'
export { createGestureLayers } from './gestures'
export type { HandShape, HandShapeSpec } from './hand-shapes'
export { HAND_SHAPES } from './hand-shapes'
export type { PerformanceLayerOptions } from './layers'
export { createPerformanceLayers } from './layers'
export type { BodyTransform } from './skeleton'
export { BodySkeleton, spineWeights } from './skeleton'
export type { LayerOutput, MergedPerformancePlan, PerformanceContext, PerformanceLayer, PerformanceModulation, PerformancePlan } from './stack'

export interface BodyPerformerOptions {
  readonly traits: BodyRigTraits
  readonly seed: number
  /** Performer owns these instances and calls reset on construction and reset. */
  readonly layers?: readonly PerformanceLayer[]
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type MutableFrame = Mutable<Omit<BodyPerformanceFrame, 'pelvis' | 'gaze' | 'eyes' | 'diagnostics'>> & {
  pelvis: Vec3
  gaze: { yaw: number, pitch: number }
  eyes: { yaw: number, pitch: number }
  diagnostics: Mutable<BodyPerformanceFrame['diagnostics']>
}

/**
 * Share of the trunk's unintended yaw, pitch and roll the head cancels. Head stabilisation below 1 Hz is incomplete;
 * roll and pitch have a gravity reference and hold better than yaw, and the eyes absorb the rest.
 */
const STEADY_GAIN = [0.5, 0.6, 0.6] as const
/** Vestibulo- and cervico-collic reflex latency, seconds. */
const STEADY_LAG = 0.08
/** A held gaze's eye residue. */
const HELD_MICRO = Object.freeze({ yaw: 0, pitch: 0 })

/** Pure state owner. Each step advances exactly one tick; the host owns accumulation/interpolation. */
class BodyPerformer {
  private state
  private context: Mutable<PerformanceContext> | null = null
  private mapped: Mutable<BodyPerformanceInput> | null = null
  private readonly plannedPosture: Mutable<BodyPerformanceInput['posture']> = { amplitude: 0, shiftRate: 0, support: null }
  private readonly turnInput = { targetYaw: 0, facingYaw: 0, allowTurn: false, home: false }
  /** The saccade count a held gaze keeps (`PerformancePlan.holdGaze`); null while the gaze is free to move. */
  private heldSaccade: number | null = null

  constructor(private readonly options: BodyPerformerOptions) {
    const { traits } = options
    if (!Number.isFinite(traits.legLength) || traits.legLength <= 0)
      throw new BodyRigError('legLength')
    if (traits.spineChain.length < 1 || traits.spineChain.length > 4)
      throw new BodyRigError('spineChain')
    for (const side of SIDES) {
      const arm = traits.arms[side]
      if (!(Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z) > 0) || !(Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z) > 0))
        throw new BodyRigError(`${side} arm lengths`)
    }
    this.state = this.createState()
  }

  private createState() {
    const { traits, seed } = this.options
    const arms = new BodyArms(traits, seed)
    const rest = arms.rest.slice()
    for (let c = 0; c < rest.length; c++)
      rest[c] = limitChannel(c, rest[c])
    this.degrade(rest)
    const collision = new BodyCollision(traits, rest)
    const stack = new PerformanceStack(this.options.layers ?? [])
    const frame: MutableFrame = {
      tick: 0,
      channels: rest.slice(),
      pelvis: { x: 0, y: 0, z: 0 },
      support: 0,
      gaze: { yaw: 0, pitch: 0 },
      eyes: { yaw: 0, pitch: 0 },
      facingYaw: 0,
      turning: false,
      turnStarted: false,
      turnSteps: [],
      footSteps: [],
      lidClose: 0,
      mouthOpen: 0,
      act: null,
      capabilities: collision.capabilities,
      diagnostics: {
        shiftTarget: 0,
        dwell: 0,
        speechLift: 0,
        inhales: 0,
        gazeShifts: 0,
        blinks: 0,
        correction: collision.correction,
        penetration: collision.penetration,
        headPenetration: collision.headPenetration,
        collisions: collision.collisions,
        corrector: collision.corrector,
        gesture: stack.gesture,
        cue: stack.cue,
        emotion: stack.emotion,
        reaction: stack.reaction,
      },
    }
    for (const layer of this.options.layers ?? [])
      layer.reset()
    return {
      arms,
      rest,
      collision,
      frame,
      posture: new BodyPosture(traits, seed),
      breath: new BodyBreath(),
      gaze: new BodyGaze(seed),
      stack,
      skeleton: new BodySkeleton(traits),
      turns: createTurnPlanner(),
      targets: new Float64Array(BODY_CHANNELS.length),
      steady: [0, 1, 2].map(() => createLagChain([STEADY_LAG], BODY_TICK)),
      sighs: 0,
    }
  }

  step(input: BodyPerformanceInput): BodyPerformanceFrame {
    const state = this.state
    const { traits } = this.options
    const { frame, targets, stack } = state
    this.context ??= {
      input,
      traits,
      capabilities: frame.capabilities,
      rest: state.rest,
      previous: frame,
      plan: stack.plan,
      tick: 0,
      time: 0,
      dt: BODY_TICK,
    }
    this.context.input = input
    this.context.tick = frame.tick + 1
    this.context.time = this.context.tick * BODY_TICK
    stack.prepare(this.context)
    let effective = input
    this.heldSaccade = stack.plan.holdGaze ? this.heldSaccade ?? input.gaze.saccadeSeq : null
    if (stack.plan.support !== null || stack.plan.gaze !== null || this.heldSaccade !== null) {
      this.mapped ??= { ...input, posture: { ...input.posture }, gaze: { ...input.gaze } }
      const posture = this.mapped.posture
      const gaze = this.mapped.gaze
      Object.assign(posture, input.posture)
      Object.assign(gaze, input.gaze)
      if (stack.plan.support !== null) {
        this.plannedPosture.amplitude = input.posture.amplitude
        this.plannedPosture.shiftRate = input.posture.shiftRate
        this.plannedPosture.support = stack.plan.support
        Object.assign(posture, this.plannedPosture)
      }
      if (stack.plan.gaze !== null)
        Object.assign(gaze, stack.plan.gaze)
      if (this.heldSaccade !== null)
        Object.assign(gaze, { saccadeSeq: this.heldSaccade, micro: HELD_MICRO })
      Object.assign(this.mapped, input)
      this.mapped.posture = posture
      this.mapped.gaze = gaze
      effective = this.mapped
    }
    targets.fill(0)
    state.posture.gazeShifting = state.gaze.shifting
    // The cue layer plays the head cue itself (4b). The emotion modulation (4c) is the previous tick's: the stack runs
    // after the generators, so its tempo, sway, breath depth and sighs reach them one tick later.
    state.posture.suppressHeadCue = stack.plan.suppressHeadCue
    state.posture.suppressHeadEmphasis = stack.plan.suppressHeadEmphasis
    state.posture.tempo = stack.modulation.tempo
    state.posture.amplitude = stack.modulation.amplitude
    state.breath.depth = stack.modulation.breath
    if (stack.sighs !== state.sighs) {
      state.sighs = stack.sighs
      state.breath.sigh()
    }
    state.posture.step(effective, targets)
    state.breath.step(effective, targets)
    this.steadyHead(targets)
    state.arms.generate(effective, targets, state.posture.shoulderSupport)
    state.gaze.step(effective, targets)
    const gait = input.gait
    if (gait) {
      for (let c = 0; c < targets.length; c++) {
        const lower = c < 6 || c === 47 || c === 48 || c === 75 || c === 76
        targets[c] += gait.weight * (gait.channels[c] - (lower ? targets[c] : 0))
      }
    }
    stack.step(targets, this.context)
    if (traits.spineChain.length === 1) {
      for (let c = 6; c < 15; c++)
        targets[c] *= 0.8
    }
    state.arms.follow(effective, targets, stack.activation, stack.fed)
    for (let c = 0; c < targets.length; c++)
      frame.channels[c] = limitChannel(c, targets[c])
    this.degrade(frame.channels)
    state.collision.correct(frame.channels, frame.tick + 1, gait)
    frame.tick++
    frame.pelvis.x = frame.channels[0] * traits.legLength
    frame.pelvis.y = frame.channels[1] * traits.legLength
    frame.pelvis.z = frame.channels[2] * traits.legLength
    frame.support = state.posture.support + (gait ? gait.weight * (gait.support - state.posture.support) : 0)
    frame.gaze.yaw = state.gaze.line.yaw + 0.3 * effective.gaze.micro.yaw
    frame.gaze.pitch = state.gaze.line.pitch + 0.3 * effective.gaze.micro.pitch
    // A free goal is a fixation around the viewer (architecture 3e), and the viewer is the body's home: while the gaze
    // is free the feet face the viewer, so after a far look they step back instead of staying torqued under a head that
    // has returned, and a free glance never turns them.
    const free = effective.gaze.kind === 'free'
    this.turnInput.targetYaw = free ? input.viewerYaw : effective.gaze.yaw
    this.turnInput.facingYaw = input.facingYaw
    this.turnInput.home = free
    this.turnInput.allowTurn = input.allowTurn && (!gait || gait.mode === 'idle')
    const turn = state.turns.step(this.turnInput, BODY_TICK)
    frame.facingYaw = turn.facingYaw
    frame.turning = turn.turning
    frame.turnStarted = turn.turnStarted
    frame.turnSteps = turn.turnSteps
    frame.footSteps = stack.footSteps
    frame.lidClose = Math.max(state.gaze.lidClose, stack.lidClose)
    frame.mouthOpen = stack.mouthOpen
    frame.act = stack.act
    this.aimEyes(input)
    frame.diagnostics.shiftTarget = state.posture.target
    frame.diagnostics.dwell = state.posture.dwell
    frame.diagnostics.speechLift = state.breath.speechLift
    frame.diagnostics.inhales = state.breath.inhales
    frame.diagnostics.gazeShifts = state.gaze.shifts
    frame.diagnostics.blinks = state.gaze.blinks
    return frame
  }

  /**
   * The neck and head counter-rotate a share of the trunk's world rotation from posture and breath (sway, transfer,
   * drift, set-point), 80 ms late; the trunk's share of Natural's head yaw is intent and is not cancelled.
   */
  private steadyHead(targets: Float64Array): void {
    const { traits } = this.options
    for (let axis = 0; axis < 3; axis++) {
      let trunk = targets[6 + axis] + targets[9 + axis] + targets[12 + axis]
      if (traits.spineParent === 'hips')
        trunk += targets[3 + axis]
      if (axis === 0)
        trunk -= this.state.posture.trunkIntentYaw
      const steady = this.state.steady[axis].step(-STEADY_GAIN[axis] * trunk)[0]
      targets[15 + axis] += 0.35 * steady
      targets[18 + axis] += 0.65 * steady
    }
  }

  private degrade(channels: Float32Array): void {
    const { traits } = this.options
    if (!traits.legIk)
      channels[0] = channels[1] = channels[2] = 0
    for (const side of SIDES) {
      const start = ARM_START[side]
      const arm = traits.arms[side]
      if (!arm.clavicle)
        channels[start] = channels[start + 1] = 0
      if (!arm.twist)
        channels[start + 6] = Math.max(-60 * DEG, Math.min(60 * DEG, channels[start + 6]))
      if (arm.fingers === 'none')
        channels.fill(0, start + 9, start + 26)
      if (!traits.feet[side].toeBend)
        channels[start + 27] = 0
      if (!traits.feet[side].toe)
        channels[start + 26] = Math.max(-10 * DEG, Math.min(10 * DEG, channels[start + 26]))
      if (!traits.legIk)
        channels[start + 26] = channels[start + 27] = 0
    }
  }

  private aimEyes(input: BodyPerformanceInput): void {
    const { frame, skeleton } = this.state
    skeleton.update(frame.channels)
    const head = skeleton.frames.head
    const yaw = frame.gaze.yaw - input.facingYaw
    const pitch = frame.gaze.pitch
    const x = Math.sin(yaw) * Math.cos(pitch)
    const y = -Math.sin(pitch)
    const z = Math.cos(yaw) * Math.cos(pitch)
    const localX = head[0] * x + head[3] * y + head[6] * z
    const localY = head[1] * x + head[4] * y + head[7] * z
    const localZ = head[2] * x + head[5] * y + head[8] * z
    frame.eyes.yaw = Math.max(-this.options.traits.eyeYawLimit, Math.min(this.options.traits.eyeYawLimit, Math.atan2(localX, localZ)))
    frame.eyes.pitch = Math.max(-this.options.traits.eyePitchLimit, Math.min(this.options.traits.eyePitchLimit, Math.atan2(-localY, Math.hypot(localX, localZ))))
  }

  /** Owned snapshot of the seed's collision-cleared reference, independent of live buffers. */
  restChannels(): Float32Array {
    return this.state.rest.slice()
  }

  /** Rewinds random streams, time, plans, corrections and velocities; invalidates borrowed frames. */
  reset(): void {
    this.state = this.createState()
    this.context = null
    this.mapped = null
  }
}

export function createBodyPerformer(options: BodyPerformerOptions) {
  return new BodyPerformer(options)
}
