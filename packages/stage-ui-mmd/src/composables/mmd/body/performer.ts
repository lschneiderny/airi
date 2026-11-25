import type { TurnStep } from '@proj-airi/motion-driver-humanoid/look-at'
import type { BodyActFeedback, BodyActId, BodyCapabilities, BodyCueKind, BodyEmotion, BodyFootStep, BodyGestureForm, BodyGestureHand, BodyPerformanceFrame, BodyPerformanceInput, BodyReactionKind, BodyRest, BodyRigTraits, BodySide, PerformanceLayer } from '@proj-airi/motion-driver-humanoid/performance'
import type { HumanoidFingerBoneName } from '@proj-airi/motion-driver-humanoid/types'
import type { Bone } from 'three'

import type { MMDCleanPose } from '../frame-pipeline'
import type { MMDHandCalibration, MMDTwistBone, MMDVec3 } from '../rig'
import type { MMDBodyPose } from './pose'

import { BODY_CHANNELS, BODY_TICK, channelIndex, createBodyPerformer, spineWeights } from '@proj-airi/motion-driver-humanoid/performance'
import { Euler, Quaternion, Vector3 } from 'three'

const DEG = 180 / Math.PI
const sides = ['left', 'right'] as const
const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const
const joints = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] } as const
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const FOOT_PITCH = { left: channelIndex('leftFootPitch'), right: channelIndex('rightFootPitch') } as const

/** Clip ownership of each written bone group, 0 performer to 1 clip; the adapter applies it exactly once. */
export interface MMDBodyWeights {
  pelvis: number
  hips: number
  torso: number
  head: number
  leftArm: number
  rightArm: number
  leftFingers: number
  rightFingers: number
}

/** The bone groups the performer writes; `pelvis` is a translation and has no rotation write. */
export type MMDBodyWriteGroup = Exclude<keyof MMDBodyWeights, 'pelvis'>

/**
 * `gaze-shift`: the planned shift's amplitude, its signed yaw change (positive toward +X, the character's left) in
 * degrees, and the goal kind it moves to. The layer events come from the core's diagnostics reports: a
 * `gesture-stroke` is raised on the tick that reaches its planned hit, `gesture-unit` when a unit starts and when its
 * phase returns to rest, and `cue`, `emotion-posture` and `reaction` when their report sequence changes. `act` is raised
 * when the frame's act feedback changes its sequence or state, and `rest` when the input's rest directive changes; the
 * initial state (no act, rest `none`) raises nothing, so neither appears without a producer.
 */
export type MMDBodyEvent
  = | { readonly kind: 'blink', readonly source: 'body' | 'natural' }
    | { readonly kind: 'gaze-shift', readonly amplitudeDeg: number, readonly yawDeg: number, readonly goal: BodyPerformanceInput['gaze']['kind'] }
    | { readonly kind: 'gesture-stroke', readonly form: BodyGestureForm, readonly hand: BodyGestureHand, readonly unitSeq: number }
    | { readonly kind: 'gesture-unit', readonly phase: 'start' | 'end', readonly unitSeq: number }
    | { readonly kind: 'cue', readonly cue: BodyCueKind, readonly seq: number }
    | { readonly kind: 'emotion-posture', readonly emotion: BodyEmotion, readonly phase: 'onset' | 'release' }
    | { readonly kind: 'reaction', readonly reaction: BodyReactionKind }
    | { readonly kind: 'act', readonly id: BodyActId, readonly state: BodyActFeedback['state'], readonly seq: number }
    | { readonly kind: 'rest', readonly rest: BodyRest }

interface Target {
  readonly bone: Bone
  readonly index: number
}

/**
 * How far each of the index, middle, ring and little fingers turns about the palm normal per unit of the spread
 * channel, toward the thumb: the fan opens evenly about the middle finger, one spread angle between neighbours.
 */
const SPREAD_FAN = [1, 0, -1, -2] as const
/**
 * The thumb's opposition at channel 0, radians, measured as `MMDThumbCalibration.opposition`. Library rigs bind the
 * thumb at 42 to 56 degrees, so the rest channel (10) holds about the bind thumb and the opposed thumb (40) tucks it
 * under the palm.
 */
const THUMB_OPPOSITION_ZERO = 40 * Math.PI / 180

/**
 * The share of each finger joint's own bind bend that curl 0 takes off; the rest comes off the whole finger, at the
 * knuckle, as its knuckle-to-tip line's flexion (`MMDFingerCalibration.chord`). Bone centres sit off the mesh's
 * centreline on some rigs: rendered against the meshes of ten library rigs, the per-joint bend alone kinks straight
 * fingers (Vivian's knuckles read 11 to 16 flexed and the next joints 8 to 13 bent back; Carlotta's and Sigrika's
 * fingertips read 11 to 18 bent back), and the whole-finger line alone leaves Chisa's authored bent-back tips. Half of
 * each halves the larger error on every rig. The thumb's inner joints take the same share of their own bend.
 */
const BIND_BEND_SHARE = 0.5

/** One calibrated finger: its bind curl axis, the bind bend curl 0 takes off each joint, and the turn that brings its bind spread to 0. */
interface FingerWrite {
  readonly axis: Vector3
  readonly bend: readonly [number, number, number]
  readonly spreadOffset: number
}

/** A side's calibrated hand write (`MMDHandCalibration`); null keeps the uncalibrated write. */
interface HandWrite {
  /** Swings the bind hand onto the forearm line, under the wrist channels. */
  readonly align: Quaternion
  /** `sigma * normal`: a positive turn about it moves a finger toward the thumb. */
  readonly spreadAxis: Vector3
  readonly fingers: readonly FingerWrite[]
  readonly thumb: { readonly axis: Vector3, readonly bend: readonly [number, number, number], readonly oppositionAxis: Vector3, readonly oppositionOffset: number } | null
}

/**
 * A twist bone that takes one joint's turn about its segment off the joint bones: `腕捩` between the upper arm and the
 * elbow, `手捩` between the elbow and the hand. Bind offsets are in model axes, which are each bone's bind local axes.
 */
interface TwistWrite {
  readonly target: Target
  /** The PMX fixed axis, unit; the fixed-axis solve projects the bone's rotation onto it before the grants. */
  readonly axis: Vector3
  /** The twist bone from the joint above it, and the joint below from the twist bone. */
  readonly toTwist: Vector3
  readonly toChild: Vector3
}

interface ArmTargets {
  readonly sigma: 1 | -1
  readonly start: number
  readonly clavicle: Target | null
  readonly upper: Target | null
  readonly lower: Target | null
  readonly hand: Target | null
  /** Null keeps the twist on the upper arm and pronation on the hand. */
  readonly armTwist: TwistWrite | null
  readonly wristTwist: TwistWrite | null
  readonly fingers: readonly (Target | null)[]
  /** Minimal rotations taking the canonical straight-down segment onto the bind upper arm and forearm. */
  readonly upperBind: Quaternion
  readonly forearmBind: Quaternion
  readonly thumbAxis: Vector3 | null
  readonly calibrated: HandWrite | null
}

const vector = (v: MMDVec3) => new Vector3(v[0], v[1], v[2])

/**
 * `q` on a bone with the fixed unit `axis`, as the fixed-axis solve before the grants renders it (`@moeru/three-mmd`
 * `applyAxisLimits`, as MMD does): the same angle, turned about the axis on the side its own axis leans; in place.
 */
function onAxis(q: Quaternion, axis: Vector3): Quaternion {
  const sign = q.w < 0 ? -1 : 1
  const length = Math.hypot(q.x, q.y, q.z)
  if (length < 1e-8)
    return q.identity()
  const angle = 2 * Math.atan2(length, sign * q.w)
  return q.setFromAxisAngle(axis, sign * (q.x * axis.x + q.y * axis.y + q.z * axis.z) < 0 ? -angle : angle)
}

/**
 * The calibrated write of one hand. A finger without its own calibration curls about the palm's knuckle axis from its
 * bind pose. The fan's reference is the middle finger's bind spread, or the mean of the measured fingers without one,
 * so spread 0 sets the fingers parallel without turning the hand.
 */
function handWrite(calibration: MMDHandCalibration, sigma: 1 | -1, forearm: { x: number, y: number, z: number }): HandWrite {
  const axis = vector(calibration.axis)
  const normal = vector(calibration.normal)
  const knuckleAxis = axis.clone().cross(normal)
  const measured = Object.values(calibration.fingers).filter(finger => finger !== null)
  const reference = calibration.fingers.middle?.spread ?? (measured.length ? measured.reduce((sum, finger) => sum + finger.spread, 0) / measured.length : 0)
  const thumb = calibration.thumb
  return {
    align: new Quaternion().setFromUnitVectors(axis, new Vector3(forearm.x, forearm.y, forearm.z).normalize()),
    spreadAxis: normal.clone().multiplyScalar(sigma),
    fingers: (['index', 'middle', 'ring', 'little'] as const).map((name) => {
      const finger = calibration.fingers[name]
      return finger
        ? {
            axis: vector(finger.curlAxis),
            bend: [
              BIND_BEND_SHARE * finger.bend[0] + (1 - BIND_BEND_SHARE) * finger.chord,
              BIND_BEND_SHARE * finger.bend[1],
              BIND_BEND_SHARE * finger.bend[2],
            ] as const,
            spreadOffset: reference - finger.spread,
          }
        : { axis: knuckleAxis, bend: [0, 0, 0] as const, spreadOffset: 0 }
    }),
    thumb: thumb && {
      axis: vector(thumb.curlAxis),
      bend: [0, BIND_BEND_SHARE * thumb.bend[1], BIND_BEND_SHARE * thumb.bend[2]] as const,
      oppositionAxis: axis.clone().multiplyScalar(sigma),
      oppositionOffset: THUMB_OPPOSITION_ZERO - thumb.opposition,
    },
  }
}

/**
 * Owns one model's pure performer. It keeps the two latest tick frames, blends them by the clock's leftover fraction,
 * and writes channels to bones from `context.clean`. Missing and physics-owned bones are skipped through
 * `MMDBodyPose.bone`; every scratch object is allocated once.
 */
export class MMDBodyPerformer {
  readonly capabilities: BodyCapabilities
  /** Turn steps the performer issued since `beginFrame`, for the foot stage. */
  readonly turnSteps: TurnStep[] = []
  /** Foot re-plants the performer issued since `beginFrame`, for the foot stage. */
  readonly footSteps: BodyFootStep[] = []
  private readonly core
  private readonly pitches: Record<BodySide, number> = { left: 0, right: 0 }
  private readonly previous = new Float32Array(BODY_CHANNELS.length)
  private readonly current = new Float32Array(BODY_CHANNELS.length)
  private readonly display = new Float32Array(BODY_CHANNELS.length)
  private readonly rest: Float32Array
  private readonly gaze = { previous: { yaw: 0, pitch: 0 }, current: { yaw: 0, pitch: 0 }, yaw: 0, pitch: 0 }
  private readonly lid = { previous: 0, current: 0, value: 0 }
  private readonly line = { yaw: 0, pitch: 0 }
  private latest: BodyPerformanceFrame | null = null
  private ticks = 0
  private shifts = 0
  private blinks = 0
  private lastShiftDeg = 0
  private readonly reported = { unitSeq: 0, strokeSeq: 0, inUnit: false, cue: 0, emotion: 0, reaction: 0, stroke: null as { form: BodyGestureForm, hand: BodyGestureHand, unitSeq: number, hit: number } | null, act: null as { seq: number, state: BodyActFeedback['state'] } | null, rest: 'none' as BodyRest }
  /** The largest angle, radians, between a written local rotation and the clean pose, per group, since `beginFrame`. */
  readonly writeDeviation: Record<MMDBodyWriteGroup, number> = { hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
  private readonly disabledLayers = new Set<string>()
  private readonly layerIds: readonly string[]
  private readonly hips: Target | null
  private readonly translation: string | null
  private readonly chain: readonly (Target | null)[]
  private readonly weights: Float64Array
  private readonly neck: Target | null
  private readonly head: Target | null
  private readonly arms: Record<BodySide, ArmTargets>
  private readonly euler = new Euler(0, 0, 0, 'YXZ')
  private readonly delta = new Quaternion()
  private readonly blend = new Quaternion()
  private readonly q1 = new Quaternion()
  private readonly q2 = new Quaternion()
  private readonly measured = new Quaternion()
  private readonly turn = new Quaternion()
  private readonly twistTurn = new Quaternion()
  private readonly keep = new Quaternion()
  private readonly carry = new Quaternion()
  private readonly part = new Quaternion()
  private readonly reference = new Quaternion()
  private readonly twistClean = new Quaternion()
  private readonly goal = new Vector3()
  private readonly reach = new Vector3()
  private readonly offset = new Vector3()
  private readonly axisZ = new Vector3(0, 0, 1)
  private readonly down = new Vector3(0, -1, 0)

  private readonly onEvent: (event: MMDBodyEvent) => void

  constructor(private readonly pose: MMDBodyPose, readonly traits: BodyRigTraits, options: { seed: number, layers?: readonly PerformanceLayer[], onEvent: (event: MMDBodyEvent) => void }) {
    this.onEvent = options.onEvent
    const layers = (options.layers ?? []).map(layer => this.switchable(layer))
    this.layerIds = layers.map(layer => layer.id)
    this.core = createBodyPerformer({ traits, seed: options.seed, layers })
    const rest = this.core.restChannels()
    this.rest = rest
    this.previous.set(rest)
    this.current.set(rest)
    this.display.set(rest)
    const { rig } = pose
    const target = (name: string | null | undefined): Target | null => {
      const bone = pose.bone(name)
      const index = name ? pose.indices.get(name) : undefined
      return bone && index !== undefined ? { bone, index } : null
    }
    this.hips = target(rig.bones.hips)
    this.translation = rig.hipsTranslation.groove ?? rig.hipsTranslation.center
    this.chain = rig.spineChain.map(link => target(link.name))
    this.weights = spineWeights(traits.spineChain)
    this.neck = target(rig.bones.neck)
    this.head = target(rig.bones.head)
    // A twist bone is written only where it sits directly between two written joints and has a fixed axis; anything
    // else (missing, physics-owned, no axis, another hierarchy) keeps that joint's twist on the joint bones.
    const twist = (bone: MMDTwistBone | null, parent: Target | null, child: Target | null): TwistWrite | null => {
      const found = bone?.fixedAxis ? target(bone.name) : null
      if (!found || !bone?.fixedAxis || !parent || !child || found.bone.parent !== parent.bone || child.bone.parent !== found.bone)
        return null
      const toTwist = found.bone.position.clone()
      const toChild = child.bone.position.clone()
      return { target: found, axis: vector(bone.fixedAxis).normalize(), toTwist, toChild }
    }
    const arm = (side: BodySide): ArmTargets => {
      const bind = (segment: { x: number, y: number, z: number }) => new Quaternion().setFromUnitVectors(this.down, new Vector3(segment.x, segment.y, segment.z).normalize())
      const axis = rig.thumbAxis[side]
      const upper = target(rig.bones[`${side}UpperArm`])
      const lower = target(rig.bones[`${side}LowerArm`])
      const hand = target(rig.bones[`${side}Hand`])
      return {
        sigma: side === 'left' ? 1 : -1,
        start: channelIndex(`${side}ClavElev`),
        clavicle: target(rig.bones[`${side}Shoulder`]),
        upper,
        lower,
        hand,
        armTwist: twist(rig.twist[side].arm, upper, lower),
        wristTwist: twist(rig.twist[side].wrist, lower, hand),
        fingers: fingers.flatMap(finger => (finger === 'Thumb' ? joints.Thumb : joints.other).map(joint => target(rig.fingerBones[`${side}${finger}${joint}` as HumanoidFingerBoneName]))),
        upperBind: bind(traits.arms[side].upperArm),
        forearmBind: bind(traits.arms[side].forearm),
        thumbAxis: axis ? new Vector3(...axis) : null,
        calibrated: rig.hands[side] && handWrite(rig.hands[side], side === 'left' ? 1 : -1, traits.arms[side].forearm),
      }
    }
    this.arms = { left: arm('left'), right: arm('right') }
    this.capabilities = this.core.step(this.restInput()).capabilities
    this.core.reset()
  }

  /**
   * Layers the `setPerformanceLayer` command turned off report weight 0, so the stack eases them out. The ramp times
   * are read through, not copied: a layer may report a shorter exit when it yields (a clip claiming a gesture arm).
   */
  private switchable(layer: PerformanceLayer): PerformanceLayer {
    return {
      id: layer.id,
      order: layer.order,
      mode: layer.mode,
      mask: layer.mask,
      get enterSeconds() {
        return layer.enterSeconds
      },
      get exitSeconds() {
        return layer.exitSeconds
      },
      plan: layer.plan?.bind(layer),
      step: (context) => {
        const output = layer.step(context)
        return this.disabledLayers.has(layer.id) ? { ...output, weight: 0 } : output
      },
      reset: () => layer.reset(),
    }
  }

  private restInput(): BodyPerformanceInput {
    const zero = { yaw: 0, pitch: 0, roll: 0 }
    return {
      head: { attitude: zero, slow: zero, terms: { emphasis: zero, impulse: zero, pet: zero, held: zero, gesture: zero, cue: zero, sway: zero } },
      posture: { amplitude: 0, shiftRate: 0, support: 0 },
      gaze: { yaw: 0, pitch: 0, kind: 'sustained', saccadeSeq: 0, blinkFactor: 1, micro: { yaw: 0, pitch: 0 } },
      breath: { phase: 0, period: 4, scale: 0 },
      voice: { speaking: false, level: 0, slow: 0, onsetSeq: 0, emphasis: null },
      mood: { valence: 0, arousal: 0, tension: 0 },
      energy: { level: 0.5, mode: 'idle', away: false, reactingUntil: 0 },
      held: { emotion: null, strength: 0, level: 0, side: 1 },
      events: { impulse: null, gesture: null, cue: null, poke: null, pet: { level: 0, active: false, x: 0, y: 0 }, react: null },
      directive: { stance: 'stand', rest: 'none', act: null },
      facingYaw: 0,
      allowTurn: false,
      viewerYaw: 0,
      dragging: false,
      attention: { approach: 0, cursorShare: 0 },
      rootVelocity: { x: 0, y: 0, z: 0 },
      owned: { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 },
      gait: null,
      armLift: { left: 0, right: 0 },
      idle: null,
      groovePhase: null,
    }
  }

  setLayerEnabled(id: string, enabled: boolean): void {
    if (enabled)
      this.disabledLayers.delete(id)
    else
      this.disabledLayers.add(id)
  }

  beginFrame(): void {
    this.turnSteps.length = 0
    this.footSteps.length = 0
    for (const group of Object.keys(this.writeDeviation) as MMDBodyWriteGroup[])
      this.writeDeviation[group] = 0
  }

  /** Turns the core's layer reports into events; see `MMDBodyEvent`. */
  private report(frame: BodyPerformanceFrame): void {
    const { gesture, cue, emotion, reaction } = frame.diagnostics
    const r = this.reported
    if (gesture.unitSeq !== r.unitSeq) {
      r.unitSeq = gesture.unitSeq
      r.inUnit = true
      this.onEvent({ kind: 'gesture-unit', phase: 'start', unitSeq: gesture.unitSeq })
    }
    if (gesture.strokeSeq !== r.strokeSeq) {
      r.strokeSeq = gesture.strokeSeq
      r.stroke = gesture.form && gesture.hand && gesture.plannedHit !== null ? { form: gesture.form, hand: gesture.hand, unitSeq: gesture.unitSeq, hit: gesture.plannedHit } : null
    }
    if (r.stroke && frame.tick * BODY_TICK >= r.stroke.hit - 1e-9) {
      const { form, hand, unitSeq } = r.stroke
      r.stroke = null
      this.onEvent({ kind: 'gesture-stroke', form, hand, unitSeq })
    }
    if (r.inUnit && gesture.phase === 'rest') {
      r.inUnit = false
      this.onEvent({ kind: 'gesture-unit', phase: 'end', unitSeq: r.unitSeq })
    }
    if (cue.seq !== r.cue) {
      r.cue = cue.seq
      if (cue.kind)
        this.onEvent({ kind: 'cue', cue: cue.kind, seq: cue.seq })
    }
    if (emotion.seq !== r.emotion) {
      r.emotion = emotion.seq
      if (emotion.emotion && emotion.phase)
        this.onEvent({ kind: 'emotion-posture', emotion: emotion.emotion, phase: emotion.phase })
    }
    if (reaction.seq !== r.reaction) {
      r.reaction = reaction.seq
      if (reaction.kind)
        this.onEvent({ kind: 'reaction', reaction: reaction.kind })
    }
    const act = frame.act
    if (act && (act.seq !== r.act?.seq || act.state !== r.act.state)) {
      r.act = { seq: act.seq, state: act.state }
      this.onEvent({ kind: 'act', id: act.id, state: act.state, seq: act.seq })
    }
  }

  /** Advances one tick. An arm without a clear pose keeps its last valid pose in the core; the first one is logged. */
  step(input: BodyPerformanceInput): void {
    const collisions = this.latest?.diagnostics.collisions.count ?? 0
    const frame = this.core.step(input)
    const { last } = frame.diagnostics.collisions
    if (collisions === 0 && last)
      console.warn(`[mmd] No clear arm pose for ${last.side} (proxy penetration ${last.depth} model units); that arm keeps its previous pose`)
    this.ticks++
    this.latest = frame
    this.previous.set(this.current)
    this.current.set(frame.channels)
    this.gaze.previous.yaw = this.gaze.current.yaw
    this.gaze.previous.pitch = this.gaze.current.pitch
    this.gaze.current.yaw = this.gaze.previous.yaw + wrap(frame.gaze.yaw - this.gaze.previous.yaw)
    this.gaze.current.pitch = frame.gaze.pitch
    this.lid.previous = this.lid.current
    this.lid.current = frame.lidClose
    for (const step of frame.turnSteps)
      this.turnSteps.push(step)
    for (const step of frame.footSteps)
      this.footSteps.push(step)
    if (frame.diagnostics.gazeShifts > this.shifts) {
      // The core measures a shift from its gaze line before the tick to the new goal; the line excludes eye residue.
      this.lastShiftDeg = Math.hypot(wrap(input.gaze.yaw - this.line.yaw), input.gaze.pitch - this.line.pitch) * DEG
      this.onEvent({ kind: 'gaze-shift', amplitudeDeg: this.lastShiftDeg, yawDeg: wrap(input.gaze.yaw - this.line.yaw) * DEG, goal: input.gaze.kind })
    }
    this.shifts = frame.diagnostics.gazeShifts
    this.blinks = frame.diagnostics.blinks
    this.report(frame)
    if (input.directive.rest !== this.reported.rest) {
      this.reported.rest = input.directive.rest
      this.onEvent({ kind: 'rest', rest: input.directive.rest })
    }
    this.line.yaw = frame.gaze.yaw - 0.3 * input.gaze.micro.yaw
    this.line.pitch = frame.gaze.pitch - 0.3 * input.gaze.micro.pitch
  }

  /** Blends the two latest ticks; `fraction` is the clock's leftover share of a tick. */
  sample(fraction: number): void {
    for (let c = 0; c < this.display.length; c++)
      this.display[c] = this.previous[c] + (this.current[c] - this.previous[c]) * fraction
    this.gaze.yaw = this.gaze.previous.yaw + (this.gaze.current.yaw - this.gaze.previous.yaw) * fraction
    this.gaze.pitch = this.gaze.previous.pitch + (this.gaze.current.pitch - this.gaze.previous.pitch) * fraction
    this.lid.value = this.lid.previous + (this.lid.current - this.lid.previous) * fraction
  }

  /** The displayed gaze line in the stance frame, radians; positive pitch looks down. */
  get gazeLine(): { readonly yaw: number, readonly pitch: number } {
    return this.gaze
  }

  /** Body lid closure [0, 1] on display; the face combines it with Natural's blink as `max`. */
  get lidClose(): number {
    return this.lid.value
  }

  /** The displayed channel value, in `BODY_CHANNELS` units. */
  channel(index: number): number {
    return this.display[index]
  }

  /** Each foot's displayed pitch, radians (positive lifts the toes), for the foot stage (architecture 5.1). */
  get footPitch(): Readonly<Record<BodySide, number>> {
    this.pitches.left = this.display[FOOT_PITCH.left]
    this.pitches.right = this.display[FOOT_PITCH.right]
    return this.pitches
  }

  get frame(): BodyPerformanceFrame | null {
    return this.latest
  }

  private rotation(channels: ArrayLike<number>, at: number, out: Quaternion): Quaternion {
    return out.setFromEuler(this.euler.set(channels[at + 1], channels[at], channels[at + 2], 'YXZ'))
  }

  private write(target: Target | null, clean: MMDCleanPose, delta: Quaternion, owned: number, group: MMDBodyWriteGroup): void {
    if (!target)
      return
    this.blend.identity().slerp(delta, 1 - owned)
    const source = clean.quaternions[target.index]
    const written = target.bone.quaternion.copy(source).multiply(this.blend)
    // Measured on the written bone, so the deviation is the actual write. The angle of conj(clean) * written ignores the
    // clean quaternion's norm, which mixer interpolation leaves slightly off 1; an acos of their dot would read that as
    // up to about 1e-3 rad of rotation.
    const relative = this.measured.copy(source).conjugate().multiply(written)
    const angle = 2 * Math.atan2(Math.hypot(relative.x, relative.y, relative.z), Math.abs(relative.w))
    this.writeDeviation[group] = Math.max(this.writeDeviation[group], angle)
  }

  /** Pelvis offset, hips and the spine chain. Returns the mesh-local pelvis offset the foot stage re-applies. */
  applyTorso(clean: MMDCleanPose, weights: MMDBodyWeights, c: ArrayLike<number> = this.display): Vector3 {
    const length = this.traits.legLength * (1 - weights.pelvis)
    this.offset.copy(this.pose.right).multiplyScalar(c[0] * length).addScaledVector(this.pose.up, c[1] * length).addScaledVector(this.pose.forward, c[2] * length)
    this.pose.translate(this.translation, clean, this.offset)
    this.write(this.hips, clean, this.rotation(c, 3, this.delta), weights.hips, 'hips')
    for (let i = 0; i < this.chain.length; i++) {
      let yaw = 0
      let pitch = 0
      let roll = 0
      for (let k = 0; k < 3; k++) {
        const w = this.weights[i * 3 + k]
        yaw += w * c[6 + 3 * k]
        pitch += w * c[7 + 3 * k]
        roll += w * c[8 + 3 * k]
      }
      this.delta.setFromEuler(this.euler.set(pitch, yaw, roll, 'YXZ'))
      this.write(this.chain[i], clean, this.delta, weights.torso, 'torso')
    }
    return this.offset
  }

  /** Neck and head; the caller applies facing first. Returns the head bone's local yaw, radians. */
  applyHead(clean: MMDCleanPose, owned: number, channels: ArrayLike<number> = this.display): number {
    this.write(this.neck, clean, this.rotation(channels, 15, this.delta), owned, 'head')
    this.write(this.head, clean, this.rotation(channels, 18, this.delta), owned, 'head')
    return this.head ? this.euler.setFromQuaternion(this.head.bone.quaternion, 'YXZ').y : 0
  }

  /**
   * Clavicles, arms, hands and fingers. The canonical channels hang a straight-down arm with the palm toward the thigh;
   * `upperBind` and `forearmBind` carry that reference onto the bind arm, so the posed segment directions equal the
   * performer's own forward kinematics, which its collision corrector cleared. A calibrated hand (`HandWrite`) is first
   * swung onto the forearm line, so the posed hand direction also equals the forward kinematics' hand; the hand keeps
   * its bind roll about that line. Where a side has a usable twist bone (`TwistWrite`), upper-arm twist turns `腕捩`
   * and pronation turns `手捩` instead of the upper arm and the hand, so the mesh between the joints twists along its
   * length (the grant solve spreads each turn over its `捩1..3` children); every joint below keeps its world rotation
   * and position. Under a clip that owns part of the arm, the joints are blended with the clip pose first and the twist
   * split second, so they stay where the write without twist bones puts them at every ownership. Otherwise twist stays
   * on the upper arm and pronation on the hand.
   */
  applyArms(clean: MMDCleanPose, weights: MMDBodyWeights, channels: ArrayLike<number> = this.display): void {
    for (const side of sides) {
      const arm = this.arms[side]
      const { sigma, start } = arm
      const owned = weights[`${side}Arm`]
      const group = `${side}Arm` as const
      const clavicle = this.q1.setFromEuler(this.euler.set(0, -sigma * channels[start + 1], sigma * channels[start], 'YXZ'))
      this.write(arm.clavicle, clean, clavicle, owned, group)
      // The write's share against the clean pose; with a twist bone the joints are blended first and split second.
      const share = 1 - owned
      // upper = clavicle^-1 * Rx(-flex) Rz(sigma abduct) * Ry(-sigma twist) * upperBind^-1
      this.delta.setFromEuler(this.euler.set(-channels[start + 2], 0, sigma * channels[start + 3], 'YXZ'))
      this.delta.multiply(this.q2.setFromEuler(this.euler.set(0, -sigma * channels[start + 4], 0, 'YXZ')))
      this.delta.premultiply(clavicle.invert()).multiply(this.q2.copy(arm.upperBind).invert())
      if (arm.armTwist) {
        // The twist T = upperBind Ry(-sigma twist) upperBind^-1, at the write's share, goes to the twist bone: the
        // upper arm keeps its blended rotation times (share T)^-1 K, and the forearm starts from `carry`.
        this.turn.copy(arm.upperBind).multiply(this.q2.setFromEuler(this.euler.set(0, -sigma * channels[start + 4], 0, 'YXZ'))).multiply(this.q1.copy(arm.upperBind).invert())
        this.turn.copy(this.q1.identity().slerp(this.turn, share))
        this.splitTwist(arm.armTwist, clean, true)
        this.write(arm.upper, clean, this.part.identity().slerp(this.delta, share).multiply(this.keep), 0, group)
        this.writeTwist(arm.armTwist, clean, group)
      }
      else {
        this.write(arm.upper, clean, this.delta, owned, group)
      }
      // forearm = upperBind * Rx(-elbow) * forearmBind^-1
      this.delta.copy(arm.upperBind).multiply(this.q1.setFromEuler(this.euler.set(-channels[start + 5], 0, 0, 'YXZ'))).multiply(this.q2.copy(arm.forearmBind).invert())
      if (arm.armTwist || arm.wristTwist) {
        this.part.identity().slerp(this.delta, share)
        if (arm.armTwist)
          this.carried(this.part, arm.lower!, clean)
        if (arm.wristTwist) {
          // Pronation T = forearmBind Ry(-sigma pron) forearmBind^-1 goes to the wrist twist bone the same way, at the
          // write's share: the forearm ends with K, and the hand starts from `carry`.
          this.turn.copy(arm.forearmBind).multiply(this.q2.setFromEuler(this.euler.set(0, -sigma * channels[start + 6], 0, 'YXZ'))).multiply(this.q1.copy(arm.forearmBind).invert())
          this.turn.copy(this.q1.identity().slerp(this.turn, share))
          this.splitTwist(arm.wristTwist, clean, false)
          this.part.multiply(this.keep)
          this.write(arm.lower, clean, this.part, 0, group)
          this.writeTwist(arm.wristTwist, clean, group)
        }
        else {
          this.write(arm.lower, clean, this.part, 0, group)
        }
      }
      else {
        this.write(arm.lower, clean, this.delta, owned, group)
      }
      // hand = forearmBind * Ry(-sigma pron) Rz(-sigma wflex) Rx(wdev) * forearmBind^-1
      this.delta.setFromEuler(this.euler.set(0, -sigma * channels[start + 6], 0, 'YXZ'))
      this.delta.multiply(this.q1.setFromEuler(this.euler.set(0, 0, -sigma * channels[start + 7], 'YXZ')))
      this.delta.multiply(this.q1.setFromEuler(this.euler.set(channels[start + 8], 0, 0, 'YXZ')))
      this.delta.premultiply(arm.forearmBind).multiply(this.q2.copy(arm.forearmBind).invert())
      if (arm.calibrated)
        this.delta.multiply(arm.calibrated.align)
      if (arm.wristTwist)
        this.write(arm.hand, clean, this.carried(this.part.identity().slerp(this.delta, share), arm.hand!, clean), 0, group)
      else
        this.write(arm.hand, clean, this.delta, owned, group)
      const fingerOwned = weights[`${side}Fingers`]
      const hand = arm.calibrated
      for (let j = 0; j < arm.fingers.length; j++) {
        const angle = channels[start + 9 + j]
        const joint = j % 3
        const finger = hand && j >= 3 ? hand.fingers[(j - 3) / 3 | 0] : null
        if (finger) {
          // Curl 0 is the joint straight along the palm, so the bind bend comes off first. The first joint also turns
          // about the palm normal from the bind spread to the fan's.
          this.delta.setFromAxisAngle(finger.axis, angle - finger.bend[joint])
          if (joint === 0)
            this.delta.premultiply(this.q1.setFromAxisAngle(hand!.spreadAxis, SPREAD_FAN[(j - 3) / 3] * channels[start + 24] + finger.spreadOffset))
        }
        else if (j < 3 && hand?.thumb) {
          // The thumb curls about its own axis; its first joint then folds the thumb across the palm.
          this.delta.setFromAxisAngle(hand.thumb.axis, angle - hand.thumb.bend[joint])
          if (joint === 0)
            this.delta.premultiply(this.q1.setFromAxisAngle(hand.thumb.oppositionAxis, channels[start + 25] + hand.thumb.oppositionOffset))
        }
        else if (j < 3 && arm.thumbAxis) {
          this.delta.setFromAxisAngle(arm.thumbAxis, angle)
        }
        else {
          // Without a calibration, curls bend toward a palm assumed to face down at bind.
          this.delta.setFromAxisAngle(this.axisZ, -sigma * angle)
        }
        this.write(arm.fingers[j], clean, this.delta, fingerOwned, `${side}Fingers`)
      }
    }
  }

  /**
   * Moves `this.turn`, a joint's twist about its bind segment at the write's share, onto that segment's twist bone, and
   * keeps every joint where the write without the twist bone puts it. The twist bone's clean rotation (a clip may key
   * it) stays under the turn. `twistTurn` is the bone's resulting turn about its fixed axis, as the fixed-axis solve
   * leaves it. `keep` (K) is the least turn that puts the lower joint back where that write puts it: the fixed axis may
   * lie off the segment by a few degrees and the twist bone off the line (3.7 degrees and 4 % of the upper arm on one
   * library rig), so the turn alone would move the lower joint. With `pulled` the turn comes off the joint above
   * (upper-arm twist), which then ends with turn^-1 K; otherwise the joint above ends with K (pronation, which the hand
   * holds). `carry` is the rotation the joint below starts from, so its world rotation is that write's.
   */
  private splitTwist(write: TwistWrite, clean: MMDCleanPose, pulled: boolean): void {
    const { axis } = write
    const source = this.twistClean.copy(clean.quaternions[write.target.index]).normalize()
    const reference = onAxis(this.reference.copy(source), axis)
    onAxis(this.twistTurn.copy(this.turn).multiply(source), axis)
    this.reach.copy(write.toChild).applyQuaternion(this.twistTurn).add(write.toTwist).normalize()
    this.goal.copy(write.toChild).applyQuaternion(reference).add(write.toTwist)
    if (pulled)
      this.goal.applyQuaternion(this.turn)
    this.keep.setFromUnitVectors(this.reach, this.goal.normalize())
    this.carry.copy(this.keep).multiply(this.twistTurn).invert()
    if (pulled) {
      this.carry.multiply(this.turn)
      this.keep.premultiply(this.q1.copy(this.turn).invert())
    }
    this.carry.multiply(reference)
  }

  /** Turns the twist bone of the latest `splitTwist` by `this.turn` on its clean rotation. */
  private writeTwist(write: TwistWrite, clean: MMDCleanPose, group: MMDBodyWriteGroup): void {
    const source = this.twistClean.copy(clean.quaternions[write.target.index]).normalize()
    this.write(write.target, clean, this.q2.copy(source).invert().multiply(this.turn).multiply(source), 0, group)
  }

  /** `local`, a joint's blended rotation on its clean pose, started from `carry` in its parent's frame; in place. */
  private carried(local: Quaternion, target: Target, clean: MMDCleanPose): Quaternion {
    const source = this.q2.copy(clean.quaternions[target.index]).normalize()
    return local.premultiply(source).premultiply(this.carry).premultiply(source.invert())
  }

  restChannels(): Float32Array {
    return this.core.restChannels()
  }

  get diagnostics() {
    const frame = this.latest
    const c = this.current
    return {
      tick: this.ticks,
      layers: Object.fromEntries(this.layerIds.map(id => [id, this.disabledLayers.has(id) ? 0 : 1])),
      support: frame?.support ?? 0,
      shift: { target: frame?.diagnostics.shiftTarget ?? 0, dwellS: frame?.diagnostics.dwell ?? 0 },
      breath: { speechLift: frame?.diagnostics.speechLift ?? 0, inhales: frame?.diagnostics.inhales ?? 0 },
      gaze: {
        shiftDeg: this.lastShiftDeg,
        eyeDeg: frame ? Math.hypot(frame.eyes.yaw, frame.eyes.pitch) * DEG : 0,
        headDeg: Math.hypot(c[15] + c[18], c[16] + c[19]) * DEG,
        trunkDeg: (c[6] + c[9] + c[12]) * DEG,
        shifts: this.shifts,
        blinks: this.blinks,
      },
      correctionDeg: { left: (frame?.diagnostics.correction.left ?? 0) * DEG, right: (frame?.diagnostics.correction.right ?? 0) * DEG },
      collision: { count: frame?.diagnostics.collisions.count ?? 0, last: frame?.diagnostics.collisions.last ?? null },
      corrector: { capHits: frame?.diagnostics.corrector.capHits ?? 0, guardScans: frame?.diagnostics.corrector.guardScans ?? 0 },
      writeDeviationRad: { ...this.writeDeviation },
      gestureActivation: { left: frame?.diagnostics.gesture.activation.left ?? 0, right: frame?.diagnostics.gesture.activation.right ?? 0 },
      arms: {
        deg: { left: this.armAngles('left', c), right: this.armAngles('right', c) },
        restDeg: { left: this.armAngles('left', this.rest), right: this.armAngles('right', this.rest) },
      },
    }
  }

  /** The nine arm angles of one side, degrees, in `BODY_CHANNELS` order. */
  private armAngles(side: BodySide, channels: ArrayLike<number>): number[] {
    const start = this.arms[side].start
    return Array.from({ length: 9 }, (_, j) => channels[start + j] * DEG)
  }

  /** Rewinds the performer with Natural, so event timestamps and performer time share one origin. */
  reset(): void {
    this.core.reset()
    const rest = this.core.restChannels()
    this.previous.set(rest)
    this.current.set(rest)
    this.display.set(rest)
    this.latest = null
    this.ticks = this.shifts = this.blinks = 0
    Object.assign(this.reported, { unitSeq: 0, strokeSeq: 0, inUnit: false, cue: 0, emotion: 0, reaction: 0, stroke: null, act: null, rest: 'none' })
    this.lastShiftDeg = 0
    this.line.yaw = this.line.pitch = 0
    this.gaze.previous.yaw = this.gaze.previous.pitch = this.gaze.current.yaw = this.gaze.current.pitch = 0
    this.lid.previous = this.lid.current = this.lid.value = 0
    this.turnSteps.length = 0
    this.footSteps.length = 0
  }
}
