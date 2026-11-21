import type { BeatClockState } from './beat-clock'
import type { GazePoint, GlanceSource, NaturalGazeLayer } from './gaze'
import type { IdleErrandKind, IdleErrandRecord } from './idle-errands'
import type { IdleOrder, IdleReport, IdleView } from './idle-schedule'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { beatAt } from './beat-clock'
import { clamp01, dormantIdleView, finite, IDLE_WAKE_SECONDS, sameIdleDrive } from './idle-schedule'
import { minJerk } from './processes'
import { createRandomStream } from './random'

/**
 * Acts only a whole body can show (architecture 4e acts 1, 2, 3, 6, 7, 8 and 11). They have no face or head shape here;
 * a host that performs a body plays them, and they are drawn only when its drive sets `body`.
 */
export const IDLE_BODY_KINDS = ['sigh', 'shoulder-roll', 'shift-stance', 'clasp-hands', 'hair-touch', 'heel-rock', 'arm-swing'] as const
export type IdleBodyKind = typeof IDLE_BODY_KINDS[number]

export function isIdleBodyKind(kind: IdleBehaviourKind): kind is IdleBodyKind {
  return (IDLE_BODY_KINDS as readonly IdleBehaviourKind[]).includes(kind)
}

/** Something she does on her own while nobody asks anything of her. `sleep` lasts until a `wake` or `rouse` input ends it. */
export type IdleActivityKind = 'stretch' | 'yawn' | 'look-around' | 'check-in' | 'peer' | 'zone-out' | 'nod-off' | 'sway' | 'sleep' | IdleBodyKind

/** Body language the host requests around a reach-out: the moment before she may speak, and letting the thought go. */
export type IdleCueKind = 'about-to-speak' | 'let-go'

export type IdleBehaviourKind = IdleActivityKind | IdleCueKind

/** The voice cues' glances rank with a chat read in the gaze layer, above her own idle acts. */
const voiceCues: ReadonlySet<IdleBehaviourKind> = new Set<IdleCueKind>(['about-to-speak', 'let-go'])
/** The glances this layer starts; releasing a behaviour ends only one of these, never a glance another layer started. */
const ownGlances: ReadonlySet<GlanceSource> = new Set<GlanceSource>(['idle-act', 'voice-cue', 'sleep-wake'])

/** Activities the idle schedule draws; `sleep` is entered by the away rule, never drawn. */
export type DrawnIdleActivityKind = Exclude<IdleActivityKind, 'sleep'>

/**
 * What shapes her idle behaviour, set by the host from the slower character state and the desktop.
 * A neutral drive (all zero) is a rested daytime character who talked a moment ago.
 */
export interface NaturalIdleDrive {
  /** Slow mood energy relative to her resting disposition, -1 (drained) to 1 (buzzing). */
  energy: number
  /** Slow mood valence relative to resting, -1 (upset) to 1 (bright). */
  valence: number
  /** Slow mood tension relative to resting, -1 to 1; positive is on edge. */
  tension: number
  /** 0 during the day, 1 deep in the night. */
  sleepiness: number
  /** 0 right after an exchange, 1 after a long time without one. */
  solitude: number
  /** Multiplies how often activities start; 1 is the default pace, 0 leaves only sleep and cues. */
  rate: number
  /**
   * The host performs a whole body (MMD): the whole-body kinds can be drawn and she settles in after a long idle.
   * Absent on a host that shows a head and face only (Live2D), which then draws exactly as it did before they existed.
   */
  body?: boolean
  /**
   * Whole-body kinds this host's body cannot perform, such as a clasp whose anchor the rig's arms cannot reach. They
   * weigh 0, so she never draws an act that would show nothing. Absent, every whole-body kind keeps its weight.
   */
  unreachable?: readonly IdleBodyKind[]
  /**
   * The errands this host can realise now: `pastime` where she has props of her own (Live2D), `idle-clip` where the
   * user allowed clips for idle and `wander` in roam mode (MMD). Absent, none is drawn and the draw is as before.
   */
  errands?: readonly IdleErrandKind[]
}

/**
 * The latest behaviour the layer started, kept after it ends, for a host that performs its own form of it. `start`,
 * `end` and `releasedAt` are active seconds; glance `at` is seconds after `start`. A behaviour that ran its course is
 * released at its end with `releaseSeconds` 0; one released earlier (an interruption, a wake) fades over
 * `releaseSeconds`.
 */
export interface IdleBehaviourRecord {
  readonly seq: number
  readonly kind: IdleBehaviourKind
  readonly start: number
  /** `Infinity` for a behaviour that lasts until it is released. */
  readonly end: number
  readonly releasedAt: number | null
  readonly releaseSeconds: number
  readonly side: -1 | 1
  /** Sway period, seconds. */
  readonly period: number
  /** Smile (check-in) or sulk (let-go) strength, 0..1. */
  readonly tone: number
  /** Repeats a body act fits into its time: shoulder-roll sides, heel rocks, arm swings. */
  readonly count: number
  /** The clasp's place: 0 in front, 1 behind the back. */
  readonly variant: 0 | 1
  /** Look-around head keys, or nod-off droops as `t` (start) and `x` (sink seconds). */
  readonly keys: readonly { readonly t: number, readonly x: number, readonly y: number }[]
  readonly glances: readonly { readonly at: number, readonly x: number, readonly y: number, readonly hold: number }[]
}

/** The per-step facts the controller already knows; this layer reads no other state. */
export interface IdleStepInput {
  /** `idle` and `watching` let activities start; any other mode ends them. */
  mode: 'idle' | 'watching' | 'listening' | 'thinking' | 'talking'
  /** The user has left the desktop. */
  away: boolean
  /** Another layer owns the head or the eyes (a pet, a chat glance, a gesture, a held emotion), so nothing new starts. */
  blocked: boolean
  /** Something happened that she must answer at once (a poke, an emotion, a cue gesture, a cursor she noticed). */
  interrupt: boolean
  /** A touch or a desktop wake: the only interruptions that wake her from sleep before the user is back. */
  rouse: boolean
  /** Ends a sleep through the gentle wake, even while the user is still away; ignored while she is awake. */
  wake: boolean
  /** Eased screen inwardness, -1..1; the lean toward the screen follows its sign. */
  placement: number
  /** Where the screen content is, in normalized eye space. */
  screenPoint: GazePoint
  /** The controller's beat clock. A sway that starts while it is locked plays on its beat. */
  beatClock: BeatClockState
}

/** The latest sway that bound to the beat clock at its start, kept after it ends. Times are active seconds. */
export interface IdleGrooveLock {
  /** The sway's `seq`. */
  readonly seq: number
  readonly at: number
  readonly beatSeconds: number
  /** Beats per side-to-side cycle; the head bob lands on the beat every `beatsPerCycle / 2` beats. */
  readonly beatsPerCycle: number
}

/** What the layer adds to one grid step. Offsets are in the controller's normalized units; scales multiply. */
export interface IdleOutput {
  head: Vec3
  body: Vec3
  /** 0 leaves the lids alone, 1 closes them. Applied through the blink factor, so it can close eyes fully. */
  lidClose: number
  /** Multiplies eye openness; 1 leaves it. */
  eyeOpen: number
  eyeOpenHint: number
  browY: number
  mouthForm: number
  eyeSmile: number
  /** Added to the silent mouth opening; the controller drops it while speech owns the mouth. */
  mouthOpen: number
  amplitudeScale: number
  shiftRateScale: number
  continuousScale: number
  blinkIntervalScale: number
  breathPeriodScale: number
}

interface Glance {
  /** Active seconds at which the glance starts. */
  at: number
  point: GazePoint
  hold: number
}

interface Clip {
  seq: number
  kind: IdleBehaviourKind
  start: number
  /** Planned end; `Infinity` for a behaviour that lasts until it is released. */
  end: number
  releasedAt: number | null
  releaseSeconds: number
  side: -1 | 1
  /** Started by a requested order: a sleep that does not wait for the user to leave and ends on its own. */
  requested: boolean
  /** Period of the sway or of a sleep's slow nod, in seconds; a sleep without a nod has 0. */
  period: number
  /** Strength of the smile (check-in) or the sulk (let-go), 0..1. */
  tone: number
  /** Head keyframes of a look-around, or the droop lengths of a nod-off as `t`. */
  keys: { t: number, x: number, y: number }[]
  glances: Glance[]
  count: number
  variant: 0 | 1
  /** A sway bound to the beat clock at its start; null for every other clip and for a sway that started unbound. */
  groove: Groove | null
}

/** The phase of a sway that plays on the beat, advanced at each step instead of computed from its age. */
interface Groove {
  /** Beats per side-to-side cycle, kept for the whole clip so a drifting tempo never doubles her speed. */
  readonly beatsPerCycle: number
  /** Radians at `at`, unwrapped. */
  phase: number
  /** Radians per second at the latest locked step; kept while the clock is unlocked. */
  rate: number
  at: number
}

/** The beats per side-to-side cycle a bound sway may take; it takes the one whose cycle is nearest its drawn period. */
const grooveBeatsPerCycle = [2, 4, 8] as const
/**
 * Seconds over which a bound sway's phase follows a correction of the beat clock, so the head never steps. The bob
 * still moves with the beat between corrections, at the clock's rate.
 */
const grooveLagSeconds = 0.25
/**
 * The phase offset at a counted beat: `sin(2 * phase)`, the head bob, is at its low point there, so she nods down on
 * the beat (CM5b D5).
 */
const grooveBeatPhase = 3 * Math.PI / 4

/** The sway phase the beat clock asks for at `beats` beats, with `beatsPerCycle` beats per cycle. */
function grooveTarget(beats: number, beatsPerCycle: number) {
  return 2 * Math.PI * beats / beatsPerCycle + grooveBeatPhase
}

/** `radians` wrapped to the nearest turn, -π..π. */
function nearestTurn(radians: number) {
  return radians - 2 * Math.PI * Math.round(radians / (2 * Math.PI))
}

/** Seconds a look-around head move takes; holds are longer, so each move completes. */
const lookMoveSeconds = 0.7
/**
 * Seconds over which a behaviour without an envelope of its own calms the posture and gives it back. The posture
 * amplitude scales her current offset directly, so a calm that switched on at once would snap the head.
 */
const calmEaseSeconds = 0.6
/** Seconds the head snaps up after a nod-off droop, and the seconds it takes to settle afterwards. */
const nodJerkSeconds = 0.28
const nodSettleSeconds = 1.3
/** Seconds the lids and head take to sink into sleep. */
const sleepSettleSeconds = 6
/**
 * The slow nod of a sleeping head-and-face character: seconds her head sinks further, floats back, and lies still
 * before the next nod. A body host nods in its own doze instead.
 */
const sleepNod = { sink: 5, rise: 3.5, pause: 5.5 }
/** Seconds a wake by touch takes; an ordinary wake takes `IDLE_WAKE_SECONDS`. */
const startledWakeSeconds = 0.35
/** Seconds an interrupted activity takes to hand the body back. */
const interruptSeconds = 0.4
/** Longest wait, in seconds, for the model's decision before the about-to-speak hold lets go on its own. */
const aboutToSpeakMaxSeconds = 10
/** A decision that arrives after the hold ended still shows as letting go within this many seconds of its start. */
const letGoWindowSeconds = 30
/** Posture shifts slow down under an activity but never stop: a hold drawn at a lower rate would outlast it. */
const maxShiftCalm = 0.6
/** Seconds a requested sleep lasts before she wakes on her own: the settle and one slow nod, into the next. */
const playedSleepSeconds = 24
/** Seconds of continuous `idle` mode after which a body host's character settles in: the director's idle-to-sit time (architecture 4f). */
const settleSeconds = 120
/** Rise over `attack`, hold, fall over `release`; 0 outside. Zero slope at every joint. */
function trapezoid(age: number, attack: number, hold: number, release: number) {
  if (age <= 0 || age >= attack + hold + release)
    return 0
  if (age < attack)
    return minJerk(age / attack)
  return age < attack + hold ? 1 : 1 - minJerk((age - attack - hold) / release)
}

function raisedCosine(u: number) {
  return u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)
}

function neutral(): IdleOutput {
  return { head: [0, 0, 0], body: [0, 0, 0], lidClose: 0, eyeOpen: 1, eyeOpenHint: 0, browY: 0, mouthForm: 0, eyeSmile: 0, mouthOpen: 0, amplitudeScale: 1, shiftRateScale: 1, continuousScale: 1, blinkIntervalScale: 1, breathPeriodScale: 1 }
}

/** A behaviour started, or the one that ran ended; `behaviour` names it in both cases. */
export interface IdleBehaviourReport {
  phase: 'start' | 'end'
  behaviour: IdleBehaviourKind
}

/**
 * Turns successive reads of the layer's `seq` and `behaviour` into start and end reports, each behaviour reported
 * once. A reader that samples once per frame uses it to follow behaviours without an observer.
 */
export class IdleBehaviourReports {
  private behaviour: IdleBehaviourKind | null = null
  private seq = 0

  /** The reports since the previous read, an end before the start that follows it. */
  read(state: { seq: number, behaviour: IdleBehaviourKind | null }): IdleBehaviourReport[] {
    const reports: IdleBehaviourReport[] = []
    const restarted = state.seq !== this.seq
    if (this.behaviour !== null && (restarted || state.behaviour === null))
      reports.push({ phase: 'end', behaviour: this.behaviour })
    if (state.behaviour !== null && (restarted || this.behaviour === null))
      reports.push({ phase: 'start', behaviour: state.behaviour })
    this.behaviour = state.behaviour
    this.seq = state.seq
    return reports
  }
}

/** The output while nothing contributes; shared, so a quiet layer allocates nothing per step. Never written. */
const idleRest: IdleOutput = Object.freeze(neutral())

/** How far the slow mood and the hour move the user's Natural energy setting; 0 for a neutral drive. */
export function idleEnergyOffset(drive: NaturalIdleDrive | null): number {
  return drive === null ? 0 : 0.3 * finite(drive.energy) - 0.15 * clamp01(drive.sleepiness)
}

/**
 * Self-directed idle behaviour: named activities of a few seconds each, sleep, and the body language around a
 * reach-out. The character mind decides what starts when (its idle policy runs `idle-schedule.ts`); this layer plays
 * its orders and reports what it saw.
 *
 * - The layer is inert until the host sets a drive. Without one it starts nothing, refuses every order, and adds
 *   nothing, so every seeded run from before it existed replays unchanged.
 * - An order starts at the next step if she is free for it, else the layer reports it `refused`. Each act's shape
 *   (side, durations, keys, glances, count, variant) is drawn from `createRandomStream(order.seed)`, so every stage
 *   that receives the order draws the same shape. A cue's shape comes from this layer's own stream.
 * - An activity yields at once to anything she must answer: speech, thinking, listening, a poke, a pet, an emotion,
 *   a cue gesture, a cursor she noticed. It fades out over 0.4 s and releases the gaze.
 * - She wakes from sleep when the `wake` input asks, or with a start on `rouse`; a requested sleep wakes after 24 s.
 * - `view` and `takeReports` tell the mind what she can see and what started and ended, in order.
 *
 * Time is seconds of active motion. Call `step` once per grid step, then read `output`.
 */
export class NaturalIdleActivities {
  /** The contribution of the latest `step`; treat it as read-only. */
  output: IdleOutput = idleRest
  /** Increments each time a behaviour starts, so a host that samples per frame never misses a short one. */
  seq = 0
  /** The latest behaviour started, kept after it ends; null before the first. */
  record: IdleBehaviourRecord | null = null
  /** The latest sway that bound to the beat clock, kept after it ends; null before the first. */
  grooveLock: IdleGrooveLock | null = null
  /** A body host's character has been idle long enough to settle in; always false without `body`. */
  settled = false
  /** What she could see at the latest step; a new object only when a field changed. Null before the first step. */
  view: IdleView | null = null

  private drive: NaturalIdleDrive | null = null
  private readonly clips: Clip[] = []
  private pendingCue: IdleCueKind | null = null
  private readonly orders: IdleOrder[] = []
  private readonly reports: IdleReport[] = []
  /** Start time of the latest about-to-speak hold, which a let-go may answer. */
  private heldAt: number | null = null
  /** Start time of the about-to-speak hold that a let-go already answered. */
  private answeredHold: number | null = null
  private eyesUntil = 0
  /** Start of the continuous `idle` mode that settling counts from; null outside it or without `body`. */
  private idleSince: number | null = null
  /** The latest errand started, kept after it ends; null before the first. */
  errand: IdleErrandRecord | null = null
  private errandSeq = 0
  private readonly errandAnswers: { seq: number, outcome: 'done' | 'refused' }[] = []

  /** `random` draws the shapes of cues only; an ordered act draws from its own seed. */
  constructor(private readonly random: RandomStream) {}

  /** Whether any behaviour, running or fading out, contributes to `output`. */
  get contributing(): boolean {
    return this.clips.length > 0
  }

  /** The behaviour she is in now, or `null` between behaviours and while one fades out. */
  get behaviour(): IdleBehaviourKind | null {
    return this.active?.kind ?? null
  }

  /** `null` switches the layer off; a running behaviour then fades out at the next step. A drive of equal values keeps the current one. */
  setDrive(drive: NaturalIdleDrive | null) {
    if (!sameIdleDrive(drive, this.drive))
      this.drive = drive === null ? null : { ...drive }
  }

  /** How far the drive moves the Natural energy; 0 without a drive. */
  get energyOffset() {
    return idleEnergyOffset(this.drive)
  }

  /** Requests a reach-out cue; it starts at the next step and is dropped when the layer is off or she is busy. */
  cue(kind: IdleCueKind) {
    this.pendingCue = kind
  }

  /**
   * Queues what the mind decided, applied at the next step after any cue of that step. An act starts if she is free:
   * performing, not blocked, nothing running, and, for an act other than sleep, the user not away. A requested act
   * needs only performing and a free head, starts in place of the running one, and a requested `sleep` does not need
   * the user away and wakes after 24 s. An errand starts if the drive lists it and she is free for it. Anything
   * else is reported `refused`.
   */
  order(order: IdleOrder) {
    this.orders.push(order)
  }

  /** Reports `refused` for an order the host cannot hand to the layer, such as one that arrives while it is suspended. */
  refuse(order: IdleOrder) {
    this.reports.push({ kind: 'refused', intentId: order.id })
  }

  /** Moves the reports since the previous call into `into`, in the order they happened. */
  drainReports(into: IdleReport[]) {
    if (this.reports.length === 0)
      return
    into.push(...this.reports)
    this.reports.length = 0
  }

  /**
   * The realiser's answer to errand `seq`, applied at the next step: `refused` when it could not take it, `done` when
   * it took it (an unasked clip or a wander the director accepted) or finished it early (a pastime the user put away).
   * An answer to an errand that already ended is ignored.
   */
  answerErrand(seq: number, outcome: 'done' | 'refused') {
    this.errandAnswers.push({ seq, outcome })
  }

  /** Whether this layer holds the gaze at `at`, so autonomous attention shifts must wait. */
  eyesOwned(at: number) {
    return at < this.eyesUntil
  }

  /** Advances to the step that starts at `at` and samples the output at its end, `at + dt`. */
  step(at: number, dt: number, input: IdleStepInput, gaze: NaturalGazeLayer) {
    const drive = this.drive
    const performing = input.mode === 'idle' || input.mode === 'watching'
    let current = this.active

    if (current) {
      // Waiting to speak outlives the thinking mode of her own turn; everything else ends when a mode claims her.
      const claimed = current.kind === 'about-to-speak' ? input.mode === 'talking' || input.mode === 'listening' : !performing
      const interrupted = current.kind === 'sleep' ? input.rouse : input.interrupt
      if (drive === null || claimed || interrupted)
        this.release(current, at, current.kind === 'sleep' && interrupted ? startledWakeSeconds : interruptSeconds, gaze)
      else if (current.kind === 'sleep' && (input.wake || (current.requested && at >= current.end)))
        this.wake(current, at, gaze, input.wake)
      else if (current.kind === 'about-to-speak' && at - current.start >= aboutToSpeakMaxSeconds)
        this.release(current, at, 0.6, gaze)
      else if (at >= current.end)
        this.finish(current, at)
      current = this.active
    }
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const clip = this.clips[i]
      if (clip.releasedAt !== null && at >= clip.releasedAt + clip.releaseSeconds)
        this.clips.splice(i, 1)
    }

    this.updateErrand(at, drive, input, current)
    if (drive === null) {
      this.pendingCue = null
      for (const order of this.orders.splice(0))
        this.refuse(order)
      this.idleSince = null
      this.settled = false
      this.updateView(null, input, undefined)
      this.advanceGrooves(at + dt, input.beatClock)
      this.sample(at + dt)
      return
    }

    // Like the director's idle clock: anything that takes her out of `idle` mode, or must be answered, stands her up.
    if (drive.body === true && input.mode === 'idle' && !input.interrupt)
      this.idleSince ??= at
    else
      this.idleSince = null
    this.settled = this.idleSince !== null && at - this.idleSince >= settleSeconds

    const cue = this.pendingCue
    this.pendingCue = null
    if (cue === 'about-to-speak' && performing && !input.blocked && current?.kind !== 'sleep') {
      if (current)
        this.release(current, at, interruptSeconds, gaze)
      current = this.start('about-to-speak', at, drive, input, this.random, null)
      this.heldAt = at
    }
    else if (cue === 'let-go' && performing && !input.blocked) {
      // A slow model can decide after the hold ran out; she still lets the thought go if nothing else started since.
      const held = this.heldAt
      const recent = !current && held !== null && at - held <= letGoWindowSeconds && this.answeredHold !== held
      if (current?.kind === 'about-to-speak' || recent) {
        if (current)
          this.release(current, at, 0.5, gaze)
        current = this.start('let-go', at, drive, input, this.random, null)
        // One hold earns one let-go.
        this.answeredHold = held
      }
    }

    for (const order of this.orders.splice(0)) {
      if (order.kind === 'errand') {
        if (!this.errandFree(order.errand, drive, input, current)) {
          this.refuse(order)
          continue
        }
        const end = order.holdSeconds === null ? Number.POSITIVE_INFINITY : at + order.holdSeconds
        this.errand = { seq: ++this.errandSeq, kind: order.errand, start: at, end, pick: order.pick, endedAt: null, outcome: null }
        this.reports.push({ kind: 'errand-started', intentId: order.id, seq: this.errand.seq, errand: order.errand })
        continue
      }
      const free = order.requested
        ? performing && !input.blocked
        : current === undefined && performing && !input.blocked && (order.act === 'sleep' || !input.away)
      if (!free) {
        this.refuse(order)
        continue
      }
      if (current)
        this.release(current, at, interruptSeconds, gaze)
      current = this.start(order.act, at, drive, input, createRandomStream(order.seed), order.id)
      if (order.requested) {
        current.requested = true
        if (order.act === 'sleep')
          current.end = at + playedSleepSeconds
      }
    }

    for (const clip of this.clips) {
      if (clip.releasedAt !== null)
        continue
      while (clip.glances.length > 0 && at >= clip.glances[0].at) {
        const glance = clip.glances.shift()!
        // A refused glance is dropped; the act goes on without it.
        const until = gaze.glance({ source: voiceCues.has(clip.kind) ? 'voice-cue' : 'idle-act', point: glance.point, hold: glance.hold }, at)
        if (until !== null)
          this.eyesUntil = Math.max(this.eyesUntil, until)
      }
    }
    this.updateView(drive, input, current)
    this.advanceGrooves(at + dt, input.beatClock)
    this.sample(at + dt)
  }

  /**
   * The phase of the latest behaviour while it is a sway bound to the beat and still contributes, in radians at the
   * latest step's end; null otherwise. A host that plays its own form of the sway plays it at this phase.
   */
  get groovePhase(): number | null {
    const seq = this.record?.seq
    const clip = this.clips.find(candidate => candidate.seq === seq)
    return clip?.groove?.phase ?? null
  }

  /**
   * Advances each bound sway to `time`: at the clock's rate, plus a pull toward the phase the clock asks for over
   * `grooveLagSeconds`, by the nearest turn. While the clock is unlocked the sway keeps its last rate.
   */
  private advanceGrooves(time: number, clock: BeatClockState) {
    const position = beatAt(clock, time)
    for (const clip of this.clips) {
      const groove = clip.groove
      if (groove === null)
        continue
      const seconds = time - groove.at
      if (position !== null)
        groove.rate = 2 * Math.PI / (groove.beatsPerCycle * position.beatSeconds)
      groove.phase += groove.rate * seconds
      if (position !== null)
        groove.phase += nearestTurn(grooveTarget(position.beats, groove.beatsPerCycle) - groove.phase) * Math.min(1, seconds / grooveLagSeconds)
      groove.at = time
    }
  }

  /** Whether an errand may start now: the drive lists it, none runs, and she is free for it, as the schedule's hazard requires. */
  private errandFree(kind: IdleErrandKind, drive: NaturalIdleDrive, input: IdleStepInput, current: Clip | undefined) {
    const open = this.errand !== null && this.errand.endedAt === null
    const performing = input.mode === 'idle' || input.mode === 'watching'
    if (open || !performing || input.away || !(drive.errands ?? []).includes(kind))
      return false
    if (kind === 'idle-clip')
      return current === undefined && !input.blocked
    return kind !== 'pastime' || current?.kind !== 'sleep'
  }

  /** Replaces `view` when a field changed; a view without a drive is the dormant view. */
  private updateView(drive: NaturalIdleDrive | null, input: IdleStepInput, current: Clip | undefined) {
    const errand = this.errand !== null && this.errand.endedAt === null ? this.errand : null
    const view = this.view
    if (drive === null) {
      if (view === null || view.drive !== null || view.current !== null || view.errand !== null)
        this.view = dormantIdleView(true)
      return
    }
    if (view !== null && view.drive === drive && view.mode === input.mode && view.away === input.away && view.blocked === input.blocked
      && view.settled === this.settled && view.current?.seq === current?.seq && view.errand?.seq === errand?.seq) {
      return
    }
    this.view = {
      drive,
      active: true,
      mode: input.mode,
      away: input.away,
      blocked: input.blocked,
      settled: this.settled,
      current: current ? { seq: current.seq, kind: current.kind } : null,
      errand: errand && { seq: errand.seq, kind: errand.kind },
    }
  }

  /** Applies the realisers' answers and ends an errand she is no longer free for. */
  private updateErrand(at: number, drive: NaturalIdleDrive | null, input: IdleStepInput, current: Clip | undefined) {
    const errand = this.errand
    const answers = this.errandAnswers.splice(0)
    if (errand === null || errand.endedAt !== null)
      return
    const answer = answers.find(candidate => candidate.seq === errand.seq)
    const performing = input.mode === 'idle' || input.mode === 'watching'
    // A pastime is put away to talk, while the user is away and before she sleeps, as `decideIdleProp`'s `free` had it.
    const unfree = drive === null || !(drive.errands ?? []).includes(errand.kind)
      || (errand.kind === 'pastime' && (!performing || input.away || current?.kind === 'sleep'))
    const outcome = answer?.outcome ?? (unfree ? 'interrupted' : at >= errand.end ? 'done' : null)
    if (outcome === null)
      return
    this.errand = { ...errand, endedAt: at, outcome }
    this.reports.push({ kind: 'errand-ended', seq: errand.seq, errand: errand.kind, outcome })
  }

  private get active(): Clip | undefined {
    return this.clips.find(clip => clip.releasedAt === null)
  }

  /** Marks the record of `clip` released, if it is still the latest behaviour. */
  private released(clip: Clip) {
    if (this.record?.seq === clip.seq)
      this.record = { ...this.record, releasedAt: clip.releasedAt, releaseSeconds: clip.releaseSeconds }
  }

  private release(clip: Clip, at: number, seconds: number, gaze: NaturalGazeLayer) {
    clip.releasedAt = at
    clip.releaseSeconds = seconds
    this.released(clip)
    clip.glances.length = 0
    // The gaze returns to her own fixations at once, unless whatever claimed her already holds it with a glance.
    if (at < this.eyesUntil) {
      gaze.endHold(at, ownGlances)
      this.eyesUntil = at
    }
    this.reports.push({ kind: 'ended', seq: clip.seq, act: clip.kind, how: 'released' })
  }

  private finish(clip: Clip, at: number) {
    // The shape has already returned to zero, so the clip retires without a fade.
    clip.releasedAt = at
    clip.releaseSeconds = 0
    this.released(clip)
    this.reports.push({ kind: 'ended', seq: clip.seq, act: clip.kind, how: 'finished' })
  }

  private wake(clip: Clip, at: number, gaze: NaturalGazeLayer, asked: boolean) {
    clip.releasedAt = at
    clip.releaseSeconds = IDLE_WAKE_SECONDS
    this.released(clip)
    // The eyes are already on the user when the lids open.
    const until = gaze.glance({ source: 'sleep-wake', point: { x: 0, y: 0 }, hold: IDLE_WAKE_SECONDS + 0.6 }, at)
    if (until !== null)
      this.eyesUntil = Math.max(this.eyesUntil, until)
    this.reports.push({ kind: 'ended', seq: clip.seq, act: clip.kind, how: asked ? 'woken-on-request' : 'woken' })
  }

  /** Starts `kind`, drawing its shape from `random`; `intentId` names the order that started it, null for a cue. */
  private start(kind: IdleBehaviourKind, at: number, drive: NaturalIdleDrive, input: IdleStepInput, random: RandomStream, intentId: string | null): Clip {
    const between = (min: number, max: number) => min + (max - min) * random()
    const drawnSide: -1 | 1 = random() < 0.5 ? -1 : 1
    const inwardSide: -1 | 1 = Math.abs(input.placement) > 0.1 ? (input.placement > 0 ? 1 : -1) : drawnSide
    const clip: Clip = { seq: this.seq + 1, kind, start: at, end: at, releasedAt: null, releaseSeconds: 0, side: drawnSide, requested: false, period: 2, tone: 0, keys: [], glances: [], count: 1, variant: 0, groove: null }
    switch (kind) {
      case 'stretch':
        clip.end = at + 5.2
        break
      case 'yawn':
        clip.end = at + 5.4
        break
      case 'look-around': {
        const count = 2 + Math.floor(random() * 3)
        let side = drawnSide
        let t = 0
        clip.keys.push({ t: 0, x: 0, y: 0 })
        for (let i = 0; i < count; i++) {
          const point = { x: side * between(0.35, 0.7), y: between(-0.12, 0.22) }
          const hold = between(1.2, 2.6)
          clip.glances.push({ at: at + t, point, hold })
          // The eyes lead; the head follows 80 ms later and covers half of the turn.
          clip.keys.push({ t: t + 0.08, x: 0.55 * point.x, y: 0.4 * point.y })
          t += hold + 0.1
          if (random() < 0.7)
            side = side === 1 ? -1 : 1
        }
        clip.keys.push({ t, x: 0, y: 0 })
        clip.end = at + t + lookMoveSeconds + 0.1
        break
      }
      case 'check-in': {
        const duration = between(2.4, 4.2)
        clip.end = at + duration
        // An upset mood looks without smiling.
        clip.tone = finite(drive.valence) < -0.3 ? 0 : clamp01(0.5 + finite(drive.valence))
        clip.glances.push({ at, point: { x: 0, y: 0 }, hold: duration - 0.5 })
        break
      }
      case 'peer': {
        const duration = between(5, 9)
        clip.end = at + duration
        clip.side = inwardSide
        // Small saccades across the content, like reading along.
        for (let t = 0; t < duration - 1.2;) {
          const hold = Math.min(between(1.2, 2.4), duration - 1 - t)
          clip.glances.push({ at: at + t, point: { x: input.screenPoint.x + between(-0.08, 0.08), y: input.screenPoint.y + between(-0.04, 0.04) }, hold })
          t += hold + 0.05
        }
        break
      }
      case 'zone-out': {
        const duration = between(8, 18)
        clip.end = at + duration
        clip.glances.push({ at, point: { x: drawnSide * between(0.2, 0.4), y: between(-0.3, -0.15) }, hold: duration - 0.8 })
        break
      }
      case 'nod-off': {
        const cycles = 2 + Math.floor(random() * 2)
        let t = 0
        for (let i = 0; i < cycles; i++) {
          // Each droop is shorter than the last: she fights it less each time.
          const droop = between(2.5, 4) * 0.8 ** i
          clip.keys.push({ t, x: droop, y: 0 })
          t += droop + nodJerkSeconds + nodSettleSeconds
        }
        clip.end = at + t
        // Half of the time she checks whether anyone saw.
        if (random() < 0.5)
          clip.glances.push({ at: at + t - nodSettleSeconds + 0.2, point: { x: 0, y: 0 }, hold: 0.9 })
        break
      }
      case 'sway': {
        clip.end = at + between(8, 16)
        clip.period = between(1.7, 2.3)
        clip.tone = clamp01(0.5 + finite(drive.valence))
        // Binds only at the start (CM5b D3), so a sway that starts unbound plays exactly as before the beat clock.
        const position = beatAt(input.beatClock, at)
        if (position !== null) {
          const cycle = (beats: number) => Math.abs(beats * position.beatSeconds - clip.period)
          // The smaller count wins a tie.
          const beatsPerCycle = grooveBeatsPerCycle.reduce((best, beats) => cycle(beats) < cycle(best) ? beats : best)
          clip.groove = { beatsPerCycle, phase: grooveTarget(position.beats, beatsPerCycle), rate: 2 * Math.PI / (beatsPerCycle * position.beatSeconds), at }
          this.grooveLock = { seq: clip.seq, at, beatSeconds: position.beatSeconds, beatsPerCycle }
        }
        break
      }
      case 'sleep':
        clip.end = Number.POSITIVE_INFINITY
        clip.period = drive.body ? 0 : sleepNod.sink + sleepNod.rise + sleepNod.pause
        break
      case 'about-to-speak':
        clip.end = Number.POSITIVE_INFINITY
        clip.glances.push({ at, point: { x: 0, y: 0 }, hold: aboutToSpeakMaxSeconds })
        break
      case 'let-go':
        clip.end = at + 2.6
        clip.tone = clamp01(-finite(drive.valence))
        clip.glances.push({ at: at + 0.1, point: { x: drawnSide * 0.42, y: -0.2 }, hold: 1.5 })
        break
      // The whole-body kinds take their duration ranges and repeats from architecture 4e; the host plays their form.
      case 'sigh':
        clip.end = at + between(2.8, 4)
        break
      case 'shoulder-roll':
        clip.end = at + between(3, 4.5)
        // Half of the time the neck stretch repeats on the other side.
        clip.count = random() < 0.5 ? 2 : 1
        break
      case 'shift-stance':
        clip.end = at + between(1.2, 1.8)
        break
      case 'clasp-hands':
        clip.end = at + between(4, 9)
        clip.variant = random() < 0.5 ? 0 : 1
        break
      case 'hair-touch':
        clip.end = at + between(2.2, 3)
        break
      case 'heel-rock':
        clip.end = at + between(1.5, 2.5)
        clip.count = random() < 0.5 ? 2 : 3
        break
      case 'arm-swing':
        clip.end = at + between(2, 4)
        clip.count = random() < 0.5 ? 2 : 3
        break
    }
    this.record = {
      seq: clip.seq,
      kind,
      start: at,
      end: clip.end,
      releasedAt: null,
      releaseSeconds: 0,
      side: clip.side,
      period: clip.period,
      tone: clip.tone,
      count: clip.count,
      variant: clip.variant,
      keys: clip.keys.map(key => ({ ...key })),
      glances: clip.glances.map(glance => ({ at: glance.at - at, x: glance.point.x, y: glance.point.y, hold: glance.hold })),
    }
    this.clips.push(clip)
    this.reports.push({ kind: 'started', intentId, seq: clip.seq, act: kind })
    this.seq++
    return clip
  }

  private sample(time: number) {
    if (this.clips.length === 0) {
      this.output = idleRest
      return
    }
    const out = neutral()
    let calmAmplitude = 0
    let calmShift = 0
    let calmContinuous = 0
    for (const clip of this.clips) {
      const gain = clip.releasedAt === null ? 1 : clip.releaseSeconds <= 0 ? 0 : 1 - minJerk((time - clip.releasedAt) / clip.releaseSeconds)
      if (gain <= 0)
        continue
      const age = time - clip.start
      const s = clip.side
      const head = (x: number, y: number, z: number) => {
        out.head[0] += gain * x
        out.head[1] += gain * y
        out.head[2] += gain * z
      }
      const body = (x: number, y: number, z: number) => {
        out.body[0] += gain * x
        out.body[1] += gain * y
        out.body[2] += gain * z
      }
      const calm = (amplitude: number, shift: number, continuous: number) => {
        calmAmplitude = Math.max(calmAmplitude, gain * amplitude)
        calmShift = Math.max(calmShift, gain * shift)
        calmContinuous = Math.max(calmContinuous, gain * continuous)
      }
      switch (clip.kind) {
        case 'stretch': {
          // Arch back and up, squeeze the eyes, then settle a little lower than before.
          const e = trapezoid(age, 1.3, 1.6, 1.1)
          // The breath she held goes out as she drops back, a little below where she started.
          const settle = raisedCosine((age - 3.5) / 1.7)
          head(s * 0.1 * e, 0.45 * e - 0.14 * settle, s * 0.3 * e)
          body(s * 0.12 * e, 0.6 * e - 0.2 * settle, s * 0.3 * e)
          out.lidClose = Math.max(out.lidClose, gain * 0.95 * trapezoid(age - 0.5, 0.6, 1.7, 0.7))
          out.browY += gain * (0.3 * e - 0.1 * settle)
          out.mouthForm -= gain * 0.25 * e
          out.mouthOpen += gain * 0.12 * settle
          calm(0.7 * e, 0.5 * e, 0.7 * e)
          break
        }
        case 'yawn': {
          const e = trapezoid(age, 1.4, 1.1, 1.1)
          // Heavy lids for a moment after the mouth has closed.
          const after = trapezoid(age - 3.4, 0.4, 0.8, 0.8)
          head(0, 0.3 * e - 0.05 * after, s * 0.12 * e)
          body(0, 0.35 * e, s * 0.1 * e)
          out.mouthOpen += gain * e
          out.mouthForm -= gain * 0.3 * e
          out.lidClose = Math.max(out.lidClose, gain * 0.9 * trapezoid(age - 0.7, 0.7, 1.1, 0.7))
          out.eyeOpen *= 1 - gain * 0.25 * after
          out.browY += gain * 0.4 * e
          calm(0.6 * e, 0.5 * e, 0.6 * e)
          break
        }
        case 'look-around': {
          const ease = trapezoid(age, calmEaseSeconds, clip.end - clip.start - 2 * calmEaseSeconds, calmEaseSeconds)
          let x = 0
          let y = 0
          for (let i = 1; i < clip.keys.length; i++) {
            const key = clip.keys[i]
            if (age < key.t)
              break
            const from = clip.keys[i - 1]
            const u = minJerk((age - key.t) / lookMoveSeconds)
            x = from.x + (key.x - from.x) * u
            y = from.y + (key.y - from.y) * u
          }
          head(x, y, 0)
          body(0.3 * x, 0, 0)
          calm(0.5 * ease, 0.5 * ease, 0.3 * ease)
          break
        }
        case 'check-in': {
          const e = trapezoid(age, 0.5, clip.end - clip.start - 1.3, 0.8)
          head(0, 0.06 * e, s * 0.2 * e)
          body(0, 0, s * 0.15 * e)
          out.eyeSmile += gain * 0.6 * clip.tone * e
          out.mouthForm += gain * 0.45 * clip.tone * e
          out.browY += gain * 0.22 * e
          // A calmer posture brings the head back toward the camera while she looks.
          calm(0.5 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'peer': {
          const e = trapezoid(age, 0.9, clip.end - clip.start - 2, 1.1)
          head(s * 0.3 * e, -0.14 * e, s * 0.1 * e)
          body(s * 0.35 * e, -0.4 * e, s * 0.2 * e)
          out.eyeOpen *= 1 - gain * 0.15 * e
          out.browY -= gain * 0.15 * e
          calm(0.4 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'zone-out': {
          const e = trapezoid(age, 1.5, clip.end - clip.start - 2.1, 0.6)
          // The head lifts a little as she comes back.
          head(s * 0.08 * e, -0.14 * e + 0.08 * raisedCosine((age - (clip.end - clip.start - 0.9)) / 0.9), s * 0.14 * e)
          body(0, -0.15 * e, s * 0.1 * e)
          out.eyeOpen *= 1 - gain * 0.3 * e
          out.mouthOpen += gain * 0.07 * e
          out.blinkIntervalScale *= 1 + gain * 0.8 * e
          out.breathPeriodScale *= 1 + gain * 0.15 * e
          calm(0.5 * e, 0.6 * e, 0.5 * e)
          break
        }
        case 'nod-off': {
          let pitch = 0
          let lid = 0
          let hint = 0
          for (const cycle of clip.keys) {
            const local = age - cycle.t
            const droop = cycle.x
            if (local < 0 || local >= droop + nodJerkSeconds + nodSettleSeconds)
              continue
            if (local < droop) {
              const u = local / droop
              pitch = -0.5 * u ** 1.5
              lid = 0.85 * minJerk(u)
            }
            else if (local < droop + nodJerkSeconds) {
              const v = minJerk((local - droop) / nodJerkSeconds)
              pitch = -0.5 + 0.6 * v
              lid = 0.85 * (1 - v)
              hint = 0.12 * v
            }
            else {
              const w = minJerk((local - droop - nodJerkSeconds) / nodSettleSeconds)
              pitch = 0.1 * (1 - w)
              hint = 0.12 * (1 - w)
            }
          }
          const ease = trapezoid(age, calmEaseSeconds, clip.end - clip.start - 2 * calmEaseSeconds, calmEaseSeconds)
          head(0, pitch, s * 0.25 * -pitch)
          out.lidClose = Math.max(out.lidClose, gain * lid)
          out.eyeOpenHint += gain * hint
          calm(0.5 * ease, 0.5 * ease, 0.4 * ease)
          break
        }
        case 'sway': {
          const e = trapezoid(age, 1.5, clip.end - clip.start - 3, 1.5)
          // A sway bound to the beat plays at its advanced phase; an unbound one computes it from its age, as before.
          const phase = clip.groove?.phase ?? 2 * Math.PI * age / clip.period
          // The head trails the body and bobs once per beat, twice per sway.
          head(0.08 * e * Math.sin(phase - Math.PI / 2), 0.05 * e * Math.sin(2 * phase), 0.2 * e * Math.sin(phase))
          body(0.3 * e * Math.sin(phase - 0.6), 0, 0.3 * e * Math.sin(phase - 0.6))
          out.mouthForm += gain * 0.2 * clip.tone * e
          out.eyeSmile += gain * 0.2 * clip.tone * e
          calm(0.3 * e, 0.5 * e, 0.2 * e)
          break
        }
        case 'sleep': {
          const e = minJerk(age / sleepSettleSeconds)
          const nodding = clip.period > 0
          // Deep, slow breathing shows on the dropped head; it is all a head-and-face character has to breathe with.
          const breath = e * Math.sin(2 * Math.PI * age / 6.5)
          // Once settled her head keeps sinking and floating back, each nod to a different depth, and never jerks awake.
          let nod = 0
          if (nodding && age > sleepSettleSeconds) {
            const index = Math.floor((age - sleepSettleSeconds) / clip.period)
            const local = age - sleepSettleSeconds - index * clip.period
            const depth = 0.55 + 0.45 * ((index * 0.618) % 1)
            nod = depth * (local < sleepNod.sink ? minJerk(local / sleepNod.sink) : 1 - minJerk((local - sleepNod.sink) / sleepNod.rise))
          }
          head(s * 0.06 * e, -0.42 * e - (nodding ? 0.05 : 0.03) * breath - 0.2 * nod, s * (0.24 * e + 0.07 * nod))
          body(0, -0.3 * e - (nodding ? 0.09 : 0.05) * breath - 0.08 * nod, s * 0.15 * e)
          out.mouthOpen += gain * 0.05 * e
          out.lidClose = Math.max(out.lidClose, gain * e)
          out.breathPeriodScale *= 1 + gain * 0.4 * e
          calm(0.65 * e, 0.6 * e, 0.7 * e)
          break
        }
        case 'about-to-speak': {
          // A small breath in and a lifted look, held while she decides.
          const e = minJerk(age / 0.5)
          head(0, 0.12 * e, 0)
          body(0, 0.28 * e, 0)
          out.browY += gain * 0.3 * e
          out.eyeOpenHint += gain * 0.12 * e
          // Lips parted on the breath in.
          out.mouthOpen += gain * 0.16 * e
          calm(0.4 * e, 0.5 * e, 0.3 * e)
          break
        }
        case 'let-go': {
          // The breath goes out and the look drops aside; a low mood shows it more.
          const e = trapezoid(age, 0.45, 1.2, 0.95)
          head(s * 0.22 * e, -0.16 * e, s * 0.08 * e)
          body(0, -0.25 * e, 0)
          out.mouthForm -= gain * 0.25 * (1 + clip.tone) * e
          out.browY -= gain * 0.15 * e
          out.eyeOpen *= 1 - gain * 0.15 * e
          calm(0.3 * e, 0.4 * e, 0.2 * e)
          break
        }
      }
    }
    out.amplitudeScale = 1 - calmAmplitude
    out.shiftRateScale = 1 - Math.min(maxShiftCalm, calmShift)
    out.continuousScale = 1 - calmContinuous
    this.output = out
  }
}
