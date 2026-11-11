import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'

import type { ClipMaskGroup } from '../clip-mask'
import type { TurnStep } from '../look-at'
import type { RestRelativeRotation, Vec3 } from '../types'
import type { BodySide } from './channels'

export type BodyBone = 'hips' | 'spine0' | 'spine1' | 'spine2' | 'spine3' | 'neck' | 'head'
export type BodyRest = 'none' | 'rest' | 'doze'
export type BodyActId = 'sigh' | 'shoulder-roll' | 'foot-replant' | 'look-around' | 'hand-inspect' | 'clasp-rock' | 'arm-swing' | 'hair-tuck' | 'yawn' | 'peek-chat' | 'heel-raise' | 'wave'
export type BodyEmotion = PerformanceEmotion
export type BodyHeadTerm = 'emphasis' | 'impulse' | 'pet' | 'held' | 'gesture' | 'cue'

export class BodyRigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid body rig trait: ${field}`)
    this.name = 'BodyRigError'
  }
}

/** Kinematic obstacle, expressed in the rest-aligned axes of its canonical ancestor. */
export type BodyCollider = {
  readonly bone: BodyBone
  readonly centre: Readonly<Vec3>
  readonly rotation: Readonly<RestRelativeRotation>
} & (
  | { readonly shape: 'sphere', readonly radius: number }
  | { readonly shape: 'capsule', readonly radius: number, readonly length: number }
  | { readonly shape: 'box', readonly halfSize: Readonly<Vec3> }
)

export interface BodyArmTraits {
  /** Absolute bind positions in model units, +X character left, +Y up, +Z forward. */
  readonly shoulder: Readonly<Vec3>
  readonly clavicle: Readonly<Vec3> | null
  /** Bind elbow minus shoulder, and wrist minus elbow, in the same axes and units. */
  readonly upperArm: Readonly<Vec3>
  readonly forearm: Readonly<Vec3>
  readonly handLength: number
  readonly fingers: 'full' | 'partial' | 'none'
  readonly twist: boolean
}

export interface BodyRigTraits {
  readonly legLength: number
  readonly hips: Readonly<Vec3>
  /** Hierarchy order, lower to upper; one to four absolute bind positions. */
  readonly spineChain: readonly Readonly<Vec3>[]
  /** MMD commonly has hips and spine as siblings. */
  readonly spineParent: 'root' | 'hips'
  readonly neck: Readonly<Vec3>
  readonly head: Readonly<Vec3>
  readonly arms: Readonly<Record<BodySide, BodyArmTraits>>
  readonly feet: Readonly<Record<BodySide, {
    readonly ankle: Readonly<Vec3>
    readonly toe: Readonly<Vec3> | null
    readonly heelBack: number
    readonly toeBend: boolean
    readonly toeIk: boolean
  }>>
  readonly legIk: boolean
  readonly eyeYawLimit: number
  readonly eyePitchLimit: number
  /** Empty means use proportional torso and head proxies. Dynamic bodies never enter this list. */
  readonly colliders: readonly BodyCollider[]
}

export interface BodyGazeGoal {
  readonly yaw: number
  readonly pitch: number
  readonly kind: 'free' | 'sustained' | 'travel'
}

/** Mapped intent; no Natural types cross this boundary. All times are active seconds. */
export interface BodyPerformanceInput {
  readonly head: {
    /** Natural posture only, converted to radians; terms stay separate for later whole-body layers. */
    readonly attitude: Readonly<RestRelativeRotation>
    readonly slow: Readonly<RestRelativeRotation>
    readonly terms: Readonly<Record<BodyHeadTerm, Readonly<RestRelativeRotation>>>
  }
  readonly posture: {
    readonly amplitude: number
    readonly shiftRate: number
    /** null releases the scheduler; positive support means the RIGHT foot. */
    readonly support: number | null
  }
  readonly gaze: BodyGazeGoal & {
    readonly saccadeSeq: number
    /** Natural openness, 1 open; body output is closure, 1 shut. */
    readonly blinkFactor: number
    /** High-passed eye residue, already in radians. */
    readonly micro: { readonly yaw: number, readonly pitch: number }
  }
  readonly breath: { readonly phase: number, readonly period: number, readonly scale: number }
  readonly voice: {
    readonly speaking: boolean
    readonly level: number
    readonly slow: number
    readonly onsetSeq: number
    readonly emphasis: { readonly seq: number, readonly at: number, readonly magnitude: number, readonly tau: number, readonly kind: 'nod' | 'tilt', readonly side: number } | null
  }
  readonly mood: { readonly valence: number, readonly arousal: number, readonly tension: number }
  readonly energy: { readonly level: number, readonly mode: PerformanceMode, readonly away: boolean, readonly reactingUntil: number }
  readonly held: { readonly emotion: BodyEmotion | null, readonly strength: number, readonly level: number, readonly side: number }
  readonly events: {
    readonly impulse: { readonly seq: number, readonly at: number, readonly emotion: BodyEmotion, readonly intensity: number, readonly band: Band, readonly side: number } | null
    readonly gesture: { readonly seq: number, readonly at: number, readonly kind: 'laugh' | 'recoil' | 'shake' | 'drop' | 'sway' | 'tilt-in' | 'look-away' | 'nod-off', readonly side: number, readonly scale: number, readonly lifetime: number } | null
    readonly cue: { readonly seq: number, readonly start: number, readonly end: number, readonly kind: 'nod' | 'shake' | 'shrug' | 'lean' | 'glance', readonly count: number, readonly side: number } | null
    readonly poke: { readonly seq: number, readonly at: number, readonly region: 'head' | 'body', readonly x: number, readonly y: number } | null
    readonly pet: { readonly level: number, readonly active: boolean, readonly x: number, readonly y: number }
    readonly react: { readonly seq: number, readonly at: number, readonly kind: 'wake' | 'screen-change' } | null
  }
  readonly directive: {
    readonly stance: 'stand' | 'sit' | 'sleep'
    readonly rest: BodyRest
    readonly act: { readonly seq: number, readonly id: BodyActId, readonly seed: number } | null
  }
  /** Actual facing in the stance frame; feed back facingYaw when no external planner owns it. */
  readonly facingYaw: number
  readonly allowTurn: boolean
  readonly dragging: boolean
  readonly attention: { readonly approach: number, readonly cursorShare: number }
  /** Root linear velocity in stance axes, model units/s; never integrated into root position. */
  readonly rootVelocity: Readonly<Vec3>
  readonly owned: Readonly<Record<ClipMaskGroup, number>>
  /** Null while gait is absent. Channels use BODY_CHANNELS: lower body overrides, torso/arms add. */
  readonly gait: {
    readonly weight: number
    readonly support: number
    readonly mode: 'idle' | 'turning' | 'starting' | 'walking' | 'stopping'
    readonly channels: ArrayLike<number>
  } | null
  /** Per-side standing hang clearance added to abduction, radians, from the adapter's hang solver. */
  readonly armLift: Readonly<Record<BodySide, number>>
}

export interface BodyCapabilities {
  readonly gestures: Readonly<Record<BodySide, boolean>>
  readonly headClearance: Readonly<Record<BodySide, boolean>>
}

export interface BodyActFeedback {
  readonly seq: number
  readonly id: BodyActId
  readonly state: 'playing' | 'finished' | 'cancelled'
}

/** Borrowed until the next step/reset; copy channels for display interpolation. */
export interface BodyPerformanceFrame {
  readonly tick: number
  readonly channels: Float32Array
  /** Same pelvis channels, scaled by legLength, in stance model units. */
  readonly pelvis: Readonly<Vec3>
  readonly support: number
  /** Absolute stance-frame line; use the rendered head to aim the eyes closed-loop. */
  readonly gaze: { readonly yaw: number, readonly pitch: number }
  /** Limited residual in the canonical FK head frame, for diagnostics; adapters aim per eye. */
  readonly eyes: { readonly yaw: number, readonly pitch: number }
  readonly facingYaw: number
  readonly turning: boolean
  readonly turnStarted: boolean
  readonly turnSteps: readonly TurnStep[]
  readonly footSteps: readonly TurnStep[]
  readonly lidClose: number
  readonly mouthOpen: number
  readonly act: BodyActFeedback | null
  readonly capabilities: BodyCapabilities
  readonly diagnostics: {
    readonly shiftTarget: number
    readonly dwell: number
    readonly speechLift: number
    readonly inhales: number
    readonly gazeShifts: number
    readonly blinks: number
    readonly correction: Readonly<Record<BodySide, number>>
    readonly penetration: Readonly<Record<BodySide, number>>
    readonly headPenetration: Readonly<Record<BodySide, number>>
    /**
     * Ticks on which an arm had no pose clear of the proxies and kept its last valid arm, hand and finger channels
     * while the rest of the body moved on; `last` names the latest side, its remaining depth in model units and tick.
     */
    readonly collisions: { readonly count: number, readonly last: { readonly side: BodySide, readonly depth: number, readonly tick: number } | null }
  }
}
