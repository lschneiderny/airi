import type { DrawnIdleActivityKind, IdleActivityKind, IdleBehaviourKind, NaturalIdleDrive } from './idle-activities'
import type { IdleErrandKind, IdleErrandOutcome } from './idle-errands'
import type { RandomStream } from './random'

import { IDLE_ERRAND_KINDS, IDLE_ERRAND_LINGER_SECONDS, IDLE_ERRAND_PACING, PASTIME_HOLD_SECONDS } from './idle-errands'

/**
 * The idle schedule: when she starts an idle act or an errand, which one, when she falls asleep while the user is away,
 * and the stretch or yawn after a long sleep. Pure rules over plain JSON state, in active seconds (the idle agency
 * ADR's unit), with every random draw taken from the `random` argument. The character mind's idle policy runs them on
 * its own clock and source, and decides when she settles in. The performer (`NaturalIdleActivities`) plays what the
 * mind orders: it keeps the shape of each act, its interruption, and cue acceptance, and reports what it saw as
 * `IdleReport`s.
 */

/** Seconds between two activities: the minimum and maximum of the uniform rest draw. */
const rest = { min: 6, max: 14 }
/** Mean seconds between activity starts at a neutral drive, on top of the rest. */
const meanGap = { idle: 45, watching: 70 }
/** Seconds the user must be away before she falls asleep: the bounds of the uniform draw. */
const sleepDelay = { min: 12, max: 30 }
/** A sleep at least this long, in seconds, can be followed by a stretch or a yawn. */
const longSleepSeconds = 90
/** Seconds an ordinary wake takes; the follow-up after a long sleep waits for it. */
export const IDLE_WAKE_SECONDS = 1.6
/**
 * Shortest seconds before the same activity is drawn again. The whole-body kinds, appended so the draw order of the
 * others stays, take architecture 4e's refractory of their act.
 */
const cooldowns: Record<DrawnIdleActivityKind, number> = { 'stretch': 300, 'yawn': 75, 'look-around': 25, 'check-in': 30, 'peer': 25, 'zone-out': 40, 'nod-off': 100, 'sway': 30, 'sigh': 90, 'shoulder-roll': 240, 'shift-stance': 60, 'clasp-hands': 240, 'hair-touch': 300, 'heel-rock': 240, 'arm-swing': 180 }

const drawnKinds = Object.keys(cooldowns) as DrawnIdleActivityKind[]

/**
 * Seconds over which a kind a body host's character showed regains its full odds, linearly: about 60 s per act (45 s
 * mean gap, 10 s mean rest, a 5 s act) times the five other kinds of her settled pool, so each can come first.
 */
const recoverySeconds = 300

/**
 * The drawn kinds that need her arms, her shoulders or a standing posture, which a settled character does not start.
 * Architecture 4f lets only the sigh, the yawn and the foot re-plant play on the rest. The head and gaze kinds
 * (look-around, check-in, zone-out, nod-off, sway) still play while she is settled: a recorded deviation from 4f's
 * list, because they move nothing the rest posture holds.
 */
const SETTLED_OUT = ['stretch', 'peer', 'shoulder-roll', 'clasp-hands', 'hair-touch', 'heel-rock', 'arm-swing'] as const satisfies readonly DrawnIdleActivityKind[]

/** A drive value in [0, 1]; a bad number reads as 0. */
export function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** A drive value in [-1, 1]; a bad number reads as 0. */
export function finite(value: number) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

/**
 * Relative odds of each drawn activity for a drive. Tiredness (night, or low mood energy) favours yawns, zoning out
 * and nodding off; a lively mood favours looking around and watching the screen; time without an exchange makes her
 * check on the user more; tension makes her restless. While the user is active (`watching`) she watches along more
 * and drifts off less. Sway, her groove, is drawn only while the character mind hears `music`. The whole-body kinds take architecture 4e's act weights,
 * mood energy standing in for its arousal, and weigh 0 unless the drive sets `body`, so a head-only host's single
 * draw sees the same pool as before they existed. While a body host's character is `settled` (resting, or sitting on
 * a clip), nothing that needs her arms, her shoulders or a standing posture is drawn (architecture 4f restricts the
 * rest's acts), and a stretch that would follow a long sleep becomes a yawn; `settled` is never true without `body`.
 * With `body`, a kind started `since` seconds ago weighs `since / 300` of its odds until 300 s have passed, so she shows
 * most of what she can do before she repeats herself; a head-only host ignores `since`.
 */
export function idleActivityWeights(drive: NaturalIdleDrive, context: { watching: boolean, music: boolean, settled?: boolean, since?: Partial<Record<DrawnIdleActivityKind, number>> }): Record<DrawnIdleActivityKind, number> {
  const tired = clamp01(Math.max(drive.sleepiness, -finite(drive.energy)))
  const lively = clamp01(finite(drive.energy))
  const warm = clamp01(0.5 + finite(drive.valence))
  const tense = clamp01(finite(drive.tension))
  const solitude = clamp01(drive.solitude)
  const body = drive.body === true
  const weights: Record<DrawnIdleActivityKind, number> = {
    'look-around': (1 + 0.5 * lively + 0.6 * tense) * (1 - 0.5 * tired),
    'check-in': (0.45 + 0.6 * warm) * (1 + 0.8 * solitude) * (context.watching ? 1.2 : 1),
    'peer': (context.watching ? 1.6 : 0.35) * (1 + 0.4 * lively) * (1 - 0.5 * tired),
    'zone-out': (0.5 + 0.9 * tired + 0.4 * solitude) * (1 - 0.5 * tense) * (context.watching ? 0.5 : 1),
    'stretch': 0.3 + 0.3 * tired + 0.2 * tense,
    'yawn': 0.08 + 1.3 * tired,
    'nod-off': tired > 0.45 ? 1.4 * (tired - 0.45) / 0.55 * (context.watching ? 0.6 : 1) : 0,
    'sway': context.music ? (0.8 + 0.6 * warm) * (1 - 0.6 * tense) : 0,
    'sigh': body ? (finite(drive.valence) < -0.2 ? 2 : 1) : 0,
    'shoulder-roll': body ? 0.8 : 0,
    // 4e act 3: the body re-plants a foot. 4e act 6 clasps the hands (0.7), act 8 tucks the hair (0.5; a host whose rig
    // lacks head clearance or the tuck's reach lists it in `unreachable`) and act 11 raises the heels (0 unless
    // valence > 0.3, then 0.8).
    'shift-stance': body ? 1.2 : 0,
    'clasp-hands': body ? 0.7 : 0,
    'hair-touch': body ? 0.5 : 0,
    'heel-rock': body && finite(drive.valence) > 0.3 ? 0.8 : 0,
    'arm-swing': body ? (lively > 0.2 ? 0.9 : 0.6) : 0,
  }
  if (context.settled) {
    for (const kind of SETTLED_OUT)
      weights[kind] = 0
  }
  for (const kind of drive.unreachable ?? [])
    weights[kind] = 0
  if (body && context.since) {
    for (const kind of drawnKinds) {
      const seconds = context.since[kind]
      if (seconds !== undefined)
        weights[kind] *= Math.min(1, Math.max(0, seconds) / recoverySeconds)
    }
  }
  return weights
}

/**
 * Activity starts per second for a drive: a lively mood fidgets more, a tired one less, and the host's `rate` scales
 * the whole pace. The rest between activities comes on top.
 */
export function idleActivityRate(drive: NaturalIdleDrive, context: { watching: boolean }): number {
  const pace = Math.max(0.5, Math.min(1.5, 1 + 0.35 * finite(drive.energy) + 0.25 * clamp01(finite(drive.tension))))
  return Math.max(0, Number.isFinite(drive.rate) ? drive.rate : 1) * pace / (context.watching ? meanGap.watching : meanGap.idle)
}

/** What the performer can see of her, as of its latest grid step. Plain JSON. */
export interface IdleView {
  /** The drive as the scene narrowed it, or null while Natural runs no idle layer. */
  drive: NaturalIdleDrive | null
  /** False while the adapter suspends Natural (paused, hidden, another driver): idle time stops. */
  active: boolean
  mode: 'idle' | 'watching' | 'listening' | 'thinking' | 'talking'
  away: boolean
  blocked: boolean
  /** The behavior that has not been released, or null. */
  current: { seq: number, kind: IdleBehaviourKind } | null
  /** The errand that has not ended, or null. */
  errand: { seq: number, kind: IdleErrandKind } | null
}

/** The view of a performer that runs no idle layer: the schedule decides nothing under it. */
export function dormantIdleView(active = false): IdleView {
  return { drive: null, active, mode: 'idle', away: false, blocked: false, current: null, errand: null }
}

/** Whether two drives hold the same values, so a host that sends a fresh copy every second changes nothing. */
export function sameIdleDrive(a: NaturalIdleDrive | null, b: NaturalIdleDrive | null): boolean {
  if (a === b)
    return true
  if (a === null || b === null)
    return false
  const sameList = (x: readonly string[] | undefined, y: readonly string[] | undefined) => (x ?? []).join() === (y ?? []).join() && (x === undefined) === (y === undefined)
  return a.energy === b.energy && a.valence === b.valence && a.tension === b.tension && a.sleepiness === b.sleepiness
    && a.solitude === b.solitude && a.rate === b.rate && a.body === b.body
    && sameList(a.unreachable, b.unreachable) && sameList(a.errands, b.errands)
}

/** The memory of the schedule. Plain JSON; every time is in active seconds. */
export interface IdleScheduleState {
  /** The `Exp(1)` level the urge must reach for the next start; null until the hazard next runs. */
  threshold: number | null
  urge: number
  /** No act starts before this time: the rest after the previous behavior. */
  restUntil: number
  /** Start of the quiet away run the sleep delay counts from; null outside one. */
  awaySince: number | null
  /** The sleep delay drawn at the start of the away run. */
  sleepAfter: number
  followUp: { kind: 'stretch' | 'yawn', at: number } | null
  lastStart: Partial<Record<IdleBehaviourKind, number>>
  /** The latest drawn kind she started, which the pick does not repeat while another is eligible. */
  lastDrawn: DrawnIdleActivityKind | null
  errandStarts: Partial<Record<IdleErrandKind, number>>
  errandEnds: Partial<Record<IdleErrandKind, number>>
  /** When the host started listing each errand, which its first refractory counts from where its timer's did. */
  errandListedSince: Partial<Record<IdleErrandKind, number>>
}

/** What the schedule starts. The mind adds the seed the performer draws an act's shape from. */
export type IdleDecision
  = | { kind: 'act', act: IdleActivityKind }
    | { kind: 'errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null }

/** An edge the performer saw, in the order it happened. */
export type IdleEdge
  = | { kind: 'started', act: IdleBehaviourKind }
    | { kind: 'ended', act: IdleBehaviourKind, how: 'finished' | 'released' | 'woken' | 'woken-on-request', sleptSeconds: number | null }
    | { kind: 'errand-started', errand: IdleErrandKind }
    | { kind: 'errand-ended', errand: IdleErrandKind }

/**
 * What the performer tells the schedule's owner, in the order it happened. `started` and `errand-started` name the
 * order that caused them, or null for a behavior the performer started itself (a cue). `refused` answers an order the
 * performer could not start when it arrived.
 */
export type IdleReport
  = | { kind: 'view', view: IdleView }
    | { kind: 'started', intentId: string | null, seq: number, act: IdleBehaviourKind }
    | { kind: 'ended', seq: number, act: IdleBehaviourKind, how: 'finished' | 'released' | 'woken' | 'woken-on-request' }
    | { kind: 'refused', intentId: string }
    | { kind: 'errand-started', intentId: string, seq: number, errand: IdleErrandKind }
    | { kind: 'errand-ended', seq: number, errand: IdleErrandKind, outcome: IdleErrandOutcome }

/** What the performer is told to start. An act's shape is drawn from `seed`; `requested` marks a play asked for by the user or a lab. */
export type IdleOrder
  = | { id: string, kind: 'act', act: IdleBehaviourKind, seed: number, requested: boolean }
    | { id: string, kind: 'errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null }

export function initialIdleSchedule(): IdleScheduleState {
  return { threshold: null, urge: 0, restUntil: 0, awaySince: null, sleepAfter: 0, followUp: null, lastStart: {}, lastDrawn: null, errandStarts: {}, errandEnds: {}, errandListedSince: {} }
}

/** Applies one edge at `at`: the cooldown stamps, the rest, the away reset, and the follow-up, drawing what the rule draws. */
export function applyIdleEdge(state: IdleScheduleState, edge: IdleEdge, at: number, random: RandomStream): IdleScheduleState {
  const next = { ...state }
  switch (edge.kind) {
    case 'started':
      next.lastStart = { ...state.lastStart, [edge.act]: at }
      if (edge.act !== 'sleep' && edge.act !== 'about-to-speak' && edge.act !== 'let-go')
        next.lastDrawn = edge.act
      break
    case 'errand-started':
      next.errandStarts = { ...state.errandStarts, [edge.errand]: at }
      break
    case 'errand-ended':
      next.errandEnds = { ...state.errandEnds, [edge.errand]: at }
      break
    case 'ended':
      switch (edge.how) {
        case 'finished':
          next.restUntil = at + rest.min + (rest.max - rest.min) * random()
          break
        case 'released':
          // Woken before the user is back, she takes a fresh while to fall asleep again.
          if (edge.act === 'sleep')
            next.awaySince = null
          next.restUntil = at + rest.min
          break
        case 'woken':
        case 'woken-on-request':
          // Woken on request before the user is back, she takes a fresh while to fall asleep again.
          if (edge.how === 'woken-on-request')
            next.awaySince = null
          next.restUntil = at + rest.min
          if ((edge.sleptSeconds ?? 0) >= longSleepSeconds && random() < 0.7)
            next.followUp = { kind: random() < 0.6 ? 'stretch' : 'yawn', at: at + IDLE_WAKE_SECONDS + 0.8 + 1.2 * random() }
          break
      }
      break
  }
  return next
}

function performing(view: IdleView) {
  return view.mode === 'idle' || view.mode === 'watching'
}

/** The errands that may start at `at`, each with its start rate per second. `current` is the behavior after any sleep this step decided. */
function errandHazards(state: IdleScheduleState, view: IdleView, drive: NaturalIdleDrive, at: number, current: IdleBehaviourKind | null): { kind: IdleErrandKind, rate: number }[] {
  if (drive.errands === undefined || drive.errands.length === 0 || view.errand !== null)
    return []
  if (!performing(view) || view.away)
    return []
  const rate = errandPace(drive)
  const hazards: { kind: IdleErrandKind, rate: number }[] = []
  for (const kind of IDLE_ERRAND_KINDS) {
    if (!drive.errands.includes(kind))
      continue
    const pacing = IDLE_ERRAND_PACING[kind]
    const since = errandRefractoryFrom(state, kind)
    // The same form as the refractory's deadline below, so the errand is free again at the deadline itself.
    if (since !== undefined && at < since + pacing.refractory)
      continue
    // An unasked clip waits for her act to finish, as `decideIdleClip`'s quiet body did; whether she stands for it is
    // the realiser's to answer. A wander and a pastime go on beside her acts, as their timers did.
    if (kind === 'idle-clip' && (current !== null || view.blocked))
      continue
    if (kind === 'pastime' && current === 'sleep')
      continue
    hazards.push({ kind, rate: rate / pacing.meanGap })
  }
  return rate > 0 ? hazards : []
}

/** How the host's `rate` scales the errands' pace; a bad number reads as 1. */
function errandPace(drive: NaturalIdleDrive) {
  return Math.max(0, Number.isFinite(drive.rate) ? drive.rate : 1)
}

/** The moment an errand's refractory counts from, or undefined when it has none yet. */
function errandRefractoryFrom(state: IdleScheduleState, kind: IdleErrandKind) {
  const pacing = IDLE_ERRAND_PACING[kind]
  const last = pacing.from === 'start' ? state.errandStarts[kind] : state.errandEnds[kind]
  return last ?? (pacing.firstAfterListing ? state.errandListedSince[kind] : undefined)
}

/**
 * The hold of an errand, drawn after its pick: a pastime's uniform duration, or a wander's log-uniform stay where it took
 * her (`IDLE_ERRAND_LINGER_SECONDS`); an unasked clip has none and draws nothing.
 */
function errandHold(errand: IdleErrandKind, random: RandomStream): number | null {
  if (errand === 'pastime')
    return PASTIME_HOLD_SECONDS.min + (PASTIME_HOLD_SECONDS.max - PASTIME_HOLD_SECONDS.min) * random()
  if (errand === 'wander')
    return IDLE_ERRAND_LINGER_SECONDS.min * (IDLE_ERRAND_LINGER_SECONDS.max / IDLE_ERRAND_LINGER_SECONDS.min) ** random()
  return null
}

/** One draw shares the start between the acts and each errand by rate; null picks an act. */
function chooseErrand(errands: readonly { kind: IdleErrandKind, rate: number }[], actRate: number, random: RandomStream): IdleErrandKind | null {
  let draw = random() * (actRate + errands.reduce((sum, errand) => sum + errand.rate, 0)) - actRate
  if (draw < 0)
    return null
  for (const errand of errands) {
    draw -= errand.rate
    if (draw < 0)
      return errand.kind
  }
  return errands[errands.length - 1].kind
}

function pick(state: IdleScheduleState, view: IdleView, context: IdleContext, drive: NaturalIdleDrive, at: number, random: RandomStream): DrawnIdleActivityKind | null {
  const since: Partial<Record<DrawnIdleActivityKind, number>> = {}
  for (const kind of drawnKinds) {
    const last = state.lastStart[kind]
    if (last !== undefined)
      since[kind] = at - last
  }
  const weights = idleActivityWeights(drive, { watching: view.mode === 'watching', music: context.music, settled: context.settled, since })
  const eligible = drawnKinds.filter((kind) => {
    const last = state.lastStart[kind]
    return weights[kind] > 0 && (last === undefined || at - last >= cooldowns[kind])
  })
  // The same activity twice in a row reads as a loop, so it is drawn again only when nothing else is available.
  const pool = eligible.length > 1 ? eligible.filter(kind => kind !== state.lastDrawn) : eligible
  const total = pool.reduce((sum, kind) => sum + weights[kind], 0)
  if (total <= 0)
    return null
  let draw = random() * total
  for (const kind of pool) {
    draw -= weights[kind]
    if (draw < 0)
      return kind
  }
  return pool[pool.length - 1]
}

/** Stamps when the host started listing each errand, and forgets one it no longer lists. */
function listErrands(state: IdleScheduleState, drive: NaturalIdleDrive | null, at: number) {
  let listed = state.errandListedSince
  for (const kind of IDLE_ERRAND_KINDS) {
    const lists = drive?.errands?.includes(kind) === true
    if (lists && listed[kind] === undefined) {
      listed = { ...listed, [kind]: at }
    }
    else if (!lists && listed[kind] !== undefined) {
      listed = { ...listed }
      delete listed[kind]
    }
  }
  return listed
}

/** What the schedule's pick reads beside the performer's view: the character mind's own state. */
export interface IdleContext {
  /** Whether the mind hears music: the groove (`sway`) weighs above 0 only then. */
  music: boolean
  /**
   * Whether the mind has settled her in after a long idle with a body drive: the settled pool and the yawn in place of a
   * stretch after a long sleep read it.
   */
  settled: boolean
}

/**
 * Advances the schedule over the span of `seconds` that starts at `at`, under `view` and `context`, which hold over the
 * whole span, and returns at most one decision. The due checks (rest, sleep delay, follow-up, refractories) read `at`, and the urge
 * grows by the span's rate times `seconds`. The character mind's idle policy calls it over spans that end at
 * `nextIdleDeadline`, so the rate holds over each span.
 */
export function advanceIdleSchedule(state: IdleScheduleState, view: IdleView, context: IdleContext, at: number, seconds: number, random: RandomStream): { state: IdleScheduleState, decision: IdleDecision | null } {
  if (!view.active)
    return { state, decision: null }
  const next = { ...state, errandListedSince: listErrands(state, view.drive, at) }
  const drive = view.drive
  if (drive === null) {
    next.followUp = null
    next.awaySince = null
    return { state: next, decision: null }
  }

  let decision: IdleDecision | null = null
  let current = view.current?.kind ?? null
  // The wait counts quiet time only. While she talks, thinks or listens it starts over, so she does not shut her
  // eyes the moment she has answered someone the desktop still calls away.
  if (view.away && performing(view)) {
    if (next.awaySince === null) {
      next.awaySince = at
      next.sleepAfter = sleepDelay.min + (sleepDelay.max - sleepDelay.min) * random()
    }
    // The same sum `nextIdleDeadline` names, so a step taken at that deadline reaches it: `at - awaySince` can fall an
    // ulp short of `sleepAfter`.
    if (current === null && !view.blocked && at >= next.awaySince + next.sleepAfter) {
      decision = { kind: 'act', act: 'sleep' }
      current = 'sleep'
    }
  }
  else {
    next.awaySince = null
  }

  const free = current === null && performing(view) && !view.blocked && !view.away
  const errands = errandHazards(next, view, drive, at, current)
  const actsOpen = free && at >= next.restUntil
  if (next.followUp && at >= next.followUp.at) {
    // A settled character does not stretch (SETTLED_OUT), so the stretch after a long sleep becomes the yawn.
    const kind = context.settled && next.followUp.kind === 'stretch' ? 'yawn' : next.followUp.kind
    next.followUp = null
    if (free)
      decision = { kind: 'act', act: kind }
  }
  else if (actsOpen || errands.length > 0) {
    // One hazard for everything she may start: the acts' rate while an act may start, plus each eligible errand's.
    next.threshold ??= -Math.log(1 - random())
    const actRate = actsOpen ? idleActivityRate(drive, { watching: view.mode === 'watching' }) : 0
    next.urge += (actRate + errands.reduce((sum, errand) => sum + errand.rate, 0)) * seconds
    if (next.urge >= next.threshold) {
      next.urge = 0
      next.threshold = null
      // Without an eligible errand the draw is exactly the acts' draw as before; with one, a share by rate first.
      const errand = errands.length > 0 ? chooseErrand(errands, actRate, random) : null
      if (errand) {
        const errandPick = random()
        decision = { kind: 'errand', errand, pick: errandPick, holdSeconds: errandHold(errand, random) }
      }
      else if (actsOpen) {
        const kind = pick(next, view, context, drive, at, random)
        if (kind)
          decision = { kind: 'act', act: kind }
      }
    }
  }
  return { state: next, decision }
}

/**
 * The earliest time at or after `at` at which the schedule could change its course under `view`: a rest end, a
 * refractory end, the sleep due time, the follow-up, or the hazard's crossing at today's rate. It is `at` itself while
 * a draw is due now (the threshold or the sleep delay of a new away run). Null when nothing is due, including while
 * the view is inactive or has no drive.
 */
export function nextIdleDeadline(state: IdleScheduleState, view: IdleView, at: number): number | null {
  const drive = view.drive
  if (!view.active || drive === null)
    return null
  let earliest: number | null = null
  const due = (time: number) => {
    const clamped = Math.max(at, time)
    earliest = earliest === null ? clamped : Math.min(earliest, clamped)
  }
  const current = view.current?.kind ?? null
  if (view.away && performing(view)) {
    if (state.awaySince === null)
      due(at)
    else if (current === null && !view.blocked)
      due(state.awaySince + state.sleepAfter)
  }
  if (state.followUp)
    due(state.followUp.at)

  const free = current === null && performing(view) && !view.blocked && !view.away
  if (free && at < state.restUntil)
    due(state.restUntil)
  if (drive.errands !== undefined && view.errand === null && performing(view) && !view.away && errandPace(drive) > 0) {
    for (const kind of drive.errands) {
      const since = errandRefractoryFrom(state, kind)
      if (since !== undefined && at < since + IDLE_ERRAND_PACING[kind].refractory)
        due(since + IDLE_ERRAND_PACING[kind].refractory)
    }
  }

  const errands = errandHazards(state, view, drive, at, current)
  const actRate = free && at >= state.restUntil ? idleActivityRate(drive, { watching: view.mode === 'watching' }) : 0
  const rate = actRate + errands.reduce((sum, errand) => sum + errand.rate, 0)
  if ((free && at >= state.restUntil) || errands.length > 0) {
    if (state.threshold === null)
      due(at)
    else if (rate > 0)
      due(at + Math.max(0, state.threshold - state.urge) / rate)
  }
  return earliest
}
