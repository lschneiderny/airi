import type { ArmKey } from './arm-key'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyGestureHand, BodyGesturePhase, BodyGestureReport, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { ArmPose, SpeechGestureForm } from './gesture-forms'
import type { LayerOutput, PerformanceContext, PerformanceLayer } from './stack'

import { minJerk } from '../dynamics'
import { deriveSeed } from '../noise'
import { createRandomStream } from '../random'
import { armCascadeDelay, armResponse } from './arms'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, SIDES } from './channels'
import { ARM_FORMS, GESTURE_FORMS, gestureGain, GestureKeys, gestureTempo, KEY_HEADROOM, writeHandShape } from './gesture-forms'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Architecture 4a and plan 3.1 timing, in seconds unless named otherwise. */
const TIMING = {
  /** Minimum gap between two stroke starts (4a minor-beat gap). */
  strokeGap: 0.45,
  unitStrokes: 6,
  unitSeconds: 9,
  /** Retract after `voice.slow` stays under 0.05 this long, or this long after speaking ends. */
  quiet: 0.8,
  afterSpeech: 0.3,
  retractionScale: 1.3,
  /** Refractory after a retraction: base + span x (1 - E). */
  refractoryBase: 2.5,
  refractorySpan: 3,
  /** The same non-beat form does not repeat within this window. */
  formRepeat: 8,
  /** A chop follows two accepted emphases inside this window. */
  chopWindow: 3,
  /** Return from the post-stroke hold to the ready key, before tempo. */
  recovery: 0.3,
  /** Exit ramp of the layer weight; the retraction ends with it. */
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
 * The coefficients of an active arm follower's inverse, `x = y + lead y' + curvature y''` (3a, r = 0), on channel `j`
 * at mood tension `tension`; damping is the follower's own clamp to [0.3, 1].
 */
function followerInverse(j: number, tension: number): readonly [lead: number, curvature: number] {
  const [f, zeta] = armResponse(j, 1, tension)
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
 * goal-2 speak runs' largest same-run placebo p95 (2.37 degrees) by 1.25 at the lowest speak energy.
 */
const AMPLITUDE = {
  minor: 0.6,
  walking: 0.6,
  nonDominant: 0.85,
  nonDominantSwivel: 6,
  drift: 0.015,
  torsoYaw: 1.2 * 2.6 * DEG,
  torsoPitch: 0.8 * 2.6 * DEG,
  torsoMidShare: 0.5,
  torsoMidLag: 0.07,
  torsoDecay: 0.5,
} as const

type TrackState = 'rest' | 'preparation' | 'ready' | 'stroke' | 'hold' | 'recovery' | 'retraction' | 'form'

interface Segment {
  readonly from: ArmPose
  readonly velocity: ArmPose
  readonly to: ArmPose
  start: number
  /**
   * Each channel's duration: the segment's, or longer where a channel's change would ask its follower for more than
   * its input slope, so a large turn of the forearm, wrist or fingers arrives after the hit (4a: the hand shape last).
   */
  readonly durations: ArmPose
}

interface TorsoPulse {
  readonly start: number
  readonly hit: number
  readonly yaw: number
  readonly pitch: number
}

const pose = (): ArmPose => new Float64Array(26)

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
  readonly key = pose()
  readonly segment: Segment = { from: pose(), velocity: pose(), to: pose(), start: 0, durations: pose().fill(1) }
  readonly pulses: TorsoPulse[] = []
  state: TrackState = 'rest'
  weight = 0
  exitSeconds: number = TIMING.exit
  /** When the weight request drops so the exit ramp ends with the retraction. */
  dropAt = Infinity
  phaseEnd = Infinity
  holdEnd = Infinity
  /** The current stroke's post-stroke hold length, seconds, and its drift key, 1.5 % A past the stroke key. */
  holdSeconds = 0
  readonly drift = pose()
  /**
   * The stroke being watched on the arm's actual output: its wrist speed peak and last sample, so the report marks the
   * apex the motion shows (plan 2.1: timing comes from kinematics).
   */
  watch: { form: SpeechGestureForm, hand: BodyGestureHand, peak: number, speed: number, wrist: readonly [number, number, number] | null, until: number } | null = null
  form: SpeechGestureForm | BodyArmForm | null = null
  prepSeconds = 0.5
  /** When the current stroke's wrist lands: its profile's end plus the elbow's cascade delay. */
  landing = 0
  pending: { at: number, form: SpeechGestureForm, size: number } | null = null
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
   * Starts a motion to `to` from the current target, continuing the plan's velocity (quintic decay of `v0`), and
   * returns its duration: `duration`, or longer when the followers could not take its fed-forward channels in that
   * time. The target stays continuous: the inverse term is zero at both ends of every segment.
   */
  move(to: ArmPose, now: number, duration: number, tension: number): number {
    const s = this.segment
    const fed = Math.max(BODY_TICK, duration, this.fedForwardFloor(to, tension))
    s.from.set(this.pose)
    for (let j = 0; j < 26; j++)
      s.velocity[j] = this.warm ? (this.planned[j] - this.plannedPrevious[j]) / BODY_TICK : 0
    s.to.set(to)
    s.start = now
    for (let j = 0; j < 26; j++)
      s.durations[j] = j >= 2 && j <= 5 ? fed : Math.max(fed, MIN_JERK_PEAK_SLOPE * Math.abs(to[j] - s.from[j]) / FOLLOWER_INPUT_SLOPE)
    return fed
  }

  advance(now: number, tension: number): void {
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
    }
    this.warm = true
  }

  /**
   * The shortest segment from the current target to `to` whose fed-forward channels (flex, abduct, twist, elbow) stay
   * within the follower input slope: their target's slope is `D (s' / T + lead s'' / T^2 + curvature s''' / T^3)` for
   * minimum jerk `s`. The other channels take their own durations (`move`).
   */
  private fedForwardFloor(to: ArmPose, tension: number): number {
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
          worst = Math.max(worst, Math.abs((to[j] - this.pose[j]) * (rate + lead * acceleration + curvature * jerk)))
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
    const shape = minJerk(u)
    // h(u) = u - 6u^3 + 8u^4 - 3u^5: unit initial slope, zero value, slope and curvature at u = 1.
    const decay = duration * (u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5)
    return s.from[j] + (s.to[j] - s.from[j]) * shape + s.velocity[j] * decay
  }

  torso(now: number): void {
    this.additive.fill(0)
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i]
      const upper = pulseShape(pulse, now)
      const mid = AMPLITUDE.torsoMidShare * pulseShape(pulse, now - AMPLITUDE.torsoMidLag)
      if (now > pulse.hit + AMPLITUDE.torsoDecay + AMPLITUDE.torsoMidLag) {
        this.pulses.splice(i, 1)
        continue
      }
      this.additive[12] += upper * pulse.yaw
      this.additive[13] += upper * pulse.pitch
      this.additive[9] += mid * pulse.yaw
      this.additive[10] += mid * pulse.pitch
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
    this.pulses.length = 0
    this.warm = false
  }
}

/** Torso participation of one stroke: the stroke's own warped rise to its hit, then a minimum-jerk return. */
function pulseShape(pulse: TorsoPulse, now: number): number {
  if (now <= pulse.start)
    return 0
  if (now < pulse.hit)
    return minJerk(((now - pulse.start) / (pulse.hit - pulse.start)) ** 0.8)
  return 1 - minJerk((now - pulse.hit) / AMPLITUDE.torsoDecay)
}

/**
 * Plans co-speech gesture units (architecture 4a with plan 3.1's changes, D3) and performs the emotion arm forms the
 * merged plan requests. Shared by the two per-side layers, and advanced once per performer tick.
 */
class GesturePerformer {
  readonly tracks: Record<BodySide, ArmTrack> = { left: new ArmTrack('left'), right: new ArmTrack('right') }
  readonly report: Mutable<BodyGestureReport> = { unitSeq: 0, strokeSeq: 0, form: null, hand: null, phase: 'rest', plannedHit: null }
  private random
  private dominant: BodySide = 'right'
  private keys: GestureKeys | null = null
  private tick = -1
  private unit = { active: false, sides: [] as BodySide[], twoHand: false, energy: 0.5, start: 0, strokes: 0, retracting: false }
  private lastOnset = 0
  private lastEmphasis = 0
  private wasSpeaking = false
  private speechEnded = -Infinity
  private quiet = 0
  private lastStroke = -Infinity
  private refractoryEnd = -Infinity
  private readonly majors: number[] = []
  private readonly formTimes = new Map<SpeechGestureForm, number>()
  private armForm: { side: BodySide, form: BodyArmForm } | null = null
  /** Natural's mood tension this tick: the arm followers' stiffness, which every segment's feedforward inverts. */
  private tension = 0
  private readonly scratch = pose()

  constructor(private readonly traits: BodyRigTraits, private readonly seed: number) {
    this.random = createRandomStream(deriveSeed(seed, 140))
    this.reset()
  }

  reset(): void {
    this.random = createRandomStream(deriveSeed(this.seed, 140))
    this.dominant = this.random() < 0.85 ? 'right' : 'left'
    this.keys = null
    this.tick = -1
    this.unit = { active: false, sides: [], twoHand: false, energy: 0.5, start: 0, strokes: 0, retracting: false }
    this.lastOnset = this.lastEmphasis = 0
    this.wasSpeaking = false
    this.speechEnded = -Infinity
    this.quiet = 0
    this.lastStroke = this.refractoryEnd = -Infinity
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
    this.tension = input.mood.tension
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
      this.yieldOwned(side, input, now)
    this.performArmForm(context, now)

    const unit = this.unit
    if (unit.active && !unit.retracting) {
      const ended = !voice.speaking && now - this.speechEnded >= TIMING.afterSpeech
      const capped = (unit.strokes >= TIMING.unitStrokes && now - this.lastStroke >= 0.6) || now - unit.start >= TIMING.unitSeconds
      if (ended || this.quiet >= TIMING.quiet || capped || !this.performable(input))
        this.retract(now)
    }
    if (!unit.active && (speakingEdge || (voice.speaking && onset)) && now >= this.refractoryEnd && this.performable(input))
      this.startUnit(context, now)
    if (unit.active && !unit.retracting && onset)
      this.stroke(context, now, major)

    for (const side of SIDES)
      this.step(this.tracks[side], context, now)
    if (unit.active && unit.sides.every(side => !this.tracks[side].active || this.tracks[side].state === 'form')) {
      unit.active = false
      this.refractoryEnd = now + TIMING.refractoryBase + TIMING.refractorySpan * (1 - unit.energy)
    }
    this.report.phase = this.phase()
  }

  /** Not while listening, sleepy, resting or asleep (4a), and only standing or sitting. */
  private performable(input: BodyPerformanceInput): boolean {
    const sleepy = input.held.emotion === 'sleepy' && input.held.level * input.held.strength > 0.5
    return input.energy.mode !== 'listening' && !sleepy && input.directive.rest === 'none' && input.directive.stance !== 'sleep'
  }

  private free(side: BodySide, input: BodyPerformanceInput, context: PerformanceContext): boolean {
    return context.capabilities.gestures[side]
      && input.owned[side === 'left' ? 'leftArm' : 'rightArm'] === 0
      && input.owned[side === 'left' ? 'leftFingers' : 'rightFingers'] === 0
      && !this.tracks[side].active
  }

  /** A clip claiming a performing arm ends that arm's part at once, its weight gone before the claim reaches 0.5. */
  private yieldOwned(side: BodySide, input: BodyPerformanceInput, now: number): void {
    const track = this.tracks[side]
    const owned = Math.max(input.owned[side === 'left' ? 'leftArm' : 'rightArm'], input.owned[side === 'left' ? 'leftFingers' : 'rightFingers'])
    if (!track.active || owned === 0 || track.weight === 0)
      return
    track.exitSeconds = TIMING.cancel
    track.weight = 0
    track.dropAt = now
    track.phaseEnd = now + TIMING.cancel
    track.state = 'retraction'
    track.pending = null
    if (this.armForm?.side === side)
      this.armForm = null
  }

  private performArmForm(context: PerformanceContext, now: number): void {
    const request = context.plan.armForm
    const held = this.armForm
    if (held && (!request || request.side !== held.side || request.form !== held.form)) {
      const track = this.tracks[held.side]
      if (track.state === 'form')
        this.retractTrack(track, now)
      this.armForm = null
    }
    if (!request || this.armForm || !this.keys || !this.free(request.side, context.input, context))
      return
    const track = this.tracks[request.side]
    this.captureHome(track, context)
    track.key.set(track.home)
    writeHandShape(ARM_FORMS[request.form].shape, track.key)
    if (!this.keys.armForm(request.side, request.form, track.key))
      return
    const travel = this.travel(request.side, track.home, track.key)
    this.begin(track, now)
    track.prepSeconds = track.move(track.key, now, (0.25 + 0.35 * travel) / gestureTempo(context.input.energy.level), this.tension)
    track.state = 'form'
    track.form = request.form
    track.phaseEnd = Infinity
    this.armForm = { side: request.side, form: request.form }
  }

  private startUnit(context: PerformanceContext, now: number): void {
    const { input } = context
    const energy = Math.max(0, Math.min(1, input.energy.level))
    const walking = input.gait !== null && input.gait.mode !== 'idle'
    const free = SIDES.filter(side => this.free(side, input, context))
    if (!free.length || !this.keys)
      return
    const twoHand = !walking && free.length === 2 && this.random() < 0.15 + 0.25 * energy
    const other: BodySide = this.dominant === 'left' ? 'right' : 'left'
    const preferred = this.random() < 0.7 ? this.dominant : other
    const sides = twoHand ? [...SIDES] : [free.includes(preferred) ? preferred : free[0]]
    const started: BodySide[] = []
    for (const side of sides) {
      const track = this.tracks[side]
      this.captureHome(track, context)
      const swivel = twoHand && side !== this.dominant ? AMPLITUDE.nonDominantSwivel : 0
      if (!this.solveReady(track, this.keys.readyKey(energy, 0, swivel)))
        continue
      this.begin(track, now)
      track.prepSeconds = track.move(track.ready, now, (0.25 + 0.35 * this.travel(side, track.home, track.ready)) / gestureTempo(energy), this.tension)
      track.state = 'preparation'
      track.phaseEnd = now + track.prepSeconds
      started.push(side)
    }
    if (!started.length)
      return
    this.unit = { active: true, sides: started, twoHand: started.length === 2, energy, start: now, strokes: 0, retracting: false }
    // 4a's quiet rule reads the utterance, not the silence before it: Natural's slow envelope rises after the edge.
    this.quiet = 0
    this.report.unitSeq++
    this.report.form = null
    this.report.plannedHit = null
    this.report.hand = started.length === 2 ? 'both' : started[0]
  }

  /**
   * Solves the ready key from the arm's home with the headroom of a key the arm settles on. Where no reachable key
   * clears it (Ellen's low ready keys sit between her skirt colliders below energy 0.85), the key that clears the
   * margin is used, so the unit still starts.
   */
  private solveReady(track: ArmTrack, key: ArmKey): boolean {
    for (const headroom of [KEY_HEADROOM, 0]) {
      track.ready.set(track.home)
      writeHandShape('relaxed', track.ready)
      if (this.keys?.solve(track.side, key, track.ready, track.home, headroom))
        return true
    }
    return false
  }

  private stroke(context: PerformanceContext, now: number, major: boolean): void {
    const { input } = context
    const unit = this.unit
    if (input.voice.level < VOICE.peak || input.voice.level - input.voice.slow < VOICE.prominence)
      return
    if (now - this.lastStroke < TIMING.strokeGap || unit.strokes >= TIMING.unitStrokes)
      return
    const energy = unit.energy
    const tempo = gestureTempo(energy)
    const lead = unit.twoHand ? this.dominant : unit.sides[0]
    const leadTrack = this.tracks[lead]
    const form = this.chooseForm(input, now, major, unit.twoHand)
    const seconds = GESTURE_FORMS[form].strokeSeconds / tempo
    if (!this.strokeReady(leadTrack, now, seconds))
      return
    const walking = input.gait !== null && input.gait.mode !== 'idle'
    const amplitude = (major ? 1 : AMPLITUDE.minor) * (walking ? AMPLITUDE.walking : 1)
    const size = gestureGain(energy) * GESTURE_FORMS[form].scale * amplitude
    const both = unit.twoHand && GESTURE_FORMS[form].hands !== 'one'
    const performed = this.strokeTrack(leadTrack, context, now, form, size)
    if (!performed)
      return
    if (both) {
      const lagging = this.tracks[lead === 'left' ? 'right' : 'left']
      if (lagging.active && lagging.state !== 'retraction' && lagging.state !== 'form') {
        const lag = TIMING.lagRange[0] + (TIMING.lagRange[1] - TIMING.lagRange[0]) * this.random()
        lagging.pending = { at: now + lag, form: performed, size: size * AMPLITUDE.nonDominant }
      }
    }
    const sign = lead === 'left' ? 1 : -1
    const forward = GESTURE_FORMS[performed].stroke[2] > 0
    const gain = gestureGain(energy) * amplitude
    // Plan 3.1: at the stroke the upper torso turns toward the gesturing side; it peaks as the wrist lands.
    leadTrack.pulses.push({ start: now, hit: leadTrack.landing, yaw: sign * AMPLITUDE.torsoYaw * gain, pitch: forward ? AMPLITUDE.torsoPitch * gain : 0 })
    unit.strokes++
    this.lastStroke = now
    if (major)
      this.majors.push(now)
    this.formTimes.set(performed, now)
    leadTrack.watch = { form: performed, hand: both ? 'both' : lead, peak: 0, speed: 0, wrist: null, until: now + seconds + 0.3 }
  }

  /** A stroke leaves from the ready key, a hold or a recovery; from a preparation only if it would end first. */
  private strokeReady(track: ArmTrack, now: number, seconds: number): boolean {
    if (track.state === 'ready' || track.state === 'hold' || track.state === 'recovery' || track.state === 'stroke')
      return true
    return track.state === 'preparation' && track.phaseEnd - now <= seconds
  }

  /** Solves and starts one arm's stroke; returns the form performed (a beat when the chosen form has no clear key). */
  private strokeTrack(track: ArmTrack, context: PerformanceContext, now: number, form: SpeechGestureForm, size: number): SpeechGestureForm | null {
    const keys = this.keys
    if (!keys)
      return null
    const energy = this.unit.energy
    const tempo = gestureTempo(energy)
    const swivel = this.unit.twoHand && track.side !== this.dominant ? AMPLITUDE.nonDominantSwivel : 0
    for (const candidate of form === 'beat' ? ['beat'] as const : [form, 'beat'] as const) {
      const ready = keys.readyKey(energy, candidate === 'frame' ? 0.1 : 0, swivel)
      const yaw = candidate === 'point' ? this.pointYaw(context.input, track.side) : 0
      // Post-stroke hold: the hand drifts 1.5 % A further along the stroke, so the stroke's end is where the arm ends up.
      // That end is the pose cleared against the proxies; the key lies on the cleared path from the ready key, short of it.
      const drift = AMPLITUDE.drift / Math.hypot(...GESTURE_FORMS[candidate].stroke)
      track.drift.set(track.ready)
      writeHandShape(GESTURE_FORMS[candidate].shape, track.drift)
      if (!keys.solve(track.side, keys.strokeKey(ready, candidate, size + drift, yaw), track.drift, track.ready))
        continue
      track.key.set(track.drift)
      for (let j = 2; j <= 5; j++)
        track.key[j] = track.ready[j] + (track.drift[j] - track.ready[j]) * size / (size + drift)
      const seconds = GESTURE_FORMS[candidate].strokeSeconds / tempo
      const [low, high] = GESTURE_FORMS[candidate].hold
      const hold = (low + (high - low) * this.random()) / tempo
      // 4a: the hit lands at the stroke's duration. Feedforward removes the followers' lag, leaving the elbow's cascade
      // delay before the wrist lands. A stroke the followers cannot take that fast lasts longer (`move`).
      const delay = armCascadeDelay(5, 1, 1, this.tension)
      const profile = track.move(track.key, now, seconds - delay, this.tension)
      track.landing = now + profile + delay
      track.state = 'stroke'
      track.form = candidate
      track.phaseEnd = now + profile
      track.holdSeconds = hold
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
    const candidates: SpeechGestureForm[] = []
    if (this.unit.strokes === 0 && r < 0.5)
      candidates.push('palm-up')
    if (major && this.majors.length >= 1)
      candidates.push('chop')
    if (input.gaze.kind === 'sustained')
      candidates.push('point')
    if (twoHand && this.unit.energy > 0.6 && r < 0.5)
      candidates.push('frame')
    const pick = this.random()
    const press = FORM_SHARE.press + FORM_SHARE.pressEnergy * this.unit.energy
    candidates.push(pick < FORM_SHARE.palmUp ? 'palm-up' : pick < FORM_SHARE.palmUp + press ? 'press' : 'beat')
    return candidates.find(form => form === 'beat' || fresh(form)) ?? 'beat'
  }

  /** Point yaws toward the gaze goal, at most 30 degrees, measured from straight ahead of the body. */
  private pointYaw(input: BodyPerformanceInput, side: BodySide): number {
    const yaw = Math.max(-30 * DEG, Math.min(30 * DEG, input.gaze.yaw - input.facingYaw))
    return side === 'left' ? yaw : -yaw
  }

  /**
   * Watches the lead arm's stroke on its actual output, the previous frame, and reports the stroke at the first wrist
   * speed minimum after the peak that is at most half of it: the gesture report's apex rule. A stroke that shows no
   * apex in time is not reported.
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
    if (watch.peak > 0 && speed > watch.speed && watch.speed <= 0.5 * watch.peak) {
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

  private retract(now: number): void {
    this.unit.retracting = true
    for (const side of this.unit.sides) {
      const track = this.tracks[side]
      if (track.active && track.state !== 'retraction' && track.state !== 'form')
        this.retractTrack(track, now)
    }
  }

  /** Returns the arm to where it was before the unit, 1.3 x its preparation, while the weight ramps down with it. */
  private retractTrack(track: ArmTrack, now: number): void {
    const duration = track.move(track.home, now, Math.max(TIMING.exit + BODY_TICK, TIMING.retractionScale * track.prepSeconds), this.tension)
    track.state = 'retraction'
    track.pending = null
    track.phaseEnd = now + duration
    track.dropAt = track.phaseEnd - TIMING.exit
    track.exitSeconds = TIMING.exit
  }

  private step(track: ArmTrack, context: PerformanceContext, now: number): void {
    if (track.pending && now >= track.pending.at) {
      const { form, size } = track.pending
      track.pending = null
      this.strokeTrack(track, context, now, form, size)
    }
    if (track.state === 'stroke' && now >= track.phaseEnd) {
      // The hit (4a): the planned profile has ended; the post-stroke hold drifts on from here.
      track.state = 'hold'
      track.holdEnd = now + track.move(track.drift, now, track.holdSeconds, this.tension)
    }
    this.observe(track, context, now)
    if (track.state === 'hold' && now >= track.holdEnd) {
      track.state = 'recovery'
      track.phaseEnd = now + track.move(track.ready, now, TIMING.recovery / gestureTempo(this.unit.energy), this.tension)
    }
    else if ((track.state === 'recovery' || track.state === 'preparation') && now >= track.phaseEnd) {
      track.state = 'ready'
    }
    if (track.state === 'retraction' && now >= track.dropAt)
      track.weight = 0
    if (track.state === 'retraction' && now >= track.phaseEnd) {
      track.state = 'rest'
      track.form = null
      track.exitSeconds = TIMING.exit
    }
    if (track.active || track.weight > 0)
      track.advance(now, this.tension)
    track.torso(now)
    track.write()
  }

  private begin(track: ArmTrack, now: number): void {
    track.pose.set(track.home)
    track.planned.set(track.home)
    track.plannedPrevious.set(track.home)
    track.warm = false
    track.segment.start = now
    track.weight = 1
    track.exitSeconds = TIMING.exit
    track.dropAt = Infinity
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
 * The co-speech gesture layer (architecture 4a, plan 3.1): one override layer per arm, sharing one planner, so each
 * arm has its own weight ramp and activation. Register both, in this order. With no speech and no requested arm form
 * both stay at weight 0 and the performer's output is bit-identical to having no layers.
 *
 * - A unit starts on every utterance (plan D3), on the speaking edge so the preparation ends before the first peak.
 *   Every onset passing the gate's S2 voice-peak rule strokes, at least 0.45 s apart; accepted emphases are major.
 * - The report's `strokeSeq` and `plannedHit` change when the lead arm's wrist reaches its apex on the arm's actual
 *   output (the first speed minimum after the stroke's peak, at most half of it). `plannedHit` is that apex, a tick or
 *   two in the past, so the marker's time is the motion's, never a claim (plan 2.1).
 * - `plan.armForm` (hand to chest, thinking hand) is held on the requested arm. Whichever performance holds an arm
 *   keeps it: a speech unit then uses the other hand, and a requested form waits for a unit to retract.
 * - A clip claiming a performing arm takes it within 90 ms; no unit starts on an arm with any ownership.
 */
export function createGestureLayers(options: GestureLayerOptions): readonly [PerformanceLayer, PerformanceLayer] {
  const performer = new GesturePerformer(options.traits, options.seed)
  const layer = (side: BodySide): PerformanceLayer => {
    const track = performer.tracks[side]
    const output: Mutable<LayerOutput> = { channels: track.channels, additive: track.additive, weight: 0, sequence: 0, gesture: performer.report }
    return {
      id: `gesture-${side}`,
      order: 'gesture',
      mode: 'override',
      mask: track.mask,
      enterSeconds: TIMING.enter,
      get exitSeconds() {
        return track.exitSeconds
      },
      step: (context) => {
        performer.update(context)
        output.weight = track.weight
        return output
      },
      reset: () => performer.reset(),
    }
  }
  return [layer('left'), layer('right')]
}
