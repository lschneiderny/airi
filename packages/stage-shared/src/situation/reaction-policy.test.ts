import type {
  GateOutcome,
  GateSettings,
  GateSignals,
  Observation,
  ReactionEvaluation,
  ReactionMemory,
  ReactionPolicyInput,
  SituationState,
  TouchObservation,
} from '.'

import { describe, expect, it } from 'vitest'

import {
  initialReactionMemory,
  initialSituationState,
  nextRandom,
  PET_SPEAK_P,
  POKE_PROTEST_P,
  reactionPolicy,
  reduceSituation,
  seedRng,
  settleReaction,
} from '.'

const T0 = 1_700_000_000_000
const SEC = 1_000
const SESSION_ID = 'chat-a'
const SEED = 20_261_031

const CLEAR_SIGNALS: GateSignals = {
  userSpeaking: false,
  userTyping: false,
  characterSpeaking: false,
  generating: false,
  queued: 0,
  desktopFresh: true,
  foregroundFresh: true,
  stageVisible: true,
}

const SETTINGS: GateSettings = { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: false }

function pet(atMs: number, durationMs: number): TouchObservation {
  return { kind: 'touch', gesture: 'pet', region: 'head', atMs, durationMs }
}

function poke(atMs: number): TouchObservation {
  return { kind: 'touch', gesture: 'poke', region: 'head', atMs }
}

/** The first seed from `start` whose first draw satisfies `accept`. */
function seedWhere(accept: (roll: number) => boolean, start = 0): number {
  let seed = start
  while (!accept(nextRandom(seedRng(seed))[0]))
    seed += 1
  return seed
}

/** Reduces each touch into the situation, then asks the policy, carrying memory between touches like the host does. */
function createStage(seed = SEED) {
  let situation: SituationState = initialSituationState
  let memory: ReactionMemory = initialReactionMemory(seed)
  let last: ReactionPolicyInput | null = null
  return {
    get memory() {
      return memory
    },
    /** The input of the last touch. */
    get input(): ReactionPolicyInput {
      if (last === null)
        throw new Error('no touch yet')
      return last
    },
    observe(observation: Observation): void {
      situation = reduceSituation(situation, observation, observation.atMs)
    },
    touch(touch: TouchObservation, adjust: (input: ReactionPolicyInput) => ReactionPolicyInput = input => input): ReactionEvaluation {
      situation = reduceSituation(situation, touch, touch.atMs)
      last = adjust({
        nowMs: touch.atMs,
        touch,
        eventId: situation.events.at(-1)?.id ?? '',
        situation,
        sessionId: SESSION_ID,
        signals: CLEAR_SIGNALS,
        settings: SETTINGS,
      })
      const evaluation = reactionPolicy(last, memory)
      memory = evaluation.memory
      return evaluation
    },
    settle(outcome: GateOutcome, nowMs: number): void {
      memory = settleReaction(memory, outcome, nowMs)
    },
  }
}

/** Whether the evaluation reached the roll step: it spoke or held on `roll`, and drew exactly once. */
function drew(evaluation: ReactionEvaluation, before: ReactionMemory): boolean {
  const reached = evaluation.decision.speak || evaluation.decision.reason === 'roll'
  return reached && evaluation.memory.rngState === nextRandom(before.rngState)[1]
}

function holdReason(evaluation: ReactionEvaluation): string | null {
  return evaluation.decision.speak ? null : evaluation.decision.reason
}

/** A stage whose first pet is done, so the next separate pet of `durationMs` ending at `atMs` is judged on its own. */
function petAfterFirst(atMs: number, durationMs: number, seed = SEED) {
  const stage = createStage(seed)
  stage.touch(pet(T0, 3 * SEC))
  return { stage, before: stage.memory, evaluation: stage.touch(pet(atMs, durationMs)) }
}

describe('reactionPolicy pets', () => {
  it('holds a pet shorter than 3000 ms and judges a 3000 ms pet', () => {
    const short = petAfterFirst(T0 + 60 * SEC, 2_999)
    expect(holdReason(short.evaluation)).toBe('pet-short')
    expect(short.evaluation.memory.rngState).toBe(short.before.rngState)

    const enough = petAfterFirst(T0 + 60 * SEC, 3_000)
    expect(drew(enough.evaluation, enough.before)).toBe(true)
  })

  it('holds a pet within 20 s of her last line and judges one at 20 s', () => {
    const afterLine = (gapMs: number) => {
      const stage = createStage()
      stage.touch(pet(T0, 3 * SEC))
      const lineAtMs = T0 + 60 * SEC
      stage.observe({ kind: 'conversation', who: 'character', origin: 'user', atMs: lineAtMs })
      const before = stage.memory
      return { before, evaluation: stage.touch(pet(lineAtMs + gapMs, 3 * SEC)) }
    }
    const recent = afterLine(19_999)
    expect(holdReason(recent.evaluation)).toBe('recent-line')
    expect(recent.evaluation.memory.rngState).toBe(recent.before.rngState)

    const eligible = afterLine(20_000)
    expect(drew(eligible.evaluation, eligible.before)).toBe(true)
  })

  it('keeps the first pet of the session silent without drawing', () => {
    const stage = createStage()
    const evaluation = stage.touch(pet(T0, 10 * SEC))
    expect(evaluation.decision).toEqual({ speak: false, reason: 'first-pet', kind: 'pet-soft', roll: null })
    expect(evaluation.memory.rngState).toBe(initialReactionMemory(SEED).rngState)
    expect(evaluation.memory.petsSeen).toBe(1)
  })

  it('does not count a pet merged into the previous span as a new pet', () => {
    const stage = createStage()
    stage.touch(pet(T0, SEC))
    // Starts 1 s after the first pet ended, inside the merge gap: one span of 4 s.
    const merged = stage.touch(pet(T0 + 4 * SEC, 3 * SEC))
    expect(holdReason(merged)).toBe('first-pet')
    expect(merged.memory.petsSeen).toBe(1)
    expect(merged.memory.lastPetStartedAtMs).toBe(T0 - SEC)
  })

  it('ignores a pet the situation did not record', () => {
    const stage = createStage()
    const body = stage.touch({ kind: 'touch', gesture: 'pet', region: 'body', atMs: T0, durationMs: 5 * SEC })
    expect(holdReason(body)).toBe('ignored')
    expect(body.memory.petsSeen).toBe(0)
  })
})

describe('reactionPolicy pokes', () => {
  it('speaks at a third poke within 9.999 s exactly when the first draw is below 0.8', () => {
    const outcomes = new Set<boolean>()
    for (let seed = 0; seed < 40; seed += 1) {
      const stage = createStage(seed)
      expect(holdReason(stage.touch(poke(T0)))).toBe('poke-count')
      expect(holdReason(stage.touch(poke(T0 + 5 * SEC)))).toBe('poke-count')
      const before = stage.memory
      const third = stage.touch(poke(T0 + 9_999))
      const [roll, next] = nextRandom(before.rngState)
      expect(third.decision.speak).toBe(roll < POKE_PROTEST_P)
      expect(third.memory.rngState).toBe(next)
      expect(third.memory.pokeBurstRolled).toBe(true)
      outcomes.add(third.decision.speak)
    }
    expect([...outcomes].sort()).toEqual([false, true])
  })

  it('rolls once per burst and re-arms after a 10 s gap', () => {
    const stage = createStage()
    stage.touch(poke(T0))
    stage.touch(poke(T0 + SEC))
    const third = stage.touch(poke(T0 + 2 * SEC))
    expect(third.memory.pokeBurstRolled).toBe(true)
    stage.settle('declined', T0 + 2 * SEC)

    const before = stage.memory
    const fourth = stage.touch(poke(T0 + 3 * SEC))
    expect(holdReason(fourth)).toBe('burst-rolled')
    expect(fourth.memory.rngState).toBe(before.rngState)

    const rearm = stage.touch(poke(T0 + 13 * SEC))
    expect(holdReason(rearm)).toBe('poke-count')
    expect(rearm.memory.pokeBurstRolled).toBe(false)

    stage.touch(poke(T0 + 18 * SEC))
    const again = stage.memory
    // The retry wait from the attempt at T0 + 2 s ended at T0 + 22 s.
    expect(drew(stage.touch(poke(T0 + 22 * SEC)), again)).toBe(true)
  })
})

describe('reactionPolicy pacing', () => {
  const SPEAKS = seedWhere(roll => roll < POKE_PROTEST_P)

  /** A stage whose first pet is done and whose poke burst at `T` spoke; the outcome is not settled yet. */
  function spokenAt(T: number) {
    const stage = createStage(SPEAKS)
    stage.touch(pet(T - 60 * SEC, 3 * SEC))
    stage.touch(poke(T - 2 * SEC))
    stage.touch(poke(T - SEC))
    const spoken = stage.touch(poke(T))
    expect(spoken.decision).toMatchObject({ speak: true, kind: 'poke-protest' })
    return stage
  }

  it('holds every candidate before 45 s after a spoken reaction', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    stage.settle('spoken', T)
    expect(stage.memory).toMatchObject({ lastLineAtMs: T, lastAttemptAtMs: T, pending: null })

    const reasons = new Set<string | null>()
    for (let atMs = T + 10 * SEC; atMs < T + 45 * SEC; atMs += SEC) {
      const evaluation = stage.touch(poke(atMs))
      if (atMs >= T + 12 * SEC)
        reasons.add(holdReason(evaluation))
    }
    reasons.add(holdReason(stage.touch(poke(T + 44_999))))
    reasons.add(holdReason(stage.touch(pet(T + 44_999, 3 * SEC))))
    expect([...reasons]).toEqual(['refractory'])

    const before = stage.memory
    expect(drew(stage.touch(poke(T + 45 * SEC)), before)).toBe(true)
  })

  it('holds candidates for 20 s after a declined reaction and does not start the refractory', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    stage.settle('declined', T)
    expect(stage.memory).toMatchObject({ lastLineAtMs: null, lastAttemptAtMs: T, pending: null })

    // A new burst: the poke 10 s after the last one re-arms, the third poke is the first candidate.
    stage.touch(poke(T + 10 * SEC))
    stage.touch(poke(T + 11 * SEC))
    const reasons = new Set<string | null>()
    for (let atMs = T + 12 * SEC; atMs < T + 20 * SEC; atMs += SEC)
      reasons.add(holdReason(stage.touch(poke(atMs))))
    reasons.add(holdReason(stage.touch(poke(T + 19_999))))
    expect([...reasons]).toEqual(['retry-wait'])

    const before = stage.memory
    expect(drew(stage.touch(poke(T + 20 * SEC)), before)).toBe(true)
  })

  it.each<GateOutcome>(['cancelled', 'failed'])('treats a %s send like a decline: no refractory', (outcome) => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    const pending = stage.memory
    stage.settle(outcome, T + SEC)
    expect(stage.memory).toEqual({ ...pending, pending: null })
  })

  it('holds a second candidate before the first settles and drops the pending attempt after 30 s', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    expect(stage.memory.pending).toMatchObject({ kind: 'poke-protest', atMs: T })

    stage.touch(poke(T + 10 * SEC))
    stage.touch(poke(T + 11 * SEC))
    expect(holdReason(stage.touch(poke(T + 12 * SEC)))).toBe('pending')
    for (let atMs = T + 13 * SEC; atMs < T + 30 * SEC; atMs += SEC)
      stage.touch(poke(atMs))
    expect(holdReason(stage.touch(poke(T + 29_999)))).toBe('pending')

    const before = stage.memory
    const cleared = stage.touch(poke(T + 30 * SEC))
    expect(drew(cleared, before)).toBe(true)
    expect(cleared.memory.pending === null || cleared.memory.pending.atMs === T + 30 * SEC).toBe(true)
  })

  it('never extends a hold when the clock moves backwards', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    stage.settle('spoken', T)
    const input = stage.input
    // The stored line lies a minute in the future of this evaluation.
    const future: ReactionMemory = { ...stage.memory, lastLineAtMs: T + 60 * SEC, lastAttemptAtMs: T + 60 * SEC, pokeBurstRolled: false }

    const pulled = reactionPolicy(input, future)
    expect(holdReason(pulled)).toBe('refractory')
    expect(pulled.memory).toMatchObject({ lastLineAtMs: T, lastAttemptAtMs: T })

    const later = reactionPolicy({ ...input, nowMs: T + 45 * SEC }, pulled.memory)
    expect(drew(later, pulled.memory)).toBe(true)
  })

  it('resets everything but the checkpoint when the session changes', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    const memory = stage.memory
    expect(memory).toMatchObject({ petsSeen: 1, pokeBurstRolled: true, lastAttemptAtMs: T })
    // Generating holds after pacing, so the hold shows the pending attempt and the rolled burst were reset.
    const other = reactionPolicy({ ...stage.input, sessionId: 'chat-b', signals: { ...CLEAR_SIGNALS, generating: true } }, memory)
    expect(holdReason(other)).toBe('generating')
    expect(other.memory).toEqual({ ...initialReactionMemory(memory.rngState), sessionId: 'chat-b' })
  })

  it('round-trips memory through JSON without changing the decision', () => {
    const T = T0 + 120 * SEC
    const stage = spokenAt(T)
    const memory = stage.memory
    const parsed = JSON.parse(JSON.stringify(memory)) as ReactionMemory
    expect(parsed).toEqual(memory)
    const input = { ...stage.input, nowMs: T + 31 * SEC }
    expect(reactionPolicy(input, parsed)).toEqual(reactionPolicy(input, memory))
  })

  it('holds a non-finite time without touching memory', () => {
    const stage = createStage()
    stage.touch(poke(T0))
    const memory = stage.memory
    const evaluation = reactionPolicy({ ...stage.input, nowMs: Number.NaN }, memory)
    expect(evaluation.decision).toEqual({ speak: false, reason: 'invalid-time', kind: null, roll: null })
    expect(evaluation.memory).toBe(memory)
    expect(settleReaction(memory, 'spoken', Number.POSITIVE_INFINITY)).toBe(memory)
  })
})

describe('reactionPolicy suppressors', () => {
  /** An eligible third poke whose input `adjust` changes. */
  function eligiblePoke(adjust: (input: ReactionPolicyInput) => ReactionPolicyInput) {
    const stage = createStage()
    stage.touch(poke(T0))
    stage.touch(poke(T0 + SEC))
    const before = stage.memory
    return { before, evaluation: stage.touch(poke(T0 + 2 * SEC), adjust) }
  }

  const withSignals = (signals: Partial<GateSignals>) => (input: ReactionPolicyInput): ReactionPolicyInput => ({ ...input, signals: { ...input.signals, ...signals } })
  const withSettings = (settings: Partial<GateSettings>) => (input: ReactionPolicyInput): ReactionPolicyInput => ({ ...input, settings: { ...input.settings, ...settings } })
  const withSituation = (situation: Partial<SituationState>) => (input: ReactionPolicyInput): ReactionPolicyInput => ({ ...input, situation: { ...input.situation, ...situation } })
  const activity = (appId: string, category: 'call' | 'game') => withSituation({ activity: { appId, label: appId, category, title: null, sinceMs: T0 } })

  it.each([
    ['disabled', withSettings({ enabled: false })],
    ['dont-disturb', withSettings({ dontDisturb: true })],
    ['stage-hidden', withSignals({ stageVisible: false })],
    ['user-speaking', withSignals({ userSpeaking: null })],
    ['user-typing', withSignals({ userTyping: true })],
    ['character-speaking', withSignals({ characterSpeaking: true })],
    ['generating', withSignals({ generating: true })],
    ['queued', withSignals({ queued: 1 })],
    ['quiet-app', activity('zoom.exe', 'call')],
  ] as const)('holds on %s without drawing', (reason, adjust) => {
    const { before, evaluation } = eligiblePoke(adjust)
    expect(evaluation.decision).toEqual({ speak: false, reason, kind: 'poke-protest', roll: null })
    expect(evaluation.memory.rngState).toBe(before.rngState)
    expect(evaluation.memory.pokeBurstRolled).toBe(false)
  })

  it('reports the suppressors in hardReason order', () => {
    const steps: readonly ((input: ReactionPolicyInput) => ReactionPolicyInput)[] = [
      withSettings({ enabled: true }),
      withSettings({ dontDisturb: false }),
      withSignals({ stageVisible: true }),
      withSignals({ userSpeaking: false }),
      withSignals({ userTyping: false }),
      withSignals({ characterSpeaking: false }),
      withSignals({ generating: false }),
      withSignals({ queued: 0 }),
      withSettings({ quietApps: [] }),
    ]
    const allHolding = (input: ReactionPolicyInput): ReactionPolicyInput => activity('game.exe', 'game')({
      ...input,
      signals: { ...CLEAR_SIGNALS, stageVisible: false, userSpeaking: true, userTyping: true, characterSpeaking: true, generating: true, queued: 2 },
      settings: { ...SETTINGS, enabled: false, dontDisturb: true, quietApps: ['GAME.*'] },
    })
    const reasons = Array.from({ length: steps.length + 1 }, (_, index) =>
      holdReason(eligiblePoke(input => steps.slice(0, index).reduce((acc, step) => step(acc), allHolding(input))).evaluation))
    expect(reasons.slice(0, -1)).toEqual(['disabled', 'dont-disturb', 'stage-hidden', 'user-speaking', 'user-typing', 'character-speaking', 'generating', 'queued', 'quiet-app'])
    // With every suppressor cleared the game in the foreground still does not hold: the candidate reaches the roll.
    expect([null, 'roll']).toContain(reasons.at(-1))
  })

  it('does not hold on unknown presence, unknown busy, stale samples, or a game', () => {
    const { before, evaluation } = eligiblePoke(input => activity('game.exe', 'game')({
      ...input,
      situation: {
        ...input.situation,
        presence: { state: 'unknown', reason: 'stale', sinceMs: T0 },
        busy: { state: 'unknown', atMs: T0 },
      },
      signals: { ...input.signals, desktopFresh: false, foregroundFresh: false },
    }))
    expect(drew(evaluation, before)).toBe(true)
  })

  it('returns generating with an unchanged checkpoint while a turn generates', () => {
    const { before, evaluation } = eligiblePoke(withSignals({ generating: true }))
    expect(holdReason(evaluation)).toBe('generating')
    expect(evaluation.memory.rngState).toBe(before.rngState)
  })
})

describe('settleReaction', () => {
  it('starts the refractory only for a spoken outcome', () => {
    const memory: ReactionMemory = { ...initialReactionMemory(SEED), sessionId: SESSION_ID, lastAttemptAtMs: T0, pending: { kind: 'pet-soft', eventId: 'e1', atMs: T0 } }
    expect(settleReaction(memory, 'spoken', T0 + SEC)).toEqual({ ...memory, lastLineAtMs: T0 + SEC, pending: null })
    for (const outcome of ['declined', 'cancelled', 'failed'] as const)
      expect(settleReaction(memory, outcome, T0 + SEC)).toEqual({ ...memory, pending: null })
  })
})

describe('reactionPolicy rates', () => {
  const TRIALS = 10_000
  const SPACING_MS = 60 * SEC

  /** Runs `TRIALS` eligible candidates, settling every spoken one, and returns the share that spoke. */
  function speakShare(candidate: (stage: ReturnType<typeof createStage>, atMs: number) => ReactionEvaluation): number {
    const stage = createStage()
    stage.touch(pet(T0, 3 * SEC))
    let spoken = 0
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      const atMs = T0 + trial * SPACING_MS
      const before = stage.memory
      const evaluation = candidate(stage, atMs)
      expect(drew(evaluation, before)).toBe(true)
      if (evaluation.decision.speak) {
        spoken += 1
        stage.settle('spoken', atMs)
      }
    }
    return spoken / TRIALS
  }

  it('speaks for 0.30 +/- 0.02 of eligible pets and 0.80 +/- 0.02 of eligible poke bursts', () => {
    const petShare = speakShare((stage, atMs) => stage.touch(pet(atMs, 3 * SEC)))
    expect(Math.abs(petShare - PET_SPEAK_P)).toBeLessThanOrEqual(0.02)

    const protestShare = speakShare((stage, atMs) => {
      stage.touch(poke(atMs - 2 * SEC))
      stage.touch(poke(atMs - SEC))
      return stage.touch(poke(atMs))
    })
    expect(Math.abs(protestShare - POKE_PROTEST_P)).toBeLessThanOrEqual(0.02)
  })
})
