import type { NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleReport, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { GateSignals } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { HOUR_MS, initialSituationState, randomSource } from '@proj-airi/stage-shared/situation'
import { describe, expect, it } from 'vitest'

import { nextIdleWakeAt } from './idle'
import { initialMindState, step } from './step'

const SEC = 1000
const MIN = 60 * SEC
const T0 = 1_700_000_000_000
/** Seed 1 rolls the 70 % follow-up after a long sleep. */
const SEED = 1

const drive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 }

function idleView(overrides: Partial<IdleView> = {}): IdleView {
  return { drive, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null, ...overrides }
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
function script(seed = SEED, initial: MindState = initialMindState()) {
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
