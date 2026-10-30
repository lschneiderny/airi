import type {
  GateLocalTime,
  GateSettings,
  GateSignals,
  Observation,
  ReasonCategory,
  ReasonKind,
  SituationState,
  ThreadKind,
  ThreadState,
  UrgeGateMemory,
} from '.'

import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  addThreads,
  advanceSituation,
  BASE_RATE_AT_HALF_PER_HOUR,
  evaluateUrgeGate,
  HOUR_MS,
  initialSituationState,
  logicalDayKey,
  markAddressed,
  nextRandom,
  promotionUrgeMemory,
  pruneThreads,
  raiseThread,
  recordUrgeFireOutcome,
  recordUrgeUserTurn,
  reduceSituation,
  seedRng,
} from '.'

/*
 * Seeded desk-day simulation: the pre-release proof of the opening rate per
 * Chattiness (IS-1) and of the share of openings that are hers (IS-2). With
 * `ULW_EVIDENCE_DIR` set, it writes `task-8-cadence.csv` and
 * `task-8-cadence-summary.json` there.
 */

const MIN = 60_000
const DAY_MS = 24 * HOUR_MS
const STEP_MS = 10_000
const DAYS = 50
/** Chattiness 0.5 run that judges the IS-1 band and gap spread (Luke, 2026-10-30: lengthen until seed-independent; 200 days varied by +-0.15, 1000 days gives 2.23 and 2.34 on two seeds). */
const LONG_RUN_DAYS = 1000
/** The 1000-day run takes about 17 s; a margin over vitest's 10 s default hook timeout. */
const SIMULATION_TIMEOUT_MS = 60_000
/** IS-1: never two non-urgent openings within two minutes. */
const OPENING_FLOOR_MS = 120_000
const SEED = 20_261_030
/** Monday 2026-01-05 00:00, read as local time through UTC getters. */
const DAY0_MS = Date.UTC(2026, 0, 5)
const SESSION_ID = 'chat-a'
const DESK_MS = 8 * HOUR_MS
/** Days that start at 09:00 reach no sign-off window; days that start at 15:30 reach 22:30-23:30 and miss the greeting. */
const EARLY_ARRIVAL_HOUR = 9
const LATE_ARRIVAL_HOUR = 15.5
const SIGN_OFF_DAY_PROBABILITY = 0.5
const REPLY_PROBABILITY = 0.6
const REPLY_MEDIAN_MS = 4 * MIN
const REPLY_SIGMA = 0.8
const USER_EXCHANGES_PER_DAY = 2
const THREAD_PER_EXCHANGE_PROBABILITY = 0.5
/** Thread extraction runs once the exchange has been quiet this long (IS-11). */
const EXTRACTION_QUIET_MS = 15 * MIN
const APP_SESSION_MEDIAN_MS = 20 * MIN
const APP_SESSION_SIGMA = 1

/** Modeled LLM veto per fired category; a declined attempt sends nothing. */
const DECLINE_PROBABILITY: Readonly<Record<ReasonCategory, number>> = {
  'open': 0.25,
  'ritual': 0.05,
  'due': 0.05,
  'continuation': 0.25,
  'double-text': 0.25,
  'urgent': 0,
}

const CHATTINESS = [0, 0.25, 0.5, 0.75, 1] as const
type Chattiness = typeof CHATTINESS[number]

const OPENING_BANDS: Readonly<Record<Chattiness, readonly [number, number]>> = {
  0: [1, 3],
  0.25: [1.5, 4],
  0.5: [3, 6],
  0.75: [4, 7.5],
  1: [5.5, 10],
}

const SIGNALS: GateSignals = {
  userSpeaking: false,
  userTyping: false,
  characterSpeaking: false,
  generating: false,
  queued: 0,
  desktopFresh: true,
  foregroundFresh: true,
  stageVisible: true,
}

const NO_HELD_TOPICS: ReadonlySet<string> = new Set()

const APPS = [
  { appId: 'code', label: 'VS Code', category: 'editor' },
  { appId: 'chrome', label: 'Chrome', category: 'browser' },
  { appId: 'figma', label: 'Figma', category: 'work' },
  { appId: 'spotify', label: 'Spotify', category: 'media' },
] as const

const THREAD_KINDS: readonly ThreadKind[] = ['question', 'event', 'later', 'topic']

interface DayRow {
  readonly chattiness: Chattiness
  readonly day: number
  attempts: number
  spokenOpenings: number
  declined: number
  continuations: number
  doubleTexts: number
  rituals: number
  readonly gapsMin: number[]
}

interface ThreadPickStats {
  ripe: number
  raised: number
}

interface RunResult {
  readonly rows: readonly DayRow[]
  /** Spoken openings by the kind of reason she reached out for. */
  readonly openingKinds: ReadonlyMap<ReasonKind, number>
  /** Epoch times of every spoken opening, in order. */
  readonly openingTimes: readonly number[]
  /** Per thread kind: threads that were ever ripe enough to pick, and how many of those she raised. */
  readonly threadPicks: Readonly<Record<ThreadKind, ThreadPickStats>>
}

type Random = () => number

function scriptRandom(seed: number): Random {
  let state = seedRng(seed)
  return () => {
    const [value, next] = nextRandom(state)
    state = next
    return value
  }
}

function logNormal(random: Random, medianMs: number, sigma: number): number {
  const radius = Math.sqrt(-2 * Math.log1p(-random()))
  return medianMs * Math.exp(sigma * radius * Math.cos(2 * Math.PI * random()))
}

function localTime(nowMs: number): GateLocalTime {
  const date = new Date(nowMs)
  const hour = date.getUTCHours()
  return {
    dayKey: logicalDayKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour }),
    minuteOfDay: hour * 60 + date.getUTCMinutes(),
  }
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  return sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

function isOpening(category: ReasonCategory): boolean {
  return category === 'open' || category === 'ritual' || category === 'due'
}

type ScriptItem
  = | { readonly atMs: number, readonly kind: 'user-turn' }
    | { readonly atMs: number, readonly kind: 'thread', readonly summary: string }

function simulate(chattiness: Chattiness, days: number): RunResult {
  const random = scriptRandom(SEED)
  const settings: GateSettings = { enabled: true, chattiness, dontDisturb: false, quietApps: [], speakDuringGames: true }
  let memory: UrgeGateMemory = promotionUrgeMemory(DAY0_MS, SEED)
  let situation: SituationState = initialSituationState
  let threads: ThreadState = { threads: [] }
  const rows: DayRow[] = []
  const openingKinds = new Map<ReasonKind, number>()
  const openingTimes: number[] = []
  const threadPicks = Object.fromEntries(THREAD_KINDS.map(kind => [kind, { ripe: 0, raised: 0 }])) as Record<ThreadKind, ThreadPickStats>
  const everRipe = new Set<string>()
  let threadCount = 0

  const observe = (observation: Observation, nowMs: number) => {
    situation = reduceSituation(situation, observation, nowMs)
  }
  observe({ kind: 'busy', state: 'accepts', atMs: DAY0_MS }, DAY0_MS)

  for (let day = 0; day < days; day++) {
    const dayStartMs = DAY0_MS + day * DAY_MS
    const signOffDay = random() < SIGN_OFF_DAY_PROBABILITY
    const arriveMs = dayStartMs + (signOffDay ? LATE_ARRIVAL_HOUR : EARLY_ARRIVAL_HOUR) * HOUR_MS
    const leaveMs = arriveMs + DESK_MS
    /** The next 04:00 rollover; threads never outlive their logical day. */
    const dayEndsAtMs = dayStartMs + 28 * HOUR_MS
    const row: DayRow = { chattiness, day, attempts: 0, spokenOpenings: 0, declined: 0, continuations: 0, doubleTexts: 0, rituals: 0, gapsMin: [] }
    rows.push(row)
    let lastOpeningAtMs: number | null = null

    // He was away overnight (the first day too); the leader kept evaluating, so the hard hold ends at arrival.
    if (day === 0)
      observe({ kind: 'presence', state: 'away', atMs: arriveMs - 16 * HOUR_MS }, arriveMs - 16 * HOUR_MS)
    memory = evaluateUrgeGate({
      nowMs: arriveMs - STEP_MS,
      situation: advanceSituation(situation, arriveMs - STEP_MS),
      reasons: { threads },
      local: localTime(arriveMs - STEP_MS),
      sessionId: SESSION_ID,
      signals: SIGNALS,
      settings,
      heldTopics: NO_HELD_TOPICS,
    }, memory).memory
    observe({ kind: 'presence', state: 'here', atMs: arriveMs }, arriveMs)
    threads = pruneThreads(threads, arriveMs)

    const switches: { atMs: number, app: typeof APPS[number] }[] = []
    let appIndex = Math.floor(random() * APPS.length)
    for (let atMs = arriveMs; atMs < leaveMs; atMs += Math.max(STEP_MS, logNormal(random, APP_SESSION_MEDIAN_MS, APP_SESSION_SIGMA))) {
      switches.push({ atMs, app: APPS[appIndex] })
      appIndex = (appIndex + 1 + Math.floor(random() * (APPS.length - 1))) % APPS.length
    }

    const script: ScriptItem[] = []
    const schedule = (item: ScriptItem) => {
      if (item.atMs >= leaveMs)
        return
      script.push(item)
      script.sort((a, b) => a.atMs - b.atMs)
    }
    const scheduleExchange = (firstTurnAtMs: number, turns: number) => {
      let atMs = firstTurnAtMs
      for (let turn = 0; turn < turns; turn++) {
        if (turn > 0)
          atMs += MIN + random() * 2 * MIN
        schedule({ atMs, kind: 'user-turn' })
      }
      if (random() < THREAD_PER_EXCHANGE_PROBABILITY) {
        threadCount += 1
        schedule({ atMs: atMs + EXTRACTION_QUIET_MS, kind: 'thread', summary: `open question ${threadCount}` })
      }
    }
    for (let exchange = 0; exchange < USER_EXCHANGES_PER_DAY; exchange++)
      scheduleExchange(arriveMs + random() * (DESK_MS - 30 * MIN), 3 + Math.floor(random() * 4))

    for (let nowMs = arriveMs; nowMs < leaveMs; nowMs += STEP_MS) {
      while (switches.length > 0 && switches[0].atMs <= nowMs) {
        const { atMs, app } = switches.shift()!
        observe({ kind: 'activity', ...app, title: null, atMs }, nowMs)
      }
      while (script.length > 0 && script[0].atMs <= nowMs) {
        const item = script.shift()!
        if (item.kind === 'user-turn') {
          observe({ kind: 'conversation', who: 'user', origin: 'user', atMs: item.atMs }, nowMs)
          memory = recordUrgeUserTurn(memory, nowMs)
        }
        else {
          threads = addThreads(threads, [{ kind: 'question', summary: item.summary, cue: `ask about ${item.summary}` }], SESSION_ID, nowMs, { dayEndsAtMs })
        }
      }
      situation = advanceSituation(situation, nowMs)

      const { decision, memory: next } = evaluateUrgeGate({
        nowMs,
        situation,
        reasons: { threads },
        local: localTime(nowMs),
        sessionId: SESSION_ID,
        signals: SIGNALS,
        settings,
        heldTopics: NO_HELD_TOPICS,
      }, memory)
      memory = next
      for (const reason of decision.trace.reasons) {
        if (reason.kind.startsWith('thread-') && !everRipe.has(reason.key)) {
          everRipe.add(reason.key)
          threadPicks[reason.kind.slice('thread-'.length) as ThreadKind].ripe += 1
        }
      }
      if (!decision.fire)
        continue

      row.attempts += 1
      if (random() < DECLINE_PROBABILITY[decision.category]) {
        row.declined += 1
        memory = recordUrgeFireOutcome(memory, 'declined', nowMs)
        continue
      }
      memory = recordUrgeFireOutcome(memory, 'spoken', nowMs)
      observe({ kind: 'conversation', who: 'character', origin: 'unprompted', atMs: nowMs }, nowMs)
      const { picked } = decision
      if (picked.kind.startsWith('thread-')) {
        threads = raiseThread(threads, picked.key, nowMs)
        threadPicks[picked.kind.slice('thread-'.length) as ThreadKind].raised += 1
      }
      if (picked.sourceEventId !== null)
        situation = markAddressed(situation, picked.key, nowMs)

      if (decision.category === 'continuation')
        row.continuations += 1
      if (decision.category === 'double-text')
        row.doubleTexts += 1
      if (!isOpening(decision.category))
        continue
      row.spokenOpenings += 1
      if (decision.category === 'ritual')
        row.rituals += 1
      openingKinds.set(picked.kind, (openingKinds.get(picked.kind) ?? 0) + 1)
      openingTimes.push(nowMs)
      if (lastOpeningAtMs !== null)
        row.gapsMin.push((nowMs - lastOpeningAtMs) / MIN)
      lastOpeningAtMs = nowMs
      if (random() < REPLY_PROBABILITY)
        scheduleExchange(nowMs + logNormal(random, REPLY_MEDIAN_MS, REPLY_SIGMA), 1 + Math.floor(random() * 3))
    }

    observe({ kind: 'presence', state: 'away', atMs: leaveMs }, leaveMs)
  }

  return { rows, openingKinds, openingTimes, threadPicks }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatMinutes(value: number | null): string {
  return value === null ? '' : value.toFixed(1)
}

function gapStats(result: RunResult) {
  const gaps = result.rows.flatMap(row => row.gapsMin).sort((a, b) => a - b)
  return {
    meanSpokenOpenings: mean(result.rows.map(row => row.spokenOpenings)),
    medianGapMin: percentile(gaps, 0.5),
    p90GapMin: percentile(gaps, 0.9),
    shareGapsUnder20Min: gaps.filter(gap => gap < 20).length / gaps.length,
  }
}

function writeEvidence(dir: string, results: ReadonlyMap<Chattiness, RunResult>, longRun: RunResult) {
  mkdirSync(dir, { recursive: true })
  const lines = ['chattiness,day,attempts,spokenOpenings,declined,continuations,doubleTexts,rituals,medianGapMin,p90GapMin']
  const summary: Record<string, unknown> = { baseRateAtHalfPerHour: BASE_RATE_AT_HALF_PER_HOUR, days: DAYS, longRunDays: LONG_RUN_DAYS, stepMs: STEP_MS, seed: SEED }
  for (const [chattiness, result] of results) {
    for (const row of result.rows) {
      const gaps = [...row.gapsMin].sort((a, b) => a - b)
      lines.push([
        chattiness,
        row.day,
        row.attempts,
        row.spokenOpenings,
        row.declined,
        row.continuations,
        row.doubleTexts,
        row.rituals,
        formatMinutes(percentile(gaps, 0.5)),
        formatMinutes(percentile(gaps, 0.9)),
      ].join(','))
    }
    const gaps = result.rows.flatMap(row => row.gapsMin).sort((a, b) => a - b)
    const openings = result.rows.reduce((sum, row) => sum + row.spokenOpenings, 0)
    summary[`c=${chattiness}`] = {
      meanSpokenOpenings: mean(result.rows.map(row => row.spokenOpenings)),
      meanAttempts: mean(result.rows.map(row => row.attempts)),
      meanDeclined: mean(result.rows.map(row => row.declined)),
      meanContinuations: mean(result.rows.map(row => row.continuations)),
      meanDoubleTexts: mean(result.rows.map(row => row.doubleTexts)),
      meanRituals: mean(result.rows.map(row => row.rituals)),
      medianGapMin: percentile(gaps, 0.5),
      p90GapMin: percentile(gaps, 0.9),
      shareGapsUnder20Min: gaps.filter(gap => gap < 20).length / gaps.length,
      openingKindShares: Object.fromEntries([...result.openingKinds].sort().map(([kind, count]) => [kind, count / openings])),
      threadPicks: result.threadPicks,
    }
  }
  summary['c=0.5 long run'] = gapStats(longRun)
  writeFileSync(join(dir, 'task-8-cadence.csv'), `${lines.join('\n')}\n`)
  writeFileSync(join(dir, 'task-8-cadence-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.info(JSON.stringify(summary, null, 2))
}

describe('urge gate cadence simulation', () => {
  const results = new Map<Chattiness, RunResult>()
  let longRun: RunResult

  beforeAll(() => {
    for (const chattiness of CHATTINESS)
      results.set(chattiness, simulate(chattiness, DAYS))
    longRun = simulate(0.5, LONG_RUN_DAYS)
    const dir = process.env.ULW_EVIDENCE_DIR
    if (dir !== undefined && dir !== '')
      writeEvidence(dir, results, longRun)
  }, SIMULATION_TIMEOUT_MS)

  it.each(CHATTINESS.filter(chattiness => chattiness !== 0.5))('keeps the mean spoken openings per desk day in band at chattiness %s', (chattiness) => {
    const [low, high] = OPENING_BANDS[chattiness]
    const openings = mean(results.get(chattiness)!.rows.map(row => row.spokenOpenings))
    expect(openings).toBeGreaterThanOrEqual(low)
    expect(openings).toBeLessThanOrEqual(high)
  })

  it('keeps the mean spoken openings per desk day in band at chattiness 0.5 over the long run', () => {
    const [low, high] = OPENING_BANDS[0.5]
    const openings = mean(longRun.rows.map(row => row.spokenOpenings))
    expect(openings).toBeGreaterThanOrEqual(low)
    expect(openings).toBeLessThanOrEqual(high)
  })

  it('never speaks two openings within two minutes', () => {
    for (const result of [...results.values(), longRun]) {
      for (let index = 1; index < result.openingTimes.length; index++)
        expect(result.openingTimes[index] - result.openingTimes[index - 1]).toBeGreaterThanOrEqual(OPENING_FLOOR_MS)
    }
  })

  it('spaces openings with a long tail at the default chattiness over the long run', () => {
    const gaps = longRun.rows.flatMap(row => row.gapsMin).sort((a, b) => a - b)
    expect(gaps.filter(gap => gap < 20).length / gaps.length).toBeLessThan(0.25)
    expect(percentile(gaps, 0.9)!).toBeGreaterThanOrEqual(2 * percentile(gaps, 0.5)!)
  })

  it('opens mostly for her own reasons at the default chattiness', () => {
    const kinds = results.get(0.5)!.openingKinds
    let total = 0
    let own = 0
    for (const [kind, count] of kinds) {
      total += count
      if (kind.startsWith('thread-') || kind.startsWith('ritual-') || kind === 'own-day')
        own += count
    }
    expect(own / total).toBeGreaterThanOrEqual(0.55)
  })
})
