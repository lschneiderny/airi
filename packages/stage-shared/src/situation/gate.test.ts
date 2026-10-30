import type {
  GateDecision,
  GateHoldReason,
  GateInput,
  GateMemory,
  GateSettings,
  GateSignals,
  Observation,
  SituationActivity,
  SituationEvent,
  SituationState,
} from '.'

import { describe, expect, it } from 'vitest'

import {
  advanceSituation,
  evaluateGate,
  gateThreshold,
  hourlyFireCap,
  IGNORE_WINDOW_MS,
  initialGateMemory,
  initialSituationState,
  markAddressed,
  minGapMs,
  notifyTopicKey,
  promotionGateMemory,
  recordFireOutcome,
  recordUserTurn,
  reduceSituation,
  visibilityRegainGateMemory,
} from '.'

const T0 = 1_700_000_000_000
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

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

function worldEvent(overrides: Partial<SituationEvent> = {}): SituationEvent {
  return {
    id: `context:vision@${T0}`,
    kind: 'context',
    topicKey: 'context:vision',
    text: 'a cat walks across the screen',
    atMs: T0,
    salience: 0.6,
    halfLifeMs: 30 * MIN,
    tier: 0,
    origin: 'world',
    shownAtMs: null,
    addressedAtMs: null,
    ...overrides,
  }
}

function activityOf(overrides: Partial<SituationActivity> = {}): SituationActivity {
  return { appId: 'notepad', label: 'Notepad', category: 'editor', title: null, sinceMs: T0 - 10 * MIN, ...overrides }
}

/** A user at the desk who accepts remarks, with one eligible topic. */
function quietSituation(overrides: Partial<SituationState> = {}): SituationState {
  return {
    ...initialSituationState,
    presence: { state: 'here', reason: null, sinceMs: T0 - HOUR },
    busy: { state: 'accepts', atMs: T0 },
    activity: activityOf(),
    events: [worldEvent()],
    nowMs: T0,
    ...overrides,
  }
}

interface InputOverrides {
  nowMs?: number
  situation?: SituationState
  signals?: Partial<GateSignals>
  settings?: Partial<GateSettings>
  forceTiming?: boolean
}

function gateInput(overrides: InputOverrides = {}): GateInput {
  return {
    nowMs: overrides.nowMs ?? T0,
    situation: overrides.situation ?? quietSituation(),
    signals: { ...QUIET_SIGNALS, ...overrides.signals },
    settings: { ...SETTINGS, ...overrides.settings },
    ...(overrides.forceTiming === undefined ? {} : { forceTiming: overrides.forceTiming }),
  }
}

function memoryWith(overrides: Partial<GateMemory>): GateMemory {
  return { ...initialGateMemory, ...overrides }
}

/** Feeds observations in order, each reduced at its own `atMs`. */
function run(observations: Observation[], state: SituationState = initialSituationState): SituationState {
  for (const observation of observations)
    state = reduceSituation(state, observation, observation.atMs)
  return state
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value))
      deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('evaluateGate hard suppressors', () => {
  it('fires on a quiet desk with an eligible topic and records the fire', () => {
    const { decision, memory } = evaluateGate(gateInput(), initialGateMemory)

    expect(decision).toMatchObject({ fire: true, reason: 'ready', topicKey: 'context:vision', topicText: 'a cat walks across the screen' })
    expect(memory).toEqual({
      lastFireAtMs: T0,
      fires: [T0],
      pending: { topicKey: 'context:vision', firedAtMs: T0, spokenAtMs: null },
      ignoreStreak: 0,
      backoffLevel: 0,
    })
  })

  const cases: { label: string, reason: GateHoldReason, input: GateInput }[] = [
    { label: 'nowMs is NaN', reason: 'invalid-time', input: gateInput({ nowMs: Number.NaN }) },
    { label: 'the gate is off', reason: 'disabled', input: gateInput({ settings: { enabled: false } }) },
    { label: 'do not disturb is on', reason: 'dont-disturb', input: gateInput({ settings: { dontDisturb: true } }) },
    { label: 'the stage is hidden', reason: 'stage-hidden', input: gateInput({ signals: { stageVisible: false } }) },
    { label: 'the user is away', reason: 'presence-away', input: gateInput({ situation: quietSituation({ presence: { state: 'away', reason: 'locked', sinceMs: T0 } }) }) },
    { label: 'presence is unknown', reason: 'presence-unknown', input: gateInput({ situation: quietSituation({ presence: { state: 'unknown', reason: 'stale', sinceMs: T0 } }) }) },
    { label: 'the desktop sample is stale', reason: 'stale-signal', input: gateInput({ signals: { desktopFresh: false } }) },
    { label: 'the foreground sample is stale', reason: 'stale-signal', input: gateInput({ signals: { foregroundFresh: false } }) },
    { label: 'the user is speaking', reason: 'user-speaking', input: gateInput({ signals: { userSpeaking: true } }) },
    { label: 'user speech is unknown', reason: 'user-speaking', input: gateInput({ signals: { userSpeaking: null } }) },
    { label: 'the user is typing', reason: 'user-typing', input: gateInput({ signals: { userTyping: true } }) },
    { label: 'the character is speaking', reason: 'character-speaking', input: gateInput({ signals: { characterSpeaking: true } }) },
    { label: 'a turn is generating', reason: 'generating', input: gateInput({ signals: { generating: true } }) },
    { label: 'a send is queued', reason: 'queued', input: gateInput({ signals: { queued: 1 } }) },
    { label: 'the host reports busy', reason: 'busy-busy', input: gateInput({ situation: quietSituation({ busy: { state: 'busy', atMs: T0 } }) }) },
    { label: 'an app is fullscreen', reason: 'busy-fullscreen', input: gateInput({ situation: quietSituation({ busy: { state: 'fullscreen', atMs: T0 } }) }) },
    { label: 'a presentation runs', reason: 'busy-presentation', input: gateInput({ situation: quietSituation({ busy: { state: 'presentation', atMs: T0 } }) }) },
    { label: 'quiet hours are on', reason: 'busy-quiet', input: gateInput({ situation: quietSituation({ busy: { state: 'quiet', atMs: T0 } }) }) },
    { label: 'busy state is unknown', reason: 'busy-unknown', input: gateInput({ situation: quietSituation({ busy: { state: 'unknown', atMs: null } }) }) },
    { label: 'the user is in a call app', reason: 'quiet-app', input: gateInput({ situation: quietSituation({ activity: activityOf({ appId: 'zoom', category: 'call' }) }) }) },
    { label: 'the app matches a quiet glob', reason: 'quiet-app', input: gateInput({ settings: { quietApps: ['OBS*'] }, situation: quietSituation({ activity: activityOf({ appId: 'obs64' }) }) }) },
    { label: 'a game runs and games are quiet', reason: 'busy-game', input: gateInput({ settings: { speakDuringGames: false }, situation: quietSituation({ activity: activityOf({ appId: 'eldenring', category: 'game' }) }) }) },
  ]

  it.each(cases)('holds with $reason when $label', ({ reason, input }) => {
    const { decision, memory } = evaluateGate(input, initialGateMemory)

    expect(decision).toMatchObject({ fire: false, reason })
    expect(memory.lastFireAtMs).toBeNull()
    expect(memory.pending).toBeNull()
  })

  it('reports the candidate in the trace even when a suppressor holds', () => {
    const { decision } = evaluateGate(gateInput({ signals: { generating: true } }), initialGateMemory)

    expect(decision.trace.candidate).toMatchObject({ topicKey: 'context:vision', urgent: false })
  })
})

describe('evaluateGate chattiness mapping', () => {
  it.each([
    { chattiness: 0, threshold: 0.65, gapMs: 20 * MIN, cap: 1 },
    { chattiness: 0.5, threshold: 0.4, gapMs: 10 * MIN, cap: 4 },
    { chattiness: 1, threshold: 0.15, gapMs: 3 * MIN, cap: 7 },
  ])('maps chattiness $chattiness to threshold $threshold, gap $gapMs ms, cap $cap', ({ chattiness, threshold, gapMs, cap }) => {
    expect(gateThreshold(chattiness)).toBeCloseTo(threshold, 12)
    expect(minGapMs(chattiness)).toBe(gapMs)
    expect(hourlyFireCap(chattiness)).toBe(cap)

    const decide = (salience: number): GateDecision => evaluateGate(
      gateInput({ settings: { chattiness }, situation: quietSituation({ events: [worldEvent({ salience })] }) }),
      initialGateMemory,
    ).decision
    expect(decide(gateThreshold(chattiness))).toMatchObject({ fire: true })
    expect(decide(gateThreshold(chattiness) - 0.001)).toMatchObject({ fire: false, reason: 'no-topic' })
  })

  it('clamps out-of-range chattiness and treats a non-finite value as 0', () => {
    expect(gateThreshold(2)).toBe(gateThreshold(1))
    expect(gateThreshold(-1)).toBe(gateThreshold(0))
    expect(minGapMs(Number.NaN)).toBe(20 * MIN)
    expect(hourlyFireCap(Number.POSITIVE_INFINITY)).toBe(1)

    const { decision } = evaluateGate(gateInput({ settings: { chattiness: Number.NaN } }), initialGateMemory)
    expect(decision.trace.chattiness).toBe(0)
    expect(decision).toMatchObject({ fire: false, reason: 'no-topic' })
  })
})

describe('evaluateGate timing guards', () => {
  it('holds one millisecond before the minimum gap and fires exactly at it', () => {
    const gap = minGapMs(0.5)

    const early = evaluateGate(gateInput(), memoryWith({ lastFireAtMs: T0 - gap + 1, fires: [T0 - gap + 1] })).decision
    expect(early).toMatchObject({ fire: false, reason: 'gap' })
    expect(early.trace.nextEligibleAtMs).toBe(T0 + 1)

    expect(evaluateGate(gateInput(), memoryWith({ lastFireAtMs: T0 - gap, fires: [T0 - gap] })).decision).toMatchObject({ fire: true, reason: 'ready' })
  })

  it('multiplies the gap by 2^backoff and doubles it during games', () => {
    const gap = minGapMs(0.5)
    const game = quietSituation({ activity: activityOf({ appId: 'eldenring', category: 'game' }) })

    expect(evaluateGate(gateInput(), memoryWith({ backoffLevel: 2 })).decision.trace.gapMs).toBe(4 * gap)
    expect(evaluateGate(gateInput({ situation: game }), initialGateMemory).decision.trace.gapMs).toBe(2 * gap)
    const both = evaluateGate(gateInput({ situation: game }), memoryWith({ backoffLevel: 1, lastFireAtMs: T0 - 3 * gap }))
    expect(both.decision.trace.gapMs).toBe(4 * gap)
    expect(both.decision).toMatchObject({ fire: false, reason: 'gap' })
  })

  it('holds within 120 s of a user turn and fires at exactly 120 s', () => {
    const at = (lastUserAtMs: number): GateDecision => evaluateGate(gateInput({
      situation: quietSituation({ conversation: { ...initialSituationState.conversation, lastUserAtMs } }),
    }), initialGateMemory).decision

    expect(at(T0 - 120 * SEC + 1)).toMatchObject({ fire: false, reason: 'in-exchange' })
    expect(at(T0 - 120 * SEC)).toMatchObject({ fire: true })
  })

  it('holds at the hourly cap until the oldest counted fire is an hour old', () => {
    const capped = evaluateGate(gateInput(), memoryWith({ lastFireAtMs: T0 - 20 * MIN, fires: [T0 - 50 * MIN, T0 - 40 * MIN, T0 - 30 * MIN, T0 - 20 * MIN] })).decision
    expect(capped).toMatchObject({ fire: false, reason: 'hourly-cap' })
    expect(capped.trace).toMatchObject({ firesLastHour: 4, hourlyCap: 4, nextEligibleAtMs: T0 + 10 * MIN })

    const freed = evaluateGate(gateInput(), memoryWith({ lastFireAtMs: T0 - 20 * MIN, fires: [T0 - 60 * MIN, T0 - 40 * MIN, T0 - 30 * MIN, T0 - 20 * MIN] }))
    expect(freed.decision).toMatchObject({ fire: true })
    expect(freed.memory.fires).toEqual([T0 - 40 * MIN, T0 - 30 * MIN, T0 - 20 * MIN, T0])
  })

  it('skips only the timing guards when forced', () => {
    const blocked = memoryWith({ lastFireAtMs: T0 - MIN, fires: [T0 - MIN] })

    expect(evaluateGate(gateInput({ forceTiming: true }), blocked).decision).toMatchObject({ fire: true, reason: 'forced' })
    expect(evaluateGate(gateInput({ forceTiming: true }), initialGateMemory).decision).toMatchObject({ fire: true, reason: 'ready' })
    expect(evaluateGate(gateInput({ forceTiming: true, settings: { dontDisturb: true } }), blocked).decision).toMatchObject({ fire: false, reason: 'dont-disturb' })
    expect(evaluateGate(gateInput({ forceTiming: true, situation: quietSituation({ events: [] }) }), blocked).decision).toMatchObject({ fire: false, reason: 'no-topic' })
  })

  it('blocks an immediate fire after leader promotion or a visibility regain', () => {
    const promoted = evaluateGate(gateInput(), promotionGateMemory(T0)).decision
    expect(promoted).toMatchObject({ fire: false, reason: 'gap' })
    expect(promoted.trace).toMatchObject({ firesLastHour: 0, nextEligibleAtMs: T0 + minGapMs(0.5) })
    expect(evaluateGate(gateInput({ nowMs: T0 + minGapMs(0.5) }), promotionGateMemory(T0)).decision).toMatchObject({ fire: true })

    const regained = visibilityRegainGateMemory(memoryWith({ backoffLevel: 1, ignoreStreak: 1, lastFireAtMs: T0 - 5 * HOUR }), T0)
    expect(regained).toMatchObject({ backoffLevel: 1, ignoreStreak: 1, lastFireAtMs: T0 })
    expect(evaluateGate(gateInput(), regained).decision).toMatchObject({ fire: false, reason: 'gap' })
  })
})

describe('evaluateGate topics', () => {
  it('ignores self-origin and addressed events and breaks ties deterministically', () => {
    const excluded = [
      worldEvent({ id: 'self', topicKey: 'self', origin: 'self', salience: 1 }),
      worldEvent({ id: 'done', topicKey: 'done', salience: 1, addressedAtMs: T0 }),
    ]
    expect(evaluateGate(gateInput({ situation: quietSituation({ events: excluded }) }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'no-topic' })

    const tied = [worldEvent({ id: 'b', topicKey: 'b' }), worldEvent({ id: 'a', topicKey: 'a' }), worldEvent({ id: 'old', topicKey: 'old', atMs: T0 - MIN })]
    expect(evaluateGate(gateInput({ situation: quietSituation({ events: [...excluded, ...tied] }) }), initialGateMemory).decision).toMatchObject({ fire: true, topicKey: 'a' })
  })

  it('lets an urgent notify bypass every timing guard and games, but not user speech', () => {
    const urgent = worldEvent({ id: 'n', kind: 'notify', topicKey: 'notify:plugin:widget:evt-1', text: 'Doorbell', salience: 1, halfLifeMs: 10 * MIN })
    const situation = quietSituation({
      events: [urgent],
      activity: activityOf({ appId: 'eldenring', category: 'game' }),
      conversation: { ...initialSituationState.conversation, lastUserAtMs: T0 - 10 * SEC },
    })
    const blocked = memoryWith({ lastFireAtMs: T0 - MIN, fires: [T0 - 30 * MIN, T0 - 20 * MIN, T0 - 10 * MIN, T0 - MIN] })

    expect(evaluateGate(gateInput({ situation, settings: { speakDuringGames: false } }), blocked).decision).toMatchObject({ fire: true, reason: 'urgent', topicText: 'Doorbell' })
    expect(evaluateGate(gateInput({ situation, signals: { userSpeaking: true } }), blocked).decision).toMatchObject({ fire: false, reason: 'user-speaking' })

    const soon = quietSituation({ ...situation, events: [{ ...urgent, salience: 0.7 }] })
    expect(evaluateGate(gateInput({ situation: soon, settings: { speakDuringGames: false } }), blocked).decision).toMatchObject({ fire: false, reason: 'busy-game' })
    expect(evaluateGate(gateInput({ situation: soon }), blocked).decision).toMatchObject({ fire: false, reason: 'in-exchange' })
  })

  it('ranks an urgent notify above a more salient ordinary topic', () => {
    const events = [
      worldEvent({ id: 'n', kind: 'notify', topicKey: 'notify:x:1', text: 'Doorbell', atMs: T0 - 5 * MIN, salience: 1, halfLifeMs: 10 * MIN }),
      worldEvent({ salience: 0.9 }),
    ]

    expect(evaluateGate(gateInput({ situation: quietSituation({ events }) }), initialGateMemory).decision).toMatchObject({ fire: true, reason: 'urgent', topicKey: 'notify:x:1' })
  })

  it('treats a critical scheduler reminder from the reducer as urgent', () => {
    const situation = reduceSituation(quietSituation({ events: [] }), {
      kind: 'notify',
      sourceKey: 'scheduler',
      eventId: 'meds',
      headline: 'Take medicine',
      urgency: 'later',
      reminder: true,
      critical: true,
      atMs: T0,
    }, T0)

    const { decision } = evaluateGate(gateInput({ situation }), memoryWith({ lastFireAtMs: T0 - MIN }))
    expect(decision).toMatchObject({ fire: true, reason: 'urgent', topicKey: notifyTopicKey('scheduler', 'meds') })
  })

  it('has no topic for the first app ever seen, then fires each long-session tier once', () => {
    let state = run([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'activity', appId: 'code', label: 'Code', category: 'editor', title: null, atMs: T0 },
    ])
    let memory = initialGateMemory
    const evaluate = (nowMs: number): GateDecision => {
      state = advanceSituation(state, nowMs)
      const result = evaluateGate(gateInput({ nowMs, situation: state }), memory)
      memory = result.memory
      if (result.decision.fire)
        state = markAddressed(state, result.decision.topicKey, nowMs)
      return result.decision
    }

    expect(evaluate(T0 + 29 * MIN)).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(evaluate(T0 + 30 * MIN)).toMatchObject({ fire: true, topicKey: 'activity:code:tier:1' })
    expect(evaluate(T0 + 45 * MIN)).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(evaluate(T0 + 60 * MIN)).toMatchObject({ fire: true, topicKey: 'activity:code:tier:2' })
  })

  it('skips long-session tiers that matured before the user returned', () => {
    const state = advanceSituation(run([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'activity', appId: 'code', label: 'Code', category: 'editor', title: null, atMs: T0 },
      { kind: 'presence', state: 'away', reason: 'locked', atMs: T0 + 20 * MIN },
      { kind: 'presence', state: 'here', atMs: T0 + 70 * MIN },
    ]), T0 + 70 * MIN)
    expect(state.events.map(event => event.topicKey)).toEqual(expect.arrayContaining(['activity:code:tier:1', 'activity:code:tier:2', 'presence:return']))

    const first = evaluateGate(gateInput({ nowMs: T0 + 70 * MIN, situation: state }), initialGateMemory)
    expect(first.decision).toMatchObject({ fire: true, topicKey: 'presence:return' })

    const addressed = markAddressed(state, 'presence:return', T0 + 70 * MIN)
    // Tier 2 (matured at +60 min while away) is still above the threshold here, so only the return rule holds it.
    expect(evaluateGate(gateInput({ nowMs: T0 + 71 * MIN, situation: advanceSituation(addressed, T0 + 71 * MIN) }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(evaluateGate(gateInput({ nowMs: T0 + 120 * MIN, situation: advanceSituation(addressed, T0 + 120 * MIN) }), first.memory).decision).toMatchObject({ fire: true, topicKey: 'activity:code:tier:3' })
  })
})

describe('gate engagement', () => {
  function fireAndSpeak(memory: GateMemory, nowMs: number): GateMemory {
    const result = evaluateGate(gateInput({ nowMs, situation: quietSituation({ events: [worldEvent({ id: `e${nowMs}`, topicKey: `t${nowMs}`, atMs: nowMs })] }) }), memory)
    expect(result.decision.fire).toBe(true)
    return recordFireOutcome(result.memory, 'spoken', nowMs + 5 * SEC)
  }

  it('backs off after two ignored fires and recovers after engagement', () => {
    let memory = fireAndSpeak(initialGateMemory, T0)
    memory = evaluateGate(gateInput({ nowMs: T0 + 5 * SEC + IGNORE_WINDOW_MS, situation: quietSituation({ events: [] }) }), memory).memory
    expect(memory).toMatchObject({ ignoreStreak: 0, backoffLevel: 0 })
    expect(memory.pending).not.toBeNull()

    memory = evaluateGate(gateInput({ nowMs: T0 + 5 * SEC + IGNORE_WINDOW_MS + 1, situation: quietSituation({ events: [] }) }), memory).memory
    expect(memory).toMatchObject({ pending: null, ignoreStreak: 1, backoffLevel: 0 })

    memory = fireAndSpeak(memory, T0 + 20 * MIN)
    const backedOff = evaluateGate(gateInput({ nowMs: T0 + 25 * MIN, situation: quietSituation({ events: [] }) }), memory)
    expect(backedOff.memory).toMatchObject({ pending: null, ignoreStreak: 0, backoffLevel: 1 })
    expect(backedOff.decision.trace.gapMs).toBe(2 * minGapMs(0.5))

    memory = fireAndSpeak(backedOff.memory, T0 + 45 * MIN)
    const engaged = recordUserTurn(memory, T0 + 45 * MIN + 5 * SEC + IGNORE_WINDOW_MS)
    expect(engaged).toMatchObject({ pending: null, ignoreStreak: 0, backoffLevel: 0 })
  })

  it('counts a decline as half an ignore and clears cancelled or failed fires without penalty', () => {
    const fired = (memory: GateMemory, nowMs: number): GateMemory => evaluateGate(gateInput({ nowMs, forceTiming: true, situation: quietSituation({ events: [worldEvent({ atMs: nowMs })] }) }), memory).memory

    let memory = recordFireOutcome(fired(initialGateMemory, T0), 'declined', T0 + SEC)
    expect(memory).toMatchObject({ pending: null, ignoreStreak: 0.5, backoffLevel: 0 })
    memory = recordFireOutcome(fired(memory, T0 + 10 * MIN), 'declined', T0 + 10 * MIN + SEC)
    expect(memory).toMatchObject({ ignoreStreak: 1, backoffLevel: 0 })
    memory = recordFireOutcome(fired(memory, T0 + 20 * MIN), 'cancelled', T0 + 20 * MIN + SEC)
    memory = recordFireOutcome(fired(memory, T0 + 30 * MIN), 'failed', T0 + 30 * MIN + SEC)
    expect(memory).toMatchObject({ pending: null, ignoreStreak: 1, backoffLevel: 0, lastFireAtMs: T0 + 30 * MIN })
    memory = recordFireOutcome(fired(memory, T0 + 40 * MIN), 'spoken', T0 + 40 * MIN)
    memory = recordUserTurn(memory, T0 + 40 * MIN + IGNORE_WINDOW_MS + 1)
    expect(memory).toMatchObject({ pending: null, ignoreStreak: 0, backoffLevel: 1 })
  })

  it('ignores outcomes and user turns that have nothing to settle', () => {
    expect(recordFireOutcome(initialGateMemory, 'declined', T0)).toEqual(initialGateMemory)
    expect(recordUserTurn(memoryWith({ backoffLevel: 2 }), T0)).toMatchObject({ backoffLevel: 2 })

    const spoken = recordFireOutcome(evaluateGate(gateInput(), initialGateMemory).memory, 'spoken', T0)
    expect(recordFireOutcome(spoken, 'declined', T0 + SEC)).toEqual(spoken)

    const firing = evaluateGate(gateInput(), initialGateMemory).memory
    expect(recordFireOutcome(firing, 'bogus' as never, T0).pending).toEqual(firing.pending)
    expect(recordUserTurn(firing, T0 + SEC).pending).toEqual(firing.pending)
  })
})

describe('evaluateGate replay', () => {
  /**
   * A two-hour gaming session evaluated every 10 s. Each fire is addressed,
   * spoken, and echoed back as the character's own conversation turn plus a
   * self-origin event, the feedback a live run would produce.
   */
  function replayGamingSession(signals: Partial<GateSignals> = {}): { nowMs: number, decision: GateDecision }[] {
    const observations: Observation[] = [
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'activity', appId: 'chrome', label: 'Chrome', category: 'browser', title: null, atMs: T0 },
      { kind: 'activity', appId: 'eldenring', label: 'Elden Ring', category: 'game', title: null, atMs: T0 + 2 * MIN },
      { kind: 'context', sourceKey: 'vision', text: 'a boss fight fills the screen', salience: 0.7, atMs: T0 + 40 * MIN },
      { kind: 'notify', sourceKey: 'plugin:kitchen', eventId: 'tea', headline: 'Tea is ready', urgency: 'soon', reminder: false, critical: false, atMs: T0 + 50 * MIN },
      { kind: 'notify', sourceKey: 'plugin:door', eventId: 'bell', headline: 'Doorbell', urgency: 'immediate', reminder: false, critical: false, atMs: T0 + 95 * MIN },
    ]
    let state = initialSituationState
    let memory = initialGateMemory
    let next = 0
    const fires: { nowMs: number, decision: GateDecision }[] = []

    for (let nowMs = T0; nowMs <= T0 + 2 * HOUR; nowMs += 10 * SEC) {
      while (next < observations.length && observations[next].atMs <= nowMs)
        state = reduceSituation(state, observations[next++], nowMs)
      state = advanceSituation(state, nowMs)

      const result = evaluateGate(gateInput({ nowMs, situation: state, signals }), memory)
      memory = result.memory
      if (!result.decision.fire)
        continue
      fires.push({ nowMs, decision: result.decision })
      state = markAddressed(state, result.decision.topicKey, nowMs)
      state = reduceSituation(state, { kind: 'conversation', who: 'character', origin: 'unprompted', atMs: nowMs }, nowMs)
      state = { ...state, events: [...state.events, worldEvent({ id: `echo@${nowMs}`, topicKey: `echo:${nowMs}`, origin: 'self', salience: 1, atMs: nowMs })] }
      memory = recordFireOutcome(memory, 'spoken', nowMs)
    }
    return fires
  }

  it('fires each topic at most once and never inside the gap in a two-hour session with self-origin feedback', () => {
    const fires = replayGamingSession()
    const topics = fires.map(fire => fire.decision.fire ? fire.decision.topicKey : '')

    expect(fires.length).toBeGreaterThanOrEqual(3)
    expect(new Set(topics).size).toBe(fires.length)
    expect(topics.some(topic => topic.startsWith('echo:'))).toBe(false)
    for (let i = 1; i < fires.length; i++) {
      if (fires[i].decision.reason !== 'urgent')
        expect(fires[i].nowMs - fires[i - 1].nowMs).toBeGreaterThanOrEqual(fires[i].decision.trace.gapMs)
    }
  })

  it('never fires while the user is speaking throughout', () => {
    expect(replayGamingSession({ userSpeaking: true })).toEqual([])
  })
})

describe('evaluateGate purity and malformed input', () => {
  it('gives identical outputs for identical inputs without mutating them', () => {
    const input = deepFreeze(gateInput())
    const memory = deepFreeze(memoryWith({ lastFireAtMs: T0 - HOUR, fires: [T0 - 30 * MIN] }))

    const first = evaluateGate(input, memory)
    const second = evaluateGate(structuredClone(input), structuredClone(memory))
    expect(second).toEqual(first)
    expect(JSON.parse(JSON.stringify(first.memory))).toEqual(first.memory)
  })

  it('normalizes malformed memory instead of trusting it', () => {
    const malformed: unknown = { lastFireAtMs: Number.NaN, fires: [Number.NaN, T0 - 5 * MIN, Number.POSITIVE_INFINITY], pending: { topicKey: 3 }, ignoreStreak: -4, backoffLevel: 9 }

    const { decision, memory } = evaluateGate(gateInput(), malformed as GateMemory)
    expect(decision).toMatchObject({ fire: true })
    expect(decision.trace).toMatchObject({ backoffLevel: 3, ignoreStreak: 0, firesLastHour: 1, pendingTopicKey: null })
    expect(memory).toMatchObject({ lastFireAtMs: T0, fires: [T0 - 5 * MIN, T0], backoffLevel: 3, ignoreStreak: 0 })
  })

  it('suppresses on malformed signals and situation values', () => {
    expect(evaluateGate(gateInput({ signals: { queued: Number.NaN } }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'queued' })
    expect(evaluateGate(gateInput({ signals: { queued: -1 } }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'queued' })
    const weirdBusy = quietSituation({ busy: { state: 'weird' as never, atMs: T0 } })
    expect(evaluateGate(gateInput({ situation: weirdBusy }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'busy-unknown' })
    const weirdPresence = quietSituation({ presence: { state: 'gone' as never, reason: null, sinceMs: T0 } })
    expect(evaluateGate(gateInput({ situation: weirdPresence }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'presence-unknown' })
    const blankTopic = quietSituation({ events: [worldEvent({ text: '   ' }), worldEvent({ id: 'x', topicKey: '', salience: 1 })] })
    expect(evaluateGate(gateInput({ situation: blankTopic }), initialGateMemory).decision).toMatchObject({ fire: false, reason: 'no-topic' })
  })

  it('returns memory unchanged when the time is not finite', () => {
    const memory = memoryWith({ lastFireAtMs: T0 })
    const held = evaluateGate(gateInput({ nowMs: Number.POSITIVE_INFINITY }), memory)

    expect(held.memory).toBe(memory)
    expect(held.decision.trace).toMatchObject({ firesLastHour: null, nextEligibleAtMs: null })
    expect(recordFireOutcome(memory, 'spoken', Number.NaN)).toBe(memory)
    expect(recordUserTurn(memory, Number.NaN)).toBe(memory)
    expect(visibilityRegainGateMemory(memory, Number.NaN)).toBe(memory)
    expect(promotionGateMemory(Number.NaN)).toEqual(initialGateMemory)
  })

  it('pulls future memory times back to now so a backward clock jump costs one gap', () => {
    const fromFuture = memoryWith({ lastFireAtMs: T0 + 24 * HOUR, fires: [T0 + 24 * HOUR], pending: { topicKey: 'old', firedAtMs: T0 + 24 * HOUR, spokenAtMs: T0 + 24 * HOUR } })

    const held = evaluateGate(gateInput(), fromFuture)
    expect(held.decision).toMatchObject({ fire: false, reason: 'gap' })
    expect(held.decision.trace.nextEligibleAtMs).toBe(T0 + minGapMs(0.5))
    expect(held.memory).toMatchObject({ lastFireAtMs: T0, fires: [T0], pending: { spokenAtMs: T0 } })

    const later = evaluateGate(gateInput({ nowMs: T0 + minGapMs(0.5) }), held.memory)
    expect(later.decision).toMatchObject({ fire: true })
    expect(later.memory.ignoreStreak).toBe(1)
  })

  it('settles stale pending fires after a forward clock jump', () => {
    const spoken = recordFireOutcome(evaluateGate(gateInput(), initialGateMemory).memory, 'spoken', T0)

    const { decision, memory } = evaluateGate(gateInput({ nowMs: T0 + 24 * HOUR, situation: quietSituation({ events: [worldEvent({ atMs: T0 + 24 * HOUR })] }) }), spoken)
    expect(decision).toMatchObject({ fire: true })
    expect(decision.trace).toMatchObject({ firesLastHour: 0, ignoreStreak: 1 })
    expect(memory.fires).toEqual([T0 + 24 * HOUR])
  })
})

describe('evaluateGate hard contract (pinned before the urge rewrite)', () => {
  // Pinned independently of timing: every case below holds or fires the same with an empty memory and with a blocked one.
  // Covered elsewhere and not repeated: the self-origin/addressed exclusion and urgent bypass of timing guards
  // ('evaluateGate topics'), and the single-fault hold reasons ('evaluateGate hard suppressors').
  const urgentNotify = worldEvent({ id: 'n', kind: 'notify', topicKey: 'notify:plugin:widget:evt-1', text: 'Doorbell', salience: 1, halfLifeMs: 10 * MIN })
  const gameActivity = activityOf({ appId: 'eldenring', category: 'game' })

  /** One hold reason per case, each the only fault, built so the urgent notify can be swapped in. */
  const faults: { reason: GateHoldReason, input: (events: SituationEvent[]) => GateInput }[] = [
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
    { reason: 'quiet-app', input: events => gateInput({ situation: quietSituation({ events, activity: activityOf({ appId: 'zoom', category: 'call' }) }) }) },
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
    const decide = (): GateDecision => evaluateGate(gateInput({
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
        presence: { state: state.presence, reason: null, sinceMs: T0 - HOUR },
        busy: { state: state.busy, atMs: T0 },
        activity: gameActivity,
      }),
    }), initialGateMemory).decision

    const order: { reason: GateHoldReason, repair: () => void }[] = [
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
    const seen: GateHoldReason[] = []
    for (const step of order) {
      const decision = decide()
      expect(decision).toMatchObject({ fire: false })
      seen.push(decision.fire ? 'invalid-time' : decision.reason)
      step.repair()
    }

    expect(seen).toEqual(order.map(step => step.reason))
    expect(decide()).toMatchObject({ fire: true, reason: 'ready' })
  })

  it.each(faults.map(fault => [fault.reason, fault] as const))('treats an urgent notify under %s as pinned: fires only for busy-game, holds otherwise', (reason, fault) => {
    const { decision } = evaluateGate(fault.input([urgentNotify]), initialGateMemory)

    if (reason === 'busy-game')
      expect(decision).toMatchObject({ fire: true, reason: 'urgent', topicKey: urgentNotify.topicKey })
    else
      expect(decision).toMatchObject({ fire: false, reason })
  })

  it('still holds a game for an urgent notify when games are quiet but the app is also denylisted', () => {
    const input = gateInput({ settings: { speakDuringGames: false, quietApps: ['eldenring'] }, situation: quietSituation({ events: [urgentNotify], activity: gameActivity }) })

    expect(evaluateGate(input, initialGateMemory).decision).toMatchObject({ fire: false, reason: 'quiet-app' })
  })

  it('never makes a self-origin event a candidate, urgent or not, even when forced', () => {
    const own = [
      worldEvent({ id: 'self-notify', kind: 'notify', topicKey: 'notify:self:1', origin: 'self', salience: 1, halfLifeMs: 10 * MIN }),
      worldEvent({ id: 'self-context', topicKey: 'context:self', origin: 'self', salience: 1 }),
    ]
    const input = gateInput({ forceTiming: true, situation: quietSituation({ events: own }) })

    const { decision, memory } = evaluateGate(input, initialGateMemory)
    expect(decision).toMatchObject({ fire: false, reason: 'no-topic' })
    expect(decision.trace.candidate).toBeNull()
    expect(memory.pending).toBeNull()
  })

  it.each(faults.map(fault => [fault.reason, fault] as const))('keeps %s a hold when timing is forced', (reason, fault) => {
    const events = [worldEvent()]
    const blocked = memoryWith({ lastFireAtMs: T0 - MIN, fires: [T0 - MIN] })

    for (const memory of [initialGateMemory, blocked])
      expect(evaluateGate({ ...fault.input(events), forceTiming: true }, memory).decision).toMatchObject({ fire: false, reason })
  })
})
