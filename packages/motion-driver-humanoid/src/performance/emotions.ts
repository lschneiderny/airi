import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { SecondOrderCoefficients, SecondOrderParameters, SecondOrderState } from '../dynamics'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyEmotionReport, BodyPerformanceInput } from './contracts'
import type { HandShape } from './hand-shapes'
import type { PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { defaultExpressionPerformanceSettings, PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'

import { advanceSecondOrder, secondOrderCoefficients } from '../dynamics'
import { ARM_START, BODY_CHANNELS, BODY_TICK, channelGroup, channelIndex, DEG, SIDES } from './channels'
import { HAND_SHAPES } from './hand-shapes'

/**
 * Architecture 4c posture columns at weight 1: degrees, pelvis in leg lengths. Pitch is forward-positive. `lowerRoll`
 * leans toward the emotion's side, `midYaw` turns away from it, and `sideClavElev` lifts only the side's shoulder.
 */
export interface BodyEmotionPosture {
  readonly lowerPitch?: number
  readonly midPitch?: number
  readonly lowerRoll?: number
  readonly midYaw?: number
  readonly clavElev?: number
  readonly sideClavElev?: number
  readonly clavProt?: number
  readonly elbow?: number
  readonly abduct?: number
  readonly pelvisY?: number
  readonly pelvisZ?: number
}

export interface BodyEmotionSpec {
  readonly posture: BodyEmotionPosture
  /**
   * Multiple of the posture row, from `E/g3/b/amplitude-sources.md`: the size at which the pose held at a clear pulse's
   * weight (0.6) clears neutral and placebo by 2.4 SD on the FK proxy, capped at 4. Awkward, question, love and think
   * need more than 4 and ship at the cap without reaching that bar.
   */
  readonly scale: number
  /** A hand shape blended in at the emotion's weight (never scaled), or a finger-curl factor. */
  readonly hands: { readonly shape: Extract<HandShape, 'open' | 'fist'>, readonly amount: number, readonly spread?: number } | { readonly curl: number } | null
  /** Second-order response of the posture weight (3a); null for the baseline. */
  readonly response: SecondOrderParameters | null
  /** Share of a held level the posture keeps; surprise is a startle and settles to 35 % while held. */
  readonly heldShare: number
  readonly support: 'centre' | 'side' | null
  /** An emotion-requested arm form for the gesture layer, on the emotion's side, while the weight exceeds 0.5. */
  readonly armForm: BodyArmForm | null
  readonly tempo: number
  readonly amplitude: number
  readonly tension: number
  readonly breath: number
  /** The onset is one deeper inhale (4c sad). */
  readonly sigh: boolean
}

/** Architecture 4c, the body half of each emotion; Natural keeps the head and face. A missing emotion fails to compile. */
export const BODY_EMOTIONS: Readonly<Record<PerformanceEmotion, BodyEmotionSpec>> = {
  happy: { posture: { lowerPitch: -2, midPitch: -2.5, clavElev: 1.5, clavProt: -2, elbow: 6, abduct: 3 }, scale: 2.4, hands: { shape: 'open', amount: 1 }, response: { f: 1.4, zeta: 0.55, r: -0.3 }, heldShare: 1, support: null, armForm: null, tempo: 1.15, amplitude: 1.2, tension: 0.45, breath: 1.1, sigh: false },
  sad: { posture: { lowerPitch: 5, midPitch: 4, clavElev: -2, clavProt: 4, elbow: -4, pelvisY: -0.004 }, scale: 2.1, hands: { curl: 1.25 }, response: { f: 0.45, zeta: 1, r: 0 }, heldShare: 1, support: null, armForm: 'hand-to-chest', tempo: 0.7, amplitude: 0.6, tension: 0.2, breath: 0.7, sigh: true },
  angry: { posture: { lowerPitch: 2, midPitch: -1, clavElev: 3, clavProt: 3, elbow: 10, abduct: 5 }, scale: 1.9, hands: { shape: 'fist', amount: 0.8 }, response: { f: 2.2, zeta: 0.7, r: -0.25 }, heldShare: 1, support: 'centre', armForm: null, tempo: 1.1, amplitude: 0.75, tension: 0.9, breath: 1.3, sigh: false },
  think: { posture: { lowerRoll: 2 }, scale: 4, hands: null, response: { f: 0.8, zeta: 0.9, r: 0 }, heldShare: 1, support: 'side', armForm: 'thinking-hand', tempo: 0.8, amplitude: 0.7, tension: 0.4, breath: 1, sigh: false },
  surprised: { posture: { lowerPitch: -4, midPitch: -3, clavElev: 6, elbow: 15, abduct: 8, pelvisZ: -0.006, pelvisY: 0.003 }, scale: 0.95, hands: { shape: 'open', amount: 1, spread: 1.3 }, response: { f: 4, zeta: 0.45, r: 0 }, heldShare: 0.35, support: null, armForm: null, tempo: 1.2, amplitude: 1.1, tension: 0.75, breath: 1.3, sigh: false },
  // Awkward and question add a bilateral signature to 4c's one-sided shoulder: a random side cancels in the mean, a
  // person still shows them on both sides (awkward hunches, question gives the small shrug of uncertainty), at the
  // note's own shoulder magnitude.
  awkward: { posture: { sideClavElev: 2, clavElev: 2, midPitch: 1.5, lowerRoll: 1.5, elbow: 5 }, scale: 4, hands: null, response: { f: 1.2, zeta: 0.7, r: -0.2 }, heldShare: 1, support: null, armForm: null, tempo: 1.25, amplitude: 0.9, tension: 0.6, breath: 1, sigh: false },
  question: { posture: { lowerPitch: 2, clavElev: 1.5, sideClavElev: 1.5 }, scale: 4, hands: null, response: { f: 1.6, zeta: 0.65, r: -0.2 }, heldShare: 1, support: null, armForm: null, tempo: 1, amplitude: 1, tension: 0.5, breath: 1, sigh: false },
  // 4c's neck +4 and head -4 are left to Natural: the body never adds a second head posture (plan 3.2).
  curious: { posture: { lowerPitch: 3.5, midPitch: 2, pelvisZ: 0.006 }, scale: 3.6, hands: null, response: { f: 1.3, zeta: 0.7, r: -0.3 }, heldShare: 1, support: null, armForm: null, tempo: 1.1, amplitude: 1, tension: 0.5, breath: 1, sigh: false },
  neutral: { posture: {}, scale: 0, hands: null, response: null, heldShare: 0, support: null, armForm: null, tempo: 1, amplitude: 1, tension: 0.4, breath: 1, sigh: false },
  love: { posture: { lowerRoll: 2, clavElev: -1, clavProt: 2 }, scale: 4, hands: null, response: { f: 0.7, zeta: 0.85, r: -0.15 }, heldShare: 1, support: null, armForm: 'hand-to-chest', tempo: 0.85, amplitude: 0.9, tension: 0.25, breath: 1.1, sigh: false },
  flustered: { posture: { clavElev: 4, clavProt: 3, elbow: 12, midYaw: 3 }, scale: 1.7, hands: null, response: { f: 2, zeta: 0.5, r: -0.1 }, heldShare: 1, support: null, armForm: 'hand-to-chest', tempo: 1.4, amplitude: 1.05, tension: 0.7, breath: 1.2, sigh: false },
  sleepy: { posture: { lowerPitch: 4, midPitch: 3, clavElev: -2, pelvisY: -0.006 }, scale: 3.5, hands: null, response: { f: 0.35, zeta: 1, r: 0 }, heldShare: 1, support: null, armForm: null, tempo: 0.55, amplitude: 0.6, tension: 0.1, breath: 1.4, sigh: false },
}

/** Arm forms engage above "slight", at a clear pulse and above (lead ruling R3). */
const ARM_FORM_WEIGHT = 0.5
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

/**
 * The body pose of an unheld pulse, as one reaction with the face (lead ruling R2b). It rises with Natural's impulse
 * attack `(t/tau)^2 e^{2(1 - t/tau)}` to its peak at the band's head tau (`impulses.ts` `impulseEnvelope`), holds for
 * the band's face hold, and releases with the face's release time constant as `(1 + a/tau) e^{-a/tau}`, which starts
 * with zero slope; Natural holds and releases the face hints the same way (`impulses.ts` `hintValue`). Every junction
 * is continuous in value and slope.
 */
function episodeEnvelope(age: number, attack: number, hold: number, release: number): number {
  if (age <= 0)
    return 0
  if (age < attack) {
    const u = age / attack
    return u * u * Math.exp(2 * (1 - u))
  }
  if (age < hold)
    return 1
  const a = (age - hold) / release
  return (1 + a) * Math.exp(-a)
}

/** The emotion modulation of the generators (4c), each the baseline blended toward the active emotions by weight. */
export interface BodyEmotionModulation {
  tempo: number
  amplitude: number
  tension: number
  breath: number
  /** Increments once per sighing onset. */
  sighSeq: number
}

export interface EmotionLayer extends PerformanceLayer {
  readonly modulation: Readonly<BodyEmotionModulation>
}

const c = channelIndex
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
  episode: { start: number, amplitude: number, attack: number, hold: number, release: number } | null
}

/**
 * Layer 3 of 3g: an additive posture per emotion, weighted by the held level (`held.level x held.strength`) or by an
 * unheld episode (its intensity under `episodeEnvelope`, lead ruling R1), each weight through the emotion's 3a
 * response. A slight pulse recruits no head in Natural and no body here. Owned groups receive no term.
 */
export function createEmotionLayer(): EmotionLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const ownedFactor = new Float64Array(BODY_CHANNELS.length)
  const modulation: BodyEmotionModulation = { tempo: 1, amplitude: 1, tension: BODY_EMOTIONS.neutral.tension, breath: 1, sighSeq: 0 }
  const report: BodyEmotionReport & { seq: number, emotion: PerformanceEmotion | null, phase: 'onset' | 'release' | null } = { seq: 0, emotion: null, phase: null }
  const tracks: Track[] = PERFORMANCE_EMOTIONS.map((emotion) => {
    const spec = BODY_EMOTIONS[emotion]
    return { emotion, spec, state: { y: 0, v: 0, x: 0 }, coefficients: spec.response && secondOrderCoefficients(spec.response, BODY_TICK), target: 0, commanded: 0, held: 0, side: 1, episode: null }
  })
  let impulseSeq: number | null = null
  let time = 0
  let active = false

  function ownership(input: BodyPerformanceInput) {
    for (let channel = 0; channel < channels.length; channel++)
      ownedFactor[channel] = Math.max(0, Math.min(1, 1 - 2 * input.owned[channelGroup(BODY_CHANNELS[channel])]))
  }

  function retarget(input: BodyPerformanceInput) {
    const impulse = input.events.impulse
    const seq = impulse?.seq ?? 0
    // The first tick only latches: a record that predates this layer (a reset performer) is not replayed.
    if (impulseSeq !== null && impulse && seq !== impulseSeq) {
      const band = defaultExpressionPerformanceSettings.naturalBands[impulse.band]
      const track = tracks.find(t => t.emotion === impulse.emotion)
      if (track?.coefficients && band.headTau) {
        track.episode = { start: time, amplitude: Math.max(0, Math.min(1, impulse.intensity)), attack: band.headTau, hold: Math.max(band.headTau, band.faceHold), release: band.faceReleaseTau }
        if (track.commanded === 0)
          track.side = impulse.side
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
        const { start, amplitude, attack, hold, release } = track.episode
        const age = time - start
        if (age > hold + RELEASE_LIFETIME * release)
          track.episode = null
        else
          episodeTarget = amplitude * episodeEnvelope(age, attack, hold, release)
      }
      track.held = heldTarget >= track.held || HELD.releaseTau === 0 ? heldTarget : heldTarget + (track.held - heldTarget) * Math.exp(-BODY_TICK / HELD.releaseTau)
      if (heldTarget === 0 && track.held < HELD_REST)
        track.held = 0
      const commanded = Math.max(heldTarget, episodeTarget)
      if (commanded > 0 && track.commanded === 0) {
        if (heldTarget > 0)
          track.side = held.side
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

  function addPosture(track: Track, rest: Float32Array) {
    const w = track.state.y
    const { posture: p, scale, hands } = track.spec
    const k = w * scale * DEG
    const s = track.side
    channels[c('lowerPitch')] += k * (p.lowerPitch ?? 0)
    channels[c('midPitch')] += k * (p.midPitch ?? 0)
    channels[c('lowerRoll')] += k * s * (p.lowerRoll ?? 0)
    channels[c('midYaw')] += k * s * (p.midYaw ?? 0)
    channels[c('pelvisY')] += w * scale * (p.pelvisY ?? 0)
    channels[c('pelvisZ')] += w * scale * (p.pelvisZ ?? 0)
    const hand = Math.max(0, Math.min(1, w))
    for (const arm of SIDES) {
      const start = ARM_START[arm]
      channels[start] += k * ((p.clavElev ?? 0) + (arm === sideIndex(s) ? p.sideClavElev ?? 0 : 0))
      channels[start + 1] += k * (p.clavProt ?? 0)
      channels[start + 3] += k * (p.abduct ?? 0)
      channels[start + 5] += k * (p.elbow ?? 0)
      if (!hands)
        continue
      // Index to little finger, three joints each; the thumb keeps its rest curl.
      for (let finger = 1; finger < 5; finger++) {
        for (let joint = 0; joint < 3; joint++) {
          const index = start + 9 + finger * 3 + joint
          if ('curl' in hands) {
            channels[index] += hand * (hands.curl - 1) * rest[index]
            continue
          }
          const shape = HAND_SHAPES[hands.shape]
          const indexRest = rest[start + 12 + joint]
          const curl = shape.index[joint] * DEG * (shape.others === 'same' || indexRest === 0 ? 1 : rest[index] / indexRest)
          channels[index] += hand * hands.amount * (curl - rest[index])
        }
      }
      if ('shape' in hands)
        channels[start + 24] += hand * hands.amount * (HAND_SHAPES[hands.shape].spread * (hands.spread ?? 1) * DEG - rest[start + 24])
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
      let support: PerformancePlan['support']
      let armForm: PerformancePlan['armForm']
      let strongest = 0
      for (const track of tracks) {
        if (track.spec.support && track.commanded > strongest && owned.lowerBody <= 0.5 && owned.upperBody <= 0.5) {
          strongest = track.commanded
          support = track.spec.support === 'centre' ? 0 : track.side
        }
        const form = track.spec.armForm
        const side = sideIndex(track.side)
        if (form && track.commanded > ARM_FORM_WEIGHT && owned[`${side}Arm`] <= 0.5)
          armForm = { side, form }
      }
      return { ...(support === undefined ? {} : { support }), ...(armForm === undefined ? {} : { armForm }) }
    },
    step(context: PerformanceContext) {
      time = context.time
      retarget(context.input)
      channels.fill(0)
      let anyTarget = false
      let moving = false
      modulation.tempo = modulation.amplitude = modulation.breath = 1
      modulation.tension = BODY_EMOTIONS.neutral.tension
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
      active = anyTarget || moving
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
        track.target = track.commanded = track.held = 0
        track.episode = null
      }
      Object.assign(modulation, { tempo: 1, amplitude: 1, tension: BODY_EMOTIONS.neutral.tension, breath: 1, sighSeq: 0 })
      Object.assign(report, { seq: 0, emotion: null, phase: null })
      impulseSeq = null
      time = 0
      active = false
    },
  }
}
