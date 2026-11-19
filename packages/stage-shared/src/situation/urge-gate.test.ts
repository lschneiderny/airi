import type {
  GateLocalTime,
  GateSettings,
  GateSignals,
  SituationActivity,
  SituationEvent,
  SituationState,
  Thread,
  UrgeGateDecision,
  UrgeGateHoldReason,
  UrgeGateInput,
  UrgeGateMemory,
  UrgeGatePending,
} from '.'

import { describe, expect, it } from 'vitest'

import {
  ACCRUAL_DT_MAX_MS,
  BASE_RATE_AT_HALF_PER_HOUR,
  DOUBLE_TEXT_OFFSET_MAX_MS,
  DOUBLE_TEXT_OFFSET_MIN_MS,
  evaluateUrgeGate,
  FLOOR_MS,
  HOUR_MS,
  initialSituationState,
  initialUrgeMemory,
  logicalDayKey,
  promotionUrgeMemory,
  randomSource,
  recordExternalSpeech,
  recordUrgeFireOutcome,
  recordUrgeUserTurn,
  restoreSocialMemory,
  visibilityRegainUrgeMemory,
} from '.'

const T0 = 1_700_000_000_000
const SEC = 1000
const MIN = 60 * SEC

const QUIET_SIGNALS: GateSignals = {
  userSpeaking: false,
  userTyping: false,
  characterSpeaking: false,
  generating: false,
  queued: 0,
  desktopFresh: true,
  foregroundFresh: true,
  stageVisible: true,
}

const SETTINGS: GateSettings = { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: true }

/** 16:00 local: past the greeting window, before the sign-off window, so no ritual is open. */
const AFTERNOON: GateLocalTime = { dayKey: '2023-11-14', minuteOfDay: 16 * 60 }

/** A user at the desk who accepts remarks, with nothing on the screen worth a word. */
function quietSituation(overrides: Partial<SituationState> = {}): SituationState {
  return {
    ...initialSituationState,
    presence: { state: 'here', reason: null, sinceMs: T0 - HOUR_MS },
    busy: { state: 'accepts', atMs: T0 },
    activity: { appId: 'notepad', label: 'Notepad', category: 'editor', title: null, sinceMs: T0 - 10 * MIN },
    nowMs: T0,
    ...overrides,
  }
}

function urgentNotify(): SituationEvent {
  return {
    id: `notify:timer@${T0}`,
    kind: 'notify',
    topicKey: 'notify:timer',
    text: 'the tea timer rang',
    atMs: T0,
    salience: 1,
    halfLifeMs: 30 * MIN,
    tier: 0,
    origin: 'world',
    shownAtMs: null,
    addressedAtMs: null,
  }
}

function laterThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread:later:0:0',
    topicKey: 'thread:later:0:0',
    sessionId: 'chat-a',
    kind: 'later',
    summary: 'He will call the bank',
    cue: 'ask whether the bank call worked out',
    bornAtMs: T0 - 3 * HOUR_MS,
    dueAtMs: T0 - 10 * MIN,
    raisedCount: 0,
    lastRaisedAtMs: null,
    expiresAtMs: T0 + 24 * HOUR_MS,
    ...overrides,
  }
}

interface InputOverrides {
  nowMs?: number
  situation?: SituationState
  threads?: readonly Thread[]
  local?: GateLocalTime
  signals?: Partial<GateSignals>
  settings?: Partial<GateSettings>
  heldTopics?: ReadonlySet<string>
  forceTiming?: boolean
}

function gateInput(overrides: InputOverrides = {}): UrgeGateInput {
  return {
    nowMs: overrides.nowMs ?? T0,
    situation: overrides.situation ?? quietSituation(),
    reasons: { threads: { threads: overrides.threads ?? [] } },
    local: overrides.local ?? AFTERNOON,
    sessionId: 'chat-a',
    signals: { ...QUIET_SIGNALS, ...overrides.signals },
    settings: { ...SETTINGS, ...overrides.settings },
    heldTopics: overrides.heldTopics ?? new Set(),
    ...(overrides.forceTiming === undefined ? {} : { forceTiming: overrides.forceTiming }),
  }
}

function memoryWith(overrides: Partial<UrgeGateMemory>): UrgeGateMemory {
  return { ...initialUrgeMemory, ...overrides }
}

function spokenPending(overrides: Partial<UrgeGatePending> = {}): UrgeGatePending {
  return {
    topicKey: 'thread:question:1:0',
    firedAtMs: T0 - 10 * MIN,
    spokenAtMs: T0 - 10 * MIN,
    category: 'open',
    reasonKind: 'thread-question',
    doubleTextRoll: 1,
    doubleTextOffsetMs: 0,
    ...overrides,
  }
}

/** A fire that was just made and awaits its outcome. */
function firedPending(overrides: Partial<UrgeGatePending> = {}): UrgeGatePending {
  return spokenPending({ topicKey: 'own-day', firedAtMs: T0, spokenAtMs: null, reasonKind: 'own-day', ...overrides })
}

function fired(decision: UrgeGateDecision): Extract<UrgeGateDecision, { fire: true }> {
  if (!decision.fire)
    throw new Error(`expected a fire, got hold ${decision.reason}`)
  return decision
}

/** The fields an urgent or double-text fire must leave untouched. */
function drawState(memory: UrgeGateMemory) {
  return { urge: memory.urge, urgeThreshold: memory.urgeThreshold, fires: memory.fires }
}

/** A Mulberry32 source from `seed` that counts how often the gate draws from it. */
function countingSource(seed = 0): { random: () => number, draws: () => number } {
  const next = randomSource(seed)
  let draws = 0
  const random = () => {
    draws++
    return next()
  }
  return { random, draws: () => draws }
}

/** Evaluates with a fresh Mulberry32 source unless the test passes its own. */
function evaluate(input: UrgeGateInput, memory: UrgeGateMemory, random: () => number = randomSource(0)) {
  return evaluateUrgeGate(input, memory, random)
}

describe('evaluateUrgeGate rate', () => {
  it('maps Chattiness to the base rate and to nothing else', () => {
    // Ratios to the calibration constant (26^(c - 0.5)), so calibrating it in todo 8 keeps this pin.
    const expected = [[0, 0.1961], [0.25, 0.4429], [0.5, 1], [0.75, 2.2581], [1, 5.099]] as const
    const opens: number[] = []
    for (const [chattiness, ratio] of expected) {
      const { trace } = evaluate(gateInput({ settings: { chattiness } }), initialUrgeMemory).decision
      expect(trace.multipliers.base / BASE_RATE_AT_HALF_PER_HOUR).toBeCloseTo(ratio, 3)
      expect({ ...trace.multipliers, base: 0 }).toEqual({ base: 0, pressure: 0.6, exchange: 1, clear: 1, damping: 1, floor: 1, game: 1, mood: 1 })
      opens.push(trace.hazardPerHour.open)
    }
    for (let i = 1; i < opens.length; i++)
      expect(opens[i]).toBeGreaterThan(opens[i - 1])
  })

  it('accumulates urge across holds and fires within the time the hazard implies', () => {
    const input = (nowMs: number) => gateInput({ nowMs, settings: { chattiness: 1 } })
    const hazard = evaluate(input(T0), initialUrgeMemory).decision.trace.hazardPerHour.total
    const threshold = 1.5
    let memory = memoryWith({ urgeThreshold: threshold })
    let previousUrge = 0
    let firedAtMs: number | null = null
    for (let nowMs = T0; nowMs <= T0 + 2 * (threshold / hazard) * HOUR_MS; nowMs += ACCRUAL_DT_MAX_MS) {
      const source = countingSource()
      const evaluation = evaluate(input(nowMs), memory, source.random)
      if (evaluation.decision.fire) {
        firedAtMs = nowMs
        expect(evaluation.decision.reason).toBe('urge')
        expect(evaluation.memory.urge).toBe(0)
        break
      }
      expect(evaluation.decision.reason).toBe('urge')
      expect(evaluation.memory.urge).toBeGreaterThanOrEqual(previousUrge)
      expect(source.draws()).toBe(0)
      previousUrge = evaluation.memory.urge
      memory = evaluation.memory
    }
    expect(firedAtMs).not.toBeNull()
    expect(firedAtMs! - T0).toBeLessThanOrEqual((threshold / hazard) * HOUR_MS + ACCRUAL_DT_MAX_MS)
    expect(firedAtMs! - T0).toBeGreaterThanOrEqual((threshold / hazard) * HOUR_MS - ACCRUAL_DT_MAX_MS)
  })

  it('has zero hazard while his last turn is under two minutes old', () => {
    const at = (lastUserAtMs: number) => evaluate(
      gateInput({ situation: quietSituation({ conversation: { ...initialSituationState.conversation, lastUserAtMs } }) }),
      memoryWith({ lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS }),
    )
    const inside = at(T0 - 2 * MIN + 1)
    expect(inside.decision.trace.hazardPerHour.total).toBe(0)
    expect(inside.memory.urge).toBe(0)
    expect(at(T0 - 2 * MIN).decision.trace.hazardPerHour.total).toBeGreaterThan(0)
  })

  it('halves the opening hazard during games', () => {
    const game = quietSituation({ activity: { appId: 'elden-ring', label: 'Elden Ring', category: 'game', title: null, sinceMs: T0 - MIN } })
    expect(evaluate(gateInput({ situation: game }), initialUrgeMemory).decision.trace.multipliers.game).toBe(0.5)
  })
})

describe('evaluateUrgeGate mood factor', () => {
  const morning: GateLocalTime = { dayKey: '2023-11-14', minuteOfDay: 9 * 60 }
  const withMood = (moodFactor?: number) => ({ ...gateInput({ local: morning, threads: [laterThread()] }), ...(moodFactor === undefined ? {} : { moodFactor }) })
  const traceOf = (moodFactor?: number) => evaluate(withMood(moodFactor), initialUrgeMemory).decision.trace

  it('multiplies only the open hazard by the factor', () => {
    const plain = traceOf()
    const moody = traceOf(1.35)
    expect(plain.multipliers.mood).toBe(1)
    expect(moody.multipliers.mood).toBe(1.35)
    expect(plain.hazardPerHour.ritual).toBe(12)
    expect(plain.hazardPerHour.due).toBe(1)
    expect(moody.hazardPerHour.open).toBeCloseTo(plain.hazardPerHour.open * 1.35, 10)
    expect(moody.hazardPerHour.ritual).toBe(plain.hazardPerHour.ritual)
    expect(moody.hazardPerHour.due).toBe(plain.hazardPerHour.due)
    expect(moody.hazardPerHour.continuation).toBe(plain.hazardPerHour.continuation)
  })

  it('clamps the factor to 0.67..1.35', () => {
    expect(traceOf(5).multipliers.mood).toBe(1.35)
    expect(traceOf(5).hazardPerHour.open).toBe(traceOf(1.35).hazardPerHour.open)
    expect(traceOf(0.1).multipliers.mood).toBe(0.67)
    expect(traceOf(-3).multipliers.mood).toBe(0.67)
    expect(traceOf(0.67).hazardPerHour.open).toBe(traceOf(0.1).hazardPerHour.open)
  })

  it('treats a non-finite factor as 1', () => {
    const plain = evaluate(withMood(), initialUrgeMemory)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(evaluate(withMood(bad), initialUrgeMemory)).toEqual(plain)
  })

  it('leaves every trace and the RNG draw count identical when the factor is omitted or 1', () => {
    const ready = memoryWith({ urge: 10, urgeThreshold: 0.5, lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS })
    const omittedSource = countingSource()
    const omitted = evaluate(withMood(), ready, omittedSource.random)
    const one = evaluate(withMood(1), ready)
    expect(omitted.decision.fire).toBe(true)
    expect(one).toEqual(omitted)
    expect(omittedSource.draws()).toBe(5)
    // A held evaluation never draws, with or without the factor.
    const heldSource = countingSource()
    evaluate(withMood(1.35), memoryWith({ urgeThreshold: 1000 }), heldSource.random)
    expect(heldSource.draws()).toBe(0)
  })
})

describe('evaluateUrgeGate floor', () => {
  it('holds every non-urgent fire for two minutes after any fire, without accruing', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - FLOOR_MS + 1, lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, urge: 5 })
    const inside = evaluate(gateInput(), memory)
    expect(inside.decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(inside.decision.trace.hazardPerHour.total).toBe(0)
    expect(drawState(inside.memory)).toEqual(drawState(memory))

    const after = evaluate(gateInput({ nowMs: T0 + 1 }), memory)
    expect(after.decision).toMatchObject({ fire: true, reason: 'urge' })
  })
})

describe('evaluateUrgeGate urgent bypass', () => {
  const urgentSituation = (overrides: Partial<SituationState> = {}) => quietSituation({ events: [urgentNotify()], ...overrides })

  it('fires an urgent notify inside the floor, inside exchange zero, and while quiet after two unanswered openings', () => {
    const situation = urgentSituation({ conversation: { ...initialSituationState.conversation, lastUserAtMs: T0 - 30 * SEC } })
    const memory = memoryWith({ lastFireAtMs: T0 - 10 * SEC, lastSpokenAtMs: T0 - 10 * SEC, unanswered: 2 })
    const decision = fired(evaluate(gateInput({ situation }), memory).decision)
    expect(decision).toMatchObject({ reason: 'urgent', category: 'urgent', topicKey: 'notify:timer' })
    expect(decision.trace.phase).toBe('quiet')
  })

  it('passes a game that would silence her but no other hard suppressor', () => {
    const game = urgentSituation({ activity: { appId: 'elden-ring', label: 'Elden Ring', category: 'game', title: null, sinceMs: T0 - MIN } })
    expect(evaluate(gateInput({ situation: game, settings: { speakDuringGames: false } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: true, reason: 'urgent' })
    expect(evaluate(gateInput({ situation: urgentSituation(), settings: { dontDisturb: true } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: false, reason: 'dont-disturb' })
    expect(evaluate(gateInput({ situation: urgentSituation(), signals: { userTyping: true } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: false, reason: 'user-typing' })
  })

  it('keeps a held urgent topic unselectable', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - 10 * SEC })
    const decision = evaluate(gateInput({ situation: urgentSituation(), heldTopics: new Set(['notify:timer']) }), memory).decision
    expect(decision).toMatchObject({ fire: false, reason: 'floor' })
  })
})

describe('evaluateUrgeGate fire transitions', () => {
  it('leaves urge, threshold, and fires untouched and draws nothing on an urgent fire', () => {
    const memory = memoryWith({ lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, urge: 0.4, fires: [T0 - 20 * MIN] })
    const source = countingSource()
    const evaluation = evaluate(gateInput({ situation: quietSituation({ events: [urgentNotify()] }) }), memory, source.random)
    expect(evaluation.decision.fire).toBe(true)
    expect(source.draws()).toBe(0)
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
    expect(evaluation.memory.lastFireAtMs).toBe(T0)
    expect(evaluation.memory.pending).toMatchObject({ category: 'urgent', doubleTextRoll: 1, doubleTextOffsetMs: 0 })
  })

  it('leaves urge, threshold, and fires untouched and draws nothing on a double-text fire and consumes it', () => {
    const memory = memoryWith({
      lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS,
      lastFireAtMs: T0 - 30 * SEC,
      urge: 0.4,
      fires: [T0 - 30 * SEC],
      unanswered: 1,
      lastSpokenAtMs: T0 - 25 * SEC,
      doubleText: { topicKey: 'own-day', dueAtMs: T0, expiresAtMs: T0 + 35 * SEC },
    })
    const source = countingSource()
    const evaluation = evaluate(gateInput(), memory, source.random)
    expect(source.draws()).toBe(0)
    expect(evaluation.decision).toMatchObject({ fire: true, reason: 'double-text', category: 'double-text', topicKey: 'own-day' })
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
    expect(evaluation.memory.unanswered).toBe(1)
    expect(evaluation.memory.doubleText).toBeNull()
  })

  it('resets urge and draws a new threshold on an ordinary fire', () => {
    const memory = memoryWith({ urge: 5 })
    const evaluation = evaluate(gateInput(), memory, randomSource(1))
    const decision = fired(evaluation.decision)
    expect(decision).toMatchObject({ reason: 'urge', category: 'open', topicKey: 'own-day' })
    expect(decision.trace.pick).toMatchObject({ category: 'open', reasonKey: 'own-day' })
    expect(evaluation.memory.urge).toBe(0)
    expect(evaluation.memory.urgeThreshold).not.toBe(memory.urgeThreshold)
    expect(evaluation.memory.fires).toEqual([T0])
    expect(evaluation.memory.pending?.doubleTextOffsetMs).toBeGreaterThanOrEqual(DOUBLE_TEXT_OFFSET_MIN_MS)
    expect(evaluation.memory.pending?.doubleTextOffsetMs).toBeLessThanOrEqual(DOUBLE_TEXT_OFFSET_MAX_MS)
  })

  it('draws exactly five values for an ordinary fire, in order, and none for an urge hold', () => {
    const fire = countingSource(42)
    const evaluation = evaluate(gateInput(), memoryWith({ urge: 5 }), fire.random)
    expect(fire.draws()).toBe(5)
    const expected = randomSource(42)
    const [thresholdRoll, categoryRoll, reasonRoll, doubleTextRoll] = [expected(), expected(), expected(), expected()]
    expect(evaluation.decision.trace.pick).toMatchObject({ categoryRoll, reasonRoll })
    expect(evaluation.memory.urgeThreshold).toBe(-Math.log1p(-thresholdRoll))
    expect(evaluation.memory.pending?.doubleTextRoll).toBe(doubleTextRoll)

    const hold = countingSource(42)
    expect(evaluate(gateInput(), memoryWith({ urgeThreshold: 1000 }), hold.random).decision.reason).toBe('urge')
    expect(hold.draws()).toBe(0)
  })

  it('is deterministic for the same memory and input', () => {
    const memory = memoryWith({ urge: 5 })
    expect(evaluate(gateInput(), memory)).toEqual(evaluate(gateInput(), memory))
  })

  it('fires with reason forced and a real pick when forceTiming skips a hold', () => {
    const source = countingSource()
    const evaluation = evaluate(gateInput({ forceTiming: true }), initialUrgeMemory, source.random)
    expect(evaluation.decision).toMatchObject({ fire: true, reason: 'forced', category: 'open', topicKey: 'own-day' })
    expect(evaluation.decision.trace.pick).not.toBeNull()
    expect(source.draws()).toBe(5)
    expect(evaluation.memory.fires).toEqual([T0])
  })

  it('holds with no-topic after spending the five draws when the drawn category has no reason', () => {
    const memory = memoryWith({ urge: 5 })
    const source = countingSource()
    const evaluation = evaluate(gateInput({ heldTopics: new Set(['own-day']) }), memory, source.random)
    expect(evaluation.decision).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(source.draws()).toBe(5)
    expect(evaluation.memory.urgeThreshold).toBe(memory.urgeThreshold)
    expect(evaluation.memory.urge).toBe(5)
  })
})

describe('evaluateUrgeGate double text', () => {
  const armedOpening = (overrides: Partial<UrgeGatePending> = {}) =>
    memoryWith({ lastFireAtMs: T0, pending: firedPending({ doubleTextRoll: 0.1, doubleTextOffsetMs: 30 * SEC, ...overrides }) })

  it('arms once when the opening is spoken and fires inside the minute after it', () => {
    const spokenAtMs = T0 + 5 * SEC
    const spoken = recordUrgeFireOutcome(armedOpening(), 'spoken', spokenAtMs)
    expect(spoken.doubleText).toEqual({ topicKey: 'own-day', dueAtMs: spokenAtMs + 30 * SEC, expiresAtMs: spokenAtMs + 60 * SEC })
    expect(spoken.unanswered).toBe(1)

    expect(evaluate(gateInput({ nowMs: spokenAtMs + 30 * SEC - 1 }), spoken).decision.fire).toBe(false)
    const second = evaluate(gateInput({ nowMs: spokenAtMs + 30 * SEC }), spoken)
    expect(second.decision).toMatchObject({ fire: true, reason: 'double-text', topicKey: 'own-day' })

    const after = recordUrgeFireOutcome(second.memory, 'spoken', spokenAtMs + 32 * SEC)
    expect(after.doubleText).toBeNull()
    expect(after.unanswered).toBe(1)
    expect(evaluate(gateInput({ nowMs: spokenAtMs + 40 * SEC }), after).decision)
      .toMatchObject({ fire: false, reason: 'floor' })
  })

  it('expires 60 s after the opening was spoken', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - 60 * SEC, doubleText: { topicKey: 'own-day', dueAtMs: T0 - 10 * SEC, expiresAtMs: T0 } })
    const evaluation = evaluate(gateInput(), memory)
    expect(evaluation.decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(evaluation.memory.doubleText).toBeNull()
  })

  it('is cancelled by a user turn and by external speech', () => {
    const spoken = recordUrgeFireOutcome(armedOpening(), 'spoken', T0)
    expect(spoken.doubleText).not.toBeNull()
    expect(recordUrgeUserTurn(spoken, T0 + SEC).doubleText).toBeNull()
    expect(recordExternalSpeech(spoken, T0 + SEC).doubleText).toBeNull()
  })

  it.each(['declined', 'cancelled', 'failed'] as const)('is never armed after a %s original', (outcome) => {
    const settled = recordUrgeFireOutcome(armedOpening({ doubleTextRoll: 0 }), outcome, T0)
    expect(settled.doubleText).toBeNull()
    expect(settled.pending).toBeNull()
    expect(recordUrgeFireOutcome(settled, 'spoken', T0 + SEC).doubleText).toBeNull()
  })

  it.each([
    ['continuation', 'continuation'],
    ['double-text', 'double-text'],
    ['urgent', 'notify'],
  ] as const)('is never armed by a spoken %s fire', (category, reasonKind) => {
    const spoken = recordUrgeFireOutcome(armedOpening({ category, reasonKind, doubleTextRoll: 0 }), 'spoken', T0)
    expect(spoken.doubleText).toBeNull()
  })
})

describe('evaluateUrgeGate unanswered phases', () => {
  const morning: GateLocalTime = { dayKey: '2023-11-14', minuteOfDay: 9 * 60 }

  it('opens rituals and due bumps only when nothing is unanswered', () => {
    const input = gateInput({ local: morning, threads: [laterThread()] })
    const open = evaluate(input, initialUrgeMemory).decision.trace
    expect(open.phase).toBe('open')
    expect(open.hazardPerHour).toMatchObject({ ritual: 12, due: 1, continuation: 0 })

    const waiting = evaluate(input, memoryWith({ unanswered: 1, lastSpokenAtMs: T0 - 10 * MIN, pending: spokenPending() })).decision.trace
    expect(waiting.phase).toBe('continuation-window')
    expect(waiting.hazardPerHour).toMatchObject({ open: 0, ritual: 0, due: 0 })
    expect(waiting.hazardPerHour.continuation).toBeGreaterThan(0)

    const quiet = evaluate(input, memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - HOUR_MS, urge: 5 }))
    expect(quiet.decision).toMatchObject({ fire: false, reason: 'quiet-unanswered' })
    expect(quiet.decision.trace.hazardPerHour.total).toBe(0)
  })

  it('allows only a continuation for 90 minutes after one unanswered opening, then reopens at half rate', () => {
    const lastSpokenAtMs = T0 - 10 * MIN
    const memory = memoryWith({ lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, unanswered: 1, lastSpokenAtMs, lastFireAtMs: lastSpokenAtMs, pending: spokenPending(), urgeThreshold: 0.05 })
    let state = memory
    let previousUrge = 0
    let continuation: UrgeGateDecision | null = null
    for (let nowMs = T0; nowMs < lastSpokenAtMs + 90 * MIN; nowMs += ACCRUAL_DT_MAX_MS) {
      const evaluation = evaluate(gateInput({ nowMs }), state)
      if (evaluation.decision.fire) {
        continuation = evaluation.decision
        break
      }
      expect(evaluation.decision.reason).toBe('awaiting-reply')
      expect(evaluation.memory.urge).toBeGreaterThan(previousUrge)
      previousUrge = evaluation.memory.urge
      state = evaluation.memory
    }
    expect(continuation).toMatchObject({ fire: true, reason: 'urge', category: 'continuation', topicKey: 'thread:question:1:0' })

    const before = evaluate(gateInput({ nowMs: lastSpokenAtMs + 90 * MIN - 1 }), memory).decision.trace
    expect(before.phase).toBe('continuation-window')
    const reopened = evaluate(gateInput({ nowMs: lastSpokenAtMs + 90 * MIN }), memory).decision.trace
    expect(reopened.phase).toBe('reopened')
    expect(reopened.multipliers.damping).toBe(0.5)
    expect(reopened.hazardPerHour.continuation).toBe(0)
    expect(reopened.hazardPerHour.open).toBeGreaterThan(0)
  })

  it('holds every non-urgent fire for four hours after two unanswered openings', () => {
    const memory = memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - 4 * HOUR_MS + 1, urge: 5 })
    expect(evaluate(gateInput(), memory).decision).toMatchObject({ fire: false, reason: 'quiet-unanswered' })
    const reopened = evaluate(gateInput({ nowMs: T0 + 1 }), memory).decision
    expect(reopened).toMatchObject({ fire: true, reason: 'urge' })
    expect(reopened.trace.multipliers.damping).toBe(0.3)
  })

  it('restores the rate gradually after a reply', () => {
    const replied = recordUrgeUserTurn(memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - 5 * HOUR_MS }), T0)
    expect(replied).toMatchObject({ unanswered: 0, awaitingSinceMs: null, damp: { depth: 0.7, sinceMs: T0 } })
    const damping = [0, 30 * MIN, HOUR_MS, 2 * HOUR_MS, 6 * HOUR_MS]
      .map(offset => evaluate(gateInput({ nowMs: T0 + offset }), replied).decision.trace)
    for (const trace of damping)
      expect(trace.phase).toBe('open')
    for (let i = 1; i < damping.length; i++)
      expect(damping[i].multipliers.damping).toBeGreaterThan(damping[i - 1].multipliers.damping)
    expect(damping[2].multipliers.damping).toBeCloseTo(0.65, 10)
  })

  it('treats a declined fire as neutral', () => {
    const memory = memoryWith({ unanswered: 1, damp: { depth: 0.4, sinceMs: T0 - HOUR_MS }, pending: firedPending() })
    const declined = recordUrgeFireOutcome(memory, 'declined', T0)
    expect(declined.unanswered).toBe(1)
    expect(declined.damp).toEqual(memory.damp)
    expect(declined.pending).toBeNull()
  })

  it('counts a forced external remark toward the floor but not as unanswered', () => {
    const spoke = recordExternalSpeech(initialUrgeMemory, T0)
    expect(spoke).toMatchObject({ lastFireAtMs: T0, lastSpokenAtMs: T0, unanswered: 0 })
    expect(evaluate(gateInput({ nowMs: T0 + MIN }), { ...spoke, urge: 5 }).decision).toMatchObject({ fire: false, reason: 'floor' })
  })
})

describe('evaluateUrgeGate holds and clocks', () => {
  const accruing = memoryWith({ lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, urge: 0.3 })

  it.each([
    ['dont-disturb', { settings: { dontDisturb: true } }, true],
    ['stage-hidden', { signals: { stageVisible: false } }, true],
    ['user-typing', { signals: { userTyping: true } }, false],
    ['generating', { signals: { generating: true } }, false],
  ] as const)('keeps urge and rng across a %s hold', (reason, overrides, long) => {
    const evaluation = evaluate(gateInput(overrides), accruing)
    expect(evaluation.decision).toMatchObject({ fire: false, reason })
    expect(drawState(evaluation.memory)).toEqual(drawState(accruing))
    expect(evaluation.memory.lastHardHoldAtMs).toBe(long ? T0 : null)
  })

  it('checks dont-disturb before stage-hidden', () => {
    expect(evaluate(gateInput({ settings: { dontDisturb: true }, signals: { stageVisible: false } }), accruing).decision.reason)
      .toBe('dont-disturb')
  })

  it('keeps urge and threshold across a quiet hold', () => {
    const memory = { ...accruing, unanswered: 2, lastSpokenAtMs: T0 - HOUR_MS }
    const evaluation = evaluate(gateInput(), memory)
    expect(evaluation.decision.reason).toBe('quiet-unanswered')
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
  })

  it('ramps the opening hazard back up after a long hard hold clears', () => {
    const held = evaluate(gateInput({ settings: { dontDisturb: true } }), accruing).memory
    const clear = [SEC, MIN, 10 * MIN].map(offset => evaluate(gateInput({ nowMs: T0 + offset }), held).decision.trace.multipliers.clear)
    expect(clear[0]).toBeLessThan(clear[1])
    expect(clear[1]).toBeLessThan(clear[2])
    expect(visibilityRegainUrgeMemory(accruing, T0).lastHardHoldAtMs).toBe(T0)
  })

  it('accrues nothing across a backward clock jump and at most ten seconds across a forward one', () => {
    const memory = memoryWith({ lastEvalAtMs: T0, urge: 0.2, urgeThreshold: 10 })
    const back = evaluate(gateInput({ nowMs: T0 - HOUR_MS }), memory)
    expect(back.memory.urge).toBe(0.2)

    const forward = evaluate(gateInput({ nowMs: T0 + HOUR_MS }), memory)
    const hazard = forward.decision.trace.hazardPerHour.total
    expect(forward.memory.urge).toBeGreaterThan(0.2)
    expect(forward.memory.urge - 0.2).toBeLessThanOrEqual(hazard * ACCRUAL_DT_MAX_MS / HOUR_MS + 1e-12)
  })

  it('returns memory unchanged for an invalid time', () => {
    const evaluation = evaluate(gateInput({ nowMs: Number.NaN }), accruing)
    expect(evaluation.decision).toMatchObject({ fire: false, reason: 'invalid-time' })
    expect(evaluation.memory).toBe(accruing)
  })
})

describe('evaluateUrgeGate hard contract (pinned before the urge rewrite)', () => {
  // Moved from the legacy gate tests (todo 1). Every case holds or fires the same with a memory whose urge path would
  // fire at once and with one inside the floor, so the hard contract is pinned independently of timing.
  const notify = urgentNotify()
  const gameActivity: SituationActivity = { appId: 'eldenring', label: 'Elden Ring', category: 'game', title: null, sinceMs: T0 - 10 * MIN }
  const ready = memoryWith({ urge: 5 })
  const blocked = memoryWith({ lastFireAtMs: T0 - 10 * SEC, fires: [T0 - 10 * SEC] })

  /** One hold reason per case, each the only fault, built so the urgent notify can be swapped in. */
  const faults: { reason: UrgeGateHoldReason, input: (events: SituationEvent[]) => UrgeGateInput }[] = [
    { reason: 'disabled', input: events => gateInput({ settings: { enabled: false }, situation: quietSituation({ events }) }) },
    { reason: 'dont-disturb', input: events => gateInput({ settings: { dontDisturb: true }, situation: quietSituation({ events }) }) },
    { reason: 'stage-hidden', input: events => gateInput({ signals: { stageVisible: false }, situation: quietSituation({ events }) }) },
    { reason: 'presence-away', input: events => gateInput({ situation: quietSituation({ events, presence: { state: 'away', reason: 'locked', sinceMs: T0 } }) }) },
    { reason: 'presence-unknown', input: events => gateInput({ situation: quietSituation({ events, presence: { state: 'unknown', reason: 'stale', sinceMs: T0 } }) }) },
    { reason: 'stale-signal', input: events => gateInput({ signals: { desktopFresh: false }, situation: quietSituation({ events }) }) },
    { reason: 'user-speaking', input: events => gateInput({ signals: { userSpeaking: true }, situation: quietSituation({ events }) }) },
    { reason: 'user-typing', input: events => gateInput({ signals: { userTyping: true }, situation: quietSituation({ events }) }) },
    { reason: 'character-speaking', input: events => gateInput({ signals: { characterSpeaking: true }, situation: quietSituation({ events }) }) },
    { reason: 'generating', input: events => gateInput({ signals: { generating: true }, situation: quietSituation({ events }) }) },
    { reason: 'queued', input: events => gateInput({ signals: { queued: 1 }, situation: quietSituation({ events }) }) },
    { reason: 'busy-busy', input: events => gateInput({ situation: quietSituation({ events, busy: { state: 'busy', atMs: T0 } }) }) },
    { reason: 'busy-fullscreen', input: events => gateInput({ situation: quietSituation({ events, busy: { state: 'fullscreen', atMs: T0 } }) }) },
    { reason: 'busy-presentation', input: events => gateInput({ situation: quietSituation({ events, busy: { state: 'presentation', atMs: T0 } }) }) },
    { reason: 'busy-quiet', input: events => gateInput({ situation: quietSituation({ events, busy: { state: 'quiet', atMs: T0 } }) }) },
    { reason: 'busy-unknown', input: events => gateInput({ situation: quietSituation({ events, busy: { state: 'unknown', atMs: null } }) }) },
    { reason: 'quiet-app', input: events => gateInput({ situation: quietSituation({ events, activity: { ...gameActivity, appId: 'zoom', label: 'Zoom', category: 'call' } }) }) },
    { reason: 'busy-game', input: events => gateInput({ settings: { speakDuringGames: false }, situation: quietSituation({ events, activity: gameActivity }) }) },
  ]

  it('returns the hard reasons in the pinned order of precedence when several hold', () => {
    // Every fault at once; each step repairs the reason just reported, and the next one in the list must surface.
    const state = {
      enabled: false,
      dontDisturb: true,
      stageVisible: false,
      presence: 'away' as 'away' | 'unknown' | 'here',
      fresh: false,
      userSpeaking: true,
      userTyping: true,
      characterSpeaking: true,
      generating: true,
      queued: 1,
      busy: 'quiet' as 'quiet' | 'accepts',
      quietApps: ['eldenring'],
      speakDuringGames: false,
    }
    const decide = (): UrgeGateDecision => evaluate(gateInput({
      settings: { enabled: state.enabled, dontDisturb: state.dontDisturb, quietApps: state.quietApps, speakDuringGames: state.speakDuringGames },
      signals: {
        stageVisible: state.stageVisible,
        desktopFresh: state.fresh,
        foregroundFresh: state.fresh,
        userSpeaking: state.userSpeaking,
        userTyping: state.userTyping,
        characterSpeaking: state.characterSpeaking,
        generating: state.generating,
        queued: state.queued,
      },
      situation: quietSituation({
        presence: { state: state.presence, reason: null, sinceMs: T0 - HOUR_MS },
        busy: { state: state.busy, atMs: T0 },
        activity: gameActivity,
      }),
    }), ready).decision

    const order: { reason: UrgeGateHoldReason, repair: () => void }[] = [
      { reason: 'disabled', repair: () => { state.enabled = true } },
      { reason: 'dont-disturb', repair: () => { state.dontDisturb = false } },
      { reason: 'stage-hidden', repair: () => { state.stageVisible = true } },
      { reason: 'presence-away', repair: () => { state.presence = 'unknown' } },
      { reason: 'presence-unknown', repair: () => { state.presence = 'here' } },
      { reason: 'stale-signal', repair: () => { state.fresh = true } },
      { reason: 'user-speaking', repair: () => { state.userSpeaking = false } },
      { reason: 'user-typing', repair: () => { state.userTyping = false } },
      { reason: 'character-speaking', repair: () => { state.characterSpeaking = false } },
      { reason: 'generating', repair: () => { state.generating = false } },
      { reason: 'queued', repair: () => { state.queued = 0 } },
      { reason: 'busy-quiet', repair: () => { state.busy = 'accepts' } },
      { reason: 'quiet-app', repair: () => { state.quietApps = [] } },
      { reason: 'busy-game', repair: () => { state.speakDuringGames = true } },
    ]
    const seen: UrgeGateDecision['reason'][] = []
    for (const step of order) {
      const decision = decide()
      expect(decision).toMatchObject({ fire: false })
      seen.push(decision.reason)
      step.repair()
    }

    expect(seen).toEqual(order.map(step => step.reason))
    expect(decide()).toMatchObject({ fire: true, reason: 'urge' })
  })

  it.each(faults.map(fault => [fault.reason, fault] as const))('treats an urgent notify under %s as pinned: fires only for busy-game, holds otherwise', (reason, fault) => {
    for (const memory of [ready, blocked]) {
      const { decision } = evaluate(fault.input([notify]), memory)

      if (reason === 'busy-game')
        expect(decision).toMatchObject({ fire: true, reason: 'urgent', topicKey: notify.topicKey })
      else
        expect(decision).toMatchObject({ fire: false, reason })
    }
  })

  it('still holds a game for an urgent notify when games are quiet but the app is also denylisted', () => {
    const input = gateInput({ settings: { speakDuringGames: false, quietApps: ['eldenring'] }, situation: quietSituation({ events: [notify], activity: gameActivity }) })

    expect(evaluate(input, ready).decision).toMatchObject({ fire: false, reason: 'quiet-app' })
  })

  it('never makes a self-origin event a reason, urgent or not, even when forced', () => {
    const own: SituationEvent[] = [
      { ...notify, id: 'self-notify', topicKey: 'notify:self:1', origin: 'self' },
      { ...notify, id: 'self-session', kind: 'long-session', topicKey: 'activity:code:tier:3', tier: 3, origin: 'self' },
    ]
    const ownKeys = own.map(event => event.topicKey)
    const ownIds = own.map(event => event.id)

    // A world event of the same kind would fire urgent inside the floor; her own never does.
    const held = evaluate(gateInput({ situation: quietSituation({ events: own }) }), blocked)
    expect(held.decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(held.decision.trace.reasons.filter(reason => ownIds.includes(reason.sourceEventId ?? ''))).toEqual([])

    const forced = fired(evaluate(gateInput({ forceTiming: true, situation: quietSituation({ events: own }) }), initialUrgeMemory).decision)
    expect(forced.reason).toBe('forced')
    expect(ownKeys).not.toContain(forced.topicKey)
    expect(forced.trace.reasons.filter(reason => ownIds.includes(reason.sourceEventId ?? ''))).toEqual([])
  })

  it.each(faults.map(fault => [fault.reason, fault] as const))('keeps %s a hold when timing is forced', (reason, fault) => {
    for (const memory of [ready, blocked])
      expect(evaluate({ ...fault.input([]), forceTiming: true }, memory).decision).toMatchObject({ fire: false, reason })
  })
})

describe('evaluateUrgeGate rituals', () => {
  /** UTC stands in for the host's local time zone. */
  function localAt(nowMs: number): GateLocalTime {
    const date = new Date(nowMs)
    const hour = date.getUTCHours()
    return {
      dayKey: logicalDayKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour }),
      minuteOfDay: hour * 60 + date.getUTCMinutes(),
    }
  }

  it('fires each ritual at most once per logical day across two simulated days', () => {
    const start = Date.UTC(2026, 9, 30, 8)
    const random = randomSource(7)
    let memory = promotionUrgeMemory(start, random)
    let lastUserAtMs: number | null = null
    let presence: SituationState['presence'] = { state: 'here', reason: null, sinceMs: start }
    const counts = new Map<string, number>()

    for (let nowMs = start; nowMs < start + 48 * HOUR_MS; nowMs += ACCRUAL_DT_MAX_MS) {
      const local = localAt(nowMs)
      // Away from 01:30 to 08:00, so the second day starts with a fresh first presence.
      const state = local.minuteOfDay >= 90 && local.minuteOfDay < 8 * 60 ? 'away' : 'here'
      if (state !== presence.state)
        presence = { state, reason: null, sinceMs: nowMs }
      const situation = quietSituation({ presence, conversation: { ...initialSituationState.conversation, lastUserAtMs } })
      const evaluation = evaluate(gateInput({ nowMs, local, situation, settings: { chattiness: 1 } }), memory, random)
      memory = evaluation.memory
      if (!evaluation.decision.fire)
        continue
      if (evaluation.decision.category === 'ritual') {
        const key = `${local.dayKey}/${evaluation.decision.picked.kind}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      // He answers every message at once, so no phase ever blocks a ritual.
      memory = recordUrgeUserTurn(recordUrgeFireOutcome(memory, 'spoken', nowMs), nowMs)
      lastUserAtMs = nowMs
    }

    expect(counts.size).toBeGreaterThanOrEqual(2)
    for (const count of counts.values())
      expect(count).toBe(1)
  })

  /** Evaluates the gate for a present user with the given tracking and returns the next memory. */
  function evaluateAt(nowMs: number, presence: SituationState['presence'], tracking: Partial<SituationState['tracking']>, memory: UrgeGateMemory = initialUrgeMemory) {
    const situation = quietSituation({ presence, tracking: { ...initialSituationState.tracking, ...tracking } })
    return evaluate(gateInput({ nowMs, local: localAt(nowMs), situation }), memory).memory
  }

  it('opens the welcome-back window from the last return after an absence of 3 h within the logical day', () => {
    const backAtMs = Date.UTC(2026, 9, 30, 13)
    const present = { state: 'here', reason: null, sinceMs: backAtMs + MIN } as const

    expect(evaluateAt(backAtMs + MIN, present, { lastReturnAtMs: backAtMs, lastAwayMs: 3 * HOUR_MS }).day?.windowOpenedAtMs['welcome-back']).toBe(backAtMs)
    expect(evaluateAt(backAtMs + MIN, present, { lastReturnAtMs: backAtMs, lastAwayMs: 3 * HOUR_MS - 1 }).day?.windowOpenedAtMs['welcome-back']).toBeNull()
  })

  it('opens no window when a here/idle flip comes hours after an overnight return', () => {
    // Back at 06:00 after 8 h away, which began before the 04:00 rollover; a pause at noon moves only the presence.
    const backAtMs = Date.UTC(2026, 9, 30, 6)
    const noonMs = Date.UTC(2026, 9, 30, 12)
    const tracking = { lastReturnAtMs: backAtMs, lastAwayMs: 8 * HOUR_MS }
    const morning = evaluateAt(backAtMs, { state: 'here', reason: null, sinceMs: backAtMs }, tracking)
    const noon = evaluateAt(noonMs, { state: 'idle', reason: 'idle', sinceMs: noonMs }, tracking, morning)

    expect(noon.day?.windowOpenedAtMs['welcome-back']).toBeNull()
  })
})

describe('urge gate memory lifecycle', () => {
  it('draws the promotion threshold from the source and starts the clear ramp', () => {
    const source = countingSource(1)
    const a = promotionUrgeMemory(T0, source.random)
    expect(a).toMatchObject({ urge: 0, lastHardHoldAtMs: T0, unanswered: 0 })
    expect(source.draws()).toBe(1)
    expect(promotionUrgeMemory(T0, randomSource(1))).toEqual(a)
    expect(promotionUrgeMemory(T0, randomSource(2)).urgeThreshold).not.toBe(a.urgeThreshold)
  })

  it('restores the persisted social slice so a reload does not reset her', () => {
    const saved = {
      lastFireAtMs: T0 - HOUR_MS,
      lastSpokenAtMs: T0 - HOUR_MS,
      unanswered: 2,
      awaitingSinceMs: T0 - HOUR_MS,
      damp: null,
      day: null,
      lastOwnDayAtMs: T0 - 2 * HOUR_MS,
    }
    const restored = restoreSocialMemory(promotionUrgeMemory(T0, randomSource(1)), saved, T0)
    expect(restored).toMatchObject(saved)
    expect(evaluate(gateInput(), { ...restored, urge: 5 }).decision.reason).toBe('quiet-unanswered')
  })
})
