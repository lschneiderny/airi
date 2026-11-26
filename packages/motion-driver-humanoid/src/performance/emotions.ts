import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { SecondOrderCoefficients, SecondOrderParameters, SecondOrderState } from '../dynamics'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyEmotionReport, BodyPerformanceInput } from './contracts'
import type { HandShape } from './hand-shapes'
import type { PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { defaultExpressionPerformanceSettings, PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'

import { advanceSecondOrder, minJerk, secondOrderCoefficients, softLimit } from '../dynamics'
import { ARM_START, BODY_CHANNELS, BODY_TICK, CHANNEL_GROUPS, channelIndex, DEG, freeShare, SIDES } from './channels'
import { KEY_HEADROOM } from './collision'
import { ARM_FORMS, GestureKeys } from './gesture-forms'
import { addHandShape } from './hand-shapes'

/**
 * One arm's posture terms, degrees, in `BODY_CHANNELS` arm order: clavicle elevation and protraction, shoulder flexion
 * (forward), abduction (out), upper-arm twist (inward, which swings a bent forearm across the body), elbow flexion,
 * forearm pronation (palm down and back; negative turns the palm forward and up) and wrist flexion (palmar; negative
 * extends the wrist).
 */
export interface BodyEmotionArm {
  readonly clavElev?: number
  readonly clavProt?: number
  readonly flex?: number
  readonly abduct?: number
  readonly twist?: number
  readonly elbow?: number
  readonly pron?: number
  readonly wflex?: number
}

/**
 * An emotion's posture at weight 1 (a held emotion at full strength): degrees, pelvis in leg lengths. Pitch is
 * forward-positive. Each roll leans toward the emotion's side and each yaw turns the trunk away from it. `arms` reach
 * both arms, `sideArm` adds to the side's arm and `farArm` to the other; an arm a held form takes keeps none of them.
 * Beside a held form the far arm completes the form's pose (the arm folded under the thinking hand, the hand drawn in
 * under the hand on the heart), so it comes in with the form, over `FORM_COMPANION`, instead of in proportion.
 * A clear pulse (0.6) shows 0.6 of the row and a strong one (0.9) 0.9 of it, so a weaker emotion is the same pose
 * smaller (2026-11-24 emotion silhouettes ADR).
 */
export interface BodyEmotionPosture {
  /** Total forward trunk curl, spread over the three torso controls by `SLUMP_SHARES`. */
  readonly slump?: number
  readonly hipsPitch?: number
  readonly lowerPitch?: number
  readonly midPitch?: number
  readonly upperPitch?: number
  readonly lowerRoll?: number
  readonly midRoll?: number
  readonly hipsYaw?: number
  readonly lowerYaw?: number
  readonly midYaw?: number
  readonly upperYaw?: number
  /**
   * The lower neck's share of a slump: a folding thoracic spine carries the base of the neck with it, so the head goes
   * down with the chest. The head itself keeps Natural's posture (plan 3.2).
   */
  readonly neckPitch?: number
  readonly pelvisY?: number
  readonly pelvisZ?: number
  readonly arms?: BodyEmotionArm
  readonly sideArm?: BodyEmotionArm
  readonly farArm?: BodyEmotionArm
}

export interface BodyEmotionSpec {
  readonly posture: BodyEmotionPosture
  /** A hand shape blended in at the emotion's weight (never scaled), or a finger-curl factor. */
  readonly hands: { readonly shape: Extract<HandShape, 'open' | 'fist'>, readonly amount: number, readonly spread?: number } | { readonly curl: number } | null
  /** Second-order response of the posture weight (3a): its tempo, anticipation and overshoot. Null for the baseline. */
  readonly response: SecondOrderParameters | null
  /** Share of a held level the posture keeps; surprise is a startle and settles to 35 % while held. */
  readonly heldShare: number
  /** The support it plans while it is the strongest, as a multiple of its side: 0 centres the weight, -1 loads the far foot. */
  readonly support: number | null
  /** An emotion-requested arm form for the gesture layer, on the emotion's side, while the weight exceeds 0.5. */
  readonly armForm: BodyArmForm | null
  readonly tempo: number
  readonly amplitude: number
  readonly tension: number
  readonly breath: number
  /** The onset is one deeper inhale (4c sad). */
  readonly sigh: boolean
  /**
   * A startle in a walking body: the pelvis dips this far (leg lengths) while the accent lasts, so the stance knee gives
   * under the step it is on (`STRIDE`). Each pulse of such an emotion also raises a startle in the modulation
   * (`PerformanceModulation.startleSeq`) at the pulse's intensity, which the gait answers by checking the stride.
   */
  readonly startle?: number
  /**
   * While she speaks, degrees at full weight: the chest lifts (`lift`) and the trunk turns `turn` toward the far side,
   * the hand that speaks, so the line comes from the emotion's posture instead of beside it. Each stroke of the speaking
   * hand turns the chest `beat` more toward it (`BEAT`), and a held hand to chest settles into the body (`SETTLE`).
   */
  readonly speech?: { readonly lift: number, readonly turn: number, readonly beat: number }
}

/**
 * Architecture 4c's emotions, the body half; Natural keeps the head and face. Each has its own silhouette, so that with
 * the face hidden no two emotions share a pose: a line of action through the trunk, where the weight sits, how open and
 * how high the chest and arms are, how asymmetric, and a tempo of arrival, hold and release (2026-11-24 emotion
 * silhouettes ADR, which replaces 4c's rows and their scales). A missing emotion fails to compile.
 *
 * - happy lifts and opens: the chest arches up, the shoulders go back, the arms open forward and out with the palms
 *   forward, and the pose anticipates, overshoots and quickens the sway, a bounce.
 * - sad sinks and closes: the trunk curls and the neck goes down with it, the shoulders round forward and down, the
 *   knees soften, the arms hang in and the hands curl; slow to come, slow to go, with a sigh.
 * - angry squares up and drops the weight forward: the trunk hinges forward over bent knees with the chest broad, the
 *   shoulders rise and come forward, the arms stay in by the sides with the elbows bent and held back, the fists set.
 * - surprised snaps back and up: the trunk arches back over retreating hips, the shoulders jump, both open hands are
 *   thrown up beside the head with the palms out and the wrists back; an underdamped startle that settles to a third.
 * - think stands on one leg, leans toward the thinking hand at the chin, and folds the other arm across the belly.
 * - question bends sideways in a C, the weight on the far foot, and shrugs: the elbows in, both forearms turned palms
 *   up, the near shoulder lifted and the far one dropped.
 * - curious leans in from the hips and tilts, the shoulders and arms drawn back behind her.
 * - awkward retreats onto the far foot and turns away, hunched, with a self-touch to the hair on the side.
 * - love softens: the chest opens, the trunk curves toward the hand on the heart, the other forearm folds across the
 *   belly, and the sway slows and widens; while she speaks the chest lifts and turns toward the speaking hand, turns
 *   further with each of its strokes, and the hand on the heart settles lower into the body with the elbow down.
 * - flustered turns away and guards: the trunk twists away and hunches, the weight retreats, both forearms come up in
 *   front of the chest with loose fists; quick and jittery.
 * - sleepy sags and lists: the hips slide forward under a trunk that leans back and curls at the chest, the knees
 *   soften, the shoulders drop, the arms dangle, and the sway grows slow and wide.
 */
export const BODY_EMOTIONS: Readonly<Record<PerformanceEmotion, BodyEmotionSpec>> = {
  happy: { posture: { lowerPitch: 2, midPitch: -6, upperPitch: -4, pelvisZ: 0.006, arms: { clavElev: 4, clavProt: -8, flex: 14, abduct: 10, twist: -15, elbow: 30, pron: -40, wflex: -10 } }, hands: { shape: 'open', amount: 1 }, response: { f: 1.6, zeta: 0.42, r: -0.3 }, heldShare: 1, support: 0, armForm: null, tempo: 1.2, amplitude: 1.3, tension: 0.45, breath: 1.1, sigh: false },
  sad: { posture: { slump: 18, hipsPitch: -3, neckPitch: 14, pelvisY: -0.016, pelvisZ: 0.003, arms: { clavElev: -6, clavProt: 10, flex: 4, abduct: -5, twist: 10, elbow: 6 } }, hands: { curl: 1.25 }, response: { f: 0.45, zeta: 1, r: 0 }, heldShare: 1, support: 0, armForm: null, tempo: 0.7, amplitude: 0.6, tension: 0.2, breath: 0.7, sigh: true },
  angry: { posture: { lowerPitch: 6, midPitch: -1, upperPitch: -2, hipsPitch: 2, pelvisY: -0.008, pelvisZ: 0.006, arms: { clavElev: 7, clavProt: 5, flex: -8, abduct: 6, twist: 10, elbow: 35 } }, hands: { shape: 'fist', amount: 0.9 }, response: { f: 2.2, zeta: 0.7, r: -0.25 }, heldShare: 1, support: 0, armForm: null, tempo: 1.1, amplitude: 0.75, tension: 0.9, breath: 1.3, sigh: false },
  think: { posture: { lowerRoll: 6, midPitch: 2, pelvisZ: -0.003, farArm: { flex: 20, abduct: 10, twist: 36, elbow: 80 } }, hands: null, response: { f: 0.8, zeta: 0.9, r: 0 }, heldShare: 1, support: 1, armForm: 'thinking-hand', tempo: 0.8, amplitude: 0.7, tension: 0.4, breath: 1, sigh: false },
  surprised: { posture: { lowerPitch: -6, midPitch: -7, upperPitch: -4, pelvisY: 0.002, pelvisZ: -0.012, arms: { clavElev: 14, clavProt: 2, flex: 18, abduct: 26, twist: -30, elbow: 100, pron: -15, wflex: -35 } }, hands: { shape: 'open', amount: 1, spread: 1.4 }, response: { f: 4.5, zeta: 0.4, r: 0 }, heldShare: 0.35, support: 0, armForm: null, tempo: 1.2, amplitude: 1.1, tension: 0.75, breath: 1.3, sigh: false, startle: -0.03 },
  awkward: { posture: { midPitch: 3, upperPitch: 2, lowerRoll: -3, lowerYaw: 4, midYaw: 4, pelvisZ: -0.006, arms: { clavElev: 3 }, sideArm: { clavElev: 4 }, farArm: { flex: 8, abduct: -4, elbow: 20 } }, hands: null, response: { f: 1.2, zeta: 0.7, r: -0.2 }, heldShare: 1, support: -1, armForm: 'hair-touch', tempo: 1.25, amplitude: 0.9, tension: 0.6, breath: 1, sigh: false },
  question: { posture: { lowerPitch: 2, lowerRoll: 6, midRoll: 7, arms: { clavElev: 5, clavProt: 3, flex: 2, abduct: -2, twist: -40, elbow: 85, pron: -75, wflex: -15 }, sideArm: { clavElev: 11 }, farArm: { clavElev: -3 } }, hands: { shape: 'open', amount: 0.8 }, response: { f: 1.6, zeta: 0.65, r: -0.2 }, heldShare: 1, support: -1, armForm: null, tempo: 1, amplitude: 1, tension: 0.5, breath: 1, sigh: false },
  // Natural keeps the head; the body never adds a second head posture (plan 3.2).
  curious: { posture: { lowerPitch: 10, midPitch: 5, upperPitch: 1, midRoll: 4, pelvisZ: 0.003, arms: { clavProt: -6, flex: -18, elbow: 15, abduct: 4 } }, hands: null, response: { f: 1.3, zeta: 0.7, r: -0.3 }, heldShare: 1, support: 0.5, armForm: null, tempo: 1.1, amplitude: 1, tension: 0.5, breath: 1, sigh: false },
  neutral: { posture: {}, hands: null, response: null, heldShare: 0, support: null, armForm: null, tempo: 1, amplitude: 1, tension: 0.4, breath: 1, sigh: false },
  love: { posture: { midPitch: -5, upperPitch: -3, lowerRoll: 4, midRoll: -2, pelvisZ: 0.002, arms: { clavProt: -4 }, farArm: { flex: 26, abduct: 4, twist: 36, elbow: 80, pron: 20 } }, hands: null, response: { f: 0.6, zeta: 0.95, r: -0.1 }, heldShare: 1, support: -1, armForm: 'hand-to-chest', tempo: 0.8, amplitude: 1.4, tension: 0.25, breath: 1.15, sigh: false, speech: { lift: 4, turn: 5, beat: 3 } },
  flustered: { posture: { midPitch: 4, upperPitch: 2, lowerRoll: -3, hipsYaw: 4, lowerYaw: 5, midYaw: 5, pelvisZ: -0.006, arms: { clavElev: 8, clavProt: 5, flex: 16, abduct: 6, twist: 10, elbow: 100, wflex: 10 } }, hands: { shape: 'fist', amount: 0.8 }, response: { f: 2.4, zeta: 0.5, r: -0.1 }, heldShare: 1, support: -1, armForm: null, tempo: 1.4, amplitude: 1.1, tension: 0.7, breath: 1.2, sigh: false },
  sleepy: { posture: { slump: 8.5, lowerPitch: -6.5, lowerRoll: 8.5, midRoll: 3, pelvisY: -0.012, pelvisZ: 0.014, arms: { clavElev: -8, abduct: -2, elbow: -6 } }, hands: { curl: 0.85 }, response: { f: 0.35, zeta: 1, r: 0 }, heldShare: 1, support: 1, armForm: null, tempo: 0.55, amplitude: 1.5, tension: 0.1, breath: 1.4, sigh: false },
}

/**
 * A person's slump curls through the thoracic spine: the lower and mid thoracic regions flex near their end range, the
 * upper thoracic and lumbar regions mid-range, and the pelvis rolls back (Nairn et al. 2013, Manual Therapy 18(6):
 * 498-505). Shares of the slump for the lower, mid and upper torso controls, derived in `E/g3/b2/expectations.md`. The
 * neck and head keep Natural's head posture alone (plan 3.2).
 */
const SLUMP_SHARES = [0.2, 0.6, 0.2] as const
/**
 * Degrees. The summed slump passes the identity below 16 degrees, which holds every clear pulse, and saturates at 20 at
 * weight 1, inside a standing person's slump and more than 2 degrees inside each control's limit.
 */
const SLUMP_CAP = 20

/** Arm forms engage above "slight", at a clear pulse and above (lead ruling R3). */
const ARM_FORM_WEIGHT = 0.5
/**
 * The command at which an emotion's weight shift is full: a clear pulse and above. Below it the support lies between the
 * emotion's side and the stance she had when the emotion first asked for it, so a slight pulse shifts part of the way
 * and a release ends on her own stance. The posture keeps the last planned support until its own next shift, so a
 * support released where the emotion put it held her on that leg 4 to 75 s after the emotion had gone.
 */
const SUPPORT_FULL = 0.6
/**
 * The weights over which the far arm beside a held form comes in, smoothly, around the form's own threshold: a part
 * of a contact pose such as an arm folded across the belly reads as an arm held out when it is only partly there.
 */
const FORM_COMPANION = [0.3, 0.6] as const
/**
 * Natural startles at every poke. A surprised pulse that starts this soon after a poke (seconds) moves its arms and hands
 * at `arms` of their size for that poke's region, so the reaction layer's guard of the touched side leads instead of
 * both hands presenting. A body poke leaves the arms to the guard alone: at a quarter, both hands still opened low into
 * one generic recoil after the near forearm (audit of 2026-11-25).
 */
const TOUCH_STARTLE = { within: 0.25, arms: { head: 0.25, body: 0 } } as const
/**
 * A held emotion's weight rises with its command, which Natural's held level already eases in, and releases with
 * Natural's held release time constant (`stage-shared` `held.releaseTau`; `motion-driver-natural` `hold.ts` `step`).
 * Natural switches a hold's emotion at full level, so without this the old posture would drop off in one step.
 */
const HELD = defaultExpressionPerformanceSettings.held
/** Below this the released held weight snaps to rest; the posture's own response filters the snap. */
const HELD_REST = 1e-4
/** Natural retires face hints this many release time constants after the hold (`impulses.ts` `impulseFaceLifetime`). */
const RELEASE_LIFETIME = 15
const REST = 1e-6
/** The follower of her speaking that an emotion's `speech` terms ride: critically damped, settling in about half a second. */
const SPEECH = secondOrderCoefficients({ f: 1, zeta: 1, r: 0 }, BODY_TICK)
/**
 * The chest's beat on each stroke of the speaking hand (`BodyEmotionSpec.speech.beat`), so the emphasis that moves the
 * speech arm turns the ribs toward it too, and the hand on the chest rides them: it starts as the gesture layer reports the stroke (`BodyGestureReport.phase`, the last
 * frame's), rises over `rise` seconds, a beat stroke's time, so it peaks with the stroke's hit, and returns over
 * `decay`, as that stroke's own torso pulse does (`gestures.ts` `AMPLITUDE.torsoDecay`). A new stroke rises from where
 * the beat is. Natural's voice emphasis reaches the body on few of the onsets the hand strokes, so it is not the cue.
 * The beat turns and does not lift: the stroke's own torso pulse pitches the chest forward, and a lift against it
 * halved the chest's pitch on each stroke.
 */
const BEAT = { rise: 0.12, decay: 0.5 } as const
/**
 * While she speaks, a held hand to chest settles into the body (audit of 2026-11-25: held where love stands, the hand
 * hovered upright in front of the sternum through the line while the other hand spoke). The settled key is the held
 * key's wrist moved `down` arm lengths lower on the chest and `in` toward it, with the elbow as low as the joint limits
 * let it hang (the swivel from 0 in `swivelStep` steps up to the form's own), and the wrist flexed `wflex` more, so the
 * hand lies on the chest instead of standing up from the steeper forearm; the solve pushes the hand back out to the
 * body's surface and swings the elbow out only until the arm clears the trunk with the settling headroom
 * (`KEY_HEADROOM`), along the whole way from the held key. The largest `down` that clears with the wrist still at least
 * half of it lower wins (on a chested rig the push can lift the hand over the bust instead); on a rig where none does,
 * the hand stays where it is held. The share is her speaking (`SPEECH`), so standing silent she holds the key the form
 * solved.
 */
const SETTLE = { down: [0.08, 0.06, 0.04, 0.02], in: 0.03, swivelStep: 5 * DEG, wflex: 20 * DEG } as const
/**
 * While she walks an emotion is an accent the stride absorbs, not a pose held over the swing (2026-11-25 amendment of the
 * emotion silhouettes ADR). Its arm joints (clavicle to wrist; the hand shape stays) show in full from the emotion's
 * start, and at the first change of stance foot at least `hold` seconds later, or `step` seconds after that without one,
 * they ease to `residue` of their size through `response`, a critically damped follower that settles in about a step,
 * so the walk's own swing carries the arms again. A new pulse accents again from where the arms are. The share follows
 * the gait's weight, so a stop gives her the whole pose back as the walk lets go.
 */
const STRIDE = {
  hold: 0.3,
  step: 0.6,
  residue: 0.2,
  response: secondOrderCoefficients({ f: 1.2, zeta: 1, r: 0 }, BODY_TICK),
} as const

/** One held part of an unheld pulse: a share of its intensity, held until `hold` seconds after it, then released. */
interface EpisodePart {
  readonly share: number
  readonly hold: number
  readonly release: number
}

interface Episode {
  readonly start: number
  /** The episode weight when it started; a pulse during another of the same emotion continues from it. */
  readonly from: number
  readonly amplitude: number
  readonly attack: number
  readonly parts: readonly EpisodePart[]
}

/**
 * The body pose of an unheld pulse, as one reaction with the face (lead ruling R2b; owner decision of 2026-11-12, "Pose
 * hold"). It rises from `from` with Natural's impulse attack `(t/tau)^2 e^{2(1 - t/tau)}` to its peak at the band's
 * head tau (`impulses.ts` `impulseEnvelope`). From there it is the largest of its parts, each held at its share of the
 * intensity and released as `(1 + a/tau) e^{-a/tau}`, which starts with zero slope. Every junction is continuous in
 * value; the attack meets each part with zero slope.
 */
function episodeWeight(episode: Episode, age: number): number {
  if (age <= 0)
    return episode.from
  if (age < episode.attack) {
    const u = age / episode.attack
    return episode.from + (episode.amplitude - episode.from) * u * u * Math.exp(2 * (1 - u))
  }
  let weight = 0
  for (const part of episode.parts) {
    const a = Math.max(0, age - part.hold) / part.release
    weight = Math.max(weight, part.share * (1 + a) * Math.exp(-a))
  }
  return episode.amplitude * weight
}

const episodeEnd = (episode: Episode) => Math.max(...episode.parts.map(part => part.hold + RELEASE_LIFETIME * part.release))
const episodeHolding = (episode: Episode, age: number) => episode.parts.some(part => age < part.hold)

/** The emotion modulation of the generators (4c), each the baseline blended toward the active emotions by weight. */
export interface BodyEmotionModulation {
  tempo: number
  amplitude: number
  tension: number
  breath: number
  /** Increments once per sighing onset. */
  sighSeq: number
  /** Increments once per pulse of an emotion with a `startle`; `startle` is that pulse's intensity. */
  startleSeq: number
  startle: number
}

export interface EmotionLayer extends PerformanceLayer {
  readonly modulation: Readonly<BodyEmotionModulation>
}

const c = channelIndex
const companion = (w: number) => minJerk((w - FORM_COMPANION[0]) / (FORM_COMPANION[1] - FORM_COMPANION[0]))
const sideIndex = (side: number): BodySide => side < 0 ? 'left' : 'right'

interface Track {
  readonly emotion: PerformanceEmotion
  readonly spec: BodyEmotionSpec
  readonly state: SecondOrderState
  readonly coefficients: SecondOrderCoefficients | null
  target: number
  /** The command before the held crossfade: the held level times strength, or the episode envelope. */
  commanded: number
  held: number
  side: number
  episode: Episode | null
  /** The episode weight of the last tick. */
  episodeLevel: number
  /** The share of the arm and hand terms, set when a pulse starts from rest; a touch startle's is `TOUCH_STARTLE.arms`. */
  armShare: number
  /** The support she stood on when this emotion's weight shift began (`SUPPORT_FULL`); null while it plans none. */
  resume: number | null
  /** When the arm accent last started: an onset from rest or a new pulse (`STRIDE`). */
  accentFrom: number
  /** The stride has absorbed the accent, until the next pulse or until she stands. */
  absorbed: boolean
  /** The accent's share of the arm terms, 1 standing (`STRIDE.response`). */
  readonly accent: SecondOrderState
}

/**
 * Layer 3 of 3g: an additive posture per emotion, weighted by the held level (`held.level x held.strength`) or by an
 * unheld episode (its intensity under `episodeEnvelope`, lead ruling R1), each weight through the emotion's 3a
 * response. A slight pulse recruits no head in Natural and no body here. Owned groups receive no term.
 */
export function createEmotionLayer(): EmotionLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const ownedFactor = new Float64Array(BODY_CHANNELS.length)
  const modulation: BodyEmotionModulation = { tempo: 1, amplitude: 1, tension: BODY_EMOTIONS.neutral.tension, breath: 1, sighSeq: 0, startleSeq: 0, startle: 0 }
  const report: BodyEmotionReport & { seq: number, emotion: PerformanceEmotion | null, phase: 'onset' | 'release' | null } = { seq: 0, emotion: null, phase: null }
  const tracks: Track[] = PERFORMANCE_EMOTIONS.map((emotion) => {
    const spec = BODY_EMOTIONS[emotion]
    return { emotion, spec, state: { y: 0, v: 0, x: 0 }, coefficients: spec.response && secondOrderCoefficients(spec.response, BODY_TICK), target: 0, commanded: 0, held: 0, side: 1, episode: null, episodeLevel: 0, armShare: 1, resume: null, accentFrom: 0, absorbed: false, accent: { y: 1, v: 0, x: 1 } }
  })
  /** The gait's stance foot on the last tick (the sign of its support), 0 while she does not walk. */
  let stance = 0
  /** The gait's weight this tick: how much of the stride the arms belong to. */
  let walking = 0
  /** How far she is into speaking: 1 through an utterance, eased in and out (`SPEECH`). */
  const speech = { y: 0, v: 0, x: 0 }
  let impulseSeq: number | null = null
  let pokeSeq: number | null = null
  let pokedAt = Number.NEGATIVE_INFINITY
  let pokedRegion: 'head' | 'body' = 'body'
  let time = 0
  /** The tick's summed slump in radians, spread over the torso after every track has added its share. */
  let slump = 0
  /** The gesture layer's solver, made on the first tick from the rest its own keys take, so the held keys agree. */
  let keys: GestureKeys | null = null
  /** Per side, the settled hand to chest less the held one (`SETTLE`); null where none clears, undefined until solved. */
  const settled: Record<BodySide, Float64Array | null | undefined> = { left: undefined, right: undefined }
  /** This tick's settle of the held hand to chest, handed to the gesture layer with the request. */
  const settle = new Float64Array(26)
  /** Whether the speaking hand was in a stroke on the last frame (`BEAT`). */
  let wasStroking = false
  /** The chest's beat on the latest stroke (`BEAT`): when it started and the beat it rose from. */
  const beat = { start: Number.NEGATIVE_INFINITY, from: 0 }
  /** The beat this tick, a share of `speech.beat`. */
  let ribs = 0

  function beatAt(t: number): number {
    const age = t - beat.start
    if (age < BEAT.rise)
      return beat.from + (1 - beat.from) * minJerk(age / BEAT.rise)
    return 1 - minJerk((age - BEAT.rise) / BEAT.decay)
  }

  /** The settled hand to chest on `side` less the held one (`SETTLE`), or null where the form or no settled key solves. */
  function settledOffset(side: BodySide, rest: Float32Array): Float64Array | null {
    if (!keys)
      return null
    const form = ARM_FORMS['hand-to-chest']
    const start = ARM_START[side]
    const held = Float64Array.from(rest.subarray(start, start + 26))
    if (!keys.armForm(side, 'hand-to-chest', held))
      return null
    const [x, y, z] = keys.wrist(side, held)
    const out = (side === 'left' ? 1 : -1) * x
    const pose = held.slice()
    for (const down of SETTLE.down) {
      for (let swivel = 0; swivel <= form.swivel + 1e-9; swivel += SETTLE.swivelStep) {
        if (keys.solve(side, { hand: [out, y - down, z - SETTLE.in], swivel, pron: form.pron, wflex: form.wflex + SETTLE.wflex, wdev: 0 }, pose, held, KEY_HEADROOM) && keys.wrist(side, pose)[1] <= y - 0.5 * down)
          return pose.map((value, j) => value - held[j])
      }
    }
    return null
  }

  /**
   * The settle a speaking emotion gives its held hand to chest: the settled key's offset times her speaking. The form is
   * held whole above `ARM_FORM_WEIGHT`, so its settle is too. Silent, the request carries none, and the form holds its
   * own key.
   */
  function settling(track: Track, side: BodySide, rest: Float32Array): { settle?: Float64Array } {
    if (!track.spec.speech || track.spec.armForm !== 'hand-to-chest')
      return {}
    if (settled[side] === undefined)
      settled[side] = settledOffset(side, rest)
    const offset = settled[side]
    if (!offset)
      return {}
    if (speech.y === 0)
      return {}
    for (let j = 0; j < settle.length; j++)
      settle[j] = speech.y * offset[j]
    return { settle }
  }

  function ownership(input: BodyPerformanceInput) {
    for (let channel = 0; channel < channels.length; channel++)
      ownedFactor[channel] = freeShare(input.owned[CHANNEL_GROUPS[channel]])
  }

  function retarget(input: BodyPerformanceInput) {
    const poke = input.events.poke?.seq ?? 0
    if (pokeSeq !== null && poke !== pokeSeq && input.events.poke) {
      pokedAt = time
      pokedRegion = input.events.poke.region
    }
    pokeSeq = poke
    const impulse = input.events.impulse
    const seq = impulse?.seq ?? 0
    // The first tick only latches: a record that predates this layer (a reset performer) is not replayed.
    if (impulseSeq !== null && impulse && seq !== impulseSeq) {
      const band = defaultExpressionPerformanceSettings.naturalBands[impulse.band]
      const track = tracks.find(t => t.emotion === impulse.emotion)
      if (track?.coefficients && band.headTau) {
        // The face hint holds for the band's face hold; the held face of the same episode holds as long as the
        // expression system holds a turnless episode (stage-shared `emotionHold`) and releases with Natural's held
        // release (`hold.ts`). The body keeps the emotion's held share of the pose for that time.
        track.episode = {
          start: time,
          from: track.episodeLevel,
          amplitude: Math.max(0, Math.min(1, impulse.intensity)),
          attack: band.headTau,
          parts: [
            { share: 1, hold: Math.max(band.headTau, band.faceHold), release: band.faceReleaseTau },
            { share: track.spec.heldShare, hold: Math.max(band.headTau, HELD.turnlessSeconds), release: HELD.releaseTau },
          ],
        }
        if (track.commanded === 0)
          track.side = impulse.side
        track.accentFrom = time
        track.absorbed = false
        // A poke's startle checks a walking stride too: it reaches the layer as this same pulse.
        if (track.spec.startle !== undefined) {
          modulation.startleSeq++
          modulation.startle = track.episode.amplitude
        }
        // Only from rest, so a share never changes under a held pose.
        if (Math.abs(track.state.y) < REST)
          track.armShare = track.emotion === 'surprised' && time - pokedAt <= TOUCH_STARTLE.within ? TOUCH_STARTLE.arms[pokedRegion] : 1
        // Natural's held face releases the previous emotion when the hold switches; the body lets go of it from where
        // it stands, with the same release.
        for (const other of tracks) {
          if (other !== track && other.episode && episodeHolding(other.episode, time - other.episode.start))
            other.episode = { start: time, from: other.episodeLevel, amplitude: other.episodeLevel, attack: 0, parts: [{ share: 1, hold: 0, release: HELD.releaseTau }] }
        }
      }
    }
    impulseSeq = seq
    for (const track of tracks) {
      if (!track.coefficients)
        continue
      const { held } = input
      const heldTarget = held.emotion === track.emotion ? held.level * held.strength * track.spec.heldShare : 0
      let episodeTarget = 0
      if (track.episode) {
        const age = time - track.episode.start
        if (age > episodeEnd(track.episode))
          track.episode = null
        else
          episodeTarget = episodeWeight(track.episode, age)
      }
      track.episodeLevel = episodeTarget
      track.held = heldTarget >= track.held || HELD.releaseTau === 0 ? heldTarget : heldTarget + (track.held - heldTarget) * Math.exp(-BODY_TICK / HELD.releaseTau)
      if (heldTarget === 0 && track.held < HELD_REST)
        track.held = 0
      const commanded = Math.max(heldTarget, episodeTarget)
      if (commanded > 0 && track.commanded === 0) {
        if (heldTarget > 0)
          track.side = held.side
        track.accentFrom = time
        track.absorbed = false
        report.seq++
        report.emotion = track.emotion
        report.phase = 'onset'
        if (track.spec.sigh)
          modulation.sighSeq++
      }
      else if (commanded === 0 && track.commanded > 0) {
        report.seq++
        report.emotion = track.emotion
        report.phase = 'release'
      }
      track.commanded = commanded
      track.target = Math.max(track.held, episodeTarget)
    }
  }

  /**
   * The hand the emotion's shape starts from, per channel: the rest hand plus the walk's hand (the gait's finger,
   * spread and opposition offsets at its weight), which reach the arms before the stack.
   */
  const handBase = new Float64Array(BODY_CHANNELS.length)

  function holdHandBase(input: BodyPerformanceInput, rest: Float32Array): void {
    const { gait } = input
    for (const side of SIDES) {
      for (let c = ARM_START[side] + 9; c < ARM_START[side] + 26; c++)
        handBase[c] = rest[c] + (gait ? gait.weight * gait.channels[c] : 0)
    }
  }

  /**
   * Advances each emotion's arm accent against the stride (`STRIDE`): the gait's weight says how much of the arms the
   * walk owns, and its support changing sign is a change of stance foot, where the accent lets go.
   */
  function stride(input: BodyPerformanceInput) {
    const gait = input.gait
    walking = gait ? Math.max(0, Math.min(1, gait.weight)) : 0
    // The host passes a gait at weight 0 while she stands, so standing is the weight, not a missing gait.
    const foot = gait && walking > 0 ? Math.sign(gait.support) : 0
    const stepped = foot !== 0 && stance !== 0 && foot !== stance
    if (foot !== 0)
      stance = foot
    else if (walking === 0)
      stance = 0
    for (const track of tracks) {
      const age = time - track.accentFrom
      if (walking === 0)
        track.absorbed = false
      else if (!track.absorbed && age >= STRIDE.hold && (stepped || age >= STRIDE.hold + STRIDE.step))
        track.absorbed = true
      advanceSecondOrder(track.accent, track.absorbed ? 0 : 1, STRIDE.response)
    }
  }

  /** The share of an emotion's arm joints the stride leaves it: all standing, its accent while she walks. */
  const armStride = (track: Track) => 1 - walking * (1 - STRIDE.residue - (1 - STRIDE.residue) * track.accent.y)

  function addArm(start: number, k: number, arm: BodyEmotionArm | undefined) {
    if (!arm)
      return
    channels[start] += k * (arm.clavElev ?? 0)
    channels[start + 1] += k * (arm.clavProt ?? 0)
    channels[start + 2] += k * (arm.flex ?? 0)
    channels[start + 3] += k * (arm.abduct ?? 0)
    channels[start + 4] += k * (arm.twist ?? 0)
    channels[start + 5] += k * (arm.elbow ?? 0)
    channels[start + 6] += k * (arm.pron ?? 0)
    channels[start + 7] += k * (arm.wflex ?? 0)
  }

  function addPosture(track: Track, rest: Float32Array) {
    const w = track.state.y
    const { posture: p, hands } = track.spec
    const k = w * DEG
    const s = track.side
    slump += k * (p.slump ?? 0)
    channels[c('hipsPitch')] += k * (p.hipsPitch ?? 0)
    channels[c('lowerPitch')] += k * (p.lowerPitch ?? 0)
    channels[c('midPitch')] += k * (p.midPitch ?? 0)
    channels[c('upperPitch')] += k * (p.upperPitch ?? 0)
    channels[c('lowerRoll')] += k * s * (p.lowerRoll ?? 0)
    channels[c('midRoll')] += k * s * (p.midRoll ?? 0)
    channels[c('hipsYaw')] += k * s * (p.hipsYaw ?? 0)
    channels[c('lowerYaw')] += k * s * (p.lowerYaw ?? 0)
    channels[c('midYaw')] += k * s * (p.midYaw ?? 0)
    channels[c('upperYaw')] += k * s * (p.upperYaw ?? 0)
    channels[c('neckPitch')] += k * (p.neckPitch ?? 0)
    const line = track.spec.speech
    if (line && (speech.y !== 0 || ribs !== 0)) {
      channels[c('midYaw')] += k * s * (line.turn * speech.y + line.beat * ribs)
      channels[c('midPitch')] -= 0.5 * k * line.lift * speech.y
      channels[c('upperPitch')] -= 0.5 * k * line.lift * speech.y
    }
    channels[c('pelvisY')] += w * (p.pelvisY ?? 0) + walking * track.accent.y * w * (track.spec.startle ?? 0)
    channels[c('pelvisZ')] += w * (p.pelvisZ ?? 0)
    const hand = Math.max(0, Math.min(1, w)) * track.armShare
    const strideShare = armStride(track)
    const arms = k * track.armShare * strideShare
    for (const arm of SIDES) {
      const start = ARM_START[arm]
      addArm(start, arms, p.arms)
      if (arm === sideIndex(s))
        addArm(start, arms, p.sideArm)
      else
        addArm(start, track.spec.armForm ? companion(w) * strideShare * DEG : arms, p.farArm)
      if (!hands)
        continue
      if ('curl' in hands) {
        // Index to little finger, three joints each; the thumb keeps its rest curl.
        for (let index = start + 12; index < start + 24; index++)
          channels[index] += hand * (hands.curl - 1) * rest[index]
        continue
      }
      // The whole hand, thumb, spread and opposition included, goes from the hand she holds toward the shape, so an
      // angry fist on a walk that already closes the hand still ends at the fist.
      addHandShape(hands.shape, hand * hands.amount, handBase, channels, start, hands.spread)
    }
  }

  return {
    id: 'emotion',
    order: 'emotion',
    mode: 'additive',
    mask: new Float64Array(BODY_CHANNELS.length).fill(1),
    // Every posture starts from zero weight through its own response, so the stack adds no entry ramp.
    enterSeconds: 0,
    modulation,
    plan(context: PerformanceContext): PerformancePlan {
      const { owned } = context.input
      keys ??= new GestureKeys(context.traits, context.rest)
      let support: PerformancePlan['support']
      let armForm: PerformancePlan['armForm']
      let strongest = 0
      const free = owned.lowerBody <= 0.5 && owned.upperBody <= 0.5
      for (const track of tracks) {
        if (track.spec.support === null || track.commanded === 0 || !free) {
          track.resume = null
        }
        else {
          // The posture's own target, not the support of the frame, which a walk's gait moves from step to step.
          track.resume ??= context.previous.diagnostics.shiftTarget
          if (track.commanded > strongest) {
            strongest = track.commanded
            support = track.resume + (track.spec.support * track.side - track.resume) * Math.min(1, track.commanded / SUPPORT_FULL)
          }
        }
        const form = track.spec.armForm
        const side = sideIndex(track.side)
        // The hair touch needs a rig that reaches it; a key that never solves would be asked for on every tick.
        // While she walks a form is an accent too: it goes once the stride has absorbed the emotion's arms.
        if (form && track.commanded > ARM_FORM_WEIGHT && !track.absorbed && owned[`${side}Arm`] <= 0.5 && (form !== 'hair-touch' || context.capabilities.hairTouch))
          armForm = { side, form, ...settling(track, side, context.rest) }
      }
      return { ...(support === undefined ? {} : { support }), ...(armForm === undefined ? {} : { armForm }) }
    },
    step(context: PerformanceContext) {
      time = context.time
      retarget(context.input)
      channels.fill(0)
      slump = 0
      let anyTarget = false
      let moving = false
      modulation.tempo = modulation.amplitude = modulation.breath = 1
      modulation.tension = BODY_EMOTIONS.neutral.tension
      holdHandBase(context.input, context.rest)
      stride(context.input)
      advanceSecondOrder(speech, context.input.voice.speaking ? 1 : 0, SPEECH)
      if (!context.input.voice.speaking && Math.abs(speech.y) < REST && Math.abs(speech.v) < REST)
        speech.y = speech.v = speech.x = 0
      const stroking = context.previous.diagnostics.gesture.phase === 'stroke'
      if (stroking && !wasStroking) {
        beat.from = beatAt(time)
        beat.start = time
      }
      wasStroking = stroking
      ribs = beatAt(time)
      for (const track of tracks) {
        if (!track.coefficients)
          continue
        anyTarget ||= track.target > 0
        if (track.target === 0 && Math.abs(track.state.y) < REST && Math.abs(track.state.v) < REST) {
          track.state.y = track.state.v = track.state.x = 0
          continue
        }
        moving = true
        advanceSecondOrder(track.state, track.target, track.coefficients)
        addPosture(track, context.rest)
        const blend = Math.max(0, Math.min(1, track.state.y))
        modulation.tempo += blend * (track.spec.tempo - 1)
        modulation.amplitude += blend * (track.spec.amplitude - 1)
        modulation.breath += blend * (track.spec.breath - 1)
        modulation.tension += blend * (track.spec.tension - BODY_EMOTIONS.neutral.tension)
      }
      if (slump !== 0) {
        const capped = softLimit(slump, -SLUMP_CAP * DEG, SLUMP_CAP * DEG)
        channels[c('lowerPitch')] += SLUMP_SHARES[0] * capped
        channels[c('midPitch')] += SLUMP_SHARES[1] * capped
        channels[c('upperPitch')] += SLUMP_SHARES[2] * capped
      }
      const active = anyTarget || moving
      if (active) {
        ownership(context.input)
        for (let channel = 0; channel < channels.length; channel++)
          channels[channel] *= ownedFactor[channel]
      }
      return { channels, weight: active ? 1 : 0, sequence: 0, emotion: report, modulation }
    },
    reset() {
      for (const track of tracks) {
        track.state.y = track.state.v = track.state.x = 0
        track.target = track.commanded = track.held = track.episodeLevel = 0
        track.episode = null
        track.armShare = 1
        track.resume = null
        track.accentFrom = 0
        track.absorbed = false
        Object.assign(track.accent, { y: 1, v: 0, x: 1 })
      }
      stance = 0
      walking = 0
      speech.y = speech.v = speech.x = 0
      wasStroking = false
      Object.assign(beat, { start: Number.NEGATIVE_INFINITY, from: 0 })
      ribs = 0
      Object.assign(modulation, { tempo: 1, amplitude: 1, tension: BODY_EMOTIONS.neutral.tension, breath: 1, sighSeq: 0, startleSeq: 0, startle: 0 })
      Object.assign(report, { seq: 0, emotion: null, phase: null })
      impulseSeq = pokeSeq = null
      pokedAt = Number.NEGATIVE_INFINITY
      pokedRegion = 'body'
      time = 0
    },
  }
}
