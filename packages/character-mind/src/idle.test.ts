import type { IdleBehaviourKind, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandKind } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdleReport, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { GateSignals } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { IDLE_ERRAND_LINGER_SECONDS, IDLE_ERRAND_PACING, PASTIME_HOLD_SECONDS } from '@proj-airi/motion-driver-natural/idle-errands'
import { dormantIdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { HOUR_MS, initialSituationState, randomSource } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { nextIdleWakeAt, SETTLE_SECONDS } from './idle'
import { step } from './step'
import { naturalMindState } from './test/fixtures'

const SEC = 1000
const MIN = 60 * SEC
const T0 = 1_700_000_000_000
/** Seed 1 rolls the 70 % follow-up after a long sleep. */
const SEED = 1

const drive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }

function idleView(overrides: Partial<IdleView> = {}): IdleView {
  return { drive, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null, ...overrides }
}

function idle(...reports: IdleReport[]): MindStimulus {
  return { kind: 'idle', reports }
}

function viewed(overrides: Partial<IdleView> = {}): MindStimulus {
  return idle({ kind: 'view', view: idleView(overrides) })
}

const wake: MindStimulus = { kind: 'idle-wake' }

const QUIET: GateSignals = { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true }

function voiceTick(atMs: number): MindStimulus {
  return {
    kind: 'voice-tick',
    forceTiming: false,
    view: {
      run: { id: 1, user: null },
      situation: { ...initialSituationState, presence: { state: 'here', reason: null, sinceMs: T0 - HOUR_MS }, busy: { state: 'accepts', atMs }, nowMs: atMs },
      threads: { threads: { threads: [] } },
      local: { dayKey: '2023-11-14', minuteOfDay: 16 * 60 },
      sessionId: 'chat-a',
      signals: QUIET,
      settings: { enabled: true, chattiness: 1, dontDisturb: false, quietApps: [], speakDuringGames: true },
      moodFactor: 1,
      unpromptedPending: false,
    },
  }
}

/** One mind fed in order from one seeded source. */
function script(seed = SEED, initial: MindState = naturalMindState()) {
  const random: MindRandom = randomSource(seed)
  let state = initial
  return {
    get state() { return state },
    get wakeAt() { return nextIdleWakeAt(state.idle) },
    send(atMs: number, ...stimuli: MindStimulus[]): MindIntent[] {
      const answer = step(state, stimuli, atMs, random)
      state = answer.state
      return answer.intents
    },
  }
}

type IdleActIntent = Extract<MindIntent, { kind: 'idle-act' }>

function actOf(intents: readonly MindIntent[]): IdleActIntent {
  const acts = intents.filter(intent => intent.kind === 'idle-act')
  expect(acts).toHaveLength(1)
  return acts[0] as IdleActIntent
}

/** Wakes the mind at each deadline until it decides an act. */
function nextAct(mind: ReturnType<typeof script>): IdleActIntent {
  for (let wakeAt = mind.wakeAt; wakeAt !== null; wakeAt = mind.wakeAt) {
    const intents = mind.send(wakeAt, wake)
    if (intents.length > 0)
      return actOf(intents)
  }
  throw new Error('no act is due')
}

describe('idle policy', () => {
  it('decides exactly at nextIdleWakeAt under an active view with no edge', () => {
    const mind = script()
    expect(mind.send(T0, viewed())).toEqual([])
    const wakeAt = mind.wakeAt!
    expect(wakeAt).toBeGreaterThan(T0)

    const before = step(mind.state, [wake], wakeAt - 1, () => 0)
    expect(before.intents).toEqual([])
    expect(nextIdleWakeAt(before.state.idle)).toBe(wakeAt)

    const act = actOf(mind.send(wakeAt, wake))
    expect(act).toMatchObject({ channel: 'posture', requested: false })
    expect(Number.isInteger(act.seed)).toBe(true)
  })

  it('stops idle time while the view is inactive', () => {
    const mind = script()
    mind.send(T0, viewed())
    const left = mind.wakeAt! - T0
    expect(left).toBeGreaterThan(SEC)

    mind.send(T0 + SEC, viewed({ active: false }))
    expect(mind.wakeAt).toBeNull()
    expect(mind.send(T0 + HOUR_MS, wake)).toEqual([])
    expect(mind.state.idle.activeSeconds).toBe(1)

    mind.send(T0 + HOUR_MS, viewed())
    expect(mind.wakeAt! - (T0 + HOUR_MS)).toBeCloseTo(left - SEC, 6)
  })

  it('clears the follow-up, the away run, and the pending intent under a dormant view', () => {
    const mind = script()
    mind.send(T0, viewed({ away: true }))
    expect(mind.state.idle.schedule.awaySince).toBe(0)
    const sleep = actOf(mind.send(T0 + SEC, { kind: 'idle-play', act: 'sleep' }))
    mind.send(T0 + SEC, idle({ kind: 'started', intentId: sleep.id, seq: 1, act: 'sleep' }), viewed({ away: true, current: { seq: 1, kind: 'sleep' } }))
    // Woken after a long sleep while still away: the follow-up is drawn and the sleep rule decides again.
    actOf(mind.send(T0 + 200 * SEC, idle({ kind: 'ended', seq: 1, act: 'sleep', how: 'woken' }, { kind: 'view', view: idleView({ away: true }) })))
    expect(mind.state.idle.schedule.followUp).not.toBeNull()
    expect(mind.state.idle.pending).not.toBeNull()

    mind.send(T0 + 201 * SEC, viewed({ drive: null, away: true }))
    expect(mind.state.idle.schedule.followUp).toBeNull()
    expect(mind.state.idle.schedule.awaySince).toBeNull()
    expect(mind.state.idle.pending).toBeNull()
    expect(mind.wakeAt).toBeNull()
    expect(mind.send(T0 + HOUR_MS, wake)).toEqual([])
  })

  it('decides nothing more while an intent waits, until it is started or refused', () => {
    const mind = script()
    mind.send(T0, viewed())
    const first = actOf(mind.send(mind.wakeAt!, wake))
    expect(mind.wakeAt).toBeNull()
    expect(mind.send(T0 + HOUR_MS, wake)).toEqual([])

    mind.send(T0 + HOUR_MS, idle({ kind: 'started', intentId: first.id, seq: 1, act: first.act }, { kind: 'ended', seq: 1, act: first.act, how: 'finished' }))
    expect(mind.state.idle.pending).toBeNull()
    expect(mind.wakeAt).toBeGreaterThan(T0 + HOUR_MS)
    expect(mind.state.idle.schedule.lastStart[first.act]).toBe(mind.state.idle.activeSeconds)

    const second = nextAct(mind)
    expect(mind.wakeAt).toBeNull()
    mind.send(T0 + 2 * HOUR_MS, idle({ kind: 'refused', intentId: second.id }))
    expect(mind.state.idle.pending).toBeNull()
    expect(mind.wakeAt).not.toBeNull()
  })

  it('spends the fire of a refused intent', () => {
    const mind = script()
    mind.send(T0, viewed())
    const wakeAt = mind.wakeAt!
    const act = actOf(mind.send(wakeAt, wake))
    const intents = mind.send(wakeAt, idle({ kind: 'refused', intentId: act.id }))
    expect(intents).toEqual([])
    expect(mind.state.idle.schedule.lastStart).toEqual({})
    expect(mind.state.idle.schedule.urge).toBe(0)
    expect(mind.wakeAt).toBeGreaterThan(wakeAt)
  })

  it('falls asleep after the drawn delay of quiet away time, and starts the delay over after talking', () => {
    const mind = script()
    mind.send(T0, viewed({ away: true }))
    const { sleepAfter } = mind.state.idle.schedule
    expect(sleepAfter).toBeGreaterThanOrEqual(12)
    expect(sleepAfter).toBeLessThanOrEqual(30)
    expect(mind.wakeAt).toBeCloseTo(T0 + sleepAfter * SEC, 6)

    const talked = script(SEED, mind.state)
    talked.send(T0 + 5 * SEC, viewed({ away: true, mode: 'talking' }))
    expect(talked.state.idle.schedule.awaySince).toBeNull()
    talked.send(T0 + 10 * SEC, viewed({ away: true }))
    expect(talked.state.idle.schedule.awaySince).toBe(10)
    const restarted = talked.state.idle.schedule.sleepAfter
    expect(talked.wakeAt).toBeCloseTo(T0 + (10 + restarted) * SEC, 6)

    expect(actOf(mind.send(mind.wakeAt!, wake))).toMatchObject({ act: 'sleep', requested: false })
  })

  it('follows a sleep of 90 s or more with a stretch or a yawn', () => {
    const mind = script()
    mind.send(T0, viewed())
    const sleep = actOf(mind.send(T0, { kind: 'idle-play', act: 'sleep' }))
    mind.send(T0, idle({ kind: 'started', intentId: sleep.id, seq: 1, act: 'sleep' }, { kind: 'view', view: idleView({ current: { seq: 1, kind: 'sleep' } }) }))
    mind.send(T0 + 90 * SEC, idle({ kind: 'ended', seq: 1, act: 'sleep', how: 'woken' }, { kind: 'view', view: idleView() }))
    const followUp = mind.state.idle.schedule.followUp!
    expect(followUp).not.toBeNull()
    expect(mind.wakeAt).toBeCloseTo(T0 + followUp.at * SEC, 6)
    expect(actOf(mind.send(mind.wakeAt!, wake))).toMatchObject({ act: followUp.kind, requested: false })
  })

  it('answers idle-play with a requested act at once', () => {
    const mind = script()
    const act = actOf(mind.send(T0, { kind: 'idle-play', act: 'stretch' }))
    expect(act).toMatchObject({ channel: 'posture', kind: 'idle-act', act: 'stretch', requested: true })
    expect(mind.state.idle.pending).toBeNull()
  })

  it('continues identically after a JSON round trip of the state', () => {
    const mind = script()
    mind.send(T0, viewed())
    const first = actOf(mind.send(mind.wakeAt!, wake))
    const atMs = mind.wakeAt ?? T0 + MIN
    const copy = script(SEED, JSON.parse(JSON.stringify(mind.state)) as MindState)
    for (const each of [mind, copy]) {
      each.send(atMs, idle({ kind: 'started', intentId: first.id, seq: 1, act: first.act }, { kind: 'ended', seq: 1, act: first.act, how: 'finished' }))
    }
    expect(copy.wakeAt).toBe(mind.wakeAt)
    expect(copy.send(copy.wakeAt!, wake)).toEqual(mind.send(mind.wakeAt!, wake))
    expect(copy.state).toEqual(mind.state)
  })

  it('draws the same acts whether or not voice ticks arrive between the edges', () => {
    function run(ticks: boolean) {
      const mind = script()
      const acts: Array<{ act: string, seed: number, atMs: number }> = []
      let seq = 0
      const perform = (intents: readonly MindIntent[], atMs: number) => {
        for (const intent of intents) {
          if (intent.kind !== 'idle-act')
            continue
          acts.push({ act: intent.act, seed: intent.seed, atMs: Math.round(atMs) })
          seq++
          mind.send(atMs, idle({ kind: 'started', intentId: intent.id, seq, act: intent.act }, { kind: 'ended', seq, act: intent.act, how: 'finished' }))
        }
      }
      perform(mind.send(T0, viewed()), T0)
      let tickAt = T0 + SEC
      for (let wakeAt = mind.wakeAt; wakeAt !== null && wakeAt < T0 + 30 * MIN; wakeAt = mind.wakeAt) {
        if (ticks) {
          for (; tickAt < wakeAt; tickAt += SEC)
            perform(mind.send(tickAt, voiceTick(tickAt)), tickAt)
        }
        perform(mind.send(wakeAt, wake), wakeAt)
      }
      return acts
    }

    const quiet = run(false)
    expect(quiet.length).toBeGreaterThan(10)
    expect(run(true)).toEqual(quiet)
  })
})

/**
 * Seconds each act lasts, drawn from the act's seed in the ranges `NaturalIdleActivities` draws its shapes from. Only
 * the length matters to the schedule: the rest after an act counts from its end.
 */
const actSeconds: Partial<Record<IdleBehaviourKind, (random: () => number) => number>> = {
  'stretch': () => 5.2,
  'yawn': () => 5.4,
  'look-around': (random) => {
    const count = 2 + Math.floor(random() * 3)
    let seconds = 0
    for (let index = 0; index < count; index++)
      seconds += 1.2 + 1.4 * random() + 0.1
    return seconds + 0.8
  },
  'check-in': random => 2.4 + 1.8 * random(),
  'peer': random => 5 + 4 * random(),
  'zone-out': random => 8 + 10 * random(),
  'nod-off': (random) => {
    const cycles = 2 + Math.floor(random() * 2)
    let seconds = 0
    for (let index = 0; index < cycles; index++)
      seconds += (2.5 + 1.5 * random()) * 0.8 ** index + 1.58
    return seconds
  },
  'sway': random => 8 + 8 * random(),
  'sigh': random => 2.8 + 1.2 * random(),
  'shoulder-roll': random => 3 + 1.5 * random(),
  'shift-stance': random => 1.2 + 0.6 * random(),
  'clasp-hands': random => 4 + 5 * random(),
  'hair-touch': random => 2.2 + 0.8 * random(),
  'heel-rock': random => 1.5 + random(),
  'arm-swing': random => 2 + 2 * random(),
}

/**
 * A fake Natural performer on exact times: it starts what the mind orders while she is free, with the tests
 * `NaturalIdleActivities` applies, runs each act for its drawn length, and reports every edge and view change. A sleep
 * lasts until `wake`. An unasked clip or a wander is answered with `answer` at once; a pastime runs its hold unless
 * `answer` refuses it.
 */
class FakePerformer {
  seq = 0
  errandSeq = 0
  /** Seconds in which no act ran, which the unasked clip's old timer counted. */
  quietSeconds = 0
  readonly started: Array<{ act: IdleBehaviourKind, atMs: number }> = []
  readonly errands: Array<{ errand: IdleErrandKind, atMs: number, endedAtMs: number | null, holdSeconds: number | null }> = []
  private current: { seq: number, kind: IdleBehaviourKind, endMs: number } | null = null
  private errand: { seq: number, kind: IdleErrandKind, endMs: number } | null = null
  private view: IdleView
  private quietFromMs: number | null

  constructor(view: IdleView, atMs: number, private readonly answer: 'done' | 'refused' = 'done') {
    this.view = view
    this.quietFromMs = atMs
  }

  get nextEndMs(): number | null {
    const ends = [this.current?.endMs, this.errand?.endMs].filter((end): end is number => end !== undefined && Number.isFinite(end))
    return ends.length > 0 ? Math.min(...ends) : null
  }

  /** The reports of a view the host changed, such as a new mode. */
  setView(overrides: Partial<IdleView>): IdleReport[] {
    this.view = { ...this.view, ...overrides }
    return [{ kind: 'view', view: this.snapshot() }]
  }

  /** Plays one intent at `atMs` and returns the reports it caused. */
  perform(intent: MindIntent, atMs: number): IdleReport[] {
    const view = this.view
    const performing = view.mode === 'idle' || view.mode === 'watching'
    if (intent.kind === 'idle-errand') {
      const kinds = view.drive?.errands ?? []
      const free = this.errand === null && performing && !view.away && kinds.includes(intent.errand)
        && (intent.errand !== 'idle-clip' || (this.current === null && !view.blocked))
        && (intent.errand !== 'pastime' || this.current?.kind !== 'sleep')
      if (!free)
        return [{ kind: 'refused', intentId: intent.id }]
      const seq = ++this.errandSeq
      const record = { errand: intent.errand, atMs, endedAtMs: null as number | null, holdSeconds: intent.holdSeconds }
      this.errands.push(record)
      const reports: IdleReport[] = [{ kind: 'errand-started', intentId: intent.id, seq, errand: intent.errand }]
      if (intent.errand !== 'pastime' || this.answer === 'refused') {
        record.endedAtMs = atMs
        reports.push({ kind: 'errand-ended', seq, errand: intent.errand, outcome: this.answer })
      }
      else {
        this.errand = { seq, kind: intent.errand, endMs: atMs + (intent.holdSeconds ?? 0) * SEC }
      }
      reports.push({ kind: 'view', view: this.snapshot() })
      return reports
    }
    if (intent.kind !== 'idle-act')
      return []
    const free = intent.requested
      ? performing && !view.blocked
      : this.current === null && performing && !view.blocked && (intent.act === 'sleep' || !view.away)
    if (!free)
      return [{ kind: 'refused', intentId: intent.id }]
    const reports: IdleReport[] = []
    if (this.current)
      reports.push(this.end(atMs, 'released'))
    const length = intent.act === 'sleep' ? Number.POSITIVE_INFINITY : actSeconds[intent.act]!(randomSource(intent.seed))
    this.current = { seq: ++this.seq, kind: intent.act, endMs: atMs + length * SEC }
    this.countQuiet(atMs)
    this.started.push({ act: intent.act, atMs })
    reports.push({ kind: 'started', intentId: intent.id, seq: this.current.seq, act: intent.act }, { kind: 'view', view: this.snapshot() })
    return reports
  }

  /** Ends what is due at `atMs`: an act that ran its course, or a pastime's hold. */
  finish(atMs: number): IdleReport[] {
    const reports: IdleReport[] = []
    if (this.current && this.current.endMs <= atMs)
      reports.push(this.end(atMs, 'finished'))
    if (this.errand && this.errand.endMs <= atMs) {
      const { seq, kind } = this.errand
      this.errand = null
      this.errands.find((record, index) => index === seq - 1 && record.errand === kind)!.endedAtMs = atMs
      reports.push({ kind: 'errand-ended', seq, errand: kind, outcome: 'done' })
    }
    reports.push({ kind: 'view', view: this.snapshot() })
    return reports
  }

  /** Wakes her from sleep on request. */
  wake(atMs: number): IdleReport[] {
    return this.current?.kind === 'sleep' ? [this.end(atMs, 'woken-on-request'), { kind: 'view', view: this.snapshot() }] : []
  }

  countQuiet(atMs: number) {
    if (this.quietFromMs !== null)
      this.quietSeconds += (atMs - this.quietFromMs) / SEC
    this.quietFromMs = this.current === null ? atMs : null
  }

  private end(atMs: number, how: 'finished' | 'released' | 'woken-on-request'): IdleReport {
    const { seq, kind } = this.current!
    this.current = null
    this.quietFromMs = atMs
    return { kind: 'ended', seq, act: kind, how }
  }

  private snapshot(): IdleView {
    return { ...this.view, current: this.current && { seq: this.current.seq, kind: this.current.kind }, errand: this.errand && { seq: this.errand.seq, kind: this.errand.kind } }
  }
}

/**
 * Runs a mind and a fake performer from `T0` for `seconds`: the mind wakes at each `nextIdleWakeAt`, the performer
 * ends what is due, and every report returns to the mind at once.
 */
function simulate(options: { seed: number, view?: Partial<IdleView>, seconds: number, answer?: 'done' | 'refused', music?: boolean }) {
  const mind = script(options.seed)
  const performer = new FakePerformer(idleView(options.view), T0, options.answer)
  const intents: MindIntent[] = []
  const endMs = T0 + options.seconds * SEC
  const deliver = (reports: IdleReport[], atMs: number) => {
    const queue = [mind.send(atMs, idle(...reports))]
    while (queue.length > 0) {
      for (const intent of queue.shift()!) {
        intents.push(intent)
        const answered = performer.perform(intent, atMs)
        if (answered.length > 0)
          queue.push(mind.send(atMs, idle(...answered)))
      }
    }
  }
  if (options.music)
    mind.send(T0, { kind: 'music', playing: true })
  deliver([{ kind: 'view', view: idleView(options.view) }], T0)
  for (;;) {
    const candidates = [mind.wakeAt, performer.nextEndMs].filter((at): at is number => at !== null)
    const atMs = Math.min(...candidates)
    if (candidates.length === 0 || atMs >= endMs)
      break
    if (performer.nextEndMs === atMs)
      deliver(performer.finish(atMs), atMs)
    else
      deliver([], atMs)
  }
  performer.countQuiet(endMs)
  return { mind, performer, intents }
}

/**
 * Runs a mind and a fake performer idle for `idleSeconds`, turns the view away at the first moment after it when no
 * act runs, and returns the seconds from that edge to the sleep intent.
 */
function awayDelay(seed: number, idleSeconds: number, base: Partial<IdleView> = {}): number {
  const mind = script(seed)
  const performer = new FakePerformer(idleView(base), T0)
  let sleepAtMs: number | null = null
  const deliver = (reports: IdleReport[], atMs: number) => {
    const queue = [mind.send(atMs, idle(...reports))]
    while (queue.length > 0) {
      for (const intent of queue.shift()!) {
        if (intent.kind === 'idle-act' && intent.act === 'sleep' && sleepAtMs === null)
          sleepAtMs = atMs
        const answered = performer.perform(intent, atMs)
        if (answered.length > 0)
          queue.push(mind.send(atMs, idle(...answered)))
      }
    }
  }
  deliver([{ kind: 'view', view: idleView(base) }], T0)
  let edgeMs: number | null = null
  for (let guard = 0; guard < 10_000; guard++) {
    if (sleepAtMs !== null)
      break
    const candidates = [mind.wakeAt, performer.nextEndMs].filter((at): at is number => at !== null)
    const atMs = Math.min(...candidates)
    if (edgeMs === null && performer.nextEndMs === null && atMs >= T0 + idleSeconds * SEC) {
      // Nothing runs here: the edge lands on this step's time, before its own decision.
      const at = Math.max(T0 + idleSeconds * SEC, mind.state.idle.atMs ?? T0)
      edgeMs = at
      deliver(performer.setView({ away: true }), at)
      continue
    }
    if (performer.nextEndMs === atMs)
      deliver(performer.finish(atMs), atMs)
    else
      deliver([], atMs)
  }
  if (edgeMs === null || sleepAtMs === null)
    throw new Error(`seed ${seed}: no sleep`)
  return (sleepAtMs - edgeMs) / SEC
}

describe('idle policy with a performer', () => {
  it('falls asleep after a delay from the away edge that follows the uniform 12 to 30 s draw', () => {
    // Over 400 runs the mean's standard error is 18 / sqrt(12 * 400) = 0.26 s, so 1.04 s is four of them. Both
    // extremes reach within 1 s of the bounds, which 400 uniform draws miss with odds under 1e-9.
    const delays = Array.from({ length: 400 }, (_, index) => awayDelay(index + 1, 30 + (index % 7) * 15))
    const mean = delays.reduce((sum, delay) => sum + delay, 0) / delays.length
    expect(Math.abs(mean - 21)).toBeLessThan(1.04)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(12 - 1e-6)
    expect(Math.max(...delays)).toBeLessThanOrEqual(30 + 1e-6)
    expect(Math.min(...delays)).toBeLessThan(13)
    expect(Math.max(...delays)).toBeGreaterThan(29)
  })

  it('starts varied activities, rests between them, and never repeats one in a row', () => {
    const { performer } = simulate({ seed: 7, seconds: 1800 })
    const kinds = performer.started.map(start => start.act)
    // Half an hour holds a few dozen activities of at least four kinds.
    expect(kinds.length).toBeGreaterThan(12)
    expect(kinds.length).toBeLessThan(60)
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(4)
    expect(kinds.some((kind, index) => index > 0 && kind === kinds[index - 1])).toBe(false)
    // A rested, daytime character never nods off, sways to music that is not playing, or sleeps while the user is here.
    expect(kinds).not.toContain('nod-off')
    expect(kinds).not.toContain('sway')
    expect(kinds).not.toContain('sleep')
  })

  it('replays the same starts for the same seed', () => {
    // Re-pinned when the idle draw moved into the mind (item 3 of the character-mind-idle plan): every start in 900 s,
    // from the mind's idle stream and this performer. The pins before it were of Natural's own stream.
    const pins: Record<number, string[]> = {
      7: ['check-in@21.456', 'look-around@70.045', 'check-in@130.799', 'stretch@261.302', 'look-around@312.976', 'check-in@353.006', 'look-around@384.449', 'check-in@551.028', 'peer@577.163', 'stretch@629.756', 'peer@719.949', 'zone-out@755.358'],
      11: ['zone-out@21.209', 'peer@47.303', 'look-around@110.718', 'peer@199.484', 'look-around@233.479', 'check-in@418.333', 'zone-out@463.869', 'peer@493.211', 'look-around@527.371', 'peer@545.497', 'stretch@571.172', 'peer@639.356', 'look-around@658.733', 'check-in@835.985', 'peer@896.598'],
      3: ['check-in@119.590', 'look-around@150.221', 'check-in@179.390', 'peer@280.083', 'look-around@316.020', 'zone-out@387.568', 'check-in@471.599', 'peer@490.765', 'check-in@510.328', 'zone-out@525.090', 'look-around@644.355', 'check-in@673.256', 'look-around@693.328', 'zone-out@732.475', 'peer@765.988', 'look-around@858.538', 'check-in@892.029'],
      23: ['look-around@23.111', 'check-in@110.714', 'zone-out@164.404', 'look-around@357.678', 'zone-out@384.643', 'check-in@417.908', 'stretch@441.394', 'look-around@457.791', 'peer@495.145', 'look-around@519.858', 'check-in@564.022', 'zone-out@603.062', 'peer@640.993', 'check-in@663.892', 'zone-out@734.447', 'look-around@763.755', 'stretch@796.901', 'zone-out@819.863', 'check-in@859.832'],
      42: ['look-around@12.803', 'zone-out@120.382', 'check-in@173.160', 'zone-out@209.662', 'check-in@245.662', 'stretch@268.167', 'check-in@341.008', 'zone-out@373.657', 'check-in@400.195', 'peer@531.807', 'look-around@580.637', 'check-in@645.769', 'look-around@725.571', 'zone-out@778.349', 'check-in@881.259'],
      101: ['zone-out@104.979', 'stretch@154.406', 'zone-out@186.382', 'look-around@234.325', 'check-in@299.450', 'look-around@321.156', 'check-in@352.252', 'look-around@408.588', 'check-in@486.648', 'look-around@519.741', 'check-in@540.724', 'look-around@619.040', 'zone-out@645.269', 'peer@694.051', 'zone-out@719.421', 'stretch@838.483', 'check-in@861.833'],
    }
    for (const seed of [7, 11, 3, 23, 42, 101]) {
      const { performer } = simulate({ seed, seconds: 900 })
      const seen = performer.started.map(start => `${start.act}@${((start.atMs - T0) / SEC).toFixed(3)}`)
      expect(seen, `seed ${seed}`).toEqual(pins[seed])
    }
    expect(simulate({ seed: 11, seconds: 900 }).performer.started).not.toEqual(simulate({ seed: 12, seconds: 900 }).performer.started)
  })

  it('starts as many activities per hour as Natural did, inactive and working', () => {
    // Measured with `NaturalIdleActivities` over 1000 hours per mode (four seeds of 250 hours at 30 steps a second) when
    // the schedule moved out of it; the idle agency ADR's evidence read 59 and 44 per hour under other conditions.
    const perHour = { idle: 58.0, watching: 41.7 } as const
    const hours = 40
    for (const mode of ['idle', 'watching'] as const) {
      const { performer } = simulate({ seed: 9, view: { mode }, seconds: hours * 3600 })
      const rate = performer.seq / hours
      // Starts are a renewal count over `hours`, so four Poisson standard deviations bound the difference.
      const bound = 4 * Math.sqrt(perHour[mode] * hours) / hours
      expect(Math.abs(rate - perHour[mode]), `${mode}: ${rate.toFixed(2)} per hour now, ${perHour[mode]} before`).toBeLessThan(bound)
    }
  }, 30_000)

  it('on a body host draws a kind she has just shown far less often than its weight alone gives', () => {
    // She shows a check-in, or a peer in its place, then a zone-out; the next drawn kind counts.
    const nextAfter = (shown: IdleBehaviourKind) => {
      let checkIns = 0
      for (let seed = 1; seed <= 300; seed++) {
        const mind = script(seed)
        const shownPerformer = new FakePerformer(idleView({ drive: { ...drive, body: true } }), T0)
        const send = (atMs: number, stimulus: MindStimulus) => {
          for (const intent of mind.send(atMs, stimulus)) {
            const reports = shownPerformer.perform(intent, atMs)
            if (reports.length > 0)
              send(atMs, idle(...reports))
          }
        }
        send(T0, viewed({ drive: { ...drive, body: true } }))
        send(T0, { kind: 'idle-play', act: shown })
        send(T0 + 10, { kind: 'idle-play', act: 'zone-out' })
        const zoned = shownPerformer.seq
        for (let atMs = T0 + 10; shownPerformer.seq === zoned && atMs < T0 + 600 * SEC;) {
          const next = [mind.wakeAt, shownPerformer.nextEndMs].filter((at): at is number => at !== null)
          if (next.length === 0)
            break
          atMs = Math.min(...next)
          if (shownPerformer.nextEndMs === atMs)
            send(atMs, idle(...shownPerformer.finish(atMs)))
          else
            send(atMs, wake)
        }
        if (shownPerformer.started.at(-1)?.act === 'check-in' && shownPerformer.seq > zoned)
          checkIns++
      }
      return checkIns
    }
    expect(nextAfter('check-in')).toBeLessThan(0.5 * nextAfter('peer'))
  }, 30_000)

  it('follows a long sleep with a yawn and never a stretch while she is settled in', () => {
    const seen = new Set<IdleBehaviourKind>()
    for (let seed = 1; seed <= 30; seed++) {
      for (const act of afterLongSleep(seed, {}))
        seen.add(act)
    }
    expect([...seen]).toEqual(['yawn'])
  })

  it('can still stretch after a long sleep when the return stands her up', () => {
    const seen = new Set<IdleBehaviourKind>()
    for (let seed = 1; seed <= 30; seed++) {
      for (const act of afterLongSleep(seed, { mode: 'watching' }))
        seen.add(act)
    }
    expect(seen.has('stretch')).toBe(true)
  })
})

describe('settling', () => {
  /** A body drive that starts no act, so the only idle deadline is the settle. */
  const still: NaturalIdleDrive = { ...drive, body: true, rate: 0 }
  const settles = (intents: readonly MindIntent[]) => intents.filter(intent => intent.kind === 'settle').map(intent => intent.kind === 'settle' && intent.settled)

  it('settles her in exactly 120 s of active idle with a body drive, and arms the wake for it', () => {
    const mind = script()
    expect(settles(mind.send(T0, viewed({ drive: still })))).toEqual([])
    expect(mind.wakeAt).toBe(T0 + SETTLE_SECONDS * SEC)
    expect(settles(mind.send(T0 + SETTLE_SECONDS * SEC - 1, wake))).toEqual([])
    expect(settles(mind.send(T0 + SETTLE_SECONDS * SEC, wake))).toEqual([true])
    expect(mind.state.idle.settle.settled).toBe(true)
    expect(mind.wakeAt).toBeNull()
  })

  it('does not count while the view is inactive', () => {
    const mind = script()
    mind.send(T0, viewed({ drive: still }))
    mind.send(T0 + 60 * SEC, viewed({ drive: still, active: false }))
    expect(mind.send(T0 + HOUR_MS, wake)).toEqual([])
    mind.send(T0 + HOUR_MS, viewed({ drive: still }))
    expect(mind.wakeAt).toBe(T0 + HOUR_MS + 60 * SEC)
  })

  it('never settles a head-only host or outside idle mode', () => {
    for (const view of [{ drive: { ...still, body: undefined } }, { drive: still, mode: 'watching' as const }]) {
      const mind = script()
      mind.send(T0, viewed(view))
      expect(mind.wakeAt).toBeNull()
      expect(settles(mind.send(T0 + HOUR_MS, wake))).toEqual([])
    }
  })

  it('gets her up with a false edge when the mode changes or the view goes dormant, and counts again from there', () => {
    for (const away of [viewed({ drive: still, mode: 'talking' }), idle({ kind: 'view', view: dormantIdleView(true) })]) {
      const mind = script()
      mind.send(T0, viewed({ drive: still }))
      mind.send(T0 + SETTLE_SECONDS * SEC, wake)
      expect(settles(mind.send(T0 + 200 * SEC, away))).toEqual([false])
      expect(mind.state.idle.settle).toEqual({ since: null, settled: false })
      mind.send(T0 + 210 * SEC, viewed({ drive: still }))
      expect(mind.wakeAt).toBe(T0 + (210 + SETTLE_SECONDS) * SEC)
    }
  })

  const interruptions: MindStimulus[] = [
    { kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0, y: 0 }, settings: defaultExpressionPerformanceSettings, voice: null },
    { kind: 'emotion', source: 'act', emotion: 'happy', nominal: 0.7, settings: defaultExpressionPerformanceSettings },
    { kind: 'cue-gesture', gesture: 'nod', count: 1, source: 'act' },
    { kind: 'presence', away: false, wake: { cause: 'unlock', atMs: T0 } },
    { kind: 'screen-change' },
    { kind: 'chat', cue: 'sent', words: 3 },
    { kind: 'chat', cue: 'unfold' },
  ]
  it.each(interruptions)('starts the count over after a $kind stimulus and gets her up', (stimulus) => {
    const mind = script()
    mind.send(T0, viewed({ drive: still }))
    expect(settles(mind.send(T0 + 100 * SEC, stimulus))).toEqual([])
    expect(mind.state.idle.settle.since).toBe(100)
    mind.send(T0 + 220 * SEC - 1, wake)
    expect(mind.state.idle.settle.settled).toBe(false)
    expect(settles(mind.send(T0 + 220 * SEC, wake))).toEqual([true])
    expect(settles(mind.send(T0 + 300 * SEC, stimulus))).toEqual([false])
  })

  it('does not start the count over for stimuli that do not claim her', () => {
    const mind = script()
    mind.send(T0, viewed({ drive: still }))
    mind.send(T0 + 100 * SEC, { kind: 'music', playing: true }, voiceTick(T0 + 100 * SEC), { kind: 'presence', away: true, wake: null })
    expect(mind.state.idle.settle.since).toBe(0)
  })

  it('draws only the settled pool once she is settled in', () => {
    const out = new Set(['stretch', 'peer', 'shoulder-roll', 'clasp-hands', 'hair-touch', 'heel-rock', 'arm-swing'])
    const { performer } = simulate({ seed: 3, view: { drive: { ...drive, body: true } }, seconds: 3 * 3600 })
    const settledAt = T0 + SETTLE_SECONDS * SEC
    const later = performer.started.filter(start => start.atMs > settledAt)
    expect(later.length).toBeGreaterThan(20)
    expect(later.filter(start => out.has(start.act))).toEqual([])
  })
})

/**
 * Puts her to sleep by the away rule on a body host, wakes her on request after 130 s with the view `after`, and
 * returns the act the mind decides within 4 s of the wake, if any.
 */
function afterLongSleep(seed: number, after: Partial<IdleView>): [IdleBehaviourKind] | [] {
  const body = { ...drive, body: true }
  const mind = script(seed)
  const performer = new FakePerformer(idleView({ drive: body, away: true }), T0)
  const send = (atMs: number, stimulus: MindStimulus): IdleBehaviourKind | null => {
    let decided: IdleBehaviourKind | null = null
    for (const intent of mind.send(atMs, stimulus)) {
      if (intent.kind === 'idle-act')
        decided = intent.act
      const reports = performer.perform(intent, atMs)
      if (reports.length > 0)
        decided = send(atMs, idle(...reports)) ?? decided
    }
    return decided
  }
  send(T0, viewed({ drive: body, away: true }))
  expect(send(mind.wakeAt!, wake)).toBe('sleep')
  const wokeAt = T0 + 160 * SEC
  send(wokeAt, idle(...performer.setView({ away: false, ...after }), ...performer.wake(wokeAt)))
  const due = mind.wakeAt
  if (due === null || due > wokeAt + 4 * SEC)
    return []
  const act = send(due, wake)
  return act ? [act] : []
}

describe('idle errands with a performer', () => {
  it('starts each errand at about the long-run rate of the timer it replaces', () => {
    // The old timers' own code, run for 1000 free hours at the U5 base aadf13984 (evidence u5/old-rates.txt).
    const old: Record<IdleErrandKind, number> = { 'pastime': 5.39, 'idle-clip': 12.006, 'wander': 4.176 }
    const hours = 200
    for (const kind of ['pastime', 'idle-clip', 'wander'] as const) {
      const { performer } = simulate({ seed: 5, view: { drive: { ...drive, body: kind !== 'pastime', errands: [kind] } }, seconds: hours * 3600 })
      // `decideIdleClip` counted quiet time only, and the scene's quiet body had no Natural behaviour in progress.
      const counted = (kind === 'idle-clip' ? performer.quietSeconds : hours * 3600) / 3600
      const perHour = performer.errands.length / counted
      // Starts are a renewal count over `counted` hours, so four Poisson standard deviations bound the difference.
      const bound = 4 * Math.sqrt(old[kind] * counted) / counted
      expect(Math.abs(perHour - old[kind]), `${kind}: ${perHour.toFixed(3)} per hour now, ${old[kind]} before`).toBeLessThan(bound)
    }
  }, 60_000)

  it('orders a pastime hold of 90 to 300 s', () => {
    const { performer } = simulate({ seed: 5, view: { drive: { ...drive, errands: ['pastime'] } }, seconds: 4 * 3600 })
    expect(performer.errands.length).toBeGreaterThan(0)
    for (const errand of performer.errands) {
      expect(errand.holdSeconds).toBeGreaterThanOrEqual(PASTIME_HOLD_SECONDS.min)
      expect(errand.holdSeconds).toBeLessThanOrEqual(PASTIME_HOLD_SECONDS.max)
    }
  })

  it('orders a wander stay of 45 to 150 s, drawn log-uniformly', () => {
    const { performer } = simulate({ seed: 5, view: { drive: { ...drive, body: true, errands: ['wander'] } }, seconds: 100 * 3600 })
    const stays = performer.errands.map(errand => errand.holdSeconds!)
    expect(stays.length).toBeGreaterThan(200)
    for (const stay of stays) {
      expect(stay).toBeGreaterThanOrEqual(IDLE_ERRAND_LINGER_SECONDS.min)
      expect(stay).toBeLessThanOrEqual(IDLE_ERRAND_LINGER_SECONDS.max)
    }
    // Log-uniform: half the stays fall below the geometric mean of the bounds; four standard deviations bound the share.
    const middle = Math.sqrt(IDLE_ERRAND_LINGER_SECONDS.min * IDLE_ERRAND_LINGER_SECONDS.max)
    const below = stays.filter(stay => stay < middle).length / stays.length
    expect(Math.abs(below - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / stays.length))
  }, 30_000)

  it('treats a refused errand as spent and keeps its refractory', () => {
    for (const kind of ['pastime', 'idle-clip', 'wander'] as const) {
      const { performer } = simulate({ seed: 5, view: { drive: { ...drive, body: kind !== 'pastime', errands: [kind] } }, seconds: 6 * 3600, answer: 'refused' })
      const started = performer.errands
      expect(started.length, kind).toBeGreaterThan(2)
      const { refractory, from } = IDLE_ERRAND_PACING[kind]
      for (let index = 1; index < started.length; index++) {
        const since = from === 'start' ? started[index - 1].atMs : started[index - 1].endedAtMs!
        expect((started[index].atMs - since) / SEC, kind).toBeGreaterThanOrEqual(refractory - 1e-6)
      }
    }
  })

  it('starts no errand for a drive that lists none', () => {
    const { intents } = simulate({ seed: 5, view: { drive: { ...drive, body: true } }, seconds: 4 * 3600 })
    expect(intents.filter(intent => intent.kind === 'idle-errand')).toEqual([])
  })
})

describe('the groove', () => {
  it('is drawn only while the mind hears music', () => {
    const kinds = (music: boolean) => simulate({ seed: 7, seconds: 3600, music }).performer.started.map(start => start.act)
    expect(kinds(false)).not.toContain('sway')
    expect(kinds(true)).toContain('sway')
  })

  it('starts at the long-run rate measured when music became a stimulus of the mind', () => {
    // Measured at CM5a's item 4 over 1000 hours (seeds 1 to 4, 250 hours each) with music on: 14.199 grooves and
    // 56.866 acts per hour. Music adds the groove to the pick and changes no rate.
    const perHour = 14.2
    const hours = 40
    const { performer } = simulate({ seed: 9, seconds: hours * 3600, music: true })
    const rate = performer.started.filter(start => start.act === 'sway').length / hours
    // Starts are a renewal count over `hours`, so four Poisson standard deviations bound the difference.
    const bound = 4 * Math.sqrt(perHour * hours) / hours
    expect(Math.abs(rate - perHour), `${rate.toFixed(2)} grooves per hour now, ${perHour} measured`).toBeLessThan(bound)
  }, 30_000)
})
