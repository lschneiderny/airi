import type { IdleDecision, IdleOrder, IdleScheduleState, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'

import type { MindIdleIntent, MindIdleState, MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { advanceIdleSchedule, applyIdleEdge, initialIdleSchedule, nextIdleDeadline } from '@proj-airi/motion-driver-natural/idle-schedule'
import { nextRandom, seedRng } from '@proj-airi/stage-shared/situation'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * Seconds by which a step may fall short of a deadline and still reach it. A wake armed at `nextIdleWakeAt` comes back
 * as milliseconds on the mind's clock, and the round trip through `atMs` loses a few ulps.
 */
const DEADLINE_SLACK_SECONDS = 1e-6
/** The urge's shortfall at a hazard crossing that is float rounding, relative to the threshold. */
const CROSSING_SLACK = 1e-9

export function initialMindIdleState(): MindIdleState {
  return { view: null, activeSeconds: 0, atMs: null, schedule: initialIdleSchedule(), pending: null, started: null, random: null }
}

/** A stream over the idle checkpoint; `checkpoint()` reads where it stopped. */
function idleStream(start: number) {
  let checkpoint = start
  return {
    random: (): number => {
      const [value, next] = nextRandom(checkpoint)
      checkpoint = next
      return value
    },
    checkpoint: () => checkpoint,
    restore: (to: number) => {
      checkpoint = to
    },
  }
}

type IdleStream = ReturnType<typeof idleStream>

/** A 32-bit seed for the shape of one act. */
function drawSeed(random: MindRandom) {
  return Math.floor(random() * 2 ** 32) >>> 0
}

/**
 * Runs the schedule from `from` to `to` in pieces that end at its deadlines, so the rate is constant over each piece and
 * a hazard crossing lands exactly on its deadline. Stops at the first decision. Every decision is taken at the time
 * of its deadline, because the schedule's due checks (rest, cooldowns, refractories) read the start of the span it is
 * given: deciding at the start of a longer piece would make the pick depend on how the time was split.
 */
function runSchedule(schedule: IdleScheduleState, view: IdleView, from: number, to: number, stream: IdleStream): { schedule: IdleScheduleState, decision: IdleDecision | null, at: number } {
  const random = stream.random
  let at = from
  // A zero span at the start applies what a new view changes (the away run, the errand listing, a dormant drive) and
  // draws a threshold that is due, so the deadlines below read the current course.
  const opened = advanceIdleSchedule(schedule, view, at, 0, random)
  schedule = opened.state
  if (opened.decision)
    return { schedule, decision: opened.decision, at }
  let checkedAt: number | null = at
  for (;;) {
    const deadline = nextIdleDeadline(schedule, view, at)
    const reaches = deadline !== null && deadline <= to + DEADLINE_SLACK_SECONDS
    const end = reaches ? Math.max(at, deadline) : to
    if (end > at) {
      const checkpoint = stream.checkpoint()
      const advanced = advanceIdleSchedule(schedule, view, at, end - at, random)
      if (advanced.decision) {
        // The urge crossed at `end`, the earliest deadline: take the decision there instead, with the draws undone.
        stream.restore(checkpoint)
        schedule = { ...schedule, urge: schedule.threshold ?? schedule.urge }
      }
      else {
        schedule = advanced.state
      }
      at = end
    }
    // Each deadline is checked once at its own time; a second deadline at the same time means nothing more is due.
    if (!reaches || checkedAt === at)
      return { schedule, decision: null, at }
    checkedAt = at
    const shortfall = schedule.threshold === null ? 0 : schedule.threshold - schedule.urge
    if (shortfall > 0 && shortfall <= CROSSING_SLACK * Math.max(1, schedule.threshold!))
      schedule = { ...schedule, urge: schedule.threshold! }
    const checked = advanceIdleSchedule(schedule, view, at, 0, random)
    schedule = checked.state
    if (checked.decision)
      return { schedule, decision: checked.decision, at }
  }
}

/** Brings the schedule up to `idle.activeSeconds` and turns a decision into an intent with its seed. */
function decide(idle: MindIdleState, from: number, id: string, cause: number): { idle: MindIdleState, intents: MindIntent[] } {
  if (idle.view === null || !idle.view.active || idle.random === null || idle.pending !== null)
    return { idle, intents: [] }
  const stream = idleStream(idle.random)
  const { schedule, decision, at } = runSchedule(idle.schedule, idle.view, from, idle.activeSeconds, stream)
  let intent: MindIntent | null = null
  // The seed is drawn after the decision's own draws.
  if (decision?.kind === 'act')
    intent = { id, cause, channel: 'posture', kind: 'idle-act', act: decision.act, seed: drawSeed(stream.random), requested: false }
  else if (decision?.kind === 'errand')
    intent = { id, cause, channel: 'posture', kind: 'idle-errand', errand: decision.errand, pick: decision.pick, holdSeconds: decision.holdSeconds }
  return {
    // A deadline reached within the slack moves the clock onto it, so the next step does not fall short of it again.
    idle: { ...idle, activeSeconds: Math.max(idle.activeSeconds, at), schedule, random: stream.checkpoint(), pending: intent?.id ?? null },
    intents: intent ? [intent] : [],
  }
}

/**
 * Advances the idle clock to `nowMs` before a stimulus. Time counts only while the last view is active. Any stimulus
 * may carry a decision that fell due, so the idle draws depend on the deadlines and edges, not on how often the
 * other channels step.
 */
export function advanceIdle(state: MindState, cause: number, nowMs: number): Answer {
  const idle = state.idle
  const from = idle.activeSeconds
  const span = idle.atMs === null || idle.view?.active !== true ? 0 : Math.max(0, nowMs - idle.atMs) / 1000
  const advanced = { ...idle, atMs: nowMs, activeSeconds: from + span }
  if (span === 0 && idle.atMs === nowMs)
    return { state, intents: [] }
  const { idle: next, intents } = decide(advanced, from, `${cause}-idle-due`, cause)
  return { state: { ...state, idle: next }, intents }
}

/** Seeds the idle stream from the mind's source at the first idle stimulus. */
function seeded(idle: MindIdleState, rng: MindRandom): MindIdleState {
  return idle.random === null ? { ...idle, random: seedRng(drawSeed(rng)) } : idle
}

/**
 * Applies the reports of one performer frame in order, then decides at the current time. A view with no drive is
 * dormant: it clears the follow-up, the away run, and the pending intent, and the policy decides nothing.
 */
export function answerIdle(state: MindState, stimulus: Stimulus<'idle'>, cause: number, rng: MindRandom): Answer {
  let idle = seeded(state.idle, rng)
  const stream = idleStream(idle.random!)
  const at = idle.activeSeconds
  let { schedule, pending, started, view } = idle
  for (const report of stimulus.reports) {
    switch (report.kind) {
      case 'view':
        view = report.view
        if (view.drive === null) {
          schedule = { ...schedule, followUp: null, awaySince: null }
          pending = null
        }
        break
      case 'started':
        schedule = applyIdleEdge(schedule, { kind: 'started', act: report.act }, at, stream.random)
        started = { seq: report.seq, intentId: report.intentId, at }
        if (report.intentId !== null && report.intentId === pending)
          pending = null
        break
      case 'ended': {
        const woken = report.how === 'woken' || report.how === 'woken-on-request'
        const sleptSeconds = woken && started?.seq === report.seq ? at - started.at : null
        schedule = applyIdleEdge(schedule, { kind: 'ended', act: report.act, how: report.how, sleptSeconds }, at, stream.random)
        break
      }
      case 'refused':
        // The fire is spent: the threshold was redrawn when it was decided.
        if (report.intentId === pending)
          pending = null
        break
      case 'errand-started':
        schedule = applyIdleEdge(schedule, { kind: 'errand-started', errand: report.errand }, at, stream.random)
        if (report.intentId === pending)
          pending = null
        break
      case 'errand-ended':
        schedule = applyIdleEdge(schedule, { kind: 'errand-ended', errand: report.errand }, at, stream.random)
        break
    }
  }
  idle = { ...idle, view, schedule, pending, started, random: stream.checkpoint() }
  const decided = decide(idle, at, `${cause}-idle`, cause)
  return { state: { ...state, idle: decided.idle }, intents: decided.intents }
}

/** A requested play starts at once; the performer keeps its own test, and its `started` report stamps the cooldowns. */
export function answerIdlePlay(state: MindState, stimulus: Stimulus<'idle-play'>, cause: number, rng: MindRandom): Answer {
  const idle = seeded(state.idle, rng)
  const stream = idleStream(idle.random!)
  const seed = drawSeed(stream.random)
  return {
    state: { ...state, idle: { ...idle, random: stream.checkpoint() } },
    intents: [{ id: `${cause}-idle-play`, cause, channel: 'posture', kind: 'idle-act', act: stimulus.act, seed, requested: true }],
  }
}

/** The order a performer carries out for an idle intent. */
export function idleOrderOf(intent: MindIdleIntent): IdleOrder {
  return intent.kind === 'idle-act'
    ? { id: intent.id, kind: 'act', act: intent.act, seed: intent.seed, requested: intent.requested }
    : { id: intent.id, kind: 'errand', errand: intent.errand, pick: intent.pick, holdSeconds: intent.holdSeconds }
}

/**
 * The earliest wake the host must arm, in epoch milliseconds of the mind's clock, or null: none while no active view
 * reports, while an intent waits for its answer, or while nothing is due.
 */
export function nextIdleWakeAt(idle: MindIdleState): number | null {
  if (idle.view === null || !idle.view.active || idle.atMs === null || idle.pending !== null || idle.random === null)
    return null
  const deadline = nextIdleDeadline(idle.schedule, idle.view, idle.activeSeconds)
  return deadline === null ? null : idle.atMs + (deadline - idle.activeSeconds) * 1000
}
