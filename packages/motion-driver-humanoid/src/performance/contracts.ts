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
export type BodyCueKind = 'nod' | 'shake' | 'shrug' | 'lean' | 'glance'
/** Architecture 4a gesture forms; `hand-to-chest` and `thinking-hand` are the emotion-requested arm forms. */
export type BodyGestureForm = 'beat' | 'palm-up' | 'press' | 'point' | 'chop' | 'frame' | 'hand-to-chest' | 'thinking-hand'
/** Held arm forms the gesture layer performs on a layer's request: an emotion's (4a) or an idle act's (4e). */
export type BodyArmForm = Extract<BodyGestureForm, 'hand-to-chest' | 'thinking-hand'> | 'cover-mouth' | 'hair-touch'
export type BodyGestureHand = BodySide | 'both'
export type BodyGesturePhase = 'rest' | 'preparation' | 'stroke' | 'hold' | 'retraction'
export type BodyReactionKind = 'body-poke' | 'head-poke' | 'pet' | 'drag'

/**
 * A gesture layer's report of its unit. `unitSeq` increments when a unit starts and `strokeSeq` when a stroke is
 * planned; `plannedHit` is that stroke's planned hit in performer seconds, null between strokes.
 */
export interface BodyGestureReport {
  readonly unitSeq: number
  readonly strokeSeq: number
  readonly form: BodyGestureForm | null
  readonly hand: BodyGestureHand | null
  readonly phase: BodyGesturePhase
  readonly plannedHit: number | null
}

/** `seq` increments once per realised cue, emotion posture onset or release, or reaction. */
export interface BodyCueReport {
  readonly seq: number
  readonly kind: BodyCueKind | null
}

export interface BodyEmotionReport {
  readonly seq: number
  readonly emotion: PerformanceEmotion | null
  readonly phase: 'onset' | 'release' | null
}

export interface BodyReactionReport {
  readonly seq: number
  readonly kind: BodyReactionKind | null
}

export class BodyRigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid body rig trait: ${field}`)
    this.name = 'BodyRigError'
  }
}

/** A leg segment a body rides on: the thigh turns about the hip joint, and the shin also bends at the knee. */
export interface BodyLegFollow {
  readonly side: BodySide
  readonly segment: 'thigh' | 'shin'
}

/** Absolute bind positions of one leg's IK joints, in the axes and units of `BodyArmTraits`. */
export interface BodyLegJoints {
  readonly hip: Readonly<Vec3>
  readonly knee: Readonly<Vec3>
  readonly ankle: Readonly<Vec3>
}

/** Kinematic obstacle, expressed in the rest-aligned axes of its canonical ancestor. */
export type BodyCollider = {
  readonly bone: BodyBone
  readonly centre: Readonly<Vec3>
  readonly rotation: Readonly<RestRelativeRotation>
  /**
   * A body on a leg bone keeps the hips as `bone`, where it sits at bind, and turns with this leg segment while the gait
   * carries the feet (`BodyPerformanceInput.gait.ankles`).
   */
  readonly leg?: BodyLegFollow
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
  /** The leg IK chains' joints; null when either leg lacks one, and then leg bodies stay with the hips. */
  readonly legs: Readonly<Record<BodySide, BodyLegJoints>> | null
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

/** Natural's idle behaviours, which the act layer gives a whole-body form. */
export type BodyIdleKind = 'stretch' | 'yawn' | 'look-around' | 'check-in' | 'peer' | 'zone-out' | 'nod-off' | 'sway' | 'sleep' | 'about-to-speak' | 'let-go' | 'sigh' | 'shoulder-roll' | 'shift-stance' | 'clasp-hands' | 'hair-touch' | 'heel-rock' | 'arm-swing'

/**
 * The idle behaviour the one idle scheduler (Natural) started, as the adapter maps it. The act layer plays its own form
 * of it from the tick it sees a new `seq`, and decides nothing. Times are seconds of the behaviour, not clock times.
 */
export interface BodyIdleAct {
  readonly seq: number
  readonly kind: BodyIdleKind
  /** Planned seconds from start to end; Infinity for sleep and the about-to-speak hold. */
  readonly duration: number
  /** Seconds a behaviour let go before its planned end fades over; null while it runs and after it ran its course. */
  readonly release: number | null
  readonly side: -1 | 1
  /** Sway period, seconds. */
  readonly period: number
  /** Repeats a body act fits into its duration: shoulder-roll sides, heel rocks, arm swings. */
  readonly count: number
  /** The clasp's place: 0 in front, 1 behind the back. */
  readonly variant: 0 | 1
  /** Nod-off droops: `t` seconds after the start, sinking for `x` seconds. */
  readonly keys: readonly { readonly t: number, readonly x: number, readonly y: number }[]
  /** Glances in Natural's eye space (x right of the viewer, y up), `at` seconds after the start, held `hold` seconds. */
  readonly glances: readonly { readonly at: number, readonly x: number, readonly y: number, readonly hold: number }[]
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
    readonly cue: { readonly seq: number, readonly start: number, readonly end: number, readonly kind: BodyCueKind, readonly count: number, readonly side: number } | null
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
  /**
   * The viewer's direction (the camera) in the stance frame, before Natural's fixation deflects it: the body's home,
   * which the feet return to face while the gaze is free. The facing when the body has no points.
   */
  readonly viewerYaw: number
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
    /**
     * The ankle targets the leg IK reaches this tick (the gait's foot targets with their roll), in the stance frame and
     * model units; null without leg IK. The collision corrector poses the leg bodies from them.
     */
    readonly ankles: Readonly<Record<BodySide, Readonly<Vec3>>> | null
  } | null
  /** Per-side standing hang clearance added to abduction, radians, from the adapter's hang solver. */
  readonly armLift: Readonly<Record<BodySide, number>>
  /** The latest idle behaviour Natural started, kept after it ends; null before the first and without an idle drive. */
  readonly idle: BodyIdleAct | null
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
    /**
     * Arm ticks, since construction or reset, on which the corrector's discontinuous fallbacks ran: `capHits` when the
     * 6 degree step cap bounded a projection, `guardScans` when a contact survived projection and the guard scan began.
     * A hold (`collisions.count`) follows a failed scan.
     */
    readonly corrector: { readonly capHits: number, readonly guardScans: number }
    /**
     * The latest report of each layer kind (zeros and nulls while no layer reports). `gesture.activation` is the
     * largest weight any gesture layer applied this tick to a channel of each side's arm, measured by the stack.
     */
    readonly gesture: BodyGestureReport & { readonly activation: Readonly<Record<BodySide, number>> }
    readonly cue: BodyCueReport
    readonly emotion: BodyEmotionReport
    readonly reaction: BodyReactionReport
  }
}
