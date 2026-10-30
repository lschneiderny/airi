import type {
  GateLocalTime,
  GateSettings,
  GateSignals,
  SituationEvent,
  SituationState,
  Thread,
  UrgeGateDecision,
  UrgeGateInput,
  UrgeGateMemory,
  UrgeGatePending,
} from '.'

import { describe, expect, it } from 'vitest'

import {
  ACCRUAL_DT_MAX_MS,
  DOUBLE_TEXT_OFFSET_MAX_MS,
  DOUBLE_TEXT_OFFSET_MIN_MS,
  evaluateUrgeGate,
  FLOOR_MS,
  HOUR_MS,
  initialSituationState,
  initialUrgeMemory,
  logicalDayKey,
  promotionUrgeMemory,
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
  return { urge: memory.urge, urgeThreshold: memory.urgeThreshold, rngState: memory.rngState, fires: memory.fires }
}

describe('evaluateUrgeGate rate', () => {
  it('maps Chattiness to the base rate and to nothing else', () => {
    const expected = [[0, 0.118], [0.25, 0.266], [0.5, 0.6], [0.75, 1.355], [1, 3.06]] as const
    const opens: number[] = []
    for (const [chattiness, base] of expected) {
      const { trace } = evaluateUrgeGate(gateInput({ settings: { chattiness } }), initialUrgeMemory).decision
      expect(trace.multipliers.base).toBeCloseTo(base, 2)
      expect({ ...trace.multipliers, base: 0 }).toEqual({ base: 0, pressure: 0.6, exchange: 1, clear: 1, damping: 1, floor: 1, game: 1 })
      opens.push(trace.hazardPerHour.open)
    }
    for (let i = 1; i < opens.length; i++)
      expect(opens[i]).toBeGreaterThan(opens[i - 1])
  })

  it('accumulates urge across holds and fires within the time the hazard implies', () => {
    const input = (nowMs: number) => gateInput({ nowMs, settings: { chattiness: 1 } })
    const hazard = evaluateUrgeGate(input(T0), initialUrgeMemory).decision.trace.hazardPerHour.total
    const threshold = 1.5
    let memory = memoryWith({ urgeThreshold: threshold })
    let previousUrge = 0
    let firedAtMs: number | null = null
    for (let nowMs = T0; nowMs <= T0 + 2 * (threshold / hazard) * HOUR_MS; nowMs += ACCRUAL_DT_MAX_MS) {
      const evaluation = evaluateUrgeGate(input(nowMs), memory)
      if (evaluation.decision.fire) {
        firedAtMs = nowMs
        expect(evaluation.decision.reason).toBe('urge')
        expect(evaluation.memory.urge).toBe(0)
        break
      }
      expect(evaluation.decision.reason).toBe('urge')
      expect(evaluation.memory.urge).toBeGreaterThanOrEqual(previousUrge)
      expect(evaluation.memory.rngState).toBe(memory.rngState)
      previousUrge = evaluation.memory.urge
      memory = evaluation.memory
    }
    expect(firedAtMs).not.toBeNull()
    expect(firedAtMs! - T0).toBeLessThanOrEqual((threshold / hazard) * HOUR_MS + ACCRUAL_DT_MAX_MS)
    expect(firedAtMs! - T0).toBeGreaterThanOrEqual((threshold / hazard) * HOUR_MS - ACCRUAL_DT_MAX_MS)
  })

  it('has zero hazard while his last turn is under two minutes old', () => {
    const at = (lastUserAtMs: number) => evaluateUrgeGate(
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
    expect(evaluateUrgeGate(gateInput({ situation: game }), initialUrgeMemory).decision.trace.multipliers.game).toBe(0.5)
  })
})

describe('evaluateUrgeGate floor', () => {
  it('holds every non-urgent fire for two minutes after any fire, without accruing', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - FLOOR_MS + 1, lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, urge: 5 })
    const inside = evaluateUrgeGate(gateInput(), memory)
    expect(inside.decision).toMatchObject({ fire: false, reason: 'floor' })
    expect(inside.decision.trace.hazardPerHour.total).toBe(0)
    expect(drawState(inside.memory)).toEqual(drawState(memory))

    const after = evaluateUrgeGate(gateInput({ nowMs: T0 + 1 }), memory)
    expect(after.decision).toMatchObject({ fire: true, reason: 'urge' })
  })
})

describe('evaluateUrgeGate urgent bypass', () => {
  const urgentSituation = (overrides: Partial<SituationState> = {}) => quietSituation({ events: [urgentNotify()], ...overrides })

  it('fires an urgent notify inside the floor, inside exchange zero, and while quiet after two unanswered openings', () => {
    const situation = urgentSituation({ conversation: { ...initialSituationState.conversation, lastUserAtMs: T0 - 30 * SEC } })
    const memory = memoryWith({ lastFireAtMs: T0 - 10 * SEC, lastSpokenAtMs: T0 - 10 * SEC, unanswered: 2 })
    const decision = fired(evaluateUrgeGate(gateInput({ situation }), memory).decision)
    expect(decision).toMatchObject({ reason: 'urgent', category: 'urgent', topicKey: 'notify:timer' })
    expect(decision.trace.phase).toBe('quiet')
  })

  it('passes a game that would silence her but no other hard suppressor', () => {
    const game = urgentSituation({ activity: { appId: 'elden-ring', label: 'Elden Ring', category: 'game', title: null, sinceMs: T0 - MIN } })
    expect(evaluateUrgeGate(gateInput({ situation: game, settings: { speakDuringGames: false } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: true, reason: 'urgent' })
    expect(evaluateUrgeGate(gateInput({ situation: urgentSituation(), settings: { dontDisturb: true } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: false, reason: 'dont-disturb' })
    expect(evaluateUrgeGate(gateInput({ situation: urgentSituation(), signals: { userTyping: true } }), initialUrgeMemory).decision)
      .toMatchObject({ fire: false, reason: 'user-typing' })
  })

  it('keeps a held urgent topic unselectable', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - 10 * SEC })
    const decision = evaluateUrgeGate(gateInput({ situation: urgentSituation(), heldTopics: new Set(['notify:timer']) }), memory).decision
    expect(decision).toMatchObject({ fire: false, reason: 'floor' })
  })
})

describe('evaluateUrgeGate fire transitions', () => {
  it('leaves urge, threshold, rng, and fires untouched on an urgent fire', () => {
    const memory = memoryWith({ lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS, urge: 0.4, fires: [T0 - 20 * MIN] })
    const evaluation = evaluateUrgeGate(gateInput({ situation: quietSituation({ events: [urgentNotify()] }) }), memory)
    expect(evaluation.decision.fire).toBe(true)
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
    expect(evaluation.memory.lastFireAtMs).toBe(T0)
    expect(evaluation.memory.pending).toMatchObject({ category: 'urgent', doubleTextRoll: 1, doubleTextOffsetMs: 0 })
  })

  it('leaves urge, threshold, rng, and fires untouched on a double-text fire and consumes it', () => {
    const memory = memoryWith({
      lastEvalAtMs: T0 - ACCRUAL_DT_MAX_MS,
      lastFireAtMs: T0 - 30 * SEC,
      urge: 0.4,
      fires: [T0 - 30 * SEC],
      unanswered: 1,
      lastSpokenAtMs: T0 - 25 * SEC,
      doubleText: { topicKey: 'own-day', dueAtMs: T0, expiresAtMs: T0 + 35 * SEC },
    })
    const evaluation = evaluateUrgeGate(gateInput(), memory)
    expect(evaluation.decision).toMatchObject({ fire: true, reason: 'double-text', category: 'double-text', topicKey: 'own-day' })
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
    expect(evaluation.memory.unanswered).toBe(1)
    expect(evaluation.memory.doubleText).toBeNull()
  })

  it('resets urge and draws a new threshold on an ordinary fire', () => {
    const memory = memoryWith({ urge: 5 })
    const evaluation = evaluateUrgeGate(gateInput(), memory)
    const decision = fired(evaluation.decision)
    expect(decision).toMatchObject({ reason: 'urge', category: 'open', topicKey: 'own-day' })
    expect(decision.trace.pick).toMatchObject({ category: 'open', reasonKey: 'own-day' })
    expect(evaluation.memory.urge).toBe(0)
    expect(evaluation.memory.urgeThreshold).not.toBe(memory.urgeThreshold)
    expect(evaluation.memory.rngState).not.toBe(memory.rngState)
    expect(evaluation.memory.fires).toEqual([T0])
    expect(evaluation.memory.pending?.doubleTextOffsetMs).toBeGreaterThanOrEqual(DOUBLE_TEXT_OFFSET_MIN_MS)
    expect(evaluation.memory.pending?.doubleTextOffsetMs).toBeLessThanOrEqual(DOUBLE_TEXT_OFFSET_MAX_MS)
  })

  it('is deterministic for the same memory and input', () => {
    const memory = memoryWith({ urge: 5 })
    expect(evaluateUrgeGate(gateInput(), memory)).toEqual(evaluateUrgeGate(gateInput(), memory))
  })

  it('fires with reason forced and a real pick when forceTiming skips a hold', () => {
    const evaluation = evaluateUrgeGate(gateInput({ forceTiming: true }), initialUrgeMemory)
    expect(evaluation.decision).toMatchObject({ fire: true, reason: 'forced', category: 'open', topicKey: 'own-day' })
    expect(evaluation.decision.trace.pick).not.toBeNull()
    expect(evaluation.memory.rngState).not.toBe(initialUrgeMemory.rngState)
    expect(evaluation.memory.fires).toEqual([T0])
  })

  it('holds with no-topic and draws nothing when the drawn category has no reason', () => {
    const memory = memoryWith({ urge: 5 })
    const evaluation = evaluateUrgeGate(gateInput({ heldTopics: new Set(['own-day']) }), memory)
    expect(evaluation.decision).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(evaluation.memory.rngState).toBe(memory.rngState)
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

    expect(evaluateUrgeGate(gateInput({ nowMs: spokenAtMs + 30 * SEC - 1 }), spoken).decision.fire).toBe(false)
    const second = evaluateUrgeGate(gateInput({ nowMs: spokenAtMs + 30 * SEC }), spoken)
    expect(second.decision).toMatchObject({ fire: true, reason: 'double-text', topicKey: 'own-day' })

    const after = recordUrgeFireOutcome(second.memory, 'spoken', spokenAtMs + 32 * SEC)
    expect(after.doubleText).toBeNull()
    expect(after.unanswered).toBe(1)
    expect(evaluateUrgeGate(gateInput({ nowMs: spokenAtMs + 40 * SEC }), after).decision)
      .toMatchObject({ fire: false, reason: 'floor' })
  })

  it('expires 60 s after the opening was spoken', () => {
    const memory = memoryWith({ lastFireAtMs: T0 - 60 * SEC, doubleText: { topicKey: 'own-day', dueAtMs: T0 - 10 * SEC, expiresAtMs: T0 } })
    const evaluation = evaluateUrgeGate(gateInput(), memory)
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
    const open = evaluateUrgeGate(input, initialUrgeMemory).decision.trace
    expect(open.phase).toBe('open')
    expect(open.hazardPerHour).toMatchObject({ ritual: 12, due: 1, continuation: 0 })

    const waiting = evaluateUrgeGate(input, memoryWith({ unanswered: 1, lastSpokenAtMs: T0 - 10 * MIN, pending: spokenPending() })).decision.trace
    expect(waiting.phase).toBe('continuation-window')
    expect(waiting.hazardPerHour).toMatchObject({ open: 0, ritual: 0, due: 0 })
    expect(waiting.hazardPerHour.continuation).toBeGreaterThan(0)

    const quiet = evaluateUrgeGate(input, memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - HOUR_MS, urge: 5 }))
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
      const evaluation = evaluateUrgeGate(gateInput({ nowMs }), state)
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

    const before = evaluateUrgeGate(gateInput({ nowMs: lastSpokenAtMs + 90 * MIN - 1 }), memory).decision.trace
    expect(before.phase).toBe('continuation-window')
    const reopened = evaluateUrgeGate(gateInput({ nowMs: lastSpokenAtMs + 90 * MIN }), memory).decision.trace
    expect(reopened.phase).toBe('reopened')
    expect(reopened.multipliers.damping).toBe(0.5)
    expect(reopened.hazardPerHour.continuation).toBe(0)
    expect(reopened.hazardPerHour.open).toBeGreaterThan(0)
  })

  it('holds every non-urgent fire for four hours after two unanswered openings', () => {
    const memory = memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - 4 * HOUR_MS + 1, urge: 5 })
    expect(evaluateUrgeGate(gateInput(), memory).decision).toMatchObject({ fire: false, reason: 'quiet-unanswered' })
    const reopened = evaluateUrgeGate(gateInput({ nowMs: T0 + 1 }), memory).decision
    expect(reopened).toMatchObject({ fire: true, reason: 'urge' })
    expect(reopened.trace.multipliers.damping).toBe(0.3)
  })

  it('restores the rate gradually after a reply', () => {
    const replied = recordUrgeUserTurn(memoryWith({ unanswered: 2, lastSpokenAtMs: T0 - 5 * HOUR_MS }), T0)
    expect(replied).toMatchObject({ unanswered: 0, awaitingSinceMs: null, damp: { depth: 0.7, sinceMs: T0 } })
    const damping = [0, 30 * MIN, HOUR_MS, 2 * HOUR_MS, 6 * HOUR_MS]
      .map(offset => evaluateUrgeGate(gateInput({ nowMs: T0 + offset }), replied).decision.trace)
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
    expect(evaluateUrgeGate(gateInput({ nowMs: T0 + MIN }), { ...spoke, urge: 5 }).decision).toMatchObject({ fire: false, reason: 'floor' })
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
    const evaluation = evaluateUrgeGate(gateInput(overrides), accruing)
    expect(evaluation.decision).toMatchObject({ fire: false, reason })
    expect(drawState(evaluation.memory)).toEqual(drawState(accruing))
    expect(evaluation.memory.lastHardHoldAtMs).toBe(long ? T0 : null)
  })

  it('keeps the hard suppressor order of the legacy gate', () => {
    expect(evaluateUrgeGate(gateInput({ settings: { dontDisturb: true }, signals: { stageVisible: false } }), accruing).decision.reason)
      .toBe('dont-disturb')
  })

  it('keeps urge and rng across a quiet hold', () => {
    const memory = { ...accruing, unanswered: 2, lastSpokenAtMs: T0 - HOUR_MS }
    const evaluation = evaluateUrgeGate(gateInput(), memory)
    expect(evaluation.decision.reason).toBe('quiet-unanswered')
    expect(drawState(evaluation.memory)).toEqual(drawState(memory))
  })

  it('ramps the opening hazard back up after a long hard hold clears', () => {
    const held = evaluateUrgeGate(gateInput({ settings: { dontDisturb: true } }), accruing).memory
    const clear = [SEC, MIN, 10 * MIN].map(offset => evaluateUrgeGate(gateInput({ nowMs: T0 + offset }), held).decision.trace.multipliers.clear)
    expect(clear[0]).toBeLessThan(clear[1])
    expect(clear[1]).toBeLessThan(clear[2])
    expect(visibilityRegainUrgeMemory(accruing, T0).lastHardHoldAtMs).toBe(T0)
  })

  it('accrues nothing across a backward clock jump and at most ten seconds across a forward one', () => {
    const memory = memoryWith({ lastEvalAtMs: T0, urge: 0.2, urgeThreshold: 10 })
    const back = evaluateUrgeGate(gateInput({ nowMs: T0 - HOUR_MS }), memory)
    expect(back.memory.urge).toBe(0.2)

    const forward = evaluateUrgeGate(gateInput({ nowMs: T0 + HOUR_MS }), memory)
    const hazard = forward.decision.trace.hazardPerHour.total
    expect(forward.memory.urge).toBeGreaterThan(0.2)
    expect(forward.memory.urge - 0.2).toBeLessThanOrEqual(hazard * ACCRUAL_DT_MAX_MS / HOUR_MS + 1e-12)
  })

  it('returns memory unchanged for an invalid time', () => {
    const evaluation = evaluateUrgeGate(gateInput({ nowMs: Number.NaN }), accruing)
    expect(evaluation.decision).toMatchObject({ fire: false, reason: 'invalid-time' })
    expect(evaluation.memory).toBe(accruing)
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
    let memory = promotionUrgeMemory(start, 7)
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
      const evaluation = evaluateUrgeGate(gateInput({ nowMs, local, situation, settings: { chattiness: 1 } }), memory)
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
})

describe('urge gate memory lifecycle', () => {
  it('seeds promotion memory from the seed and starts the clear ramp', () => {
    const a = promotionUrgeMemory(T0, 1)
    expect(a).toMatchObject({ urge: 0, lastHardHoldAtMs: T0, unanswered: 0 })
    expect(promotionUrgeMemory(T0, 1)).toEqual(a)
    expect(promotionUrgeMemory(T0, 2).rngState).not.toBe(a.rngState)
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
      rngState: 12345,
    }
    const restored = restoreSocialMemory(promotionUrgeMemory(T0, 1), saved, T0)
    expect(restored).toMatchObject(saved)
    expect(evaluateUrgeGate(gateInput(), { ...restored, urge: 5 }).decision.reason).toBe('quiet-unanswered')
  })
})
