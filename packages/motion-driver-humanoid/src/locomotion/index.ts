import type { SecondOrderCoefficients, SecondOrderState } from '../dynamics'
import type { Foot, FootAnchor, TurnStep } from '../foot-contact'
import type { BodyLocomotionIntent, RigTraits, Vec3 } from '../types'
import type { GaitStyle, GaitStyleKey, MutableGaitStyle } from './style'

import { advanceSecondOrder, minJerk, secondOrderCoefficients } from '../dynamics'
import { planFootSteps } from '../foot-contact'
import { createDriftNoise, deriveSeed } from '../noise'
import { createRandomStream } from '../random'
import { easeGaitStyle, GAIT_STYLE_BOUNDS, NEUTRAL_GAIT_STYLE } from './style'
import { urgencySpeedShare } from './urgency'

export type { GaitBaseline, GaitStyle, GaitStyleKey, MutableGaitStyle, WalkFactors } from './style'
export { boundGaitStyle, GAIT_STYLE_BOUNDS, GAIT_STYLE_KEYS, NEUTRAL_GAIT_STYLE, walkStyleFrom } from './style'
export { clampUrgency, urgencySpeedShare } from './urgency'

/**
 * The ground contacts a foot rolls over, in model units in the foot's own frame: the heel `heelBack` behind and the ball
 * `ballForward` ahead of the ankle, both `ankleHeight` below it.
 */
export interface FootGeometry {
  readonly ankleHeight: number
  readonly ballForward: number
  readonly heelBack: number
}

export interface GaitTraits extends Pick<RigTraits, 'legLength' | 'footBaselineY'> {
  /** Bind hip-to-ankle vertical distance in model units. */
  readonly hipToAnkleY: number
  /** Bind ankle positions in mesh-local model units. */
  readonly bindAnkles: Record<Foot, Vec3>
  /**
   * Bind hip joint positions in mesh-local model units. Without them each hip is taken to sit hipToAnkleY above its
   * ankle; a rig whose ankles stand behind its hips then walks with its feet ahead of its body and its knees bent.
   */
  readonly bindHips?: Record<Foot, Vec3>
  /** Without it the feet stay flat: every roll is 0 and its pivot 'flat' or 'air'. */
  readonly foot?: Record<Foot, FootGeometry>
}

/** Stride-to-stride variability: coefficients of variation (sd / mean) of stride time and stride length. */
export interface GaitVariability {
  readonly strideTime: number
  readonly strideLength: number
  /** Size of each arm's own lag drift behind the shoulder girdle, in strides per unit of its drift process. */
  readonly armLag: number
}

/**
 * Healthy young adults at a self-selected speed: stride time CV 1.8 %, stride length CV 3.9 % (Beauchet, Dubost, Herrmann
 * & Kressig 2005, J NeuroEng Rehabil 2:26, n = 49). Drawn independently, they reproduce that study's stride velocity CV
 * of 4.3 %. Each is a subject's SD over the study's 15 m of steady walking, about 11 strides, not the stationary SD of a
 * long walk (`elevenStrideShare`).
 *
 * `armLag` 0.002784 strides gives the left and right arms' relative phase Mirelman et al. 2015's arm phase coordination
 * index, 1.68 % over a one-minute walk (PLoS One 10:e0136043, Table 2, ages 30 to 40, usual walking; 60 strides at their
 * 1.43 m/s and 70.6 cm steps), together with the 1.08 % the stride drift alone gives it through unequal half strides.
 * Solved from the drift processes' own statistics; an arm-only term would be 0.003637.
 */
export const youngAdultStrideVariability: GaitVariability = { strideTime: 0.018, strideLength: 0.039, armLag: 0.002784 }

export interface LocomotionInput {
  /** Seconds on the fixed 120 Hz grid; only stamps events. */
  readonly now: number
  /** World x on the ground line; null means stay. */
  readonly goalX: number | null
  /** How urgently she walks, in [0, 1]; `urgencySpeedShare` turns it into a share of the reference speed. */
  readonly urgency: number
  /** Checked at departure against SIDESTEP_MAX_LEGS; an accepted sidestep keeps yaw instead of arriveFacing. */
  readonly step?: BodyLocomotionIntent['step']
  /** Facing at arrival, in radians; 0 faces the camera. */
  readonly arriveFacing: number
  /** False while sitting, during one-shots, or when a clip owns root or leg IK. */
  readonly enabled: boolean
  /** WeightShiftOutput.s; picks the first swing foot. */
  readonly idleSupport: number
  /** Current planted anchors in world space; the gait seeds from them when it leaves idle. */
  readonly plantedFeet: Record<Foot, FootAnchor>
  /** The walk's shape; `NEUTRAL_GAIT_STYLE` when omitted. A walk under way eases into a new one (`styleTau`). */
  readonly style?: GaitStyle
}

/**
 * The gait's body offsets for one tick: pelvis translation in model units (positive `pelvisLateral` toward the
 * character's right, as the reach model in this module assumes) and rotations in radians.
 */
export interface GaitBodyChannels {
  pelvisLateral: number
  pelvisDrop: number
  pelvisForeAft: number
  lowerBodyRoll: number
  lowerBodyYaw: number
  upperBodyRoll: number
  chestCounterRoll: number
  spinePitch: number
  chestPitch: number
  /** The style's head carriage (`GaitStyle.head`), radians, positive down. */
  neckPitch: number
}

/** Heel-to-toe roll of one foot (architecture 5.1). `target` stays the planning ankle; the roll is applied on top of it. */
export interface FootRoll {
  /** Foot pitch in radians about its lateral axis; positive lifts the toes. */
  readonly pitch: number
  /** Ankle displacement from `target` in the foot's frame, [forward, up], model units: the ankle rotated about `pivot`. */
  readonly ankleOffset: readonly [number, number]
  /** The ground point that holds still: the heel after a strike, the whole sole, the ball before lift-off, or none. */
  readonly pivot: 'heel' | 'flat' | 'ball' | 'air'
}

/**
 * Architecture 5.2: the pelvis yaw travels up the spine as a counter-rotation, each torso segment at its own lag, and the
 * head turns back against the torso so it stays on the travel line. Each lag is a link of architecture 3a's lag chain, a
 * critically damped response to the segment below, so every segment answers a change of stride with its own dynamics.
 * Yaws in radians, for a torso chain that does not inherit the pelvis yaw.
 */
export interface GaitTwist {
  readonly lower: number
  readonly mid: number
  readonly upper: number
  /** Minus the three torso yaws through a link of 80 ms lag, the reflex latency of head stabilisation. */
  readonly head: number
}

export interface LocomotionFoot {
  /** World target for the ankle. */
  readonly target: FootAnchor
  /** True while this foot carries weight; its target is then frozen. */
  readonly planted: boolean
  /** Swing progress 0..1, or null while planted. */
  readonly swing: number | null
  readonly roll: FootRoll
}

export interface GaitEvent {
  readonly kind: 'liftOff' | 'heelStrike'
  readonly foot: Foot
  readonly time: number
}

export interface LocomotionFrame {
  readonly mode: 'idle' | 'turning' | 'starting' | 'walking' | 'sidestepping' | 'stopping'
  readonly root: {
    /** World position; y = 0. */
    readonly position: Vec3
    readonly yaw: number
  }
  readonly speed: number
  /**
   * World x where the root comes to rest if the walk loses its goal now and brakes as hard as the gait allows
   * (`brakingDistance`), or the current pair's destination while sidestepping; otherwise the root x.
   */
  readonly restX: number
  /** Continuous phase, in steps. */
  readonly phase: number
  readonly feet: Record<Foot, LocomotionFoot>
  /** Same sign as WeightShiftOutput.s. */
  readonly support: number
  readonly body: GaitBodyChannels & { readonly chestCounterYaw: number, readonly twist: GaitTwist }
  /** True while the ordinary walk owns the gait, including its fade-out. */
  readonly walkForm: boolean
  /**
   * Architecture 5.3, radians, per arm: shoulder flexion and abduction, elbow flexion, clavicle protraction, the arm's
   * roll (upper-arm twist and forearm pronation, positive inward) and the wrist's offset from its rest (`wristFlex`,
   * palmar positive, so the style's carriage is negative).
   */
  readonly armSwing: Record<Foot, {
    readonly flexion: number
    readonly elbowFlex: number
    readonly abduct: number
    readonly clavProt: number
    readonly twist: number
    readonly pronation: number
    readonly wristFlex: number
  }>
  /** The hand's closure the walk asks for (`GaitStyle.handCurl`); 1, the rest hand, outside the walk. */
  readonly handCurl: number
  /**
   * Where she is about to face, a world yaw: during a turn, a minimum-jerk sweep from the facing the turn starts at to its
   * final facing, reached as the last step starts; otherwise the walk heading or the root yaw. `lookAhead - root.yaw` is
   * the signed turn the gaze leads by, never wrapped across a turn (architecture 5.5).
   */
  readonly lookAhead: number
  /** Blend factor: lower-body channels override the idle pose by it, torso and arm channels add. */
  readonly weight: number
  readonly events: readonly GaitEvent[]
  /** The style values this rig held below what the style asked for (`gaitStepLimit`); empty when none. */
  readonly limited: readonly GaitStyleKey[]
}

const radians = Math.PI / 180
const epsilon = 1e-9
const referenceRate = 1.44
const minRate = 1.2
const maxRate = 2.4
const referenceLengthShare = 0.625
/** beta: share of a stride that a foot carries weight. */
const stanceShare = 0.6
/** delta = 2 beta - 1: double-support share of each step. */
const doubleSupport = 2 * stanceShare - 1
/** Landing targets follow the predicted root until this swing progress, then freeze. */
const replanUntil = 0.75
/**
 * The share of a leg's length the bob plans a planted ankle to stand from its hip. At 0.988 the knee read 20 to 22
 * degrees at recorded heel strikes on two rigs (walking adults 4 to 10); 0.990 reads 18.5 and keeps the leash idle.
 */
const planReach = 0.990
const hardReach = 0.993
/** The share of a leg's length the gait lets a planted ankle stand from its hip: the leash's limit. */
export const GAIT_REACH_SHARE = hardReach
const kneeSoftening = 0.012
/**
 * How far the reach floor may lower the pelvis below the bob: enough for the off-centre
 * stances of starts and stops. A misplaced foot needs more, so the leash shortens root travel.
 */
const floorMarginShare = 0.05
/** Share of a swing over which a lifted foot's reach requirement fades out. */
const liftFadeShare = 0.25
/** Floor of the walking swing height; 0.03 L lets short closing steps slide more than 0.002 L. */
const swingHeightFloorShare = 0.04
const stepWidthShare = 0.5
/**
 * Step width as a share of the hip joints' spacing, when the rig gives its hips: walking adults step 0.12 to 0.15 L
 * wide, about half to three quarters of that spacing. A rig's bind stance is no guide: over 13 rigs its ankles stood
 * 0.15 to 0.32 L apart (measured 2026-11-23), and a walk half that wide waddled on the wide ones.
 */
const stepWidthHipShare = 0.55
/**
 * A full stride's stance is centred this share of the step length behind the hips: walking adults land the foot 0.46 of
 * a step ahead of the hip, and the stance covers 0.6 of a step each way. A rig's bind ankles are no guide here either:
 * they stood from 0.03 L ahead of the hips to 0.09 L behind them, and the pelvis bobbed twice as far on the rigs whose
 * ankles stand under their hips.
 */
const stanceBack = 0.14
const swayShare = 0.03
/** Seconds over which a walk under way eases into a new style: about a step, so a change shows within two. */
const styleTau = 0.5
/** Extra knee softening at a style's lowest bounce, and extra bob at a bounce of 2, each in leg lengths. */
const bounceCrouchShare = 0.01
const bounceDipShare = 0.02
/**
 * The deepest bob, leg lengths, that a full stride's reach may ask of a rig before its step is shortened. Walking adults
 * bob 0.015 to 0.129 L across acted styles, and the neutral walk 0.046 to 0.050 L on rigs whose heel-off raises the
 * ankle; a rig whose ball sits under its ankle (stilettos, short robot feet) bobbed 0.08 to 0.09 L at the same stride,
 * because its trailing leg must reach (measured on 13 rigs, 2026-11-23). The style's own bounce adds on top.
 */
const maxReachBobShare = 0.06
const noLimits: readonly GaitStyleKey[] = Object.freeze([])
const strideLimited: readonly GaitStyleKey[] = Object.freeze(['stride'])
const speedLimited: readonly GaitStyleKey[] = Object.freeze(['speed'])
const strideSpeedLimited: readonly GaitStyleKey[] = Object.freeze(['stride', 'speed'])
/** Goals closer than this share of the leg length are not worth a walk. */
const minWalkShare = 0.05
/**
 * Maximum departure distance in leg lengths for an explicitly requested sidestep.
 * Tuning value from the owner's ruling of 2026-11-21: step onto the pointer without turning.
 */
export const SIDESTEP_MAX_LEGS = 0.6
/**
 * A sidestep pair's travel in leg lengths, and its step rate at the reference speed, steps per second. They are the
 * sidestep's own: the walk's stride and cadence were refitted to walking adults on 2026-11-23, and the sidestep keeps
 * the size and pace it was reviewed with.
 */
const sidestepPairShare = 0.5
const sidestepReferenceRate = 1.8
const sidestepPlanReach = 0.97
const sidestepHardReach = 0.985
const sidestepKneeSoftening = 0.02
const sidestepFloorMargin = 0.01
const sidestepTorsoTwist = [[-0.25, 0.03], [-0.55, 0.06], [-0.35, 0.09]] as const
/** After arrival each foot must sit within this fore-aft share of the root, or it takes a closing step. */
const closingShare = 0.02
/** Step rate of the closing steps after the root has stopped, steps per second. */
const closingRate = 1.7
const turnStepYaw = 45 * radians
const turnStepDuration = 0.45
const turnTolerance = radians
const turnSwingShare = 0.03
/**
 * A walk that starts or ends at another facing turns while it steps: the body turns over this many steps from the first
 * weight shift (a start) or, for an arrival, from `arriveLeadSteps` before the braking starts. Adults turning a quarter
 * while walking take about three steps and 1.4 s for the middle 80 % of the turn (190 walking quarter turns, Bandai Namco
 * Research Motiondataset 2, styles normal, feminine and youthful; measured 2026-11-23). Turned from the first braking
 * tick, an arrival was half made after she had all but stopped; a stop without a goal ahead (a reversal) has no step to
 * lead with, so it turns over `brakeTurnSteps` instead.
 */
const departTurnSteps = 2.4
const arriveTurnSteps = 2.6
const arriveLeadSteps = 0.5
const brakeTurnSteps = 1.6
/**
 * A goal behind her is a reversal, not an arrival: from the first braking tick she turns toward the new heading, through
 * the viewer, over this many steps for the half turn, and the walk sets off the other way from the stop with that turn
 * still under way, so no settle or turn on the spot comes between. A walk at the walk urgency brakes over about 1.4 steps,
 * so 2.0 steps make the half turn's middle while she still moves and leave about 30 degrees for the stop and the first
 * step. At 2.4 steps the middle fell at the stop, and the faster spin over planted feet doubled the contact skate on two
 * rigs. Judged on the reference rig's walk scenario (2026-11-24): before, she stood 0.7 s and faced the viewer 2.2 s
 * between the two directions; now 0.2 s and 0.2 s. Over 2.0 steps in one minimum-jerk sweep the brake foot's stance saw
 * her turn 147 degrees, so it stood up to 97 degrees off her facing and read as a swivel (independent visual audit,
 * 2026-11-25). Over 2.8 steps with the ramps of `reverseRampUp` and `reverseRampDown` she turns at most 110 degrees
 * over any stance of 1.2 steps, so a foot set at its middle stays within 55 degrees of her facing (`plantedYawLimit`).
 */
const reverseTurnSteps = 2.8
/**
 * A reversal's gaze runs this many steps ahead of the turn and sweeps over all of it, so the eyes leave first with a
 * glance of about 40 degrees and the head is round before the body sets off. Without a lead the head stayed within 10
 * degrees of the hips through the turn and then swung 25 degrees past the new heading; at 0.4 steps the opening glance
 * fell below the size that recruits the head and the head still trailed (reference rig, walk scenario, 2026-11-24).
 */
const reverseLookLead = 0.8
const reverseLookShare = 1
/**
 * Shares of a reversal's turn over which its rate ramps up, and down (`cruise`); its peak rate is 1.43 times its mean.
 * The turn sets in with the brake and eases out over the new heading, so it is half done at 40 percent of its span,
 * 0.28 step sooner than with ramps of 0.3 each. Those put the half turn at the stop, and `walk-form` `turns-under-way`
 * found her under 0.05 L/s there on the reference rig and two others (2026-11-25); now on one of the three.
 */
const reverseRampUp = 0.1
const reverseRampDown = 0.5
/**
 * A reversal's outgoing step lands at least this many leg lengths ahead of the planted foot along the new heading. At the
 * stop it landed beside the brake foot, 0.05 to 0.07 L away along the new heading, so the ankles stacked; 0.2 L, a third
 * of a reference step, reads as a step on the stills.
 */
const outgoingLead = 0.2
/**
 * The look-ahead leads her facing by at most this much: walking adults turning a quarter turn carry the head up to 39
 * degrees ahead of the body (natural walk refit ADR). A reversal's lead would otherwise reach 80 degrees, past a
 * comfortable neck turn.
 */
const lookLeadMax = 40 * radians
/**
 * A start from standing turns over this many steps instead of `departTurnSteps`, and its gaze runs `standingLookLead`
 * steps ahead of the turn, ramped in over the preparation. Over 2.4 steps her hips had turned 23 degrees of a quarter
 * turn when the first foot struck and her head 30, so the first step read as a foot reaching sideways from a body still
 * square to the viewer (reference rig, walk scenario, 2026-11-24). The head starts the turn before the feet do: walking
 * adults turn the head toward a new direction of travel before the body follows (Grasso, Glasauer, Takei and Berthoz
 * 1996, NeuroReport 7:1170). Now the hips stand 35 degrees round at the first strike and the head 74 on three rigs. Over
 * 1.8 steps the standing foot stood 61 degrees off her facing before it lifted, past the 60 a planted foot may. The
 * quarter-turn capture of the walk refit turns while already walking and holds no start from standing, so these two
 * are judged on the stills.
 */
const standingTurnSteps = 2.0
const standingLookLead = 0.5
/**
 * A start from standing turns about each stance hip in turn: the loaded hip carries `standingHipShare` of the turn from
 * the first weight shift to the first heel strike, and the first foot's hip the rest from `standingSecondFrom` of a step
 * before that strike to the end of the turn. In one minimum-jerk sweep over the 2.0 steps her hips stood 9 degrees round
 * at the first foot's mid-swing and 38 at its strike, so the foot swept out sideways from a lower body still square to
 * the viewer (independent visual audit, 2026-11-25). Now they stand about 36 and 51 degrees round. The share keeps the
 * standing foot within 57 degrees of her facing until it lifts, under the 60 a planted foot may; 0.58 reached 60.1. The
 * two turns overlap by 0.2 step, so the turn never stops while both feet are down. Judged on the stills; walking adults
 * turn the pelvis toward a new direction over the stance limb (Hase and Stein 1999, J Neurophysiol 81:2914).
 */
const standingHipShare = 0.55
const standingSecondFrom = 0.8
/** A start that must turn further than this first turns the excess on the spot, so she never sets off backwards. */
const mergedTurnMax = 100 * radians
const mergedTurn = 90 * radians
/** A foot lands turned toward where the body will face a step later, at most this far from the body's facing at landing. */
const footLead = 42 * radians
/**
 * A walking foot lands within this much of the facings her body sweeps over its stance, 5 degrees inside the 60 a planted
 * foot may stand off her facing.
 */
const plantedYawLimit = 55 * radians
/** The gaze reaches a merged turn's final facing at this share of the turn, so the head leads the body by up to 35 degrees. */
const lookLeadShare = 0.65
/**
 * Trunk roll into a turn per radian per second of yaw rate at the reference speed: 3.5 degrees at the 84 deg/s peak of a
 * walking quarter turn. The lean answers the turn's centripetal acceleration, speed times yaw rate, so it scales with the
 * speed: a reversal that turns fast about a stop leans hardly at all, where a lean sized by the yaw rate alone tipped her
 * 8 degrees while she stood.
 */
const turnLean = 3.5 / 84
/** Time constant of the trunk's lean into a turn, seconds: the trunk follows the yaw rate, it does not step with it. */
const turnLeanTau = 0.25
/** A start's acceleration as a share of the limit: it rises with the speed from a quarter, full at 30 % of the pace. */
const startAccelerationFloor = 0.25
const startAccelerationFullAt = 0.3
/** Architecture 5.4: the settle hold after the last plant, long enough for the stop dip and one lean overshoot. */
const settleDuration = 0.45
const blendDuration = 0.3
/** Architecture 5.4: an under-damped lean, one overshoot of about 13 % gone in 0.6 s (omega 5 rad/s, zeta 0.55). */
const leanResponse = { f: 5 / (2 * Math.PI), zeta: 0.55, r: 0 } as const
/** Architecture 5.4: the preparation before the first walk step, its draw-back lean and drop, and the stop dip. */
const preparationDuration = 0.22
const drawBackLean = -1.5 * radians
const preparationDropShare = 0.008
const stopDipShare = 0.006
/** The gait's tick, seconds: it runs on a 120 Hz grid. */
const gaitTick = 1 / 120
/** Architecture 5.1: heel-strike and toe-off pitch at a full stride, scaled by min(1, strideScale). */
const heelStrikePitch = 20 * radians
const toeOffPitch = 28 * radians
/** The toe-down pitch a swinging foot hangs at behind the knee, reached 30 % into the swing. */
const swingHangPitch = 36 * radians
/** Share of a walking swing by which the foot has turned to its landing facing (`sampleSwing`); judged on the stills. */
const swingTurnBy = 0.7
/** The ankle's speed at lift-off as a share of the swing's mean speed: the toe-off roll hands its motion on. */
const swingStartSpeed = 0.45
/** Stance shares: the foot is flat from 12 % and its heel rises from 62 %. */
const footFlatAt = 0.16
const heelOffAt = 0.72
/** Architecture 5.2: pelvis yaw at a full stride, and each torso segment's share of it (negative: a counter) and lag in steps. */
const pelvisTwist = 6 * radians
const torsoTwist = [[-0.13, 0.03], [-0.29, 0.06], [-0.18, 0.09]] as const
/** Steps by which the torso's counter-rotation and the arm swing run ahead of the pelvis twist. */
const torsoLead = 0.3
/** Pelvis list at a full stride, and the steps by which it runs ahead of the lateral sway. */
const pelvisList = 4.5 * radians
const listLead = 0.3
/** The pelvis's forward speed swings by this share of the walking speed about its mean, fastest 0.2 step after a heel strike. */
const speedRipple = 0.2
const rippleLag = 0.2
/**
 * The trunk's fore-aft nod at a full stride, most forward `nodLag` step after a heel strike, and the chest's share of it
 * `chestNodLag` steps later still: the upper trunk answers the load the pelvis takes rather than pitching with it as one
 * block. The trunk pitches twice a stride by a few degrees in walking adults (Thorstensson, Nilsson, Carlson and
 * Zomlefer 1984, Acta Physiol Scand 121:9); at 1.2 degrees in one piece the chest held the same profile through the
 * stride (independent visual audit, 2026-11-24), so 2 degrees, the chest 0.06 step behind the spine, judged on stills.
 * The chest then took 0.4 of the nod, 0.8 degrees, and the profile still repeated step after step (independent visual
 * audit, 2026-11-25), so the chest now nods `chestNod` of its own, 0.12 step behind the spine: the ribs visibly catch
 * the load after the pelvis has taken it. Judged on stills; 2 + 2.5 degrees stays within the few degrees of the study.
 */
const trunkNod = 2 * radians
const nodLag = 0.08
const chestNod = 2.5 * radians
const chestNodLag = 0.12
/**
 * The chest's roll against the pelvis list, as a share of the list, `chestRollLag` steps behind it: the thorax bends
 * sideways against the pelvis's obliquity in walking (Crosbie, Vachalathiti and Smith 1997, Gait Posture 5:6), so the
 * spine curves through each step and the shoulders ride nearer level than the hips. The share and lag are judged on
 * stills: the shoulder line rolled 4 degrees a step against the hips' 9 before (reference rig, walk scenario).
 */
const chestCounterShare = 0.35
const chestRollLag = 0.06
/**
 * The head's nod at a full stride, carried by the bounce, `headNodLag` steps behind the trunk's: the head rides the body
 * a little late instead of holding one pitch. At 1.5 degrees 0.12 step behind, 80 ms at the reference step rate, the
 * chin did not read as riding the step (independent visual audit, 2026-11-25); 2.5 degrees 0.2 step behind lands it
 * after the chest's nod, as each link of the trunk answers the one below. Judged on stills; it stays under the trunk's
 * nod of 4.5 degrees.
 */
const headNod = 2.5 * radians
const headNodLag = 0.2
/** Swing height at a full stride, in leg lengths. */
const swingHeightShare = 0.13
/** The performer's head-stabilisation latency (`STEADY_LAG` in `performance/index.ts`), seconds. */
const headCounterLag = 0.08
/**
 * The elbow's swing lags the shoulder's, seconds, before the performer's followers add their own lag. The human walk
 * reference's median is 200.9 ms (bands-v5 walk `chain.upperArm-lowerArm.lagMs` p50, 100STYLE forward walks); at 0.03 s
 * the posed forearm trailed the upper arm by 67 ms (`walk-form` wrist-lags, reference rig, 2026-11-24) and the arm swung
 * as one stiff piece. At 0.1 s it trailed by 100 to 117 ms and the forearm still did not carry on after the trunk had
 * turned back (independent visual audit, 2026-11-25), and a happy walk's wide swing held the wrist forward at its high
 * point. At 0.17 s the forearm keeps rising after the upper arm has started back.
 */
const elbowLag = 0.17
/**
 * The arm's roll (twist and pronation) follows the shoulder by this much, seconds: the elbow's 0.1 s before the elbow
 * came to trail further, so the forearm still turns inward while the arm is forward of the body and out behind it.
 */
const armRollLag = 0.1
/**
 * The right arm's swing as a share of the left's, a fixed trait: adults walking overground at a comfortable pace swing
 * the left arm more, mean directional arm swing asymmetry index 21.9 (Killeen et al. 2018, Scientific Reports, n = 334,
 * doi:10.1038/s41598-018-31151-9, https://www.nature.com/articles/s41598-018-31151-9).
 */
const rightSwingShare = 1 - 0.219
/**
 * The upper arm swings behind the shoulder girdle by the human walk reference's median, 25.9 ms (bands-v5 walk
 * `chain.shoulder-upperArm.lagMs` p50, n = 24, 100STYLE forward walks). Each arm's lag drifts about it on its own stream.
 */
const upperArmLag = 0.0259
/**
 * The upper arm's angle out from the chest's vertical at the back and at the front of its swing, degrees: walking adults
 * hold it 11 to 14 degrees out behind and 13 to 23 in front (same clips). 14 and 19 kept the arm off the body colliders
 * before the body proxies were fitted to the rest hang; 12 and 16 sit inside the human range and keep it off them on ten rigs
 * (2026-11-24). It is a floor on the arm's own hang, which
 * the performer applies: a rig that already stands with its arms wider keeps its own.
 */
const armOutBack = 12
const armOutForward = 16
/**
 * The forearm's forward rise (shoulder flexion plus elbow flexion, degrees from hanging) at which the walk starts to ease
 * the elbow's swing, and the rise it never reaches. Walking adults' fast arms carry the hand forward to about chest
 * height, not above it; an elbow that swung freely with a wide, carried swing lifted the forearm 123 degrees at the
 * front, above horizontal, so the hand rose as in a wave (visual review, 2026-11-24). The neutral walk's forearm rises
 * at most about 58 degrees, under the knee.
 */
const forearmRise = { knee: 60, ceiling: 85 } as const
/**
 * The arm's roll at a full swing, degrees either way, positive inward at the front of the swing and outward behind it,
 * timed with the elbow. Acted walks roll the forearm 7 to 19 degrees within a stride (36 in a youthful walk), and about
 * half the authored MMD walks key the arm twist bone, swinging 13 to 16 degrees either way (arm-hand plan, section 1).
 * Two thirds go to pronation, which turns the hand alone; a third to the upper arm's twist, which also swings the bent
 * forearm across the body and toward the hip.
 */
const armRollTwist = 2.5
const armRollPronation = 4.5
/** Seconds of shoulder-girdle history kept for the arms: the upper arm's lag, the elbow's after it, and drift room. */
const girdleHistory = 0.5
/**
 * The stride fluctuations are long-range correlated, not white (Hausdorff et al. 1995, 1996; Terrier, Turner & Schutz
 * 2005): the package's 1/f source (`createDriftNoise`, architecture 3b) stepped in strides, its time constants log-spaced
 * from one stride to 16 (about the longest walking span) and its output low-passed over a sixth of the shortest, 3b's
 * ratio, so the step rate never steps.
 */
const strideNoise = { taus: [1, 4, 16], filterTau: 1 / 6 } as const
/**
 * Expected SD over 11 consecutive strides of `strideNoise` averaged per stride, in units of its stationary SD: 0.6163.
 * Beauchet et al. 2005 measured over a 20 m walkway less 2.5 m at each end, 15 m at their mean stride of 137.4 cm, so
 * 10.9 strides; the slow components barely move inside that window, so a CV read there is 0.62 of the process's own.
 * Computed from the process's covariance (three equal OU terms, their first-order output filter, one-stride averages,
 * sample SD with n - 1); the walk divides the source CVs by it.
 */
const elevenStrideShare = 0.6163
/** `deriveSeed` indices of the gait seed's stride streams; the seed's own stream stays the first-foot tie-break. */
const strideTimeStream = 0
const strideLengthStream = 1
/** `deriveSeed` indices of each arm's lag drift. */
const armLagStreams: Record<Foot, number> = { left: 2, right: 3 }
const sides = ['left', 'right'] as const
/** Lateral sign: left = -1, right = +1, matching `support`. */
const footSign: Record<Foot, 1 | -1> = { left: -1, right: 1 }

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrap(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

function opposite(foot: Foot): Foot {
  return foot === 'left' ? 'right' : 'left'
}

function copyAnchor(anchor: FootAnchor): FootAnchor {
  return { position: { ...anchor.position }, yaw: anchor.yaw }
}

/** Cycloid blend: zero velocity at lift-off and touchdown. */
function cycloid(progress: number) {
  return progress - Math.sin(2 * Math.PI * progress) / (2 * Math.PI)
}

/**
 * Share of a move at progress `u` that ramps its rate up over the first `up` of the move along a smoothstep, holds it
 * and ramps it down over the last `down`: a minimum-jerk move's rate peaks at 1.875 times its mean, this one's at
 * 1 / (1 - (up + down) / 2) times.
 */
function cruise(u: number, up: number, down: number) {
  const rate = 1 / (1 - (up + down) / 2)
  // The integral of a smoothstep from 0 to x, per unit of ramp: x^3 - x^4 / 2.
  const rise = (x: number) => x ** 3 - x ** 4 / 2
  const t = clamp(u, 0, 1)
  if (t < up)
    return rate * up * rise(t / up)
  if (t > 1 - down)
    return 1 - rate * down * rise((1 - t) / down)
  return rate * (up / 2 + t - up)
}

/** Share of a swing's travel at progress `u`: the speed rises at once, peaks at two thirds and stops at touchdown. */
function swingTravel(u: number, start = swingStartSpeed) {
  const rest = 1 - clamp(u, 0, 1)
  const bell = 1 - 2.5 * rest ** 1.5 + 1.5 * rest ** 2.5
  // A start at `start` that dies out as (1 - u)^2 covers a third of that speed in travel.
  return start * (1 - rest ** 3) / 3 + (1 - start / 3) * bell
}

/** Share of a swing's height at progress `u`: the ankle is highest at 0.29 and comes in low over the last quarter. */
function swingLift(u: number) {
  const rest = 1 - clamp(u, 0, 1)
  return Math.sin(Math.PI * (1 - rest * rest))
}

/**
 * Share of a turn step's yaw covered at step progress `u`. The turn leaves and reaches its facing at rest, as the gaze
 * turn planner's steps do (goal 3), so neither end steps the yaw rate; the first step eases in with `2u^2 - u^3`, the
 * last eases out with its mirror, and the steps between stay linear. Every step still ends on its planned facing and the
 * yaw rate is continuous at every step boundary, so the body turns as one movement instead of stopping at each step.
 */
function turnProgress(u: number, index: number, count: number) {
  if (index === 0)
    return u * u * (2 - u)
  if (index === count - 1)
    return 1 - (1 - u) * (1 - u) * (1 + u)
  return u
}

/** Displacement of an ankle at [forward, up] from a pivot when the foot pitches by `pitch` about that pivot. */
function pivotOffset(forward: number, up: number, pitch: number): [number, number] {
  const cos = Math.cos(pitch)
  const sin = Math.sin(pitch)
  return [forward * cos - up * sin - forward, forward * sin + up * cos - up]
}

/**
 * A standing foot pitched toe-down by `pitch` (negative radians) about its ball (architecture 5.1's ball pivot): the
 * heel rises and the ankle moves on its arc about the ball, which holds still. For a foot the gait does not carry, such
 * as the performer's heel raise.
 */
export function ballRoll(foot: FootGeometry, pitch: number): FootRoll {
  return { pitch, ankleOffset: pivotOffset(-foot.ballForward, foot.ankleHeight, pitch), pivot: 'ball' }
}

function scaleOffset(offset: readonly [number, number], share: number): [number, number] {
  return [offset[0] * share, offset[1] * share]
}

interface Swing {
  readonly foot: Foot
  readonly lift: FootAnchor
  /** Bob amplitude at lift-off; the amplitude blends to its target over the swing. */
  readonly bobFrom: number
  /** Reach-floor drop this foot required at lift-off; it fades out over the swing. */
  readonly liftDrop: number
  /** How far the toe-off roll had raised the ankle at lift-off; the swing lowers it onto its own arc. */
  readonly liftUp: number
  /** The toe-off pitch the swing leaves the ground with. */
  readonly liftPitch: number
  land: FootAnchor
  /** Planned fore-aft offset of the landing ahead of the root. */
  reach: number
  height: number
  progress: number
}

interface Walk {
  /** Seconds into the preparation; the walk's first step starts at preparationDuration. */
  preparation: number
  /** The travel direction and heading; a reversal flips both at the stop (`reverse`). */
  direction: 1 | -1
  heading: number
  readonly firstFoot: Foot
  /** Index of the current step, floor(phase). */
  step: number
  starting: boolean
  /**
   * The least roll of a start's steps: 0.5 from standing, where a first step has neither reach nor a foot behind; none
   * after a reversal, whose stop step lands flat and whose next steps roll by their own reach, so no roll jumps in.
   */
  startRoll: number
  arrived: boolean
  settle: { readonly phase: number, elapsed: number } | null
  /** The last facing planned for the arrival, or null on the way to the goal. */
  arrivalFacing: number | null
  /** Braking to the goal: the arrival turn may start before it, the stop does not. */
  stopping: boolean
  /** One leading/trailing pair. A withdrawn or replaced goal finishes this pair before yielding. */
  sidestep?: { readonly goalX: number, readonly rate: number, fromX: number, toX: number, phase: number }
}

/** One link of the twist's lag chain (architecture 3a): critically damped, `f = 1 / (pi delay)`, steady lag `delay`. */
interface TwistLink {
  readonly state: SecondOrderState
  coefficients: SecondOrderCoefficients | null
  delay: number
}

function twistLink(): TwistLink {
  return { state: { y: 0, v: 0, x: 0 }, coefficients: null, delay: 0 }
}

/**
 * A turn made while walking: the facing as a function of the gait phase, `from` at `fromPhase` and `to` from `toPhase`,
 * leaving at `startRate` (radians per step) and arriving at rest.
 */
interface YawPlan {
  readonly from: number
  readonly to: number
  readonly fromPhase: number
  readonly toPhase: number
  readonly startRate: number
  /**
   * A start from standing's two turns (`standingHipShare`): `share` of the turn from `fromPhase` to `endPhase`, the rest
   * from `secondFrom` to `toPhase`, each a minimum-jerk sweep. Without it the plan is one sweep.
   */
  readonly stance?: { readonly share: number, readonly endPhase: number, readonly secondFrom: number }
  /** A reversal (`planReverse`): the turn holds a steady rate between its ramps, and its outgoing step leads off. */
  readonly reversal?: true
  /** Steps the gaze's look-ahead runs ahead of the plan, and the share of the plan over which it turns. */
  readonly lookLead: number
  readonly lookShare: number
  /**
   * The walk phase the look-ahead's sweep starts from, `fromPhase` when omitted: a start from standing's gaze keeps the
   * walk's own clock, since its turn's clock runs ahead of it through the preparation.
   */
  readonly lookFromPhase?: number
}

interface Turn {
  /** True when a walk takes the turn over: the last step then keeps its rate instead of coming to rest. */
  readonly flows: boolean
  readonly steps: ReturnType<typeof planFootSteps>
  /** Facing at the start of each step, followed by the final facing. */
  readonly facings: readonly number[]
  index: number
  elapsed: number
  /** Reach-floor drop the stepping foot required when its step started. */
  liftDrop: number
}

/**
 * Owns the root position, gait phase and world foot anchors for one character.
 * Time comes only from step's dt. The seed's own stream breaks first-foot ties; two streams derived from it vary each
 * stride's time and length.
 */
class Locomotion {
  private readonly random: () => number
  private readonly strideTime: ReturnType<typeof createDriftNoise>
  private readonly strideLength: ReturnType<typeof createDriftNoise>
  /** This stride's speed and cadence multipliers: stride time scales by 1 / cadence, stride length by speed / cadence. */
  private speedFactor = 1
  private cadenceFactor = 1
  private readonly armLagNoise: Record<Foot, ReturnType<typeof createDriftNoise>>
  /** Each arm's lag drift, in strides. */
  private readonly armDrift: Record<Foot, number> = { left: 0, right: 0 }
  /**
   * The shoulder girdle's swing drive (the upper torso's twist over the full pelvis twist, times the step rate over the
   * reference rate) on this gait's own clock: each arm samples it at its lag, so both arms answer the trunk.
   */
  private readonly girdle = { times: [] as number[], values: [] as number[], clock: 0 }
  /** The step rate the swing was last scaled by; a halt keeps it, so the swing dies out with the trunk, not in a tick. */
  private swingRate = referenceRate
  private readonly referenceLength: number
  private readonly referenceSpeed: number
  private readonly maxAcceleration: number
  private readonly baseHalfStepWidth: number
  /** Half the bind ankle spacing: the standing width. */
  private readonly halfBindWidth: number
  /** Each hip joint in mesh-local model units. */
  private readonly hips: Record<Foot, Vec3>
  private readonly hipsAboveAnkles: Record<Foot, Vec3>
  /** Mesh-local fore-aft position of the line the ankles stand on: the stance is centred on it. */
  private readonly ankleLine: number
  /** Mesh-local fore-aft position of the hip joints. */
  private readonly hipLine: number
  private x = 0
  private readonly z = 0
  private yaw = 0
  private speed = 0
  private phase = 0.1
  /** Lateral sign of the first swing foot of the current walk. */
  private leadSign: 1 | -1 = -1
  private feet: Record<Foot, FootAnchor>
  /** Fore-aft half-span each planted foot was placed for; it lifts about this far behind the hip. */
  private spans: Record<Foot, number> = { left: 0, right: 0 }
  private walkForm = false
  private bob: number
  private swing: Swing | null = null
  private walk: Walk | null = null
  /** Keep a rejected sidestep on the ordinary walk path through its arrival turn. */
  private stepRequest: { goalX: number, sidestep: boolean } | null = null
  private turn: Turn | null = null
  private yawPlan: YawPlan | null = null
  /** Yaw rate of the last tick, radians per second; a walk that takes over a turn starts its own turn at it. */
  private yawRate = 0
  /** The trunk's roll into the turn, radians. */
  private turnRoll = 0
  private lastTurnFoot: Foot | null = null
  /** Phase of each foot's last heel strike in this walk: its stance progress, and so its roll, counts from it. */
  private strikes: Record<Foot, number> = { left: 0, right: 0 }
  private mode: LocomotionFrame['mode'] = 'idle'
  private rebased = false
  private blend = 0
  private readonly lean = { y: 0, v: 0, x: 0 }
  /** Lower, mid and upper torso, each following the one below from the pelvis yaw, then the head counter. */
  private readonly twistLinks: readonly [TwistLink, TwistLink, TwistLink, TwistLink] = [twistLink(), twistLink(), twistLink(), twistLink()]
  private leanCoefficients = secondOrderCoefficients(leanResponse, 0)
  /** This tick's preparation lean, added to the lean target while a walk prepares. */
  private leanBias = 0
  /** This tick's pelvis, shared by the leash and the frame so both see the same drop. */
  private posture: ReturnType<Locomotion['pelvis']> | null = null
  private clamps = 0
  /** The style the walk shows now, easing toward the input's. */
  private readonly style: MutableGaitStyle = { ...NEUTRAL_GAIT_STYLE }
  /** The input style with the rig's limits applied, and which values they held. */
  private readonly allowed: MutableGaitStyle = { ...NEUTRAL_GAIT_STYLE }
  private limited = noLimits
  /** The longest full step at the walk pace this rig takes, as a share of the gait's: `gaitStepLimit`. */
  readonly stepLimit: number

  constructor(private readonly traits: GaitTraits, seed: number, private readonly variability: GaitVariability) {
    this.random = createRandomStream(seed)
    this.strideTime = createDriftNoise({ seed: deriveSeed(seed, strideTimeStream), ...strideNoise })
    this.strideLength = createDriftNoise({ seed: deriveSeed(seed, strideLengthStream), ...strideNoise })
    this.armLagNoise = {
      left: createDriftNoise({ seed: deriveSeed(seed, armLagStreams.left), ...strideNoise }),
      right: createDriftNoise({ seed: deriveSeed(seed, armLagStreams.right), ...strideNoise }),
    }
    this.referenceLength = referenceLengthShare * traits.legLength
    this.referenceSpeed = this.referenceLength * referenceRate
    this.maxAcceleration = this.referenceSpeed
    const { left, right } = traits.bindAnkles
    const above = (ankle: Vec3): Vec3 => ({ x: ankle.x, y: ankle.y + traits.hipToAnkleY, z: ankle.z })
    this.hipsAboveAnkles = { left: above(left), right: above(right) }
    this.hips = traits.bindHips ?? this.hipsAboveAnkles
    this.ankleLine = (left.z + right.z) / 2
    this.hipLine = (this.hips.left.z + this.hips.right.z) / 2
    const ankleSpacing = Math.hypot(left.x - right.x, left.z - right.z)
    this.baseHalfStepWidth = traits.bindHips
      ? stepWidthHipShare * Math.abs(this.hips.left.x - this.hips.right.x) / 2
      : stepWidthShare * ankleSpacing / 2
    this.halfBindWidth = ankleSpacing / 2
    this.feet = this.bindFeet()
    this.bob = this.bobAmplitude(0, 0)
    this.stepLimit = this.longestStep()
  }

  /**
   * The longest full step, as a share of the gait's, whose reach, the trailing foot's at lift-off included, asks a bob of
   * at most `maxReachBobShare`, between the style's shortest and longest. The bob grows with the step, so a bisection finds it. A rig without foot geometry keeps
   * its feet flat and is not limited: its step length is the gait's.
   */
  private longestStep() {
    if (!this.traits.foot)
      return Number.POSITIVE_INFINITY
    // The least roll and the narrowest step ask the most bob of a step, so the limit holds in every style.
    this.style.roll = GAIT_STYLE_BOUNDS.roll[0]
    this.style.width = GAIT_STYLE_BOUNDS.width[0]
    try {
      return this.longestStepInStyle()
    }
    finally {
      this.style.roll = NEUTRAL_GAIT_STYLE.roll
      this.style.width = NEUTRAL_GAIT_STYLE.width
    }
  }

  private longestStepInStyle() {
    const bob = (share: number) => this.bobAmplitude(stanceShare * share * this.referenceLength, share, true, true) / this.traits.legLength
    const shortest = GAIT_STYLE_BOUNDS.stride[0]
    let longest = GAIT_STYLE_BOUNDS.stride[1] * Math.sqrt(GAIT_STYLE_BOUNDS.speed[1])
    if (bob(longest) <= maxReachBobShare)
      return longest
    if (bob(shortest) > maxReachBobShare)
      return shortest
    let low = shortest
    for (let k = 0; k < 24; k++) {
      const mid = (low + longest) / 2
      if (bob(mid) <= maxReachBobShare)
        low = mid
      else
        longest = mid
    }
    return low
  }

  /**
   * `style` with the rig's step limit applied: a full step is `stride` times the root of the speed, the style's `speed`
   * times the urgency's `share` of the reference, so a hurried walk on a limited rig takes shorter, quicker steps.
   */
  private allow(style: GaitStyle, share: number): GaitStyle {
    const stride = this.stepLimit / Math.sqrt(style.speed * share)
    if (style.stride <= stride) {
      this.limited = noLimits
      return style
    }
    Object.assign(this.allowed, style)
    this.allowed.stride = stride
    this.limited = strideLimited
    return this.allowed
  }

  /** Half the walking step width under the current style. */
  private get halfStepWidth() {
    return this.baseHalfStepWidth * this.style.width
  }

  /** Largest hip-to-ankle sideways offset during double support. */
  private get lateralError() {
    return Math.abs((Math.abs(this.hips.left.x) + Math.abs(this.hips.right.x)) / 2 - this.halfStepWidth) + swayShare * this.traits.legLength * Math.sin(Math.PI * doubleSupport / 2)
  }

  /**
   * The walking knee softening, leg lengths: a low bounce keeps the knees softer, and a list wider than the gait's lowers
   * the pelvis by how far it raises the stance hip, so the stance leg still reaches its foot.
   */
  private get softening() {
    const halfHips = Math.abs(this.hips.left.x - this.hips.right.x) / 2 / this.traits.legLength
    const list = halfHips * Math.max(0, Math.sin(pelvisList * this.style.pelvisList) - Math.sin(pelvisList))
    return kneeSoftening + bounceCrouchShare * Math.max(0, 1 - this.style.bounce) / (1 - GAIT_STYLE_BOUNDS.bounce[0]) + list
  }

  /** Ticks on which the reach leash shortened root travel. Zero in normal driving. */
  get leashClamps() {
    return this.clamps
  }

  /** Teleports the root, re-plants both feet at the bind ankle offsets and returns to idle. */
  rebase({ x, yaw }: { x: number, yaw: number }) {
    this.x = finite(x)
    this.yaw = finite(yaw)
    this.speed = 0
    this.phase = 0.1
    this.swing = null
    this.walk = null
    this.stepRequest = null
    this.turn = null
    this.yawPlan = null
    this.walkForm = false
    this.yawRate = 0
    this.turnRoll = 0
    this.lastTurnFoot = null
    this.feet = this.bindFeet()
    this.spans = { left: 0, right: 0 }
    this.bob = this.bobAmplitude(0, 0)
    this.mode = 'idle'
    this.rebased = true
    this.blend = 0
    this.lean.y = this.lean.v = this.lean.x = 0
    for (const link of this.twistLinks)
      link.state.y = link.state.v = link.state.x = 0
    this.girdle.times.length = this.girdle.values.length = 0
  }

  step(input: LocomotionInput, dt: number): LocomotionFrame {
    dt = Math.max(0, finite(dt))
    const events: GaitEvent[] = []
    const previousSpeed = this.speed
    const previousYaw = this.yaw
    if (input.step !== 'sidestep' || input.goalX === null)
      this.stepRequest = null
    // Between walks the style follows its input at once; while the gait still owns the body (a walk, a turn, the hand-off
    // between them, or the blend out) it eases into it.
    const style = this.allow(input.style ?? NEUTRAL_GAIT_STYLE, urgencySpeedShare(input.urgency))
    if (!this.walk && !this.turn && this.blend === 0)
      Object.assign(this.style, style)
    else if (dt > 0)
      easeGaitStyle(this.style, style, 1 - Math.exp(-dt / styleTau))
    let mode: LocomotionFrame['mode'] = 'idle'
    if (!input.enabled) {
      this.halt()
    }
    else if (!this.rebased && dt > 0) {
      // A goal that comes while she settles sets off at once: the settle only hands the body back to standing.
      if (this.walk?.settle && !this.walk.sidestep && this.worthWalking(input.goalX))
        this.walk = null
      if (!this.walk && !this.turn)
        this.depart(input)
      if (this.turn)
        mode = this.advanceTurn(input.now, dt, events)
      else if (this.walk)
        mode = this.advanceWalk(input, dt, events)
    }
    this.rebased = false
    this.mode = mode
    if (mode === 'idle')
      this.lastTurnFoot = null
    if (dt > 0) {
      this.yawRate = (this.yaw - previousYaw) / dt
      this.turnRoll += ((this.walk ? turnLean * this.yawRate * this.speed / this.referenceSpeed : 0) - this.turnRoll) * (1 - Math.exp(-dt / turnLeanTau))
    }

    const owned = mode === 'turning' || (this.walk !== null && this.walk.settle === null)
    this.blend = clamp(this.blend + (owned ? dt : -dt) / blendDuration, 0, 1)
    if (!this.walk && !this.turn && this.blend === 0)
      this.setWalkForm(false)
    const acceleration = dt > 0 ? (this.speed - previousSpeed) / dt : 0
    const leanTarget = this.walk?.sidestep ? 0 : 2 * radians * this.speed / this.referenceSpeed + 3 * radians * acceleration / this.maxAcceleration + this.leanBias + (this.walkForm ? this.style.lean : 0)
    this.leanBias = 0
    if (dt !== this.leanCoefficients.dt)
      this.leanCoefficients = secondOrderCoefficients(leanResponse, dt)
    advanceSecondOrder(this.lean, leanTarget, this.leanCoefficients)
    const frame = this.frame(mode, events, this.posture ?? this.pelvis(this.speed, this.x), dt)
    this.posture = null
    return frame
  }

  private bindFeet(): Record<Foot, FootAnchor> {
    const place = (bind: Vec3): FootAnchor => {
      const local = this.toWorld(bind.x, bind.z)
      return { position: { x: local.x, y: this.traits.footBaselineY, z: local.z }, yaw: this.yaw }
    }
    return { left: place(this.traits.bindAnkles.left), right: place(this.traits.bindAnkles.right) }
  }

  /** Mesh-local x (character left) and z (forward) to world, about the root at the current yaw. */
  private toWorld(localX: number, localZ: number) {
    const cos = Math.cos(this.yaw)
    const sin = Math.sin(this.yaw)
    return { x: this.x + cos * localX + sin * localZ, z: this.z - sin * localX + cos * localZ }
  }

  /** Fore-aft offset of `point` from the line the ankles stand on. */
  private foreAft(point: Vec3, yaw = this.yaw) {
    return (point.x - this.x) * Math.sin(yaw) + (point.z - this.z) * Math.cos(yaw) - this.ankleLine
  }

  /** The cadence law at the speed without this stride's variation, times this stride's cadence. */
  private stepRate(speed: number) {
    const length = this.walkForm ? this.referenceLength * this.style.stride : sidestepPairShare * this.traits.legLength
    const referenceSpeed = this.walkForm ? this.referenceSpeed : length * sidestepReferenceRate
    return clamp(Math.sqrt(speed / this.speedFactor * referenceSpeed) / length, minRate, maxRate) * this.cadenceFactor
  }

  /**
   * The fastest walk whose step, `speed / stepRate(speed)`, stays within the rig's step limit under this stride's
   * variation and the eased style. The step grows with the speed, as the root of it while the cadence law holds and in
   * proportion once the cadence is clamped.
   */
  private fastestSpeed() {
    const step = this.stepLimit * this.referenceLength
    if (!Number.isFinite(step))
      return Number.POSITIVE_INFINITY
    const length = this.referenceLength * this.style.stride
    const lawful = this.referenceSpeed * (step * this.cadenceFactor / length) ** 2 / this.speedFactor
    const rate = Math.sqrt(lawful / this.speedFactor * this.referenceSpeed) / length
    return rate > maxRate ? step * maxRate * this.cadenceFactor : rate < minRate ? step * minRate * this.cadenceFactor : lawful
  }

  /**
   * Advances the stride processes by `strides` and sets the multipliers: stride time ~ exp(sigma_T n_T) and stride
   * length ~ exp(sigma_L n_L) at a steady speed, independent, so the speed varies by both. Each sigma is the source's
   * 11-stride CV over `elevenStrideShare`. Each arm's lag drifts on its own stream at the same pace.
   */
  private vary(strides: number) {
    const time = this.variability.strideTime / elevenStrideShare * this.strideTime.step(strides)
    const length = this.variability.strideLength / elevenStrideShare * this.strideLength.step(strides)
    this.cadenceFactor = Math.exp(-time)
    this.speedFactor = Math.exp(length - time)
    for (const side of sides)
      this.armDrift[side] = this.variability.armLag * this.armLagNoise[side].step(strides)
  }

  /** Appends this tick's shoulder-girdle drive; a zero tick replaces the latest sample instead of adding time. */
  private recordGirdle(value: number, dt: number) {
    const girdle = this.girdle
    if (dt > 0 || girdle.times.length === 0) {
      girdle.clock += dt
      girdle.times.push(girdle.clock)
      girdle.values.push(value)
    }
    else {
      girdle.values[girdle.values.length - 1] = value
    }
    while (girdle.times.length > 2 && (girdle.times[1] ?? 0) <= girdle.clock - girdleHistory) {
      girdle.times.shift()
      girdle.values.shift()
    }
  }

  /** The shoulder-girdle drive `lag` seconds ago, linear between ticks; before the history starts, its first sample. */
  private girdleAt(lag: number) {
    const { times, values, clock } = this.girdle
    const at = clock - lag
    for (let index = times.length - 1; index > 0; index--) {
      const from = times[index - 1] ?? at
      if (from <= at) {
        const to = times[index] ?? at
        const a = values[index - 1] ?? 0
        const b = values[index] ?? 0
        return to > from ? a + (b - a) * Math.min(1, (at - from) / (to - from)) : b
      }
    }
    return values[0] ?? 0
  }

  /**
   * Largest speed that still stops exactly at the goal on this tick grid while the
   * speed changes by at most a_max * dt per tick: the discrete form of sqrt(2 a_max d).
   */
  private stoppingSpeed(distance: number, dt: number) {
    const change = this.maxAcceleration * dt
    const units = distance / (change * dt)
    const whole = Math.floor((Math.sqrt(1 + 8 * units) - 1) / 2)
    const fraction = clamp((units - whole * (whole + 1) / 2) / (whole + 1), 0, 1)
    return (whole + fraction) * change
  }

  /**
   * Root travel during the stance that follows a landing in `untilLanding` seconds, predicted
   * by running advanceWalk's per-tick speed law forward. `ahead` is null while braking.
   */
  private predictStanceTravel(ahead: number | null, command: number, untilLanding: number, dt: number) {
    const change = this.maxAcceleration * dt
    const travels = [0]
    const speeds = [this.speed]
    let speed = this.speed
    let travelled = 0
    const extend = (until: number) => {
      while ((travels.length - 1) * dt < until) {
        const remaining = ahead === null ? 0 : ahead - travelled
        const target = ahead === null || remaining <= 0 ? 0 : Math.min(command, this.stoppingSpeed(remaining, dt))
        speed = Math.max(0, clamp(target, speed - change, speed + change * this.startShare(speed, command)))
        travelled += ahead === null ? speed * dt : Math.min(speed * dt, Math.max(0, remaining))
        travels.push(travelled)
        speeds.push(speed)
      }
    }
    // Linear interpolation between ticks keeps the prediction continuous as the landing time slides.
    const sample = (values: readonly number[], time: number) => {
      const index = Math.min(Math.floor(time / dt), values.length - 2)
      const from = values[index] ?? 0
      return from + ((values[index + 1] ?? from) - from) * (time / dt - index)
    }
    extend(untilLanding + dt)
    const stanceDuration = 2 * stanceShare / this.stepRate(sample(speeds, untilLanding))
    extend(untilLanding + stanceDuration + dt)
    return sample(travels, untilLanding + stanceDuration) - sample(travels, untilLanding)
  }

  /**
   * A_bob = (h0 - c0 - sqrt(r_plan^2 - span^2 - e_lat^2)) / ((1 + cos(pi delta)) / 2), where span is
   * the fore-aft hip-to-ankle offset at heel strike and lift-off (beta * l at constant speed).
   */
  /**
   * Mesh-local fore-aft position a stance of half-span `reach` is centred on: the bind ankle line for a foot set down
   * beside a stopped root, moving to `stanceBack` of the step behind the hips by half a full stride's reach.
   */
  private stanceCentre(reach: number) {
    const stride = clamp(reach / (stanceShare * this.referenceLength / 2), 0, 1)
    return this.ankleLine + stride * (this.hipLine - stanceBack * reach / stanceShare - this.ankleLine)
  }

  private setWalkForm(walkForm: boolean) {
    if (this.walkForm === walkForm)
      return
    this.walkForm = walkForm
    this.bob = this.bobAmplitude(0, 0)
  }

  private bobAmplitude(halfSpan: number, strideScale: number, walkForm = this.walkForm, rolled = false) {
    const legLength = this.traits.legLength
    if (!walkForm) {
      const reach = sidestepPlanReach * legLength
      const lateral = this.halfBindWidth * 0.3 + swayShare * legLength * Math.sin(Math.PI * doubleSupport / 2)
      const required = this.traits.hipToAnkleY - sidestepKneeSoftening * legLength - Math.sqrt(Math.max(0, reach ** 2 - halfSpan ** 2 - lateral ** 2))
      return Math.max(0, required / ((1 + Math.cos(Math.PI * doubleSupport)) / 2))
    }
    const reach = planReach * legLength
    const standing = (this.hips.left.y + this.hips.right.y) / 2 - this.traits.footBaselineY - this.softening * legLength
    const shape = (phase: number) => (1 + Math.cos(2 * Math.PI * (phase - 0.1))) / 2
    const drop = (foreAft: number, up: number) => standing - up - Math.sqrt(Math.max(0, reach ** 2 - foreAft ** 2 - this.lateralError ** 2))
    const length = strideScale * this.referenceLength
    const ripple = speedRipple * length / (2 * Math.PI)
    // At the strike the foot stands on its heel, toes up: the ankle is behind and above its planning target, and the
    // pelvis is at the back of its fore-aft swing.
    const foot = this.traits.foot
    const strike = heelStrikePitch * this.style.roll * Math.min(1, strideScale)
    const [forward, up] = foot ? pivotOffset((foot.left.heelBack + foot.right.heelBack) / 2, (foot.left.ankleHeight + foot.right.ankleHeight) / 2, strike) : [0, 0]
    const hipAhead = this.hipLine - this.stanceCentre(halfSpan)
    const front = drop(Math.max(0, halfSpan - hipAhead + forward - ripple * Math.sin(-2 * Math.PI * rippleLag)), up) / shape(0)
    // The trailing foot is flat until its heel rises, `heelOffAt` of its stance after it landed `halfSpan` ahead.
    const flatUntil = heelOffAt * (1 + doubleSupport)
    const behind = flatUntil * length - halfSpan + hipAhead + ripple * Math.sin(2 * Math.PI * (flatUntil - rippleLag))
    const rear = drop(Math.max(0, behind), 0) / shape(flatUntil)
    // At lift-off, a full stance behind, the trailing foot stands on its ball at the toe-off pitch, which carries the ankle
    // forward and up: a ball far ahead of the ankle lifts it, one under the ankle (a stiletto) hardly does. The reach floor
    // lowers the pelvis for it at lift-off only, so the bob plans for it only without roll geometry, where the heel never
    // rises and the foot stays flat until it lifts. `longestStep` reads it with `rolled`.
    if (foot && !rolled)
      return Math.max(0, front, rear)
    const stance = 1 + doubleSupport
    const toeOff = toeOffPitch * this.style.roll * Math.max(1, this.style.push) * Math.min(1, strideScale)
    const [ballAhead, ballUp] = foot ? pivotOffset(-(foot.left.ballForward + foot.right.ballForward) / 2, (foot.left.ankleHeight + foot.right.ankleHeight) / 2, -toeOff) : [0, 0]
    const lift = drop(Math.max(0, stance * length - halfSpan + hipAhead + ripple * Math.sin(2 * Math.PI * (stance - rippleLag)) - ballAhead), ballUp) / shape(stance)
    return Math.max(0, front, rear, lift)
  }

  /**
   * A bouncy or loaded style's extra knee give after each heel strike, leg lengths: none at the strike, deepest 0.25 step
   * later (the loading response) and gone by mid-stance, so the knee still lands straight.
   */
  private loadingDip(strideScale: number) {
    const t = this.phase - Math.floor(this.phase)
    const amount = bounceDipShare * this.traits.legLength * (Math.max(0, this.style.bounce - 1) + this.style.load) * Math.min(1, strideScale)
    return t < 0.5 ? amount * Math.sin(2 * Math.PI * t) ** 2 : 0
  }

  /** A planted foot's ankle in the world: its planning anchor moved by its roll's ankle offset. */
  private ankle(side: Foot, strideScale: number): Vec3 {
    const anchor = this.feet[side]
    const [forward, up] = this.roll(side, strideScale).ankleOffset
    return {
      x: anchor.position.x + Math.sin(anchor.yaw) * forward,
      y: anchor.position.y + up,
      z: anchor.position.z + Math.cos(anchor.yaw) * forward,
    }
  }

  private support(phase: number) {
    return -this.leadSign * Math.sin(Math.PI * (phase - 0.1))
  }

  /** +1 while the right foot leads, -1 while the left foot leads. */
  private lead(phase: number) {
    return -this.leadSign * Math.cos(Math.PI * (phase - 0.1))
  }

  private pelvis(speed: number, rootX: number) {
    const length = speed / this.stepRate(speed)
    const swayScale = 1 - 0.3 * clamp((speed - this.referenceSpeed) / (0.3 * this.referenceSpeed), 0, 1)
    const lateral = swayShare * this.traits.legLength * swayScale * this.support(this.phase)
    const bobDrop = (this.walkForm ? this.softening : sidestepKneeSoftening) * this.traits.legLength + this.bob * (1 + Math.cos(2 * Math.PI * (this.phase - 0.1))) / 2
      + (this.walkForm && this.walk ? this.loadingDip(length / this.referenceLength) : 0)
    const foreAft = this.walkForm ? speedRipple * length / (2 * Math.PI) * Math.sin(2 * Math.PI * (this.phase - rippleLag)) : 0
    const required = Math.min(bobDrop + (this.walkForm ? floorMarginShare : sidestepFloorMargin) * this.traits.legLength, this.requiredDrop(rootX + (this.walk?.direction ?? 1) * foreAft, lateral, length / this.referenceLength))
    return { length, lateral, foreAft, drop: Math.max(bobDrop, required) }
  }

  /**
   * Smallest drop that keeps every planted foot within r_plan of its hip. The bob covers
   * centred stances and landings; this floor covers stances that are off-centre at
   * mid-stance, such as while stopping. A lifted foot's requirement is frozen at lift-off
   * and fades out early in the swing, so the floor never jumps.
   */
  private requiredDrop(rootX: number, lateral: number, strideScale: number) {
    const turnStep = this.turn && this.turn.elapsed > 0 ? this.turn.steps[this.turn.index] : undefined
    const fade = (progress: number) => 1 - cycloid(Math.min(1, progress / liftFadeShare))
    let required = 0
    for (const side of sides) {
      if (this.swing?.foot === side)
        required = Math.max(required, fade(this.swing.progress) * this.swing.liftDrop)
      else if (this.turn && turnStep?.foot === side)
        required = Math.max(required, fade(this.turn.elapsed / turnStep.duration) * this.turn.liftDrop)
      else
        required = Math.max(required, this.anchorDrop(side, this.ankle(side, strideScale), rootX, lateral))
    }
    return required
  }

  private anchorDrop(side: Foot, anchor: Vec3, rootX: number, lateral: number) {
    const hip = (this.walkForm ? this.hips : this.hipsAboveAnkles)[side]
    const cos = Math.cos(this.yaw)
    const sin = Math.sin(this.yaw)
    const hipX = rootX + cos * hip.x + sin * hip.z - cos * lateral
    const hipZ = this.z - sin * hip.x + cos * hip.z + sin * lateral
    const horizontal = (hipX - anchor.x) ** 2 + (hipZ - anchor.z) ** 2
    const reach = (this.walkForm ? planReach : sidestepPlanReach) * this.traits.legLength
    return hip.y - anchor.y - Math.sqrt(Math.max(0, reach ** 2 - horizontal))
  }

  /** True for a goal far enough from the root to walk to. */
  private worthWalking(goal: number | null): goal is number {
    return goal !== null && Number.isFinite(goal) && Math.abs(goal - this.x) > minWalkShare * this.traits.legLength
  }

  private depart(input: LocomotionInput) {
    const goal = input.goalX
    if (goal === null || !Number.isFinite(goal))
      return
    const walkTo = this.worthWalking(goal)
    const direction = goal > this.x ? 1 : -1
    let sidestep = false
    if (input.step === 'sidestep') {
      if (this.stepRequest?.goalX !== goal)
        this.stepRequest = { goalX: goal, sidestep: Math.abs(goal - this.x) <= SIDESTEP_MAX_LEGS * this.traits.legLength }
      sidestep = this.stepRequest.sidestep
    }
    let facing = walkTo ? direction * Math.PI / 2 : finite(input.arriveFacing)
    if (sidestep)
      facing = this.yaw
    const turns = Math.abs(wrap(facing - this.yaw)) > turnTolerance
    if (!walkTo && !turns)
      return
    // Leaving idle: the foot-contact planner owned the feet until now.
    if (this.mode === 'idle') {
      this.feet = { left: copyAnchor(input.plantedFeet.left), right: copyAnchor(input.plantedFeet.right) }
      this.spans = { left: 0, right: 0 }
      this.phase = 0.1
    }
    const delta = wrap(facing - this.yaw)
    this.setWalkForm(walkTo && !sidestep)
    // A walk of less than one step has no room to turn out and back while moving.
    if (turns && (!walkTo || Math.abs(goal - this.x) < this.referenceLength))
      this.startTurn(facing, false)
    // Further than a quarter turn from the heading: turn the excess on the spot, and let the walk take the rest over.
    else if (turns && Math.abs(delta) > mergedTurnMax)
      this.startTurn(facing - Math.sign(delta) * mergedTurn, true)
    else
      this.startWalk(direction, facing, input.idleSupport, sidestep ? { goalX: goal, rate: this.stepRate(urgencySpeedShare(input.urgency) * (sidestepPairShare * this.traits.legLength * sidestepReferenceRate)) } : undefined)
  }

  private startTurn(facing: number, flows: boolean) {
    const delta = wrap(facing - this.yaw)
    const count = Math.max(2, Math.ceil(Math.abs(delta) / turnStepYaw - epsilon))
    const facings = Array.from({ length: count + 1 }, (_, index) => this.yaw + delta * index / count)
    const footYaws = { left: this.feet.left.yaw, right: this.feet.right.yaw }
    let foot: Foot = delta > 0 ? 'left' : 'right'
    const commands: TurnStep[] = []
    for (let index = 1; index <= count; index++) {
      // Each foot lands at the facing one step ahead, so 90 degrees takes two steps
      // and both feet finish aligned with the final facing.
      const landingYaw = this.yaw + delta * Math.min(index + 1, count) / count
      const yawDelta = wrap(landingYaw - footYaws[foot])
      commands.push({ foot, yawDelta, duration: turnStepDuration })
      footYaws[foot] += yawDelta
      foot = opposite(foot)
    }
    const pivot = { x: this.x, y: 0, z: this.z }
    this.turn = {
      flows,
      steps: planFootSteps(commands, this.feet, pivot, turnSwingShare * this.traits.legLength),
      facings,
      index: 0,
      elapsed: 0,
      liftDrop: 0,
    }
  }

  private advanceTurn(now: number, dt: number, events: GaitEvent[]): LocomotionFrame['mode'] {
    const turn = this.turn
    const step = turn?.steps[turn.index]
    const from = turn?.facings[turn.index]
    const to = turn?.facings[turn.index + 1]
    if (!turn || !step || from === undefined || to === undefined) {
      this.turn = null
      return 'turning'
    }
    if (turn.elapsed === 0) {
      // Turning stands centred (support 0), so the pelvis has no lateral offset.
      turn.liftDrop = this.anchorDrop(step.foot, this.feet[step.foot].position, this.x, 0)
      events.push({ kind: 'liftOff', foot: step.foot, time: now })
    }
    turn.elapsed = Math.min(step.duration, turn.elapsed + dt)
    this.yaw = from + (to - from) * turnProgress(turn.elapsed / step.duration, turn.index, turn.steps.length + Number(turn.flows))
    if (turn.elapsed >= step.duration - epsilon) {
      this.feet[step.foot] = step.sample(step.duration)
      this.spans[step.foot] = 0
      events.push({ kind: 'heelStrike', foot: step.foot, time: now })
      this.yaw = to
      turn.index++
      turn.elapsed = 0
      if (turn.index === turn.steps.length) {
        this.lastTurnFoot = step.foot
        this.turn = null
      }
    }
    return 'turning'
  }

  private startWalk(direction: 1 | -1, heading: number, idleSupport: number, sidestep?: { goalX: number, rate: number }) {
    const turn = sidestep ? 0 : wrap(heading - this.yaw)
    let firstFoot: Foot
    if (sidestep)
      firstFoot = direction * (this.feet.left.position.x - this.feet.right.position.x) >= 0 ? 'left' : 'right'
    else if (this.lastTurnFoot)
      firstFoot = opposite(this.lastTurnFoot)
    // A start that turns opens with the foot on the side it turns to.
    else if (Math.abs(turn) > turnStepYaw / 2)
      firstFoot = turn > 0 ? 'left' : 'right'
    // Weight on the right (s > 0.2) leaves the left foot unloaded and free to swing.
    else if (idleSupport > 0.2)
      firstFoot = 'left'
    else if (idleSupport < -0.2)
      firstFoot = 'right'
    else
      firstFoot = this.random() < 0.5 ? 'left' : 'right'
    this.lastTurnFoot = null
    this.leadSign = footSign[firstFoot]
    this.phase = 0.1
    // As if the walk had been running: the first swing foot lifts at phase delta, the other foot a step later.
    this.strikes = { [firstFoot]: doubleSupport - (1 + doubleSupport), [opposite(firstFoot)]: 0 } as Record<Foot, number>
    this.speed = 0
    this.walk = { preparation: 0, direction, heading, firstFoot, step: 0, starting: true, startRoll: 0.5, arrived: false, settle: null, arrivalFacing: null, stopping: false }
    // From standing the turn is quicker and the gaze leads it; a start that carries an on-spot turn's yaw rate keeps
    // the walking turn's pace.
    const standing = Math.abs(this.yawRate) <= turnTolerance
    // From standing the turn's clock starts with the preparation (`prepare`), so the loaded hip turns as the weight arrives.
    const stance = { share: standingHipShare, endPhase: 1, secondFrom: standingSecondFrom }
    this.yawPlan = Math.abs(turn) > turnTolerance
      ? standing
        ? { from: this.yaw, to: this.yaw + turn, fromPhase: doubleSupport - minRate * preparationDuration, toPhase: this.phase + standingTurnSteps, startRate: this.yawRate / minRate, lookLead: standingLookLead, lookShare: lookLeadShare, lookFromPhase: this.phase, stance }
        : { from: this.yaw, to: this.yaw + turn, fromPhase: this.phase, toPhase: this.phase + departTurnSteps, startRate: this.yawRate / minRate, lookLead: 0, lookShare: lookLeadShare }
      : null
    if (sidestep) {
      this.walk.sidestep = {
        ...sidestep,
        fromX: this.x,
        toX: this.x + direction * Math.min(Math.abs(sidestep.goalX - this.x), sidestepPairShare * this.traits.legLength),
        phase: 0,
      }
    }
  }

  /** The facing at gait phase `phase`: along the walk's turn plan, or the facing now. */
  private facingAt(phase: number): number {
    const plan = this.yawPlan
    if (!plan)
      return this.yaw
    const span = plan.toPhase - plan.fromPhase
    const u = clamp((phase - plan.fromPhase) / span, 0, 1)
    const stance = plan.stance
    const share = stance
      ? stance.share * minJerk(clamp((phase - plan.fromPhase) / (stance.endPhase - plan.fromPhase), 0, 1))
      + (1 - stance.share) * minJerk(clamp((phase - stance.secondFrom) / (plan.toPhase - stance.secondFrom), 0, 1))
      : plan.reversal ? cruise(u, reverseRampUp, reverseRampDown) : minJerk(u)
    // Minimum jerk between the facings, plus the rate the turn starts at, which dies out as (1 - u)^2.
    return plan.from + (plan.to - plan.from) * share + plan.startRate * span * u * (1 - u) ** 2
  }

  private followYawPlan(phase = this.phase) {
    const plan = this.yawPlan
    if (!plan)
      return
    this.yaw = this.facingAt(phase)
    if (phase >= plan.toPhase) {
      this.yaw = plan.to
      this.yawPlan = null
    }
  }

  /**
   * A turn plan from the facing now to `facing`, or none when she already faces it: over `steps` steps for a quarter
   * turn or less, and as many more as a wider turn is wider.
   */
  private planYaw(facing: number, steps: number, rate: number): YawPlan | null {
    const turn = wrap(facing - this.yaw)
    const span = steps * Math.max(1, Math.abs(turn) / mergedTurn)
    return Math.abs(turn) > turnTolerance || Math.abs(this.yawRate) > turnTolerance
      ? { from: this.yaw, to: this.yaw + turn, fromPhase: this.phase, toPhase: this.phase + span, startRate: this.yawRate / rate, lookLead: 0, lookShare: lookLeadShare }
      : null
  }

  /**
   * A reversal's turn to `facing`, the heading behind her, through the viewer and unwrapped, over `reverseTurnSteps`;
   * its gaze runs `reverseLookLead` steps ahead. A foot planted before the goal came, or a swing too far on to plan
   * again (`replanUntil`), cannot be set for the turn, so the turn waits, if it must, until it would reach
   * `plantedYawLimit` off that foot no sooner than the foot lifts.
   */
  private planReverse(facing: number, rate: number, dt: number): YawPlan {
    const walk = this.walk
    const turn = facing - this.yaw
    let fromPhase = this.phase
    if (walk && Math.abs(turn) > 0) {
      const swinging = walk.step % 2 === 0 ? walk.firstFoot : opposite(walk.firstFoot)
      // Each foot's yaw and the phase it lifts at: this step's foot lifts at its double support's end, or, in a swing
      // past planning, lands and lifts a stance later; the other foot lifts a step after this one.
      const feet: (readonly [number, number])[] = [[this.feet[opposite(swinging)].yaw, walk.step + 1 + doubleSupport]]
      if (!this.swing)
        feet.push([this.feet[swinging].yaw, walk.step + doubleSupport])
      // The swing's progress when the feet next advance, after this tick's phase step.
      else if ((this.phase + rate * dt - walk.step - doubleSupport) / (1 - doubleSupport) >= replanUntil)
        feet.push([this.swing.land.yaw, walk.step + 2 + doubleSupport])
      for (const [yaw, lift] of feet) {
        if (lift <= this.phase)
          continue
        // The share of the turn she may make before this foot lifts, and the progress at which the turn reaches it.
        const share = (plantedYawLimit - wrap(this.yaw - yaw) * Math.sign(turn)) / Math.abs(turn)
        if (share >= 1)
          continue
        let low = 0
        let high = 1
        for (let i = 0; i < 30; i++) {
          const middle = (low + high) / 2
          if (cruise(middle, reverseRampUp, reverseRampDown) < share)
            low = middle
          else
            high = middle
        }
        fromPhase = Math.max(fromPhase, lift - low * reverseTurnSteps)
      }
    }
    return { from: this.yaw, to: facing, fromPhase, toPhase: fromPhase + reverseTurnSteps, startRate: this.yawRate / rate, lookLead: reverseLookLead, lookShare: reverseLookShare, reversal: true }
  }

  /** A start's share of the acceleration limit at `speed` toward `command`: the speed leaves rest gently. */
  private startShare(speed: number, command: number) {
    return command > 0 ? clamp(startAccelerationFloor + (1 - startAccelerationFloor) * speed / (startAccelerationFullAt * command), startAccelerationFloor, 1) : 1
  }

  private advanceWalk(input: LocomotionInput, dt: number, events: GaitEvent[]): LocomotionFrame['mode'] {
    const walk = this.walk
    if (!walk)
      return 'idle'
    if (walk.preparation < preparationDuration) {
      this.prepare(walk, dt)
      return 'starting'
    }
    if (walk.sidestep)
      return this.advanceSidestep(walk, walk.sidestep, input, dt, events)
    // A faster walk lengthens the step, so the limit caps the speed as well: past the top cadence for the style, and by a
    // few percent where a stride's variation would lengthen a step at the limit. Only the style's own cap is reported.
    const asked = urgencySpeedShare(input.urgency) * this.referenceSpeed * this.speedFactor * this.style.speed
    const command = Math.min(asked, this.fastestSpeed())
    if (asked / this.speedFactor > this.stepLimit * this.referenceLength * maxRate)
      this.limited = this.limited === strideLimited ? strideSpeedLimited : speedLimited
    const goal = input.goalX !== null && Number.isFinite(input.goalX) ? input.goalX : null
    const ahead = goal === null ? 0 : (goal - this.x) * walk.direction
    // Without a goal ahead, brake as hard as allowed and stop wherever that lands.
    const braking = goal === null || ahead <= 0
    const profiled = !braking && this.stoppingSpeed(ahead, dt) < command
    // The arrival turn starts `arriveLeadSteps` of cruise before the braking would.
    const turnLead = arriveLeadSteps * command / this.stepRate(command)
    const nearing = !braking && this.stoppingSpeed(Math.max(0, ahead - turnLead), dt) < command
    const target = braking || walk.settle ? 0 : Math.min(command, this.stoppingSpeed(ahead, dt))
    const change = this.maxAcceleration * dt
    const speed = Math.max(0, clamp(target, this.speed - change, this.speed + change * this.startShare(this.speed, command)))

    // Keep the departure turn through the first step. The braking cap can be below cruise speed while still accelerating.
    const wasArriving = walk.arrivalFacing !== null
    const arriving = braking || (nearing && (wasArriving || ((!this.yawPlan || walk.step > 0) && (!profiled || target <= this.speed + epsilon))))
    const wasStopping = walk.stopping
    walk.stopping = arriving && (walk.stopping || braking || (profiled && target <= this.speed + epsilon))
    // A goal behind her, worth a walk, turns her toward the opposite heading through the viewer (`reverseTurnSteps`).
    const reversing = goal !== null && ahead < -minWalkShare * this.traits.legLength
    const facing = reversing ? walk.heading - walk.direction * Math.PI : arriving ? finite(input.arriveFacing) : walk.heading
    const slowed = walk.stopping ? (1 - Math.min(1, speed / command)) ** 2 : 0
    const rate = this.stepRate(speed) + (closingRate - minRate) * slowed
    // A goal moved behind her during the lead brakes at once, so the turn is planned again over the braking's steps.
    if (!walk.settle && (arriving !== wasArriving || (braking && !wasStopping) || (walk.arrivalFacing !== null && Math.abs(wrap(facing - walk.arrivalFacing)) > turnTolerance))) {
      this.yawPlan = reversing
        ? this.planReverse(facing, rate, dt)
        : this.planYaw(facing, arriving ? braking ? brakeTurnSteps : arriveTurnSteps : departTurnSteps, rate)
      walk.arrivalFacing = arriving ? facing : null
    }
    if (walk.settle) {
      walk.settle.elapsed += dt
      this.phase = Math.min(walk.settle.phase, this.phase + rate * dt)
    }
    else {
      this.phase += rate * dt
      this.vary(rate * dt / 2)
    }
    this.followYawPlan()

    let advance = braking ? speed * dt : Math.min(speed * dt, ahead)
    this.posture = this.pelvis(speed, this.x + walk.direction * advance)
    // The knees give as the weight arrives on the final plant, and recover over the settle.
    if (walk.settle)
      this.posture.drop += stopDipShare * this.traits.legLength * Math.sin(Math.PI * Math.min(1, walk.settle.elapsed / settleDuration))
    advance = this.leash(advance, walk.direction, this.posture)
    this.x += walk.direction * advance
    if (goal !== null && !braking && ahead - advance <= epsilon)
      this.x = goal
    this.speed = advance / dt
    walk.arrived = this.speed === 0 && target === 0

    this.advanceFeet(walk, goal, braking, command, dt, input.now, events)

    // Stopped with both feet down and the goal still behind: the same walk sets off the other way, its turn under way.
    if (reversing && walk.arrived && !this.swing && !walk.settle) {
      this.reverse(walk)
      return 'starting'
    }
    if (walk.arrived && !this.swing && !walk.settle) {
      // Both feet stand beside the root and face as she does; until then they take closing steps.
      const closed = !this.yawPlan && sides.every(side =>
        Math.abs(this.foreAft(this.feet[side].position)) < closingShare * this.traits.legLength
        && Math.abs(wrap(this.feet[side].yaw - this.yaw)) <= 2 * turnTolerance)
      if (closed)
        walk.settle = { phase: Math.max(this.phase, walk.step + 0.1), elapsed: 0 }
    }
    if (walk.settle && walk.settle.elapsed >= settleDuration - epsilon) {
      this.walk = null
      return 'stopping'
    }
    if (walk.settle || walk.arrived || walk.stopping)
      return 'stopping'
    if (walk.starting && this.speed < command - epsilon)
      return 'starting'
    walk.starting = false
    return 'walking'
  }

  /**
   * Turns a stopped walk round: it heads the other way from the next step, on the turn its braking began (the yaw plan
   * already names the new heading), and accelerates as a start does. The phase, the feet and the gait's weight carry on,
   * so the stop step is the first step's preparation.
   */
  private reverse(walk: Walk) {
    walk.direction = walk.direction === 1 ? -1 : 1
    walk.heading = walk.direction * Math.PI / 2
    walk.starting = true
    walk.startRoll = 0
    walk.stopping = false
    walk.arrived = false
    walk.arrivalFacing = null
  }

  /**
   * The same swing, landing and support cycle as a walk, with fixed lateral landing targets.
   * Root travel eases over a complete pair: the leading foot opens the stance and the trailing foot closes it.
   * The reach floor follows the planted feet directly because lateral travel does not use the walking fore-aft bob.
   */
  private advanceSidestep(walk: Walk, pair: NonNullable<Walk['sidestep']>, input: LocomotionInput, dt: number, events: GaitEvent[]): LocomotionFrame['mode'] {
    if (walk.settle) {
      walk.settle.elapsed += dt
      this.phase = Math.min(walk.settle.phase, this.phase + minRate * dt)
      this.speed = 0
      if (walk.settle.elapsed >= settleDuration - epsilon)
        this.walk = null
      return 'stopping'
    }
    // Keep the departure cadence when the director clears the goal and the host returns to its default pace.
    this.phase = Math.min(pair.phase + 2, this.phase + pair.rate * dt)
    const progress = clamp((this.phase - pair.phase - doubleSupport) / (2 - doubleSupport), 0, 1)
    const nextX = pair.fromX + (pair.toX - pair.fromX) * minJerk(progress)
    this.advanceFeet(walk, pair.toX, false, 0, dt, input.now, events)
    this.posture = this.pelvis(0, nextX)
    this.posture.drop = Math.max(this.posture.drop, this.requiredDrop(nextX, this.posture.lateral, 0))
    const advance = this.leash(Math.abs(nextX - this.x), walk.direction, this.posture)
    this.x += walk.direction * advance
    this.speed = advance / dt
    if (this.phase >= pair.phase + 2) {
      // Both swings have landed before either a new pair or the settle starts.
      const goal = input.goalX
      const ahead = input.step === 'sidestep' && goal === pair.goalX ? (goal - this.x) * walk.direction : 0
      if (ahead > epsilon) {
        pair.fromX = this.x
        pair.toX = this.x + walk.direction * Math.min(ahead, sidestepPairShare * this.traits.legLength)
        pair.phase += 2
      }
      else {
        walk.settle = { phase: this.phase + 0.1, elapsed: 0 }
        this.speed = 0
      }
    }
    return 'sidestepping'
  }

  /**
   * Architecture 5.4: before the first step the root holds still for 0.22 s while the weight moves onto the stance foot,
   * the pelvis dips and the trunk draws back. The weight moves by the walk's own support law: the phase runs from 0.1 to
   * the lift-off at delta, as a^k with k chosen so it reaches the slowest step rate just as the first foot lifts.
   */
  private prepare(walk: Walk, dt: number) {
    walk.preparation = Math.min(preparationDuration, walk.preparation + dt)
    const a = walk.preparation / preparationDuration
    const power = minRate * preparationDuration / (doubleSupport - 0.1) - 1
    this.phase = 0.1 + (doubleSupport - 0.1) * a ** power
    // The yaw clock joins the preceding turn and the first walking tick at the minimum step rate.
    const yawPhase = 0.1 + (doubleSupport - 0.1) * smoothstep(a) + minRate * preparationDuration * a * (1 - a) * (1 - 2 * a)
    // A start from standing runs its turn's clock through the preparation at the slowest step rate, so it reaches the
    // walk's phase as the first foot lifts.
    const plan = this.yawPlan
    this.followYawPlan(plan?.stance ? plan.fromPhase + (doubleSupport - plan.fromPhase) * a : plan?.startRate ? yawPhase : this.phase)
    this.speed = 0
    this.leanBias = drawBackLean * Math.sin(Math.PI * a)
    this.posture = this.pelvis(0, this.x)
    this.posture.drop += preparationDropShare * this.traits.legLength * Math.sin(Math.PI * a)
  }

  /** Shortens root travel so no planted ankle ends farther than r_hard from its hip. */
  private leash(advance: number, direction: 1 | -1, pelvis: { length: number, lateral: number, drop: number, foreAft: number }) {
    const hardLimit = (this.walkForm ? hardReach : sidestepHardReach) * this.traits.legLength
    let limit = advance
    for (const side of sides) {
      if (this.swing?.foot === side)
        continue
      const joint = (this.walkForm ? this.hips : this.hipsAboveAnkles)[side]
      const hip = this.toWorld(joint.x, joint.z)
      const anchor = this.ankle(side, pelvis.length / this.referenceLength)
      const dx = hip.x - Math.cos(this.yaw) * pelvis.lateral + direction * pelvis.foreAft - anchor.x
      const dy = joint.y - pelvis.drop - anchor.y
      const dz = hip.z + Math.sin(this.yaw) * pelvis.lateral - anchor.z
      // Solve |hip + s * direction * x - anchor| <= r_hard for the largest advance s.
      const b = dx * direction
      const c = dx ** 2 + dy ** 2 + dz ** 2 - hardLimit ** 2
      const discriminant = b * b - c
      limit = Math.min(limit, discriminant < 0 ? 0 : Math.max(0, -b + Math.sqrt(discriminant)))
    }
    if (limit < advance - 1e-12)
      this.clamps++
    return limit
  }

  private advanceFeet(walk: Walk, goal: number | null, braking: boolean, command: number, dt: number, now: number, events: GaitEvent[]) {
    const index = Math.floor(this.phase)
    if (index > walk.step) {
      if (this.swing) {
        this.feet[this.swing.foot] = copyAnchor(this.swing.land)
        this.spans[this.swing.foot] = this.swing.reach
        this.strikes[this.swing.foot] = index
        events.push({ kind: 'heelStrike', foot: this.swing.foot, time: now })
        this.swing = null
      }
      walk.step = index
    }
    const t = this.phase - walk.step
    if (walk.settle || t < doubleSupport)
      return
    const foot = walk.step % 2 === 0 ? walk.firstFoot : opposite(walk.firstFoot)
    const progress = (t - doubleSupport) / (1 - doubleSupport)
    const rate = this.stepRate(this.speed)
    if (!this.swing) {
      // The swing starts where the toe-off roll left the ankle, so the ankle never moves back to its planning anchor.
      const strideScale = this.speed / rate / this.referenceLength
      const liftPitch = this.roll(foot, strideScale).pitch
      const ankle = this.ankle(foot, strideScale)
      const liftDrop = this.anchorDrop(foot, ankle, this.x, this.posture?.lateral ?? 0)
      const lift: FootAnchor = { position: { x: ankle.x, y: this.traits.footBaselineY, z: ankle.z }, yaw: this.feet[foot].yaw }
      this.swing = { foot, lift, bobFrom: this.bob, liftDrop, liftUp: ankle.y - this.traits.footBaselineY, liftPitch, progress, ...this.planLanding(walk, foot, lift, t, rate, goal, braking, command, dt) }
      events.push({ kind: 'liftOff', foot, time: now })
    }
    else if (progress < replanUntil) {
      Object.assign(this.swing, this.planLanding(walk, foot, this.swing.lift, t, rate, goal, braking, command, dt))
    }
    this.swing.progress = progress
    // The drop must cover every foot in contact: the stance foot until it lifts and the landing foot.
    const span = Math.max(stanceShare * this.speed / rate, this.spans[opposite(foot)], this.swing.reach)
    this.bob = this.swing.bobFrom + (this.bobAmplitude(span, this.speed / rate / this.referenceLength) - this.swing.bobFrom) * cycloid(progress)
  }

  /**
   * X_land = R(t_land) + (D / 2) * d + sign * (w / 2) * n. R(t_land) extrapolates the current
   * speed, capped at the goal or the braking distance. D is the root travel predicted over the coming stance (2 beta
   * steps), so the foot lifts as far behind the hip as it landed ahead. At constant speed
   * D / 2 = beta * l; D reaches 0 once the root stops first, which lands the foot beside it.
   */
  private planLanding(walk: Walk, foot: Foot, lift: FootAnchor, t: number, rate: number, goal: number | null, braking: boolean, command: number, dt: number) {
    if (walk.sidestep) {
      const bind = this.traits.bindAnkles[foot]
      const offset = this.toWorld(bind.x, bind.z)
      return {
        land: {
          position: { x: offset.x + walk.sidestep.toX - this.x, y: this.traits.footBaselineY, z: offset.z },
          yaw: walk.heading,
        },
        reach: Math.abs(walk.sidestep.toX - walk.sidestep.fromX) / 2,
        height: swingHeightFloorShare * this.traits.legLength,
      }
    }
    const untilLanding = (1 - t) / rate
    const ahead = braking || goal === null ? null : Math.max(0, (goal - this.x) * walk.direction)
    const travel = this.speed * untilLanding
    const room = ahead ?? this.speed ** 2 / (2 * this.maxAcceleration)
    const rootX = this.x + walk.direction * Math.min(travel, room)
    const reach = this.predictStanceTravel(ahead, command, untilLanding, dt) / 2
    const centre = this.stanceCentre(reach)
    // The foot lands turned toward where the body faces a step later, within `footLead` of her facing at the landing,
    // on its own side of the ankle line in that frame. A full stride narrows the stance; beside a stopped root the foot
    // stands at its bind width.
    const landing = walk.step + 1
    const facing = this.facingAt(landing)
    const led = facing + clamp(wrap(this.facingAt(landing + 1) - facing), -footLead, footLead)
    // A planted foot stays within `plantedYawLimit` of her facing from its strike to its lift-off; a turn too fast for
    // that, as a reversal is, sets the foot at the middle of the facings its stance sweeps.
    const lifting = this.facingAt(landing + 1 + doubleSupport)
    const low = Math.max(facing, lifting) - plantedYawLimit
    const high = Math.min(facing, lifting) + plantedYawLimit
    const yaw = low <= high ? clamp(led, low, high) : (facing + lifting) / 2
    const stride = clamp(reach / (stanceShare * this.referenceLength / 2), 0, 1)
    const side = -footSign[foot] * (this.halfBindWidth + (this.halfStepWidth - this.halfBindWidth) * stride)
    const land: FootAnchor = {
      position: {
        x: rootX + Math.cos(yaw) * side + Math.sin(yaw) * centre + Math.sin(walk.heading) * reach,
        y: this.traits.footBaselineY,
        z: this.z - Math.sin(yaw) * side + Math.cos(yaw) * centre + Math.cos(walk.heading) * reach,
      },
      yaw,
    }
    // A reversal's first step past the viewer leads off the other way: it lands at least `outgoingLead` ahead of the
    // planted foot along the new heading, so the weight visibly moves onto it.
    const plan = this.yawPlan
    if (plan?.reversal && Math.cos(plan.to - walk.heading) < 0 && (facing - (plan.from + plan.to) / 2) * Math.sign(plan.to - plan.from) > 0) {
      const other = this.feet[opposite(foot)].position
      const ahead = (land.position.x - other.x) * Math.sin(plan.to) + (land.position.z - other.z) * Math.cos(plan.to)
      const short = Math.max(0, outgoingLead * this.traits.legLength - ahead)
      land.position.x += Math.sin(plan.to) * short
      land.position.z += Math.cos(plan.to) * short
    }
    // H_sw = max(0.04 L, 0.08 L sqrt(l_i / l_ref)), with l_i half of this swing's travel.
    const stepLength = Math.hypot(land.position.x - lift.position.x, land.position.z - lift.position.z) / 2
    const legLength = this.traits.legLength
    const height = Math.max(swingHeightFloorShare * legLength, swingHeightShare * this.style.lift * legLength * Math.sqrt(stepLength / this.referenceLength))
    return { land, reach, height }
  }

  private sampleSwing(swing: Swing): FootAnchor {
    const turn = cycloid(swing.progress)
    // The style's push hands the toe-off on faster or slower: a springy step leaves the ground quickly, a tired one drags.
    const blend = this.walkForm ? swingTravel(swing.progress, swingStartSpeed * this.style.push) : turn
    const height = this.walkForm
      ? swing.liftUp * (1 - minJerk(Math.min(1, swing.progress / 0.5))) + swing.height * swingLift(swing.progress)
      : swing.height * Math.sin(Math.PI * swing.progress)
    return {
      position: {
        x: swing.lift.position.x + (swing.land.position.x - swing.lift.position.x) * blend,
        y: this.traits.footBaselineY + height,
        z: swing.lift.position.z + (swing.land.position.z - swing.lift.position.z) * blend,
      },
      // A walking foot turns to its landing facing by `swingTurnBy` of the swing, as the hip opens it, and comes in
      // already pointing where it lands; turned over the whole swing, a start's first foot still faced the viewer at
      // mid-swing and swept out sideways (independent visual audit, 2026-11-25).
      yaw: swing.lift.yaw + wrap(swing.land.yaw - swing.lift.yaw) * (this.walkForm ? cycloid(Math.min(1, swing.progress / swingTurnBy)) : turn),
    }
  }

  /** Stops at once when disabled: a lifted foot is put down where it is. */
  private halt() {
    if (this.swing) {
      const sample = this.sampleSwing(this.swing)
      this.feet[this.swing.foot] = { position: { ...sample.position, y: this.traits.footBaselineY }, yaw: sample.yaw }
    }
    const step = this.turn?.steps[this.turn.index]
    if (this.turn && step && this.turn.elapsed > 0) {
      const sample = step.sample(this.turn.elapsed)
      this.feet[step.foot] = { position: { ...sample.position, y: this.traits.footBaselineY }, yaw: sample.yaw }
    }
    this.swing = null
    this.walk = null
    this.turn = null
    this.yawPlan = null
    this.speed = 0
  }

  /**
   * Architecture 5.5's look-ahead during a turn: it leaves the facing the turn starts from at rest and reaches the final
   * facing as the last step starts, as a minimum-jerk move over every step but the last. The eyes and head so lead the
   * body by one step, as each foot lands at the facing one step ahead (`startTurn`): a quarter turn is led within its
   * first step, and a turn-around sweeps the gaze over three steps instead of one. A goal that stepped to the whole turn
   * at once made the gaze answer with a head jolt.
   */
  private turnLookAhead(turn: Turn): number {
    const from = turn.facings[0] ?? this.yaw
    const to = turn.facings.at(-1) ?? this.yaw
    let span = 0
    let elapsed = turn.elapsed
    turn.steps.forEach((step, index) => {
      if (index < turn.steps.length - 1)
        span += step.duration
      if (index < turn.index)
        elapsed += step.duration
    })
    const progress = span > 0 ? minJerk(Math.min(1, elapsed / span)) : 1
    return from + (to - from) * progress
  }

  /**
   * The look-ahead of a turn made while walking: the gaze sweeps to the final facing over the plan's `lookShare` of it,
   * `lookLead` steps early, and at most `lookLeadMax` ahead of her facing.
   */
  private planLookAhead(plan: YawPlan): number {
    // A start's lead ramps in over the preparation, so the gaze leaves her facing at rest.
    const ready = this.walk ? smoothstep(this.walk.preparation / preparationDuration) : 1
    const from = plan.lookFromPhase ?? plan.fromPhase
    const u = clamp((this.phase + plan.lookLead * ready - from) / (plan.toPhase - from), 0, 1)
    const look = plan.from + (plan.to - plan.from) * minJerk(Math.min(1, u / plan.lookShare))
    // The gaze never trails the body's turn: a start's hips leave with its first weight shift, as its gaze does.
    const lead = (look - this.yaw) * Math.sign(plan.to - plan.from)
    return this.yaw + Math.sign(plan.to - plan.from) * clamp(lead, 0, lookLeadMax)
  }

  private footFrame(side: Foot, strideScale: number): LocomotionFoot {
    if (this.swing?.foot === side)
      return { target: this.sampleSwing(this.swing), planted: false, swing: this.swing.progress, roll: this.roll(side, strideScale) }
    const step = this.turn?.steps[this.turn.index]
    if (this.turn && step?.foot === side && this.turn.elapsed > 0)
      return { target: step.sample(this.turn.elapsed), planted: false, swing: this.turn.elapsed / step.duration, roll: { pitch: 0, ankleOffset: [0, 0], pivot: 'air' } }
    return { target: copyAnchor(this.feet[side]), planted: true, swing: null, roll: this.roll(side, strideScale) }
  }

  /**
   * Architecture 5.1. Stance progress g runs from a heel strike (0) to lift-off (1, after 1 + delta steps): the heel pivot
   * lowers the toes to flat by g = 0.12, the sole holds, and from g = 0.62 the ball pivot lifts the heel. The swing releases
   * the toe-off pitch by w = 0.45 and raises the toes from w = 0.55 for the next strike; the ankle offset leaves the ground
   * with the toe-off and arrives with the strike. Both pitches scale with min(1, strideScale), so a walk starts and stops
   * flat-footed. Turn steps and an idle gait keep the feet flat.
   */
  private roll(side: Foot, strideScale: number): FootRoll {
    const foot = this.traits.foot?.[side]
    const swing = this.swing?.foot === side ? this.swing : null
    if (!foot || !this.walk || this.walk.sidestep)
      return { pitch: 0, ankleOffset: [0, 0], pivot: swing ? 'air' : 'flat' }
    // A foot rolls by the reach it landed with and by how far it stands behind the ankle line: one planted at speed
    // still rolls off after she slows, and one beside a stopped root stands flat. A walk's first step has neither and
    // rolls at 50 % at least. The foot stands behind along the path: while she turns, her facing would shorten it.
    const behind = swing ? 0 : -this.foreAft(this.feet[side].position, this.walk.heading)
    // Both measure against the style's own full stride: the cadence law's step grows as the root of the speed.
    const own = this.style.stride * Math.sqrt(this.style.speed)
    // The settle hands the feet back flat: a planted foot's roll fades with the gait's weight.
    const scale = Math.min(1, Math.max(strideScale / own, (swing ? swing.reach : Math.min(this.spans[side], Math.max(0, behind))) / (stanceShare * this.referenceLength * own), this.walk.starting ? this.walk.startRoll : 0))
      * (this.walk.settle ? this.blend : 1)
    // The style's roll acts on full strides only: the short steps of a start or a stop keep the gait's own.
    const styled = 1 + (this.style.roll - 1) * clamp(2 * scale - 1, 0, 1)
    const strike = heelStrikePitch * styled * scale
    // A springy push rolls further onto the ball; a dragging one only leaves late, so the rig's step limit stands.
    const toeOff = toeOffPitch * styled * Math.max(1, this.style.push) * scale
    const heel = (pitch: number) => pivotOffset(foot.heelBack, foot.ankleHeight, pitch)
    const ball = (pitch: number) => pivotOffset(-foot.ballForward, foot.ankleHeight, pitch)
    if (swing) {
      const w = swing.progress
      // The foot hangs toe-down behind the knee until 45 % of the swing, then turns toe-up for the strike.
      const hang = swingHangPitch * scale
      const pitch = w < 0.45 ? swing.liftPitch - (hang + swing.liftPitch) * minJerk(Math.min(1, w / 0.3)) : -hang + (hang + strike) * minJerk((w - 0.45) / 0.55)
      // The swing's own path starts at the rolled ankle (`Swing.liftUp`), so only the strike's offset is added here.
      return { pitch, ankleOffset: scaleOffset(heel(Math.max(0, pitch)), minJerk((w - 0.7) / 0.3)), pivot: 'air' }
    }
    const g = clamp((this.phase - this.strikes[side]) / (1 + doubleSupport), 0, 1)
    if (g < footFlatAt) {
      const pitch = strike * (1 - minJerk(g / footFlatAt))
      return { pitch, ankleOffset: heel(pitch), pivot: 'heel' }
    }
    if (g < heelOffAt)
      return { pitch: 0, ankleOffset: [0, 0], pivot: 'flat' }
    // The heel rises ever faster until the foot leaves the ground, so the ankle is moving when the swing takes it over.
    const rise = (g - heelOffAt) / (1 - heelOffAt)
    const pitch = -toeOff * rise * rise * (2 - rise)
    return { pitch, ankleOffset: ball(pitch), pivot: 'ball' }
  }

  /** Advances one twist link toward `input` by `dt` (none on a zero tick) and returns its output. */
  private followTwist(link: TwistLink, input: number, delay: number, dt: number): number {
    if (dt > 0) {
      if (!link.coefficients || link.coefficients.dt !== dt || Math.abs(delay - link.delay) > 1e-3 * delay) {
        link.coefficients = secondOrderCoefficients({ f: 1 / (Math.PI * delay), zeta: 1, r: 0 }, dt)
        link.delay = delay
      }
      advanceSecondOrder(link.state, input, link.coefficients)
    }
    return link.state.y
  }

  private frame(mode: LocomotionFrame['mode'], events: readonly GaitEvent[], pelvis: ReturnType<Locomotion['pelvis']>, dt: number): LocomotionFrame {
    const strideScale = pelvis.length / this.referenceLength
    const support = this.support(this.phase)
    const twist = pelvisTwist * (this.walkForm ? this.style.pelvisTwist : 1)
    const lowerBodyYaw = twist * strideScale * this.lead(this.phase)
    // Architecture 5.2's lags, in steps at the current rate, as links of 3a's lag chain: each torso segment follows the
    // one below it, and the head counters the torso 80 ms late.
    const rate = this.stepRate(this.speed)
    const nodAt = (lag: number) => (this.walkForm ? trunkNod : 0) * Math.min(1, strideScale) * Math.cos(2 * Math.PI * (this.phase - lag))
    const nod = nodAt(nodLag)
    const chestNodNow = (this.walkForm ? chestNod : 0) * Math.min(1, strideScale) * Math.cos(2 * Math.PI * (this.phase - nodLag - chestNodLag))
    const [lowerLink, midLink, upperLink, headLink] = this.twistLinks
    const [[lowerShare, lowerLag], [midShare, midLag], [upperShare, upperLag]] = this.walkForm ? torsoTwist : sidestepTorsoTwist
    // The shoulder girdle reaches its counter-rotation before the pelvis reaches its twist, so the chain follows the twist
    // `torsoLead` steps ahead.
    const lowerYaw = this.followTwist(lowerLink, twist * strideScale * this.lead(this.phase + (this.walkForm ? torsoLead : 0)), lowerLag / rate, dt)
    const midYaw = this.followTwist(midLink, lowerYaw, (midLag - lowerLag) / rate, dt)
    const upperYaw = this.followTwist(upperLink, midYaw, (upperLag - midLag) / rate, dt)
    const counter = this.walkForm ? this.style.torsoTwist : 1
    const lower = lowerShare * counter * lowerYaw
    const mid = midShare * counter * midYaw
    const upper = upperShare * counter * upperYaw
    const head = this.followTwist(headLink, -(lower + mid + upper), headCounterLag, dt)
    // The trunk swings the arms (Pontzer et al. 2009): the shoulder girdle's twist drives the clavicle at once and each arm
    // at its own drifting lag; the performer's followers are the pendulum. The step-rate ratio keeps the size at
    // speed / v_ref, and architecture 5.3's shape is the target.
    if (mode !== 'idle')
      this.swingRate = rate
    this.recordGirdle(this.swingRate / (this.walkForm ? referenceRate : sidestepReferenceRate) * upperYaw / twist, dt)
    // A soft |x|, exact at 1: the swing's forward and back sizes differ, and a hard corner between them steps the arm's
    // speed.
    const soft = (value: number) => (Math.sqrt(value * value + 0.15 ** 2) - 0.15) / (Math.sqrt(1 + 0.15 ** 2) - 0.15)
    const arm = (side: Foot) => {
      const lag = Math.max(0, upperArmLag + 2 * this.armDrift[side] / this.swingRate)
      const girdle = footSign[side] * this.girdleAt(0)
      const swing = footSign[side] * this.girdleAt(lag)
      const late = footSign[side] * this.girdleAt(lag + (this.walkForm ? elbowLag : 0.2))
      const rolled = footSign[side] * this.girdleAt(lag + armRollLag)
      const share = side === 'right' ? rightSwingShare : 1
      if (!this.walkForm) {
        const forward = Math.max(0, -swing)
        const back = Math.max(0, swing)
        return {
          flexion: 2 * radians + share * (16 * radians * forward - 12 * radians * back),
          elbowFlex: 12 * radians + share * (16 * radians * Math.max(0, -late) - 6 * radians * Math.max(0, late)),
          abduct: -3 * radians * share * forward,
          clavProt: -3 * radians * share * girdle,
          twist: 0,
          pronation: 0,
          wristFlex: 0,
        }
      }
      // 1 at the front of the swing and 0 at the back.
      const forward = (soft(swing) - swing) / 2
      // Walking adults swing the upper arm about 19 degrees forward and 17 to 24 back, and bend the elbow 34 degrees
      // more at the front, straight at the back; 15.5 back here, since a wider back swing met the body colliders (Bandai Namco Research Motiondataset 2 walk clips, measured 2026-11-23).
      const size = share * this.style.armSwing
      const flexion = 2 * radians + size * radians * (-17.5 * swing + 2 * soft(swing))
      // The elbow's swing eases into the forearm's ceiling, bent as the back swing is (`easeBackSwing`): the same
      // tanh shape keeps the elbow's speed continuous.
      const knee = forearmRise.knee * radians
      const room = (forearmRise.ceiling - forearmRise.knee) * radians
      const rise = flexion + 2 * radians + this.style.elbowCarry + size * radians * 17 * (soft(late) - late)
      return {
        flexion,
        elbowFlex: (rise <= knee ? rise : knee + room * Math.tanh((rise - knee) / room)) - flexion,
        abduct: radians * (armOutBack + (armOutForward - armOutBack) * forward) + this.style.armOut,
        // A folded chest rounds the shoulders forward by half its angle.
        clavProt: -3 * radians * share * girdle + 0.5 * this.style.fold,
        // The arm turns inward as it swings forward and back out behind.
        twist: -size * radians * armRollTwist * rolled,
        pronation: -size * radians * armRollPronation * rolled,
        wristFlex: -this.style.wristCarry,
      }
    }
    return {
      mode,
      root: { position: { x: this.x, y: 0, z: this.z }, yaw: this.yaw },
      speed: this.speed,
      restX: this.walk?.sidestep?.toX ?? (this.walk ? this.x + this.walk.direction * brakingDistance(this.speed, this.traits.legLength) : this.x),
      phase: this.phase,
      feet: { left: this.footFrame('left', strideScale), right: this.footFrame('right', strideScale) },
      support,
      body: {
        pelvisLateral: pelvis.lateral,
        pelvisDrop: pelvis.drop,
        pelvisForeAft: pelvis.foreAft,
        lowerBodyRoll: this.walkForm ? -pelvisList * this.style.pelvisList * strideScale * this.support(this.phase + listLead) : -3 * radians * strideScale * support,
        lowerBodyYaw,
        upperBodyRoll: 1.5 * radians * strideScale * support + (this.walkForm ? this.turnRoll : 0),
        chestCounterRoll: this.walkForm ? chestCounterShare * pelvisList * this.style.pelvisList * strideScale * this.support(this.phase + listLead - chestRollLag) : 0,
        spinePitch: 0.6 * (this.lean.y + nod),
        chestPitch: 0.4 * this.lean.y + chestNodNow + (this.walkForm ? this.style.fold : 0),
        // The head keeps half of a forward-leaning style's lean off its line of sight, and nods a little after the trunk.
        neckPitch: this.walkForm ? this.style.head - 0.5 * (this.style.lean + this.style.fold) + headNod * Math.sqrt(this.style.bounce) * Math.min(1, strideScale) * Math.cos(2 * Math.PI * (this.phase - nodLag - headNodLag)) : 0,
        chestCounterYaw: -0.5 * lowerBodyYaw,
        twist: { lower, mid, upper, head },
      },
      walkForm: this.walkForm,
      armSwing: { left: arm('left'), right: arm('right') },
      handCurl: this.walkForm ? this.style.handCurl : 1,
      lookAhead: this.turn ? this.turnLookAhead(this.turn) : this.yawPlan ? this.planLookAhead(this.yawPlan) : this.walk && this.walk.arrivalFacing === null ? this.yaw + wrap(this.walk.heading - this.yaw) : this.yaw,
      weight: smoothstep(this.blend),
      events,
      limited: this.limited,
    }
  }
}

/**
 * Root travel, in model units, from `speed` to rest when a walk brakes as hard as the gait allows: each tick of the
 * 120 Hz grid takes a_max * dt off the speed (a_max = v_ref per second, v_ref = 0.9 L per second) and then advances by
 * the speed left. It is the slide that follows when a walk's goal ends, so a goal ended when `x + brakingDistance` reaches
 * a point stops her on it.
 */
export function brakingDistance(speed: number, legLength: number): number {
  const change = referenceLengthShare * legLength * referenceRate * gaitTick
  if (!(speed > 0) || !(change > 0))
    return 0
  // Ticks k = 1..n move at speed - k * change while that is positive.
  const ticks = Math.floor(speed / change)
  return gaitTick * (ticks * speed - change * ticks * (ticks + 1) / 2)
}

/**
 * Deterministic procedural gait on the 120 Hz grid. Planted anchors are frozen by
 * construction; landing targets are re-planned until 75% of the swing; root travel
 * follows a speed ramp of a_max = v_ref per second and stops exactly at the goal.
 */
export function createLocomotion({ traits, seed, variability = youngAdultStrideVariability }: { traits: GaitTraits, seed: number, variability?: GaitVariability }) {
  return new Locomotion(traits, seed, variability)
}
