import type { ArmKey } from './arm-key'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyGestureHand, BodyGesturePhase, BodyGestureReport, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { ArmPose, ReadyOffset, SpeechGestureForm } from './gesture-forms'
import type { GesturePhrase } from './phrases'
import type { LayerOutput, PerformanceContext, PerformanceLayer } from './stack'

import { minJerk } from '../dynamics'
import { deriveSeed } from '../noise'
import { createRandomStream } from '../random'
import { armResponse } from './arms'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, freeShare, SIDES } from './channels'
import { KEY_HEADROOM } from './collision'
import { addOffsets, ARM_FORMS, BEAT_PATHS, GESTURE_FORMS, gestureGain, GestureKeys, gestureTempo, isArmForm, NO_OFFSET, writeArmFormHand, writeFormHand, writeHandShare } from './gesture-forms'
import { handOrder, ORDER_PEAK_SLOPE, orderedCurve, orderedShare, orderedSlope, writeHandShape } from './hand-shapes'
import { drawPhrase, GESTURE_PLACES, gestureDrive, nextHands, retractShare } from './phrases'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Architecture 4a and plan 3.1 timing, in seconds unless named otherwise. */
const TIMING = {
  /** Minimum gap between two stroke starts (4a minor-beat gap). */
  strokeGap: 0.45,
  unitStrokes: 6,
  unitSeconds: 9,
  /**
   * `voice.slow` under 0.05 this long ends a thought, and the hands lower. From drive `holdDrive` up the speaker holds
   * them through `quiet + quietHold x drive` of it instead, and hands at rest in a phrase that has stroked go on to the
   * next phrase's place in the pause.
   */
  quiet: 0.4,
  holdDrive: 0.6,
  quietHold: 0.6,
  afterSpeech: 0.3,
  retractionScale: 1.3,
  /** Refractory after a unit that speaking ended: base + span x (1 - drive). */
  refractoryBase: 2.5,
  refractorySpan: 3,
  /** Refractory after a unit lowered while speech goes on (a pause, a cap, a phrase's end): a livelier speaker comes back sooner. */
  pauseBase: 0.4,
  pauseSpan: 1.2,
  /** The same non-beat form does not repeat within this window. */
  formRepeat: 8,
  /** A chop follows two accepted emphases inside this window. */
  chopWindow: 3,
  /** Return from the post-stroke hold to the ready key, before tempo. */
  recovery: 0.3,
  /** Exit ramp of the layer weight; it starts as a retraction ends. */
  exit: 0.35,
  enter: 0.25,
  /**
   * Exit ramp when a clip claims the arm. The app's upper-layer fade is a 0.25 s smoothstep, which passes ownership 0.5
   * 0.125 s after the claim; the gesture's weight is gone 90 ms after the first owned tick, before that.
   */
  cancel: 0.09,
  /** Non-dominant hand of a two-hand stroke (4a). */
  lagRange: [0.04, 0.07],
} as const

/**
 * A follower takes its target's slope up to 20 rad/s (`advanceSecondOrder`; architecture 3a: "a larger jump is a cut
 * and goes through inertialisation, not through the filter"), and leaves a faster target unfollowed.
 */
const FOLLOWER_INPUT_SLOPE = 20
/** Samples of a stroke's progress at which its target slope is checked against the follower input slope. */
const SLOPE_SAMPLES = 64
/** Minimum jerk's peak slope over its mean, `max s'(u)`. */
const MIN_JERK_PEAK_SLOPE = 1.875
/**
 * A speech unit's transitions (its preparation, every recovery, both legs of its retraction) carry an overlapping
 * corrective submovement with probability `share`. In the plain transition's time T, a minimum-jerk primary aims
 * `landing` of the way over `primary` T; at `onset` T, while it still moves, a second minimum-jerk submovement continues
 * the plan's velocity to the key and ends at T, as the plain transition does. Sources (E/g3/x2/sources.md,
 * expectation.md): submovements in 40 % of young adults' movements (Fradet, Lee and Dounskaia 2008), as two or more speed
 * peaks in 41 % of the stationary human talk reference's arm episodes; an undershooting primary (the minimisation model,
 * Roberts, Burkitt and Elliott 2024); overlapping, near-symmetric submovements (Novak, Miller and Houk 2002). Landing,
 * primary and onset reproduce the reference's first speed-peak pairs: the second 0.85 of the first, the trough between
 * them 0.37, 0.17 s apart.
 */
const CORRECTION = { share: 0.4, landing: 0.72, primary: 0.8, onset: 0.65 } as const
/**
 * A reach through a via pose (the hair tuck's, `GestureKeys.tuckVia`), in the reach's time T: a minimum-jerk segment
 * to the via over `primary` T, and at `onset` T, while it still moves, a second one to the key, ending at T, that
 * carries the plan's velocity and acceleration (`release`). The hand does not stop at the via.
 */
const THROUGH = { primary: 0.75, onset: 0.4 } as const
/**
 * Seconds over which a prepared arm's wrist-placing joints move from their cascade links to the fed target. The elbow's
 * link still lags a preparation's end by 1.3 to 1.9 degrees and by 0.24 to 0.35 degrees 50 ms later (30 to 90 degrees
 * over 0.35 to 0.5 s at tension 0); a 0.1 s ease takes up that remainder without a step.
 */
const FED_RAMP = 0.1

/**
 * The coefficients of an arm follower's inverse, `x = y + lead y' + curvature y''` (3a, r = 0), on channel `j` at
 * mood tension `tension` and activation `used` (1, an override layer's active follower; 0, the relaxed follower
 * under additive layers); damping is the follower's own clamp to [0.3, 1].
 */
export function followerInverse(j: number, tension: number, used = 1): readonly [lead: number, curvature: number] {
  const [f, zeta] = armResponse(j, used, tension)
  const omega = 2 * Math.PI * f
  return [2 * Math.max(0.3, Math.min(1, zeta)) / omega, 1 / omega ** 2]
}

/**
 * The default emphasis form's shares (plan 3.1, lead's ruling that energy scales size and selects among forms): palm-up
 * 0.25 as before; press, 4a's "large emphasis", 0.10 + 0.25 E with E the utterance's energy as Natural reports it
 * (0.21 at 0.45, 0.31 at 0.85); beat the rest. The onset's voice level no longer selects a form: Natural's onsets fire
 * at 0.31 to 0.46, so the old press condition (level 0.7) never held.
 */
const FORM_SHARE = { palmUp: 0.25, press: 0.1, pressEnergy: 0.25 } as const

/** Plan 3.1 stroke admission: the gate's S2 voice-peak rule (`Q/gate/definition.ts`), read at the onset tick. */
const VOICE = { peak: 0.3, prominence: 0.15, quiet: 0.05 } as const

/**
 * Amplitudes (unit A `amplitude-sources.md`). Minor beats are plan D3's 0.6; the post-stroke drift is 4a's 1.5 % A,
 * unscaled; the torso terms are plan 3.1's 1.2 and 0.8 degrees x gain, scaled 2.6 so a stroke's trunk turn clears the
 * goal-2 speak runs' largest same-run placebo p95 (2.37 degrees) by 1.25 at the lowest speak energy. A two-hand
 * stroke's second hand takes its form's shape `nonDominantHand` of the way back toward the relaxed hand, so the two
 * hands do not mirror each other exactly: the non-dominant hand is the less articulated one.
 */
const AMPLITUDE = {
  minor: 0.6,
  walking: 0.6,
  nonDominant: 0.85,
  nonDominantSwivel: 6 * DEG,
  nonDominantHand: 0.3,
  drift: 0.015,
  torsoYaw: 1.2 * 2.6 * DEG,
  torsoPitch: 0.8 * 2.6 * DEG,
  torsoMidShare: 0.5,
  torsoMidLag: 0.07,
  torsoDecay: 0.5,
  /**
   * The gesturing shoulder rises into each stroke with the torso pulse, 1.5 degrees x gain; a stroke that drives down
   * (press, chop: 0.1 A or more) presses it down by half that instead.
   */
  shoulderLift: 1.5 * DEG,
  shoulderPress: -0.75 * DEG,
} as const

/**
 * A calm speaker gestures seldom: below drive 0.4 a unit opens only on an emphasis or a loud onset, and a stroke needs
 * a voice level up to `floor` above the S2 peak rule (at drive 0) unless it carries an emphasis: 0.55 at drive 0.2, so
 * Natural's ordinary onsets (0.31 to 0.46) pass by.
 */
const CALM = { drive: 0.4, floor: 0.5 } as const

/**
 * A hand rises only to say something. A unit opens on an utterance's speaking edge or on an onset that strokes; an
 * onset that finds the lead hand still rising strokes as soon as the preparation lets it, when that is within `defer`
 * seconds of the onset, so the rise leads into its stroke; and the unit lowers its hands only after that stroke.
 * Before, an onset that opened a unit passed while the hands rose, and a pause or the end of speech lowered them again
 * with no stroke at all.
 *
 * A hand that would rise before its stress is known only leans (`LEAN`) and rises on the next stroking onset, which it
 * strokes: the hands of a unit opened by a weak onset, and a hand that a new phrase brings in from rest, the other hand
 * taking over the thought or both joining. Until that onset the hand that has the thought keeps it, so a phrase that
 * ended on the thought's last stress no longer raises the other hand to its ready key to wait there unstroked, and
 * speech that restarts on a weak onset prepares the hands in time without raising them for nothing.
 *
 * A raised hand with nothing more to stress lets go: once every hand of a unit has waited at its ready key for
 * `settle` seconds of speech with no stroke leaving, the unit lowers them while speech goes on, and the next stroking
 * onset raises them again; one hand of two that waits so while the other strokes alone lets go by itself. Before, a
 * hand that had taken the last stroke of a thought waited there, elbow bent, until speaking ended (2.6 s on the speak
 * scenario's second utterance), and then 1 s + 0.4 s x drive, up to 1.45 s still to the eye. The wait outlasts the
 * speak scenario's widest peak gap (1.5 s) less a beat, its shortest hold and its recovery (0.46 s at drive 0.85), so
 * the hands stay up between close strokes; at 1 s a lively hand let go just before such a stroke.
 */
const RISE = { defer: 0.6, settle: 1.1 } as const

/**
 * A hand at its ready key does not hold still there. From the moment it arrives it sinks toward its hang by minimum
 * jerk over `seconds`, its fingers relaxing to the hang's hand over the wait (`RISE.settle`). A hand with nothing more
 * to stress lets go about two fifths of the way down and goes on home in the time the sink had left, carrying its
 * speed, so a thought's last accent runs into one fall; that way home is a retraction like any other, corrected as
 * often. A pause or the end of speech lowers a hand that has not waited out its wait at a retraction's pace, so the
 * next unit is not kept waiting. A stroke still leaves from wherever the sinking hand is (`strokeTrack`).
 *
 * Before, the hand stood at its ready key, elbow bent, for up to 1.1 s after the last stroke and then dropped in a
 * retraction's time: it read as waiting to speak again, most plainly in profile. A sink over 4 s was an eighth of the
 * way down at the let-go and still read as a wait; fingers that relaxed over the whole sink barely moved.
 */
const SINK = { seconds: 2.4 } as const

/**
 * A leaning hand moves `share` of the way from its rest to its ready key, over the time its whole preparation takes:
 * the elbow bends and the hand comes a little forward, a shift of the arm's hang rather than a raised forearm. It waits
 * there as a ready hand waits (`RISE.settle`), and its rise from there takes the rest of the way.
 */
const LEAN = { share: 0.3 } as const

/**
 * A phrase's theme stroke sets its hand: the ready key turns `share` of the way to the theme's forearm and wrist and
 * the hand takes `hand` of the theme's shape, so the beats that follow keep the palm the theme showed. A set phrase's
 * beat keeps that turn and flexes the wrist `beatFlex` further, and lands with the theme's full hand.
 */
const SET = { share: 0.6, hand: 0.5, beatFlex: 10 * DEG } as const

/**
 * Each recovery returns to a ready key moved within the phrase's place: the elbow floats up or down by half to all of
 * `up` A (alternating on each arm), and the hand by as much of `forward` A back when it rises and forward when it
 * falls, so a lowered hand stays out in front of the body; it moves out by up to `out` A and the elbow swings by up to
 * `swivel`. Successive beats leave from different heights and depths instead of one parked pose.
 */
const FLOAT = { out: 0.04, up: 0.05, forward: 0.04, swivel: 10 * DEG } as const

/**
 * The hand at a ready key outside a set phrase: `share` of the way from the rest hand to the open one. The rest hand's
 * cascade, curled most at the middle joints, reads as a claw held palm down in front of the body; this shallower curl
 * hovers, and a beat's hand settles into it through the fingertips (`handOrder`).
 */
const READY_HAND = { shape: 'open', share: 0.5 } as const

/** During the post-stroke hold the hand eases this share of the way back toward the ready hand before the recovery opens it fully. */
const HOLD_SOFTEN = 0.35

/**
 * The body's part in a phrase, held from its preparation to its retraction and eased by minimum jerk: the trunk turns
 * toward a one-handed phrase's hand (degrees x gain, upper and mid), leans forward with drive above 0.3, the head and
 * neck tilt toward the hand, the gesturing shoulder rises by the place's lift (degrees x gain) and the free shoulder
 * settles. A two-hand phrase squares the trunk.
 */
const BODY = {
  upperYaw: 2 * DEG,
  midYaw: 1 * DEG,
  lean: 2.4 * DEG,
  leanFrom: 0.3,
  midLeanShare: 0.5,
  headRoll: 2 * DEG,
  neckRoll: 0.8 * DEG,
  freeShoulder: -1.5 * DEG,
  placeLift: { centre: 1 * DEG, low: 0.3 * DEG, side: 2.2 * DEG, high: 2.8 * DEG, inner: 1.5 * DEG },
} as const

/**
 * Between thoughts the weight moves to the other foot: as a unit lowers its hands while standing, with probability
 * `share`, the gesture body layer asks for support `magnitude` + `driveMagnitude` x drive on the other side for
 * `seconds`, unless an emotion or act holds the support.
 */
const SHIFT = { share: 0.6, magnitude: 0.5, driveMagnitude: 0.4, seconds: 1.5 } as const

/**
 * The speech head beat (probe option (b), E/g3/speech-head-probe.md): a pitch-down nod of neck and head together, 3
 * degrees peak to peak for a major stroke (Graf, Cosatto, Strom and Huang 2002, Visual prosody, figure 4a: about 3 to 5
 * degrees per accent nod; the low end), split as the posture and the cue nod split the head, the neck 30 ms first. It
 * rises by minimum jerk over the stroke to its apex on the stroke's landing and returns over 0.25 s, so the whole nod
 * spans two to four phones. A gaze that is not free takes 0.6, as every head accent does (`posture.ts`).
 */
const HEAD_BEAT = { degrees: 3 * DEG, neckShare: 0.35, neckLead: 0.03, back: 0.25, heldGaze: 0.6 } as const

const NECK_PITCH = 16
const HEAD_PITCH = 19

type TrackState = 'rest' | 'preparation' | 'lean' | 'ready' | 'stroke' | 'hold' | 'recovery' | 'retraction' | 'form'

interface Segment {
  readonly from: ArmPose
  readonly velocity: ArmPose
  /** A let-go arm form's start carries the plan's acceleration too (`ArmTrack.release`); zero on every other segment. */
  readonly acceleration: ArmPose
  /**
   * The followers receive the inverse of the carried velocity and acceleration as well as of the minimum-jerk part, so
   * their target goes on without a step where the segment cut a moving one. Only a let-go arm form's start sets it.
   */
  carried: boolean
  readonly to: ArmPose
  start: number
  /**
   * Each channel's duration: the segment's, or longer where a channel's change would ask its follower for more than
   * its input slope, so a large turn of the forearm, wrist or fingers arrives after the hit (4a: the hand shape last).
   */
  readonly durations: ArmPose
  /**
   * Each hand channel's closing order (`handOrder`, channels 9 to 25): a finger closes from its knuckle and opens from
   * its tip, so a closing hand's fingertips arrive last and an opening one's leave first. The arm channels keep
   * minimum jerk in time.
   */
  readonly order: ArmPose
}

/** One stroke's trunk and head participation: the torso pulse peaks at 4a's stroke time, the head beat at the landing. */
interface StrokeAccent {
  readonly start: number
  readonly hit: number
  readonly yaw: number
  readonly pitch: number
  /** The end of the stroke's fed-forward profile, where the wrist lands. */
  readonly landing: number
  /** Neck and head pitch together, radians. */
  readonly nod: number
  /** The gesturing shoulder's elevation, radians, on the torso pulse's course. */
  readonly lift: number
}

const pose = (): ArmPose => new Float64Array(26)
const relaxedHand = pose()
writeHandShape('relaxed', relaxedHand)

/** Slope and curvature (per unit progress) of a segment's carried-velocity term, h(u) = u - 6u^3 + 8u^4 - 3u^5. */
const decaySlope = (u: number) => 1 - 18 * u ** 2 + 32 * u ** 3 - 15 * u ** 4
const decayCurve = (u: number) => -36 * u + 96 * u ** 2 - 60 * u ** 3
/** Slope and curvature of a let-go form's carried-acceleration term, g(u) (`ArmTrack.profile`). */
const carrySlope = (u: number) => u - 4.5 * u ** 2 + 6 * u ** 3 - 2.5 * u ** 4
const carryCurve = (u: number) => 1 - 9 * u + 18 * u ** 2 - 10 * u ** 3

/** One arm's performance: its targets, its weight request and its motion segment. */
class ArmTrack {
  readonly channels = new Float64Array(BODY_CHANNELS.length)
  readonly additive = new Float64Array(BODY_CHANNELS.length)
  readonly mask = new Float64Array(BODY_CHANNELS.length)
  /** The target the followers receive: the planned motion, fed forward during a stroke. */
  readonly pose = pose()
  /** The planned motion and its previous tick; a new segment continues the plan's velocity, never the inverse's. */
  readonly planned = pose()
  readonly plannedPrevious = pose()
  readonly home = pose()
  readonly ready = pose()
  /** The key `ready` was solved from: the phrase's place, its float and its set hand turn. */
  readyKey: ArmKey | null = null
  /** The direction of the next elbow float, up (1) or down (-1); it alternates. */
  floatSign = 1
  /** The `BEAT_PATHS` entry the arm's last beat took; -1 before its first, which takes the form's own path. */
  beatPath = -1
  /** Seconds of speech the arm has waited at its ready key with no stroke leaving; too long, and it lets go (`RISE`). */
  waited = 0
  /** Whether the arm has risen from rest and not stroked since: a two-hand phrase's beat takes it along (`perform`). */
  silent = false
  /** Whether the arm's preparation goes only to its lean (`LEAN`), where it waits in state `lean`. */
  leaning = false
  readonly key = pose()
  /** Where the hair tuck's reach passes between the rest arm and its key (`GestureKeys.tuckVia`). */
  readonly tuckVia = pose()
  readonly segment: Segment = { from: pose(), velocity: pose(), acceleration: pose(), carried: false, to: pose(), start: 0, durations: pose().fill(1), order: pose() }
  readonly accents: StrokeAccent[] = []
  state: TrackState = 'rest'
  weight = 0
  exitSeconds: number = TIMING.exit
  /** When the weight request drops: as a retraction ends. */
  dropAt = Infinity
  phaseEnd = Infinity
  holdEnd = Infinity
  /** The current stroke's post-stroke hold length, seconds, and its drift key, 1.5 % A past the stroke key. */
  holdSeconds = 0
  readonly drift = pose()
  /**
   * The stroke being watched on the arm's actual output: its wrist speed peak and last sample, so the report marks the
   * apex the motion shows (plan 2.1: timing comes from kinematics). `after` is 0.75 of the stroke's planned time: a
   * minimum-jerk stroke's speed first falls to half its peak at 0.77, so its landing cannot come earlier, while a stroke
   * that starts with the arm still moving (a recovery's second submovement under way) dips before it.
   */
  watch: { form: SpeechGestureForm, hand: BodyGestureHand, peak: number, speed: number, wrist: readonly [number, number, number] | null, until: number, after: number } | null = null
  form: SpeechGestureForm | BodyArmForm | null = null
  prepSeconds = 0.5
  pending: { at: number, form: SpeechGestureForm, size: number, hold: number, corrected: boolean } | null = null
  warm = false

  constructor(readonly side: BodySide) {
    // Clavicles stay out: breath and the shoulder keep moving under a gesture.
    for (let j = 2; j < 26; j++)
      this.mask[ARM_START[side] + j] = 1
  }

  get active(): boolean {
    return this.state !== 'rest'
  }

  /**
   * Whether every channel of the current motion had arrived by the previous tick, so the target is the key itself: a
   * segment's last ticks carry its feedforward's lead, and a motion started from them would keep it.
   */
  arrived(now: number): boolean {
    return this.correctAt === Infinity && now - BODY_TICK >= this.segment.start + Math.max(...this.segment.durations) - 1e-9
  }

  /**
   * The share of the wrist-placing joints fed past their cascade links (`LayerOutput.fed`): 0 through the preparation,
   * which keeps the links' proximal-to-distal order as before, then rising over `FED_RAMP` once the arm is prepared,
   * while the links' lag on the preparation's end has settled to a fraction of a degree; back to 0 at the retraction.
   * An emotion arm form keeps the links.
   */
  fed = 0
  /** When the preparation ended (the ready key reached, or a stroke cut it), seconds. */
  preparedAt = Infinity
  /** A retraction still on its way back to the ready key, from where it goes home on the preparation's cleared path. */
  viaReady = false
  /**
   * An arm on its way home: a ready arm sinking toward it (`SINK`), or a retracting one, which comes to rest there before
   * its weight ramps out (`retractTrack`). Home is cleared against the body every tick on the way. An arm holding a form
   * sets it once it has gone on from the form's key to the settled key its request asks for (`step`).
   */
  settle = false
  /** A corrected transition's second submovement: its target, when it starts (Infinity while none waits) and its end. */
  readonly correctTo = pose()
  correctAt = Infinity
  correctEnd = Infinity
  /** Whether the current segment goes to a via pose (`through`), which `aim` leaves in place, not a corrected primary. */
  private toVia = false
  /** Whether the recovery after this arm's stroke is corrected: drawn with the stroke, a second hand's taken from the first. */
  recoveryCorrected = false
  private readonly primaryTo = pose()
  private readonly onsetPose = pose()
  private readonly releaseFrom = pose()
  private readonly releaseVelocity = pose()
  private readonly releaseAcceleration = pose()

  /**
   * Starts a motion to `to` from the current target, continuing the plan's velocity (quintic decay of `v0`), and
   * returns its duration: `duration`, or longer when the followers could not take its fed-forward channels in that
   * time. The target stays continuous: the inverse term is zero at both ends of every segment.
   */
  move(to: ArmPose, now: number, duration: number, tension: number): number {
    const s = this.segment
    for (let j = 0; j < 26; j++)
      s.velocity[j] = this.warm ? (this.planned[j] - this.plannedPrevious[j]) / BODY_TICK : 0
    const fed = Math.max(BODY_TICK, duration, this.fedForwardFloor(to, tension, this.pose, s.velocity))
    this.correctAt = Infinity
    this.toVia = false
    s.from.set(this.pose)
    s.to.set(to)
    s.start = now
    s.carried = false
    this.schedule(fed)
    return fed
  }

  /**
   * Starts a let-go arm form's way to `to` (architecture 4e: "its exit can start from any tick") from where the plan is
   * at `now`, with the plan's velocity and acceleration there, and returns its duration, `move`'s. The followers
   * receive the inverse of the whole new profile, carried terms included, so the target the old segment's inverse held
   * goes on without a step. `move` from a reach under way restarted the followers' target without the reach's lead and
   * curvature terms, and the arm sprang off the face (a yawn let go 1.1 s in: 1.35 deg per tick within a tick).
   */
  release(to: ArmPose, now: number, duration: number, tension: number): number {
    let carried = false
    for (let j = 0; j < 26; j++) {
      this.planAt(j, now)
      carried ||= this.releaseVelocity[j] !== 0 || this.releaseAcceleration[j] !== 0
    }
    const s = this.segment
    const fed = Math.max(BODY_TICK, duration, this.fedForwardFloor(to, tension, this.releaseFrom))
    this.correctAt = Infinity
    this.toVia = false
    s.from.set(this.releaseFrom)
    s.velocity.set(this.releaseVelocity)
    s.acceleration.set(this.releaseAcceleration)
    s.to.set(to)
    s.start = now
    s.carried = carried
    this.schedule(fed)
    return fed
  }

  /**
   * Sets the current segment's channel durations and hand order for a segment of `fed` seconds: a channel whose change
   * would ask its follower for more than its input slope takes longer, a leading or trailing hand joint by its order's
   * steeper peak too.
   */
  private schedule(fed: number): void {
    const s = this.segment
    handOrder(s.from, s.to, s.order)
    for (let j = 0; j < 26; j++) {
      const peak = MIN_JERK_PEAK_SLOPE * (j >= 9 ? ORDER_PEAK_SLOPE : 1)
      s.durations[j] = j >= 2 && j <= 5 ? fed : Math.max(fed, peak * Math.abs(s.to[j] - s.from[j]) / FOLLOWER_INPUT_SLOPE)
    }
  }

  /**
   * Brings the current segment's hand channels in within `seconds` of its start, or as soon as their followers take
   * them (`schedule`); the arm keeps its own time.
   */
  handWithin(seconds: number): void {
    const s = this.segment
    for (let j = 9; j < 26; j++)
      s.durations[j] = Math.max(Math.min(s.durations[j], seconds), MIN_JERK_PEAK_SLOPE * ORDER_PEAK_SLOPE * Math.abs(s.to[j] - s.from[j]) / FOLLOWER_INPUT_SLOPE)
  }

  /** Writes the plan of channel `j` at `time` on the current segment, and its velocity and acceleration, into the release scratch. */
  private planAt(j: number, time: number): void {
    const s = this.segment
    const duration = s.durations[j]
    const u = Math.max(0, Math.min(1, (time - s.start) / duration))
    this.releaseFrom[j] = this.profile(j, time)
    if (u >= 1) {
      this.releaseVelocity[j] = this.releaseAcceleration[j] = 0
      return
    }
    const delta = s.to[j] - s.from[j]
    const v0 = s.velocity[j]
    const a0 = s.carried ? s.acceleration[j] : 0
    // Minimum jerk of the hand order's warp w(u) (`orderedShare`): slope s'(w) w', curvature s''(w) w'^2 + s'(w) w''.
    const hand = j >= 9
    const w = hand ? orderedShare(s.order[j], u) : u
    const slope = hand ? orderedSlope(s.order[j], u) : 1
    const curve = hand ? orderedCurve(s.order[j], u) : 0
    const shapeSlope = 30 * w ** 2 * (1 - w) ** 2
    this.releaseVelocity[j] = delta * shapeSlope * slope / duration + v0 * decaySlope(u) + a0 * duration * carrySlope(u)
    this.releaseAcceleration[j] = delta * (60 * w * (1 - w) * (1 - 2 * w) * slope ** 2 + shapeSlope * curve) / duration ** 2 + v0 * decayCurve(u) / duration + a0 * carryCurve(u)
  }

  /**
   * Starts a speech unit's transition to `to` and returns its duration, `move`'s. With `corrected` it is a corrected
   * transition (`CORRECTION`) when both submovements stay within the follower input slope in their share of that time;
   * otherwise it is plain.
   */
  transit(to: ArmPose, now: number, duration: number, tension: number, corrected: boolean): number {
    if (corrected) {
      const total = Math.max(BODY_TICK, duration, this.fedForwardFloor(to, tension))
      const reach = CORRECTION.landing * minJerk(CORRECTION.onset / CORRECTION.primary)
      for (let j = 0; j < 26; j++) {
        this.primaryTo[j] = this.pose[j] + CORRECTION.landing * (to[j] - this.pose[j])
        this.onsetPose[j] = this.pose[j] + reach * (to[j] - this.pose[j])
      }
      if (this.fedForwardFloor(this.primaryTo, tension) <= CORRECTION.primary * total
        && this.fedForwardFloor(to, tension, this.onsetPose) <= (1 - CORRECTION.onset) * total) {
        this.move(this.primaryTo, now, CORRECTION.primary * total, tension)
        this.correctTo.set(to)
        this.correctAt = now + CORRECTION.onset * total
        this.correctEnd = now + total
        return total
      }
    }
    return this.move(to, now, duration, tension)
  }

  /**
   * Starts a reach to `to` through `via` (`THROUGH`) in `duration` seconds and returns its duration; `move` when either
   * segment would ask a follower for more than its input slope in its share of that time. `release` starts the first
   * segment from where the plan is, with its velocity and acceleration, as a let-go arm form's way home does.
   */
  through(via: ArmPose, to: ArmPose, now: number, duration: number, tension: number, release: boolean): number {
    const total = Math.max(BODY_TICK, duration)
    const reach = minJerk(THROUGH.onset / THROUGH.primary)
    for (let j = 0; j < 26; j++)
      this.onsetPose[j] = this.pose[j] + reach * (via[j] - this.pose[j])
    if (this.fedForwardFloor(via, tension) > THROUGH.primary * total || this.fedForwardFloor(to, tension, this.onsetPose) > (1 - THROUGH.onset) * total)
      return release ? this.release(to, now, duration, tension) : this.move(to, now, duration, tension)
    if (release)
      this.release(via, now, THROUGH.primary * total, tension)
    else
      this.move(via, now, THROUGH.primary * total, tension)
    this.toVia = true
    this.correctTo.set(to)
    this.correctAt = now + THROUGH.onset * total
    this.correctEnd = now + total
    return total
  }

  /**
   * Moves the current transition's end to `to`; a corrected transition's primary keeps aiming its share of the way, and
   * a segment to a via pose keeps its via.
   */
  aim(to: ArmPose): void {
    if (this.correctAt === Infinity) {
      this.segment.to.set(to)
      return
    }
    this.correctTo.set(to)
    if (this.toVia)
      return
    for (let j = 0; j < 26; j++)
      this.segment.to[j] = this.segment.from[j] + CORRECTION.landing * (to[j] - this.segment.from[j])
  }

  advance(now: number, tension: number): void {
    // A reach through a via goes on from the plan's velocity and acceleration with its followers' target unbroken
    // (`release`); a corrective submovement, as measured, continues the velocity alone.
    if (now >= this.correctAt && this.toVia)
      this.release(this.correctTo, now, this.correctEnd - now, tension)
    else if (now >= this.correctAt)
      this.move(this.correctTo, now, this.correctEnd - now, tension)
    this.plannedPrevious.set(this.planned)
    const s = this.segment
    for (let j = 0; j < 26; j++) {
      const y = this.profile(j, now)
      this.planned[j] = y
      this.pose[j] = y
      const duration = s.durations[j]
      const u = Math.max(0, Math.min(1, (now - s.start) / duration))
      if (j < 2 || j > 5 || u >= 1)
        continue
      // Flex, abduct, twist and elbow place the wrist: the followers receive the inverse of every segment's planned
      // minimum-jerk part, analytic, so the arm moves along the path the keys were cleared on and lands as planned,
      // without its followers' lag or overshoot. Distal channels follow softly.
      const [lead, curvature] = followerInverse(j, tension)
      const rate = 30 * u ** 2 * (1 - u) ** 2 / duration
      const acceleration = 60 * u * (1 - u) * (1 - 2 * u) / duration ** 2
      this.pose[j] += (s.to[j] - s.from[j]) * (lead * rate + curvature * acceleration)
      if (s.carried) {
        const v0 = s.velocity[j]
        const a0 = s.acceleration[j]
        this.pose[j] += lead * (v0 * decaySlope(u) + a0 * duration * carrySlope(u)) + curvature * (v0 * decayCurve(u) / duration + a0 * carryCurve(u))
      }
    }
    this.warm = true
  }

  /**
   * The shortest segment from the current target to `to` whose fed-forward channels (flex, abduct, twist, elbow) stay
   * within the follower input slope: their target's slope is `D (s' / T + lead s'' / T^2 + curvature s''' / T^3)` for
   * minimum jerk `s`, plus `v0 h'(u)` for a carried plan velocity `velocity` (its decay is not inverted). A corrected
   * transition's second submovement carries the primary's velocity, which its admission check does not see: a hand
   * leaving a high place mid-unit turned its elbow 90 degrees in under 0.5 s and the carried velocity took its target
   * to 20.6 rad/s. The other channels take their own durations (`move`).
   */
  private fedForwardFloor(to: ArmPose, tension: number, from: ArmPose = this.pose, velocity: ArmPose | null = null): number {
    const inverses = [2, 3, 4, 5].map(j => followerInverse(j, tension))
    const slope = (duration: number) => {
      let worst = 0
      for (let k = 0; k <= SLOPE_SAMPLES; k++) {
        const u = k / SLOPE_SAMPLES
        const rate = 30 * u ** 2 * (1 - u) ** 2 / duration
        const acceleration = 60 * u * (1 - u) * (1 - 2 * u) / duration ** 2
        const jerk = 60 * (1 - 6 * u + 6 * u ** 2) / duration ** 3
        for (let j = 2; j <= 5; j++) {
          const [lead, curvature] = inverses[j - 2]
          worst = Math.max(worst, Math.abs((to[j] - from[j]) * (rate + lead * acceleration + curvature * jerk) + (velocity ? velocity[j] * decaySlope(u) : 0)))
        }
      }
      return worst
    }
    let low = 2 * BODY_TICK
    let high = 1
    if (slope(low) <= FOLLOWER_INPUT_SLOPE)
      return low
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2
      if (slope(middle) > FOLLOWER_INPUT_SLOPE)
        low = middle
      else
        high = middle
    }
    return high
  }

  /** The planned position of channel `j` at `time` on the current segment. */
  profile(j: number, time: number): number {
    const s = this.segment
    const duration = s.durations[j]
    const u = Math.max(0, Math.min(1, (time - s.start) / duration))
    const shape = minJerk(j >= 9 ? orderedShare(s.order[j], u) : u)
    // h(u) = u - 6u^3 + 8u^4 - 3u^5: unit initial slope, zero value, slope and curvature at u = 1.
    const decay = duration * (u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5)
    const planned = s.from[j] + (s.to[j] - s.from[j]) * shape + s.velocity[j] * decay
    // g(u) = u^2/2 - 3u^3/2 + 3u^4/2 - u^5/2: unit initial curvature, zero value and slope at 0, all three zero at 1.
    return s.carried ? planned + s.acceleration[j] * duration ** 2 * (u ** 2 / 2 - 1.5 * u ** 3 + 1.5 * u ** 4 - u ** 5 / 2) : planned
  }

  /** Adds every live stroke's torso pulse and head beat; `head` scales the beat (a clip owning the head takes it). */
  participate(now: number, head: number): void {
    this.additive.fill(0)
    for (let i = this.accents.length - 1; i >= 0; i--) {
      const accent = this.accents[i]
      if (now > Math.max(accent.hit + AMPLITUDE.torsoDecay + AMPLITUDE.torsoMidLag, accent.landing + HEAD_BEAT.back)) {
        this.accents.splice(i, 1)
        continue
      }
      const upper = pulseShape(accent, now)
      const mid = AMPLITUDE.torsoMidShare * pulseShape(accent, now - AMPLITUDE.torsoMidLag)
      this.additive[12] += upper * accent.yaw
      this.additive[13] += upper * accent.pitch
      this.additive[9] += mid * accent.yaw
      this.additive[10] += mid * accent.pitch
      const neckApex = Math.max(accent.start + BODY_TICK, accent.landing - HEAD_BEAT.neckLead)
      this.additive[NECK_PITCH] += head * HEAD_BEAT.neckShare * accent.nod * beatShape(accent.start, neckApex, now)
      this.additive[ARM_START[this.side]] += upper * accent.lift
      this.additive[HEAD_PITCH] += head * (1 - HEAD_BEAT.neckShare) * accent.nod * beatShape(accent.start, accent.landing, now)
    }
  }

  write(): void {
    const start = ARM_START[this.side]
    for (let j = 0; j < 26; j++)
      this.channels[start + j] = this.pose[j]
  }

  reset(): void {
    this.state = 'rest'
    this.weight = 0
    this.exitSeconds = TIMING.exit
    this.dropAt = this.phaseEnd = this.holdEnd = Infinity
    this.form = null
    this.pending = null
    this.preparedAt = Infinity
    this.fed = 0
    this.viaReady = false
    this.settle = false
    this.correctAt = Infinity
    this.recoveryCorrected = false
    this.accents.length = 0
    this.warm = false
    this.readyKey = null
    this.floatSign = 1
    this.beatPath = -1
    this.waited = 0
    this.silent = false
    this.leaning = false
  }
}

/** The body channels a phrase holds (`BODY`): mid yaw and pitch, upper yaw and pitch, neck and head roll, both clavicles' elevation. */
const BODY_CHANNEL_INDEX = [9, 10, 12, 13, 17, 20, ARM_START.left, ARM_START.right] as const
const HEAD_ROLLS = new Set([4, 5])

/**
 * The trunk, head and shoulders' hold for the current phrase. Each change eases by minimum jerk from where the pose is,
 * carrying its velocity (the arm segments' h(u)), so a phrase that cuts the last one's ease short goes on smoothly.
 */
class PhrasePose {
  readonly value = new Float64Array(BODY_CHANNEL_INDEX.length)
  private readonly previous = new Float64Array(BODY_CHANNEL_INDEX.length)
  private readonly from = new Float64Array(BODY_CHANNEL_INDEX.length)
  private readonly velocity = new Float64Array(BODY_CHANNEL_INDEX.length)
  private readonly to = new Float64Array(BODY_CHANNEL_INDEX.length)
  private start = 0
  private duration = 1

  aim(to: ArrayLike<number>, now: number, seconds: number): void {
    for (let k = 0; k < this.value.length; k++) {
      this.from[k] = this.value[k]
      this.velocity[k] = (this.value[k] - this.previous[k]) / BODY_TICK
      this.to[k] = to[k]
    }
    this.start = now
    this.duration = Math.max(BODY_TICK, seconds)
  }

  advance(now: number): void {
    const u = Math.max(0, Math.min(1, (now - this.start) / this.duration))
    const decay = this.duration * (u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5)
    for (let k = 0; k < this.value.length; k++) {
      this.previous[k] = this.value[k]
      this.value[k] = this.from[k] + (this.to[k] - this.from[k]) * minJerk(u) + this.velocity[k] * decay
    }
  }

  /** Writes the hold into `additive`; `head` scales the head and neck roll (a clip owning the head takes it). */
  write(additive: Float64Array, head: number): void {
    for (let k = 0; k < this.value.length; k++)
      additive[BODY_CHANNEL_INDEX[k]] = this.value[k] * (HEAD_ROLLS.has(k) ? head : 1)
  }

  reset(): void {
    for (const values of [this.value, this.previous, this.from, this.velocity, this.to])
      values.fill(0)
    this.start = 0
    this.duration = 1
  }
}

/** Torso participation of one stroke: the stroke's own warped rise to its hit, then a minimum-jerk return. */
function pulseShape(pulse: StrokeAccent, now: number): number {
  if (now <= pulse.start)
    return 0
  if (now < pulse.hit)
    return minJerk(((now - pulse.start) / (pulse.hit - pulse.start)) ** 0.8)
  return 1 - minJerk((now - pulse.hit) / AMPLITUDE.torsoDecay)
}

/** The head beat's course: minimum jerk from the stroke's start to its apex, then back over `HEAD_BEAT.back`. */
function beatShape(start: number, apex: number, now: number): number {
  if (now <= start)
    return 0
  if (now < apex)
    return minJerk((now - start) / (apex - start))
  return 1 - minJerk((now - apex) / HEAD_BEAT.back)
}

/**
 * Plans co-speech gesture units (architecture 4a with plan 3.1's changes, D3) and performs the emotion arm forms the
 * merged plan requests. Shared by the two per-side layers, and advanced once per performer tick.
 */
class GesturePerformer {
  readonly tracks: Record<BodySide, ArmTrack> = { left: new ArmTrack('left'), right: new ArmTrack('right') }
  readonly report: Mutable<BodyGestureReport> = { unitSeq: 0, strokeSeq: 0, form: null, hand: null, phase: 'rest', plannedHit: null }
  /** The body's hold for the current phrase, and the additive output of the gesture body layer. */
  readonly body = new PhrasePose()
  readonly bodyAdditive = new Float64Array(BODY_CHANNELS.length)
  /** A weight shift the body layer asks of the posture between thoughts (`SHIFT`). */
  shift: { readonly support: number, readonly until: number } | null = null
  private random
  /** The corrective submovements' own stream (`CORRECTION`), so the gesture stream's choices keep their order. */
  private corrections
  /** The phrases' own stream: places, themes, hands, floats and weight shifts, so the gesture stream keeps its order. */
  private phrases
  private dominant: BodySide = 'right'
  private keys: GestureKeys | null = null
  private tick = -1
  /** `leaning`: the unit's hands have only leaned (`LEAN`); a unit that ends so takes no refractory. */
  private unit = { active: false, sides: [] as BodySide[], twoHand: false, drive: 0.5, start: 0, strokes: 0, retracting: false, bySpeech: false, leaning: false }
  /** The current phrase, kept past its unit so the next one differs from it; its strokes; whether its theme has set the hand. */
  private phrase: GesturePhrase | null = null
  private phraseStrokes = 0
  private phraseSet = false
  private readonly bodyTarget = new Float64Array(BODY_CHANNEL_INDEX.length)
  private lastOnset = 0
  private lastEmphasis = 0
  private wasSpeaking = false
  private speechEnded = -Infinity
  private quiet = 0
  private lastStroke = -Infinity
  private refractoryEnd = -Infinity
  /** An onset that strokes once the lead hand's preparation lets it (`RISE`): when it came, its form and whether it was major. */
  private deferred: { readonly at: number, readonly form: SpeechGestureForm, readonly major: boolean } | null = null
  /**
   * The next phrase, drawn at the current one's end, when it brings in a hand from rest: that hand leans, and the
   * phrase begins on the next stroking onset (`RISE`).
   */
  private handover: { readonly phrase: GesturePhrase, readonly joining: readonly BodySide[] } | null = null
  private readonly majors: number[] = []
  private readonly formTimes = new Map<SpeechGestureForm, number>()
  private armForm: { side: BodyGestureHand, form: BodyArmForm } | null = null
  /** The arm followers' tension this tick (`PerformanceContext.tension`), which every segment's feedforward inverts. */
  private tension = 0
  private readonly scratch = pose()

  constructor(private readonly traits: BodyRigTraits, private readonly seed: number) {
    this.random = createRandomStream(deriveSeed(seed, 140))
    this.corrections = createRandomStream(deriveSeed(seed, 141))
    this.phrases = createRandomStream(deriveSeed(seed, 142))
    this.reset()
  }

  /** A unit is under way: its strokes carry the head beat, so Natural's emphasis nod leaves the head (one posture). */
  get performing(): boolean {
    return this.unit.active
  }

  reset(): void {
    this.random = createRandomStream(deriveSeed(this.seed, 140))
    this.corrections = createRandomStream(deriveSeed(this.seed, 141))
    this.phrases = createRandomStream(deriveSeed(this.seed, 142))
    this.dominant = this.random() < 0.85 ? 'right' : 'left'
    this.keys = null
    this.tick = -1
    this.unit = { active: false, sides: [], twoHand: false, drive: 0.5, start: 0, strokes: 0, retracting: false, bySpeech: false, leaning: false }
    this.phrase = null
    this.phraseStrokes = 0
    this.phraseSet = false
    this.body.reset()
    this.bodyAdditive.fill(0)
    this.shift = null
    this.lastOnset = this.lastEmphasis = 0
    this.wasSpeaking = false
    this.speechEnded = -Infinity
    this.quiet = 0
    this.lastStroke = this.refractoryEnd = -Infinity
    this.deferred = null
    this.handover = null
    this.majors.length = 0
    this.formTimes.clear()
    this.armForm = null
    Object.assign(this.report, { unitSeq: 0, strokeSeq: 0, form: null, hand: null, phase: 'rest', plannedHit: null })
    for (const side of SIDES)
      this.tracks[side].reset()
  }

  update(context: PerformanceContext): void {
    if (context.tick === this.tick)
      return
    this.tick = context.tick
    this.keys ??= new GestureKeys(this.traits, context.rest)
    const { input } = context
    const now = context.time
    const voice = input.voice
    this.tension = context.tension
    const onset = voice.onsetSeq !== this.lastOnset
    const major = onset && voice.emphasis !== null && voice.emphasis.seq !== this.lastEmphasis
    this.lastOnset = voice.onsetSeq
    if (voice.emphasis)
      this.lastEmphasis = voice.emphasis.seq
    const speakingEdge = voice.speaking && !this.wasSpeaking
    if (!voice.speaking && this.wasSpeaking)
      this.speechEnded = now
    this.wasSpeaking = voice.speaking
    this.quiet = voice.slow < VOICE.quiet ? this.quiet + BODY_TICK : 0

    for (const side of SIDES)
      this.yieldOwned(side, context, now)
    this.performArmForm(context, now)

    // A pause leaves the wait alone: the quiet rule decides whether hands hold through it.
    for (const side of SIDES) {
      const track = this.tracks[side]
      track.waited = track.state !== 'ready' && track.state !== 'lean' ? 0 : track.waited + (this.quiet === 0 ? BODY_TICK : 0)
    }
    const unit = this.unit
    if (this.deferred && (!unit.active || unit.retracting || now - this.deferred.at > RISE.defer))
      this.deferred = null
    if (unit.active && !unit.retracting) {
      // A phrase is endless exactly while she walks. A walk that starts mid-phrase keeps the phrase going endless, and
      // an arrival ends the walk's phrase at its next hold; either way the body eases to the new gait's phrase hold.
      const walking = input.gait !== null && input.gait.mode !== 'idle'
      if (this.phrase && walking === Number.isFinite(this.phrase.length)) {
        this.phrase = { ...this.phrase, length: walking ? Infinity : this.phraseStrokes }
        // Hands that only lean have not taken the body's hold; it comes as they rise (`riseFor`).
        if (!unit.leaning)
          this.aimBody(context, now, Math.max(TIMING.exit, ...unit.sides.map(side => this.tracks[side].prepSeconds)))
      }
      const ended = !voice.speaking && now - this.speechEnded >= TIMING.afterSpeech
      const capped = (unit.strokes >= TIMING.unitStrokes && now - this.lastStroke >= 0.6) || now - unit.start >= TIMING.unitSeconds
      const holding = unit.drive >= TIMING.holdDrive
      // A hand rising into a stroke it owes strokes first (`RISE`); only a performer that may not gesture drops it.
      const owed = this.deferred !== null && this.performable(input)
      const waited = unit.sides.filter(side => this.tracks[side].waited >= RISE.settle)
      if (!owed && (ended || this.quiet >= TIMING.quiet + (holding ? TIMING.quietHold * unit.drive : 0) || capped || waited.length === unit.sides.length || !this.performable(input)))
        this.retract(context, now, ended || !voice.speaking)
      // One hand of two waits while the other strokes alone: it lets go, and the unit goes on with the hand that speaks.
      else if (waited.length)
        this.letGo(context, now, waited)
      // Walking keeps its one endless beat phrase.
      else if (holding && this.quiet >= TIMING.quiet && this.phrase && Number.isFinite(this.phrase.length) && this.phraseStrokes > 0 && !this.handover && unit.sides.every(side => this.tracks[side].state === 'ready'))
        this.nextPhrase(context, now)
    }
    // A unit opened on this tick's onset owes that onset its stroke (`startUnit`).
    if (!unit.active && (speakingEdge || (voice.speaking && onset)) && now >= this.refractoryEnd && this.performable(input))
      this.startUnit(context, now, onset, major, speakingEdge)
    else if (unit.active && !unit.retracting && onset)
      this.stroke(context, now, major)
    else if (this.deferred && unit.active && !unit.retracting)
      this.strokeDeferred(context, now)

    for (const side of SIDES)
      this.step(this.tracks[side], context, now)
    if (unit.active && unit.sides.every(side => !this.tracks[side].active || this.tracks[side].state === 'form')) {
      unit.active = false
      // Hands that only leaned have not gestured: the next stroking onset may raise them at once.
      if (unit.leaning)
        this.refractoryEnd = now
      else
        this.refractoryEnd = now + (unit.bySpeech ? TIMING.refractoryBase + TIMING.refractorySpan * (1 - unit.drive) : TIMING.pauseBase + TIMING.pauseSpan * (1 - unit.drive))
    }
    this.body.advance(now)
    this.body.write(this.bodyAdditive, freeShare(input.owned.head))
    if (this.shift && now >= this.shift.until)
      this.shift = null
    this.report.phase = this.phase()
  }

  /** Not while listening, sleepy, resting or asleep (4a), and only standing or sitting. */
  private performable(input: BodyPerformanceInput): boolean {
    const sleepy = input.held.emotion === 'sleepy' && input.held.level * input.held.strength > 0.5
    return input.energy.mode !== 'listening' && !sleepy && input.directive.rest === 'none' && input.directive.stance !== 'sleep'
  }

  private free(side: BodySide, input: BodyPerformanceInput, context: PerformanceContext): boolean {
    return context.capabilities.gestures[side]
      && input.owned[`${side}Arm`] === 0
      && input.owned[`${side}Fingers`] === 0
      && !this.tracks[side].active
  }

  /** A clip claiming a performing arm ends that arm's part at once, its weight gone before the claim reaches 0.5. */
  private yieldOwned(side: BodySide, context: PerformanceContext, now: number): void {
    const { input } = context
    const track = this.tracks[side]
    const owned = Math.max(input.owned[`${side}Arm`], input.owned[`${side}Fingers`])
    if (!track.active || owned === 0 || track.weight === 0)
      return
    track.exitSeconds = TIMING.cancel
    track.weight = 0
    track.dropAt = now
    track.phaseEnd = now + TIMING.cancel
    track.state = 'retraction'
    track.pending = null
    track.leaning = false
    track.correctAt = Infinity
    track.viaReady = false
    track.settle = false
    // A clip taking one hand of a held two-hand form leaves the other holding it.
    if (this.armForm?.side === 'both')
      this.armForm = { side: side === 'left' ? 'right' : 'left', form: this.armForm.form }
    else if (this.armForm?.side === side)
      this.armForm = null
    // A two-handed unit goes on with the hand it still has: its lead and its phase follow that arm from here.
    const unit = this.unit
    if (unit.active && unit.sides.length > 1 && unit.sides.includes(side)) {
      unit.sides = unit.sides.filter(other => other !== side)
      unit.twoHand = false
      // That hand takes the thought on: its wait at the ready key starts again (`RISE`).
      for (const other of unit.sides)
        this.tracks[other].waited = 0
    }
    // A clip taking the unit's last hand ends the unit: a hand leaning in to take the thought over goes home, and the
    // body lets its phrase hold go.
    else if (unit.active && !unit.retracting && unit.sides.includes(side)) {
      this.retract(context, now, false)
    }
  }

  /**
   * Holds the requested arm form. A two-hand form (`both`) starts only when both arms are free and both keys solve,
   * and both arms travel for the longer of their two preparations, so the hands meet together. A request for one side
   * of a held two-hand form lets the other hand go and keeps that one where it is (4e act 6: one hand releases first).
   * A form that follows another (`after`: the hair tuck's sweep) is reached from that form's held key without going
   * home, and never starts on its own.
   */
  private performArmForm(context: PerformanceContext, now: number): void {
    const request = context.plan.armForm
    const held = this.armForm
    const sidesOf = (hand: BodyGestureHand): readonly BodySide[] => hand === 'both' ? SIDES : [hand]
    if (held && request && held.side === 'both' && request.side !== 'both' && request.form === held.form) {
      const other = this.tracks[request.side === 'left' ? 'right' : 'left']
      if (other.state === 'form')
        this.retractTrack(other, now)
      this.armForm = { side: request.side, form: request.form }
    }
    else if (held && request && held.side !== 'both' && request.side === held.side && ARM_FORMS[request.form].after === held.form && this.followOn(held.side, request.form, context, now)) {
      this.armForm = { side: request.side, form: request.form }
    }
    else if (held && (!request || request.side !== held.side || request.form !== held.form)) {
      for (const side of sidesOf(held.side)) {
        const track = this.tracks[side]
        if (track.state === 'form')
          this.retractTrack(track, now)
      }
      this.armForm = null
    }
    if (!request || this.armForm || !this.keys || ARM_FORMS[request.form].after)
      return
    const sides = sidesOf(request.side)
    if (!sides.every(side => this.free(side, context.input, context)))
      return
    for (const side of sides) {
      const track = this.tracks[side]
      this.captureHome(track, context)
      track.key.set(track.home)
      writeArmFormHand(request.form, side, track.key)
      if (!this.keys.armForm(side, request.form, track.key))
        return
    }
    const travel = Math.max(...sides.map(side => this.travel(side, this.tracks[side].home, this.tracks[side].key)))
    for (const side of sides) {
      const track = this.tracks[side]
      this.begin(track, now)
      const seconds = (0.25 + 0.35 * travel) / gestureTempo(context.input.energy.level)
      // The hair tuck's hand comes up in front of the chest on its way to the temple (`GestureKeys.tuckVia`).
      track.prepSeconds = this.tuckVia(track, request.form)
        ? track.through(track.tuckVia, track.key, now, seconds, this.tension, false)
        : track.move(track.key, now, seconds, this.tension)
      track.state = 'form'
      track.form = request.form
      track.phaseEnd = Infinity
    }
    this.armForm = { side: request.side, form: request.form }
  }

  /** Moves a held form's arm on to `form`'s key from wherever its plan is; false when the arm is not holding or the key does not solve. */
  private followOn(side: BodySide, form: BodyArmForm, context: PerformanceContext, now: number): boolean {
    const track = this.tracks[side]
    if (track.state !== 'form' || !this.keys)
      return false
    const key = track.key.slice()
    writeArmFormHand(form, side, key)
    if (!this.keys.armForm(side, form, key))
      return false
    const travel = this.travel(side, track.key, key)
    track.key.set(key)
    track.release(track.key, now, (0.25 + 0.35 * travel) / gestureTempo(context.input.energy.level), this.tension)
    track.form = form
    return true
  }

  private startUnit(context: PerformanceContext, now: number, onset: boolean, major: boolean, edge: boolean): void {
    const { input } = context
    const drive = gestureDrive(input.energy.level, input.mood)
    // A calm speaker lets most of an utterance pass: the unit waits for an emphasis or a loud onset.
    const stirred = onset && (major || input.voice.level >= this.peakFloor(drive))
    if (drive < CALM.drive && !stirred)
      return
    // Past the speaking edge the hands rise only for an onset they will stroke, and a weaker one leans them (`RISE`).
    const lean = !edge && !this.strikes(input, major, drive)
    const walking = input.gait !== null && input.gait.mode !== 'idle'
    const free = SIDES.filter(side => this.free(side, input, context))
    if (!free.length || !this.keys)
      return
    const twoHand = !walking && free.length === 2 && this.random() < 0.15 + 0.25 * drive
    const other: BodySide = this.dominant === 'left' ? 'right' : 'left'
    const preferred = this.random() < 0.7 ? this.dominant : other
    const first = free.includes(preferred) ? preferred : free[0]
    // A hand whose ready key does not clear from where it hangs leaves a one-hand phrase to the other free hand.
    const choices: BodySide[][] = twoHand ? [[...SIDES]] : [[first], ...free.filter(side => side !== first).map(side => [side])]
    // Walking keeps 4a's single beat phrase at the centre; standing, each unit opens a phrase of its own.
    const phrase = walking ? { sides: choices[0], place: 'centre' as const, theme: 'beat' as const, length: Infinity } : drawPhrase(this.phrases, drive, choices[0], this.phrase)
    let started: BodySide[] = []
    for (const sides of choices) {
      started = sides.filter((side) => {
        this.captureHome(this.tracks[side], context)
        return this.placeAt(this.tracks[side], drive, phrase, sides.length === 2, null)
      })
      if (started.length)
        break
    }
    if (!started.length)
      return
    for (const side of started) {
      const track = this.tracks[side]
      this.begin(track, now)
      if (lean) {
        this.lean(track, now, gestureTempo(drive))
        continue
      }
      track.prepSeconds = track.transit(track.ready, now, (0.25 + 0.35 * this.travel(side, track.home, track.ready)) / gestureTempo(drive), this.tension, this.correct())
      track.state = 'preparation'
      track.phaseEnd = now + track.prepSeconds
    }
    this.unit = { active: true, sides: started, twoHand: started.length === 2, drive, start: now, strokes: 0, retracting: false, bySpeech: false, leaning: lean }
    this.handover = null
    this.phrase = { ...phrase, sides: started }
    this.phraseStrokes = 0
    this.phraseSet = false
    // 4a's quiet rule reads the utterance, not the silence before it: Natural's slow envelope rises after the edge.
    this.quiet = 0
    this.report.unitSeq++
    this.report.form = null
    this.report.plannedHit = null
    this.report.hand = started.length === 2 ? 'both' : started[0]
    // Leaning hands leave the body where it is; it takes the phrase's hold as they rise (`riseFor`).
    if (!lean)
      this.aimBody(context, now, Math.max(...started.map(side => this.tracks[side].prepSeconds)))
    if (onset)
      this.stroke(context, now, major)
  }

  /** Starts `track`'s preparation to its lean (`LEAN`) from rest, over the time its whole preparation would take. */
  private lean(track: ArmTrack, now: number, tempo: number): void {
    const lean = this.scratch
    for (let j = 0; j < 26; j++)
      lean[j] = track.home[j] + LEAN.share * (track.ready[j] - track.home[j])
    const seconds = (0.25 + 0.35 * this.travel(track.side, track.home, track.ready)) / tempo
    track.phaseEnd = now + track.move(lean, now, seconds, this.tension)
    track.prepSeconds = seconds
    track.state = 'preparation'
    track.leaning = true
  }

  /**
   * Takes a leaning arm the rest of the way to its ready key at its whole preparation's pace, in the share of that
   * preparation's time the lean left. Its `prepSeconds` stay the whole way's, which its retraction scales.
   */
  private rise(track: ArmTrack, now: number): void {
    track.leaning = false
    track.phaseEnd = now + track.transit(track.ready, now, (1 - LEAN.share) * track.prepSeconds, this.tension, this.correct())
    track.state = 'preparation'
  }

  /**
   * Raises the hands that leaned for a stress (`RISE`) on a stroking onset: the phrase that waited for one begins, its
   * joining hand rising, and the hands of a unit that a weak onset opened rise to their ready keys. On the unit's last
   * stroke the waiting phrase does not begin: its joining hand would rise with nothing to stroke, so it goes home.
   */
  private riseFor(context: PerformanceContext, now: number): void {
    const unit = this.unit
    const handover = this.handover
    if (handover && unit.strokes + 1 >= TIMING.unitStrokes) {
      for (const side of handover.joining) {
        if (this.tracks[side].leaning)
          this.retractTrack(this.tracks[side], now)
      }
    }
    else if (handover) {
      this.beginPhrase(context, now, handover.phrase, handover.joining.filter(side => this.tracks[side].leaning))
    }
    this.handover = null
    if (!unit.leaning)
      return
    unit.leaning = false
    for (const side of unit.sides) {
      if (this.tracks[side].leaning)
        this.rise(this.tracks[side], now)
    }
    this.aimBody(context, now, Math.max(...unit.sides.map(side => this.tracks[side].phaseEnd - now)))
  }

  /**
   * At the end of a phrase in continuous speech: a calm speaker may lower the hands (`retractShare`); otherwise the
   * next phrase takes its hands (`nextHands`) to a new place with a new theme. A hand that goes on prepares again from
   * where it is, a joining hand from its rest, a hand that leaves retracts; the unit goes on without a new marker. A
   * phrase that hands the thought over to the other hand alone waits for the next stroking onset while that hand
   * leans (`RISE`).
   */
  private nextPhrase(context: PerformanceContext, now: number): void {
    const { input } = context
    const unit = this.unit
    const current = this.phrase
    // A unit that has played its last stroke lowers its hands: a new phrase would raise a hand with nothing to stroke (`RISE`).
    if (!current || unit.strokes >= TIMING.unitStrokes || this.phrases() < retractShare(unit.drive)) {
      this.retract(context, now, false)
      return
    }
    const free = SIDES.filter(side => unit.sides.includes(side) || this.free(side, input, context))
    const drawn = nextHands(this.phrases, unit.drive, unit.sides, free, this.dominant)
    const phrase = drawPhrase(this.phrases, unit.drive, drawn, current)
    // A joining hand first needs a clear ready key on this rig, with no set hand until the new phrase's own theme
    // stroke; where none solves, the hands that gestured go on.
    const joining = drawn.filter(side => !unit.sides.includes(side)).filter((side) => {
      const track = this.tracks[side]
      this.captureHome(track, context)
      return this.placeAt(track, unit.drive, phrase, drawn.length === 2, null, null)
    })
    if (!joining.length) {
      this.beginPhrase(context, now, phrase, joining)
      return
    }
    for (const side of joining) {
      this.begin(this.tracks[side], now)
      this.lean(this.tracks[side], now, gestureTempo(unit.drive))
    }
    this.handover = { phrase, joining }
  }

  /**
   * Starts `phrase` in the unit: a hand that goes on prepares again from where it is to the new place, a joining hand
   * prepares from its rest or rises from its lean, and a hand the phrase leaves out retracts.
   */
  private beginPhrase(context: PerformanceContext, now: number, phrase: GesturePhrase, joining: readonly BodySide[]): void {
    const unit = this.unit
    const drawn = phrase.sides
    const twoHand = drawn.length === 2
    const tempo = gestureTempo(unit.drive)
    // The new phrase's ready keys take no set hand until its own theme stroke.
    this.phraseSet = false
    const going = drawn.filter(side => unit.sides.includes(side))
    const sides = going.length || joining.length ? [...going, ...joining] : [...unit.sides]
    for (const side of SIDES) {
      const track = this.tracks[side]
      if (!sides.includes(side)) {
        if (unit.sides.includes(side) && track.active && track.state !== 'retraction' && track.state !== 'form')
          this.retractTrack(track, now)
        continue
      }
      if (unit.sides.includes(side)) {
        track.pending = null
        track.settle = false
        const from = track.planned.slice()
        const placed = this.placeAt(track, unit.drive, phrase, twoHand, from)
        const seconds = placed ? (0.25 + 0.35 * this.travel(side, from, track.ready)) / tempo : TIMING.recovery / tempo
        // A hand carried on into a new phrase homes in on its new place: a corrected transition whenever the followers
        // take it, so the stream's draw is kept for the hands that open a unit.
        track.prepSeconds = track.transit(track.ready, now, seconds, this.tension, placed)
        track.state = placed ? 'preparation' : 'recovery'
        track.phaseEnd = now + track.prepSeconds
      }
      else if (track.leaning) {
        this.rise(track, now)
      }
      else {
        this.begin(track, now)
        track.prepSeconds = track.transit(track.ready, now, (0.25 + 0.35 * this.travel(side, track.home, track.ready)) / tempo, this.tension, true)
        track.state = 'preparation'
        track.phaseEnd = now + track.prepSeconds
      }
    }
    unit.sides = sides
    unit.twoHand = sides.length === 2
    this.phrase = { ...phrase, sides }
    this.phraseStrokes = 0
    this.report.hand = sides.length === 2 ? 'both' : sides[0]
    this.aimBody(context, now, Math.max(...sides.map(side => this.tracks[side].phaseEnd - now)))
  }

  /** A side's ready offset in `phrase`: its place, and the second hand of a two-hand phrase swung out a little further (4a). */
  private placeOffset(phrase: GesturePhrase, side: BodySide, twoHand: boolean): ReadyOffset {
    const place = GESTURE_PLACES[phrase.place]
    return twoHand && side !== this.dominant ? addOffsets(place, { ...NO_OFFSET, swivel: AMPLITUDE.nonDominantSwivel }) : place
  }

  /**
   * Places the ready key at the phrase's place, or at the centre where that place has no clear key on this rig, with
   * the hand `theme` has set (`SET`): the current phrase's unless given. A hand already up goes there from `via`, where
   * it is, along a path that clears a settled key's headroom: its followers lag its plan, so on its way it leaves the
   * angle path it was cleared on. A path cleared to the margin let the arm reach into the margin, and the corrector
   * stopped it at 30 deg/s (Ellen, `speak` seed 1: a new phrase's preparation from a hold that a stroke from a sinking
   * hand had lowered). Where neither place clears so, the hand keeps its ready key.
   */
  private placeAt(track: ArmTrack, drive: number, phrase: GesturePhrase, twoHand: boolean, via: ArmPose | null, theme = this.setTheme()): boolean {
    return this.placeReady(track, drive, this.placeOffset(phrase, track.side, twoHand), via, theme, KEY_HEADROOM)
      || (phrase.place !== 'centre' && this.placeReady(track, drive, this.placeOffset({ ...phrase, place: 'centre' }, track.side, twoHand), via, theme, KEY_HEADROOM))
  }

  /**
   * Solves the ready key at `offset` from the arm's home with the headroom of a key the arm settles on, the phrase's set
   * hand turn applied (`SET`), and with `via` also the path from there, by `wayHeadroom` past the margin. Where no
   * reachable key clears the headroom (Ellen's low ready keys sit between her skirt colliders below energy 0.85), the
   * key that clears the margin is used, so the unit still starts. False, with the ready key unchanged, when neither
   * clears.
   */
  private placeReady(track: ArmTrack, drive: number, offset: ReadyOffset, via: ArmPose | null, theme = this.setTheme(), wayHeadroom = 0): boolean {
    const keys = this.keys
    if (!keys)
      return false
    const base = keys.readyKey(drive, offset)
    const spec = theme ? GESTURE_FORMS[theme] : null
    const key: ArmKey = spec ? { ...base, pron: base.pron + SET.share * (spec.pron - base.pron), wflex: SET.share * spec.wflex, wdev: SET.share * spec.wdev } : base
    const candidate = this.scratch
    for (const headroom of [KEY_HEADROOM, 0]) {
      candidate.set(track.home)
      if (spec)
        writeHandShare(spec.shape, SET.hand * spec.shapeShare, candidate)
      else
        writeHandShare(READY_HAND.shape, READY_HAND.share, candidate)
      if (keys.solve(track.side, key, candidate, track.home, headroom) && (!via || keys.pathDepth(track.side, via, candidate, wayHeadroom) === 0)) {
        track.ready.set(candidate)
        track.readyKey = key
        return true
      }
    }
    return false
  }

  /** The theme that has set the current phrase's hand, or null before its theme stroke and in a beat phrase. */
  private setTheme(): SpeechGestureForm | null {
    return this.phraseSet && this.phrase && this.phrase.theme !== 'beat' ? this.phrase.theme : null
  }

  /** A calm speaker's stroke threshold (`CALM`): the S2 peak rule raised toward `VOICE.peak + CALM.floor` as drive falls to 0. */
  private peakFloor(drive: number): number {
    return VOICE.peak + CALM.floor * Math.max(0, CALM.drive - drive) / CALM.drive
  }

  /**
   * Aims the body's phrase hold (`BODY`) over `seconds`: the current phrase's while a unit gestures standing, rest
   * otherwise.
   */
  private aimBody(context: PerformanceContext, now: number, seconds: number): void {
    const target = this.bodyTarget.fill(0)
    const unit = this.unit
    const walking = context.input.gait !== null && context.input.gait.mode !== 'idle'
    if (unit.active && !unit.retracting && !walking && this.phrase) {
      const gain = gestureGain(unit.drive)
      const toward = unit.twoHand ? 0 : unit.sides[0] === 'left' ? 1 : -1
      const lean = BODY.lean * (unit.drive - BODY.leanFrom)
      const lively = 0.5 + 0.5 * unit.drive
      target[0] = toward * BODY.midYaw * gain
      target[1] = BODY.midLeanShare * lean
      target[2] = toward * BODY.upperYaw * gain
      target[3] = lean
      target[4] = toward * BODY.neckRoll * lively
      target[5] = toward * BODY.headRoll * lively
      const lift = BODY.placeLift[this.phrase.place] * gain
      SIDES.forEach((side, k) => {
        target[6 + k] = unit.sides.includes(side) ? lift : BODY.freeShoulder * gain
      })
    }
    this.body.aim(target, now, seconds)
  }

  /** Whether an onset strokes: the gate's S2 voice-peak rule, and for a calm speaker a louder voice unless it carries an emphasis (`CALM`). */
  private strikes(input: BodyPerformanceInput, major: boolean, drive: number): boolean {
    const { level, slow } = input.voice
    return level >= VOICE.peak && level - slow >= VOICE.prominence && (major || level >= this.peakFloor(drive))
  }

  private stroke(context: PerformanceContext, now: number, major: boolean): void {
    const { input } = context
    const unit = this.unit
    if (!this.strikes(input, major, unit.drive))
      return
    if (now - this.lastStroke < TIMING.strokeGap || unit.strokes >= TIMING.unitStrokes)
      return
    this.riseFor(context, now)
    const form = this.chooseForm(input, now, major, unit.twoHand)
    const lead = this.tracks[unit.twoHand ? this.dominant : unit.sides[0]]
    if (this.strokeReady(lead, now, GESTURE_FORMS[form].strokeSeconds / gestureTempo(unit.drive)) && this.prepared()) {
      this.deferred = null
      this.perform(context, now, form, major)
    }
    // A hand is still rising: the stroke leaves as soon as the preparations let it (`RISE`).
    else if (unit.sides.some(side => this.tracks[side].state === 'preparation')) {
      this.deferred = { at: now, form, major: major || (this.deferred?.major ?? false) }
    }
  }

  /** Plays an onset's stroke that waited for the hands' preparations (`RISE`), once they let it leave. */
  private strokeDeferred(context: PerformanceContext, now: number): void {
    const deferred = this.deferred
    const unit = this.unit
    if (!deferred || unit.strokes >= TIMING.unitStrokes)
      return
    const lead = this.tracks[unit.twoHand ? this.dominant : unit.sides[0]]
    if (!this.strokeReady(lead, now, GESTURE_FORMS[deferred.form].strokeSeconds / gestureTempo(unit.drive)) || !this.prepared())
      return
    this.deferred = null
    this.perform(context, now, deferred.form, deferred.major)
  }

  /** Starts the stroke of `form` on the unit's lead hand, and on the second hand when the form takes both. */
  private perform(context: PerformanceContext, now: number, form: SpeechGestureForm, major: boolean): void {
    const { input } = context
    const unit = this.unit
    const drive = unit.drive
    const tempo = gestureTempo(drive)
    // A two-hand stroke is led by the dominant hand, unless that hand has only just risen beside the other: then the hand
    // that was up leads, and the risen one, still carrying its rise, lands its 30 to 90 ms later.
    const other: BodySide = this.dominant === 'left' ? 'right' : 'left'
    const lead = !unit.twoHand ? unit.sides[0] : this.tracks[this.dominant].silent && !this.tracks[other].silent ? other : this.dominant
    const leadTrack = this.tracks[lead]
    const seconds = GESTURE_FORMS[form].strokeSeconds / tempo
    const walking = input.gait !== null && input.gait.mode !== 'idle'
    const amplitude = (major ? 1 : AMPLITUDE.minor) * (walking ? AMPLITUDE.walking : 1)
    const size = gestureGain(drive) * GESTURE_FORMS[form].scale * amplitude
    const lagging = this.tracks[lead === 'left' ? 'right' : 'left']
    // A hand that joined at a phrase change may still be on its way from rest: it joins the strokes once prepared, so
    // a two-hand stroke keeps its second hand's lag. A hand that has not stroked since it rose also takes a beat (`RISE`).
    const takes = GESTURE_FORMS[form].hands !== 'one' || (form === 'beat' && lagging.silent)
    const both = unit.twoHand && takes && this.strokeReady(lagging, now, seconds)
    const performed = this.strokeTrack(leadTrack, context, now, form, size)
    if (!performed)
      return
    // The report names the hands that stroke from the stroke's start: a two-hand unit's one-hand stroke strokes with one.
    this.report.hand = both ? 'both' : lead
    if (both) {
      if (lagging.active && lagging.state !== 'retraction' && lagging.state !== 'form') {
        const lag = TIMING.lagRange[0] + (TIMING.lagRange[1] - TIMING.lagRange[0]) * this.random()
        // The second hand plays the same stroke (4a), hold included: with a hold of its own it would recover at another
        // time, and the next two-hand stroke would find one hand resting and the other still on its way back.
        lagging.pending = { at: now + lag, form: performed, size: size * AMPLITUDE.nonDominant, hold: leadTrack.holdSeconds, corrected: leadTrack.recoveryCorrected }
      }
    }
    const sign = lead === 'left' ? 1 : -1
    const forward = GESTURE_FORMS[performed].stroke[2] > 0
    const down = GESTURE_FORMS[performed].stroke[1] <= -0.1
    const gain = gestureGain(drive) * amplitude
    const nod = HEAD_BEAT.degrees * amplitude * (input.gaze.kind === 'free' ? 1 : HEAD_BEAT.heldGaze)
    leadTrack.accents.push({ start: now, hit: now + GESTURE_FORMS[performed].strokeSeconds / tempo, yaw: sign * AMPLITUDE.torsoYaw * gain, pitch: forward ? AMPLITUDE.torsoPitch * gain : 0, landing: leadTrack.phaseEnd, nod, lift: (down ? AMPLITUDE.shoulderPress : AMPLITUDE.shoulderLift) * gain })
    unit.strokes++
    this.phraseStrokes++
    if (performed === this.phrase?.theme)
      this.phraseSet = true
    this.lastStroke = now
    if (major)
      this.majors.push(now)
    this.formTimes.set(performed, now)
    leadTrack.watch = { form: performed, hand: both ? 'both' : lead, peak: 0, speed: 0, wrist: null, until: now + seconds + 0.3, after: now + 0.75 * (leadTrack.phaseEnd - now) }
  }

  /**
   * Whether a two-hand stroke that takes along a hand that has not stroked since it rose (`perform`) can leave: only once
   * every hand of the unit has prepared. Cutting a rise that had just begun, the hands' apexes fell together instead of
   * 30 to 90 ms apart.
   */
  private prepared(): boolean {
    const unit = this.unit
    return !unit.twoHand || !unit.sides.some(side => this.tracks[side].silent) || unit.sides.every(side => this.tracks[side].state !== 'preparation')
  }

  /** A stroke leaves from the ready key, a hold or a recovery; from a preparation only if it would end first. */
  private strokeReady(track: ArmTrack, now: number, seconds: number): boolean {
    if (track.state === 'ready' || track.state === 'hold' || track.state === 'recovery' || track.state === 'stroke')
      return true
    return track.state === 'preparation' && !track.leaning && track.phaseEnd - now <= seconds
  }

  /**
   * Solves and starts one arm's stroke; returns the form performed (a beat when the chosen form has no clear key). The
   * post-stroke hold and whether the recovery after it is corrected are drawn, or `hold` and `corrected` given when the
   * stroke is a two-hand stroke's second hand.
   */
  private strokeTrack(track: ArmTrack, context: PerformanceContext, now: number, form: SpeechGestureForm, size: number, hold?: number, corrected?: boolean): SpeechGestureForm | null {
    const keys = this.keys
    if (!keys)
      return null
    const tempo = gestureTempo(this.unit.drive)
    const second = this.unit.twoHand && track.side !== this.dominant
    const theme = this.setTheme()
    const key = track.readyKey ?? keys.readyKey(this.unit.drive)
    // A sinking hand (`SINK`) strokes from where it is: the stroke's key comes down as far as the wrist has, so the beat
    // keeps most of its size. Moved in and back with the wrist as well, the key asked a palm-up stroke's elbow for 4 % more turn.
    const origin = track.state === 'ready' && track.settle ? track.planned.slice() : track.ready
    // Where no form's lowered key clears the body, the stroke rises to its ready key's.
    const sunk = keys.wrist(track.side, origin)[1] - keys.wrist(track.side, track.ready)[1]
    const bases: ArmKey[] = sunk === 0 ? [key] : [{ ...key, hand: [key.hand[0], key.hand[1] + sunk, key.hand[2]] }, key]
    const forms = form === 'beat' ? ['beat'] as const : [form, 'beat'] as const
    for (const [base, candidate] of bases.flatMap(base => forms.map(candidate => [base, candidate] as const))) {
      const ready = candidate === 'frame' ? { ...base, hand: [base.hand[0] + 0.1, base.hand[1], base.hand[2]] as const } : base
      const yaw = candidate === 'point' ? this.pointYaw(context.input, track.side) : 0
      // A beat takes the path after its hand's last beat's (`BEAT_PATHS`).
      const beatPath = (track.beatPath + 1) % BEAT_PATHS.length
      const path = candidate === 'beat' ? BEAT_PATHS[beatPath] : GESTURE_FORMS[candidate].stroke
      // Post-stroke hold: the hand drifts 1.5 % A further along the stroke, so the stroke's end is where the arm ends up.
      // That end is the pose cleared against the proxies; the key lies on the cleared path from the ready key, short of it.
      const drift = AMPLITUDE.drift / Math.hypot(...path)
      // A set phrase's beat keeps the theme's palm and lands with its full hand (`SET`).
      const setBeat = theme !== null && candidate === 'beat'
      track.drift.set(track.ready)
      writeFormHand(setBeat ? theme : candidate, track.drift)
      // A share of the way as a static mix of the two shapes, not a moment on the closing path (`blendHand`).
      if (second) {
        for (let j = 9; j < 26; j++)
          track.drift[j] += AMPLITUDE.nonDominantHand * (relaxedHand[j] - track.drift[j])
      }
      const strokeKey = keys.strokeKey(ready, candidate, size + drift, yaw, path)
      // The path is cleared from where the arm is: a stroke may cut a recovery short, and a recovery now goes to a
      // floated ready key, so the hold it left and the ready key may both lie off the stroke's straight way.
      const aimed = setBeat ? { ...strokeKey, pron: ready.pron, wflex: ready.wflex + SET.beatFlex, wdev: ready.wdev } : strokeKey
      const from = track.planned
      const start = track.drift.slice()
      if (!keys.solve(track.side, aimed, track.drift, from, KEY_HEADROOM)) {
        track.drift.set(start)
        if (!keys.solve(track.side, aimed, track.drift, from))
          continue
      }
      if (candidate === 'beat')
        track.beatPath = beatPath
      track.silent = false
      track.settle = false
      track.key.set(track.drift)
      for (let j = 2; j <= 5; j++)
        track.key[j] = origin[j] + (track.drift[j] - origin[j]) * size / (size + drift)
      // Through the hold the fingers ease part of the way back toward the ready hand; the recovery opens them fully.
      for (let j = 9; j < 26; j++)
        track.drift[j] += HOLD_SOFTEN * (track.ready[j] - track.drift[j])
      const seconds = GESTURE_FORMS[candidate].strokeSeconds / tempo
      const [low, high] = GESTURE_FORMS[candidate].hold
      // A second hand draws as well, so the stream's later choices (forms, hands, lags) do not depend on its hold.
      const drawn = (low + (high - low) * this.random()) / tempo
      const holdSeconds = hold ?? drawn
      // 4a: the hit lands at the stroke's duration. Feedforward removes the followers' lag and the fed joints take no
      // cascade link, so the wrist lands as the profile ends. A stroke the followers cannot take that fast lasts longer
      // (`move`).
      const profile = track.move(track.key, now, seconds, this.tension)
      track.state = 'stroke'
      track.form = candidate
      track.phaseEnd = now + profile
      track.holdSeconds = holdSeconds
      track.recoveryCorrected = corrected ?? this.correct()
      return candidate
    }
    return null
  }

  private chooseForm(input: BodyPerformanceInput, now: number, major: boolean, twoHand: boolean): SpeechGestureForm {
    if (input.gait !== null && input.gait.mode !== 'idle')
      return 'beat'
    const fresh = (form: SpeechGestureForm) => now - (this.formTimes.get(form) ?? -Infinity) >= TIMING.formRepeat
    while (this.majors.length && now - this.majors[0] > TIMING.chopWindow)
      this.majors.shift()
    const r = this.random()
    const pick = this.random()
    const candidates: SpeechGestureForm[] = []
    // A themed phrase opens with its theme and then beats in the hand the theme set; chops and points still break in.
    const theme = this.phrase?.theme ?? 'beat'
    const themed = theme !== 'beat'
    if (themed && !this.phraseSet && (theme !== 'frame' || twoHand))
      candidates.push(theme)
    if (!themed && this.phraseStrokes === 0 && r < 0.5)
      candidates.push('palm-up')
    if (major && this.majors.length >= 1)
      candidates.push('chop')
    if (input.gaze.kind === 'sustained')
      candidates.push('point')
    if (!themed && twoHand && this.unit.drive > 0.6 && r < 0.5)
      candidates.push('frame')
    const press = FORM_SHARE.press + FORM_SHARE.pressEnergy * this.unit.drive
    candidates.push(themed ? 'beat' : pick < FORM_SHARE.palmUp ? 'palm-up' : pick < FORM_SHARE.palmUp + press ? 'press' : 'beat')
    return candidates.find(form => form === 'beat' || fresh(form)) ?? 'beat'
  }

  /** One draw per transition from the corrections' own stream: whether it carries a corrective submovement. */
  private correct(): boolean {
    return this.corrections() < CORRECTION.share
  }

  /** Point yaws toward the gaze goal, at most 30 degrees, measured from straight ahead of the body. */
  private pointYaw(input: BodyPerformanceInput, side: BodySide): number {
    const yaw = Math.max(-30 * DEG, Math.min(30 * DEG, input.gaze.yaw - input.facingYaw))
    return side === 'left' ? yaw : -yaw
  }

  /**
   * Watches the lead arm's stroke on its actual output, the previous frame, and reports the stroke at the first wrist
   * speed minimum after the stroke's own speed peak that is at most half of it: the gesture report's apex rule. A
   * stroke that shows no apex in time is not reported.
   */
  private observe(track: ArmTrack, context: PerformanceContext, now: number): void {
    const watch = track.watch
    if (!watch || !this.keys)
      return
    const start = ARM_START[track.side]
    for (let j = 0; j < 26; j++)
      this.scratch[j] = context.previous.channels[start + j]
    const wrist = this.keys.wrist(track.side, this.scratch)
    const speed = watch.wrist ? Math.hypot(wrist[0] - watch.wrist[0], wrist[1] - watch.wrist[1], wrist[2] - watch.wrist[2]) : 0
    watch.wrist = wrist
    if (watch.peak > 0 && speed > watch.speed && watch.speed <= 0.5 * watch.peak && now >= watch.after) {
      this.report.strokeSeq++
      this.report.form = watch.form
      this.report.hand = watch.hand
      // The previous frame carried the slowest sample; it was produced one tick before this one.
      this.report.plannedHit = now - 2 * BODY_TICK
      track.watch = null
      return
    }
    watch.peak = Math.max(watch.peak, speed)
    watch.speed = speed
    if (now > watch.until)
      track.watch = null
  }

  /** Writes the hair tuck's via between `track`'s home and key when `form` is a tuck and its way through clears. */
  private tuckVia(track: ArmTrack, form: BodyArmForm): boolean {
    return ARM_FORMS[form].seed === 'tragion' && this.keys !== null && this.keys.tuckVia(track.side, track.home, track.key, track.tuckVia)
  }

  /** Lowers `sides`, hands of the unit that waited at their ready keys (`RISE`), and goes on with the others. */
  private letGo(context: PerformanceContext, now: number, sides: readonly BodySide[]): void {
    const unit = this.unit
    for (const side of sides)
      this.retractTrack(this.tracks[side], now)
    unit.sides = unit.sides.filter(side => !sides.includes(side))
    unit.twoHand = unit.sides.length === 2
    if (this.phrase)
      this.phrase = { ...this.phrase, sides: unit.sides }
    this.report.hand = unit.twoHand ? 'both' : unit.sides[0]
    this.aimBody(context, now, Math.max(TIMING.exit, ...sides.map(side => TIMING.retractionScale * this.tracks[side].prepSeconds)))
  }

  /**
   * Lowers the unit's hands. `bySpeech`: speaking ended (or the unit could not go on), so the long refractory follows;
   * otherwise speech goes on and the next unit may start sooner (`TIMING.pauseBase`). Standing, the weight may move to
   * the other foot as the hands come down (`SHIFT`).
   */
  private retract(context: PerformanceContext, now: number, bySpeech: boolean): void {
    const unit = this.unit
    unit.retracting = true
    unit.bySpeech = bySpeech
    for (const side of unit.sides) {
      const track = this.tracks[side]
      if (track.active && track.state !== 'retraction' && track.state !== 'form' && track.state !== 'stroke')
        this.retractTrack(track, now)
    }
    // A hand that leaned into the phrase that waited for a stress goes home too.
    for (const side of this.handover?.joining ?? []) {
      const track = this.tracks[side]
      if (track.active && track.state !== 'retraction' && track.state !== 'form')
        this.retractTrack(track, now)
    }
    this.handover = null
    const seconds = Math.max(...unit.sides.map(side => TIMING.retractionScale * this.tracks[side].prepSeconds), TIMING.exit)
    this.aimBody(context, now, seconds)
    const standing = context.input.directive.stance === 'stand' && (context.input.gait === null || context.input.gait.mode === 'idle')
    const shift = this.phrases()
    const away = context.previous.support === 0 ? (this.phrases() < 0.5 ? 1 : -1) : -Math.sign(context.previous.support)
    if (standing && shift < SHIFT.share)
      this.shift = { support: away * (SHIFT.magnitude + SHIFT.driveMagnitude * unit.drive), until: now + SHIFT.seconds }
  }

  /**
   * Returns the arm to where it was before the unit, 1.3 x its preparation. Only the paths through the ready key were
   * cleared: an arm in a stroke or hold first goes back to the ready key along its stroke, over the recovery time, an
   * arm in its recovery finishes it, and either goes home from there.
   *
   * The arm, a speech unit's or an emotion arm form's, comes to rest at home before its weight ramps out (`settle`).
   * The ramp hands the arm to the hang, whose target the corrector holds out of the body on rigs whose arms rest
   * against it; ramping while the arm still travelled carried it into that margin moving, and the corrector stopped it
   * in one tick (a velocity step).
   */
  private retractTrack(track: ArmTrack, now: number): void {
    track.leaning = false
    if (track.state === 'stroke' || track.state === 'hold' || track.state === 'recovery') {
      // A recovery is already the way back to the ready key: it goes on. Restarted as a new segment of full recovery
      // time, the plan's velocity carried the arm past the key, off the path the key was cleared on.
      if (track.state !== 'recovery')
        track.phaseEnd = now + track.transit(track.ready, now, TIMING.recovery / gestureTempo(this.unit.drive), this.tension, this.correct())
      track.state = 'retraction'
      track.pending = null
      track.viaReady = true
      track.dropAt = Infinity
      track.exitSeconds = TIMING.exit
      return
    }
    track.viaReady = false
    track.pending = null
    track.exitSeconds = TIMING.exit
    // A hand that has sunk through its whole wait goes on home in the time its sink, the current segment, had left (`SINK`).
    const falling = track.state === 'ready' && track.settle && track.waited >= RISE.settle
    track.settle = true
    const seconds = Math.max(TIMING.exit + BODY_TICK, falling ? track.segment.start + track.segment.durations[2] - now : TIMING.retractionScale * track.prepSeconds)
    // A speech unit's home leg may carry a corrective submovement (`transit`); an emotion arm form's way home stays one
    // plain segment and draws nothing from the corrections' stream, and the hair tuck's goes back the way it came.
    const form = track.state === 'form'
    const duration = form && track.form && isArmForm(track.form) && this.tuckVia(track, track.form)
      ? track.through(track.tuckVia, track.home, now, seconds, this.tension, true)
      : form ? track.release(track.home, now, seconds, this.tension) : track.transit(track.home, now, seconds, this.tension, this.correct())
    track.state = 'retraction'
    track.phaseEnd = now + duration
    track.dropAt = track.phaseEnd
  }

  private step(track: ArmTrack, context: PerformanceContext, now: number): void {
    if (track.pending && now >= track.pending.at) {
      const { form, size, hold, corrected } = track.pending
      track.pending = null
      this.strokeTrack(track, context, now, form, size, hold, corrected)
    }
    if (track.state === 'stroke' && now >= track.phaseEnd) {
      // The hit (4a): the planned profile has ended; the post-stroke hold drifts on from here.
      track.state = 'hold'
      track.holdEnd = now + track.move(track.drift, now, track.holdSeconds, this.tension)
      // A unit that retracted during the stroke lets it land first, so the way back starts from rest on its path.
      if (this.unit.retracting && this.unit.sides.includes(track.side))
        this.retractTrack(track, now)
    }
    this.observe(track, context, now)
    const unit = this.unit
    const lead = unit.twoHand ? this.dominant : unit.sides[0]
    // A phrase ends at its lead's hold end. A second hand still in its stroke would leave its feedforward behind if cut
    // there (a step in its followers' target), so the phrase then plays one stroke more and ends at the next hold.
    const settled = unit.sides.every(side => this.tracks[side].state === 'hold' || this.tracks[side].state === 'ready')
    if (track.state === 'hold' && now >= track.holdEnd && unit.active && !unit.retracting && track.side === lead && settled && this.phrase && this.phraseStrokes >= this.phrase.length) {
      this.nextPhrase(context, now)
    }
    if (track.state === 'hold' && now >= track.holdEnd) {
      // The elbow floats within the phrase's place: each recovery returns to a ready key of its own (`FLOAT`).
      if (this.phrase && unit.active && !unit.retracting) {
        const out = FLOAT.out * (2 * this.phrases() - 1)
        const lift = track.floatSign * (0.5 + 0.5 * this.phrases())
        const float = { out, up: FLOAT.up * lift, forward: -FLOAT.forward * lift, swivel: FLOAT.swivel * (2 * this.phrases() - 1) }
        track.floatSign = -track.floatSign
        this.placeReady(track, unit.drive, addOffsets(this.placeOffset(this.phrase, track.side, unit.twoHand), float), track.planned.slice())
      }
      track.state = 'recovery'
      track.phaseEnd = now + track.transit(track.ready, now, TIMING.recovery / gestureTempo(unit.drive), this.tension, track.recoveryCorrected)
    }
    else if ((track.state === 'recovery' || track.state === 'preparation') && now >= track.phaseEnd) {
      track.state = track.leaning ? 'lean' : 'ready'
    }
    // A ready hand sinks toward its hang until a stroke catches it or it lets go (`SINK`), once every channel has
    // arrived: the long sink would carry a forearm, wrist or finger turn still on its way on for a second.
    if (track.state === 'ready' && !track.settle && track.arrived(now)) {
      // `phaseEnd` stays at the arrival: a hand's phase end aims the body's phrase hold.
      track.move(track.home, now, SINK.seconds, this.tension)
      track.handWithin(RISE.settle)
      track.settle = true
    }
    const prepared = track.state === 'stroke' || track.state === 'hold' || track.state === 'recovery' || track.state === 'ready'
    if (!prepared)
      track.preparedAt = Infinity
    else if (track.preparedAt === Infinity)
      track.preparedAt = now
    track.fed = prepared ? minJerk(Math.min(1, (now - track.preparedAt) / FED_RAMP)) : 0
    if (track.state === 'retraction' && track.viaReady && now >= track.phaseEnd) {
      track.state = 'ready'
      this.retractTrack(track, now)
    }
    if (track.state === 'retraction' && now >= track.dropAt)
      track.weight = 0
    if (track.state === 'retraction' && now >= track.phaseEnd) {
      track.state = 'rest'
      track.form = null
      track.exitSeconds = TIMING.exit
    }
    // Home is where the arm rested before the unit, cleared against the trunk as it was then; the trunk has moved since,
    // so the arm comes home clear of the body as it is now, with a settled key's headroom (`clearOfBody`).
    if ((track.state === 'retraction' || track.state === 'ready') && track.settle && this.keys) {
      this.scratch.set(track.home)
      this.keys.clearOfBody(track.side, this.scratch, context.previous.channels)
      track.aim(this.scratch)
    }
    // Once the arm reaches the form's key, a new segment takes it on by the request's settle (`armForm.settle`), so no
    // step starts. It takes a settled key only where the way from its own key keeps `KEY_HEADROOM`. Without a settle the
    // form holds its key.
    const settle = context.plan.armForm?.settle
    if (track.state === 'form' && this.keys) {
      if (!settle) {
        track.settle = false
        track.aim(track.key)
      }
      else {
        for (let j = 0; j < 26; j++)
          this.scratch[j] = track.key[j] + settle[j]
        if ((track.settle || track.arrived(now)) && this.keys.pathDepth(track.side, track.key, this.scratch, KEY_HEADROOM) === 0) {
          if (track.settle)
            track.aim(this.scratch)
          else
            track.move(this.scratch, now, 0, this.tension)
          track.settle = true
        }
      }
    }
    if (track.active || track.weight > 0)
      track.advance(now, this.tension)
    track.participate(now, freeShare(context.input.owned.head))
    track.write()
  }

  private begin(track: ArmTrack, now: number): void {
    track.pose.set(track.home)
    track.planned.set(track.home)
    track.plannedPrevious.set(track.home)
    track.warm = false
    track.settle = false
    track.segment.start = now
    track.weight = 1
    track.exitSeconds = TIMING.exit
    track.dropAt = Infinity
    track.silent = true
    track.leaning = false
    // A hand joining at a phrase change may have written its last tick already; its target starts from home this tick.
    track.write()
  }

  private captureHome(track: ArmTrack, context: PerformanceContext): void {
    const start = ARM_START[track.side]
    for (let j = 0; j < 26; j++)
      track.home[j] = context.previous.channels[start + j]
  }

  private travel(side: BodySide, from: ArmPose, to: ArmPose): number {
    const keys = this.keys
    if (!keys)
      return 0
    const [ax, ay, az] = keys.wrist(side, from)
    const [bx, by, bz] = keys.wrist(side, to)
    return Math.hypot(bx - ax, by - ay, bz - az)
  }

  private phase(): BodyGesturePhase {
    if (!this.unit.active)
      return 'rest'
    const lead = this.tracks[this.unit.twoHand ? this.dominant : this.unit.sides[0]]
    switch (lead.state) {
      case 'preparation':
      case 'lean':
        return 'preparation'
      case 'stroke':
        return 'stroke'
      case 'retraction':
        return 'retraction'
      case 'rest':
        return 'rest'
      default:
        return 'hold'
    }
  }
}

export interface GestureLayerOptions {
  readonly traits: BodyRigTraits
  readonly seed: number
}

/**
 * The co-speech gesture layers (architecture 4a, plan 3.1): one override layer per arm, sharing one planner, so each
 * arm has its own weight ramp and activation, and one additive body layer for the phrase's trunk, head and shoulder
 * hold. Register all three, in this order. With no speech and no requested arm form the arm layers stay at weight 0
 * and the body layer adds zero, so the performer's output is bit-identical to having no layers.
 *
 * - Speech is gestured in phrases (`phrases.ts`): each unit opens a phrase with its own place, theme, hands and length;
 *   at a phrase's end the hands lower or go on into the next phrase from a new place. A pause in speech, the end of
 *   speech, or the unit caps lower the hands. A unit starts on an utterance's speaking edge, or later on an onset; a
 *   calm speaker's only on an emphasis or a loud onset.
 *   Every onset passing the gate's S2 voice-peak rule strokes, at least 0.45 s apart; accepted emphases are major.
 * - The report's `strokeSeq` and `plannedHit` change when the lead arm's wrist reaches its apex on the arm's actual
 *   output (the first speed minimum after the stroke's peak, at most half of it). `plannedHit` is that apex, a tick or
 *   two in the past, so the marker's time is the motion's, never a claim (plan 2.1).
 * - `plan.armForm` (hand to chest, thinking hand) is held on the requested arm. Whichever performance holds an arm
 *   keeps it: a speech unit then uses the other hand, and a requested form waits for a unit to retract.
 * - A clip claiming a performing arm takes it within 90 ms; no unit starts on an arm with any ownership.
 * - Standing, the body layer may ask the posture for a weight shift as a unit lowers its hands (`SHIFT`), unless an
 *   earlier layer holds the support.
 */
export function createGestureLayers(options: GestureLayerOptions): readonly [PerformanceLayer, PerformanceLayer, PerformanceLayer] {
  const performer = new GesturePerformer(options.traits, options.seed)
  const layer = (side: BodySide): PerformanceLayer => {
    const track = performer.tracks[side]
    const output: Mutable<LayerOutput> = { channels: track.channels, additive: track.additive, weight: 0, fed: 0, sequence: 0, gesture: performer.report }
    return {
      id: `gesture-${side}`,
      order: 'gesture',
      mode: 'override',
      mask: track.mask,
      enterSeconds: TIMING.enter,
      get exitSeconds() {
        return track.exitSeconds
      },
      plan: () => performer.performing ? { suppressHeadEmphasis: true } : {},
      step: (context) => {
        performer.update(context)
        output.weight = track.weight
        output.fed = track.fed
        return output
      },
      reset: () => performer.reset(),
    }
  }
  const none = new Float64Array(BODY_CHANNELS.length)
  const body: PerformanceLayer = {
    id: 'gesture-body',
    order: 'gesture',
    mode: 'additive',
    mask: none,
    plan: context => performer.shift && context.plan.support === null ? { support: performer.shift.support } : {},
    step: (context) => {
      performer.update(context)
      return { channels: none, additive: performer.bodyAdditive, weight: 1, sequence: 0 }
    },
    reset: () => performer.reset(),
  }
  return [layer('left'), layer('right'), body]
}
