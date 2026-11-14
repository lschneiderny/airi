import type { Observation, SituationState } from '.'

import { describe, expect, it } from 'vitest'

import { collectReasons, initialSituationState, REASON_TEXT, reduceSituation, renderSituation, selfHint, selfLine } from '.'

const T0 = 1_700_000_000_000
const SEC = 1000
const MIN = 60 * SEC

function fold(observations: readonly Observation[], from: SituationState = initialSituationState): SituationState {
  return observations.reduce((state, observation) => reduceSituation(state, observation, observation.atMs), from)
}

describe('self observations', () => {
  it('tracks the activity in progress and closes it with its length', () => {
    const asleep = fold([{ kind: 'self', activity: 'sleep', phase: 'start', atMs: T0 }])
    expect(asleep.self.current).toEqual({ activity: 'sleep', label: null, sinceMs: T0 })
    const awake = fold([{ kind: 'self', activity: 'sleep', phase: 'end', atMs: T0 + 40 * MIN }], asleep)
    expect(awake.self.current).toBeNull()
    expect(awake.self.recent).toEqual([{ activity: 'sleep', label: null, endedAtMs: T0 + 40 * MIN, durationMs: 40 * MIN }])
  })

  it('records an end without a start as a momentary activity and keeps the one in progress', () => {
    const state = fold([
      { kind: 'self', activity: 'sit', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'held-back', phase: 'end', atMs: T0 + MIN },
    ])
    expect(state.self.current?.activity).toBe('sit')
    expect(state.self.recent[0]).toMatchObject({ activity: 'held-back', durationMs: 0 })
  })

  it('keeps a sit in progress while a short activity comes and goes inside it', () => {
    const state = fold([
      { kind: 'self', activity: 'sit', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 + 3 * MIN },
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 + 3 * MIN + 4 * SEC },
    ])
    expect(state.self.current).toEqual({ activity: 'sit', label: null, sinceMs: T0 })
    expect(state.self.recent.map(past => past.activity)).toEqual(['yawn'])
    expect(selfLine(state, T0 + 5 * MIN, 'Luke')).toBe('You are sitting down, for about 5 min now, and you yawned 2 min ago.')
  })

  it('ends the activity in progress when another starts, and keeps the three newest', () => {
    const state = fold([
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'stretch', phase: 'start', atMs: T0 + 3 * SEC },
      { kind: 'self', activity: 'stretch', phase: 'end', atMs: T0 + 8 * SEC },
      { kind: 'self', activity: 'peer', phase: 'end', atMs: T0 + 60 * SEC },
      { kind: 'self', activity: 'sway', phase: 'end', atMs: T0 + 90 * SEC },
    ])
    expect(state.self.recent.map(past => past.activity)).toEqual(['sway', 'peer', 'stretch'])
  })

  it('keeps a clip label and drops unknown activities, phases, and stale reports', () => {
    const base = fold([{ kind: 'self', activity: 'clip', phase: 'start', label: '  wave  ', atMs: T0 }])
    expect(base.self.current).toEqual({ activity: 'clip', label: 'wave', sinceMs: T0 })
    const malformed: unknown[] = [
      { kind: 'self', activity: 'juggle', phase: 'start', atMs: T0 + SEC },
      { kind: 'self', activity: 'yawn', phase: 'pause', atMs: T0 + SEC },
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 - SEC },
    ]
    for (const observation of malformed)
      expect(reduceSituation(base, observation as Observation, T0 + 2 * SEC).self).toEqual(base.self)
  })

  it('never becomes an event, so the gate has nothing to pick', () => {
    const state = fold([
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 + 4 * SEC },
    ])
    expect(state.events).toEqual([])
  })
})

describe('selfLine', () => {
  it('says nothing when she did nothing recently', () => {
    expect(selfLine(initialSituationState, T0, 'Luke')).toBeNull()
    const old = fold([{ kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 }])
    expect(selfLine(old, T0 + 11 * MIN, 'Luke')).toBeNull()
  })

  it('names the activity in progress, with its length when it lasts', () => {
    const asleep = fold([{ kind: 'self', activity: 'sleep', phase: 'start', atMs: T0 }])
    expect(selfLine(asleep, T0 + 20 * SEC, 'Luke')).toBe('You are dozing.')
    expect(selfLine(asleep, T0 + 12 * MIN, 'Luke')).toBe('You are dozing, for about 12 min now.')
  })

  it('ignores a short activity whose end never arrived', () => {
    const stuck = fold([{ kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 }])
    expect(selfLine(stuck, T0 + MIN, 'Luke')).toBe('You are yawning.')
    expect(selfLine(stuck, T0 + 3 * MIN, 'Luke')).toBeNull()
    expect(selfHint(stuck, T0 + 3 * MIN)).toBeNull()
  })

  it('names up to two finished activities, newest first, each once', () => {
    const state = fold([
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 },
      { kind: 'self', activity: 'check-in', phase: 'end', atMs: T0 + 2 * MIN },
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 + 3 * MIN },
    ])
    expect(selfLine(state, T0 + 5 * MIN, 'Luke')).toBe('You yawned 2 min ago, and glanced over at Luke 3 min ago.')
  })

  it('keeps a long sleep worth telling for half an hour and says how long it was', () => {
    const state = fold([
      { kind: 'self', activity: 'sleep', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'sleep', phase: 'end', atMs: T0 + 90 * MIN },
    ])
    expect(selfLine(state, T0 + 90 * MIN + 20 * SEC, 'Luke')).toBe('You dozed off for about 1.5 h just now.')
    expect(selfLine(state, T0 + 115 * MIN, 'Luke')).toBe('You dozed off for about 1.5 h 25 min ago.')
    expect(selfLine(state, T0 + 125 * MIN, 'Luke')).toBeNull()
  })

  it('tells a pastime with its label and its length, and keeps it through a short activity', () => {
    const playing = fold([
      { kind: 'self', activity: 'prop', phase: 'start', label: 'game', atMs: T0 },
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 + 2 * MIN },
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 + 2 * MIN + 5 * SEC },
    ])
    expect(playing.self.current).toEqual({ activity: 'prop', label: 'game', sinceMs: T0 })
    expect(selfLine(playing, T0 + 3 * MIN, 'Luke')).toBe('You are busy with your "game", for about 3 min now, and you yawned just now.')

    const done = fold([{ kind: 'self', activity: 'prop', phase: 'end', label: 'game', atMs: T0 + 4 * MIN }], playing)
    expect(done.self.current).toBeNull()
    expect(selfLine(done, T0 + 20 * MIN, 'Luke')).toBe('You were busy with your "game" for about 4 min 16 min ago.')
    expect(selfLine(fold([{ kind: 'self', activity: 'prop', phase: 'end', atMs: T0 }]), T0 + SEC, 'Luke')).toBe('You were busy with something of your own just now.')
  })

  it('reports a clip-free rest as it reports a sit: long-lived, kept through a short activity, told with its length', () => {
    const resting = fold([
      { kind: 'self', activity: 'rest', phase: 'start', atMs: T0 },
      { kind: 'self', activity: 'yawn', phase: 'start', atMs: T0 + 2 * MIN },
      { kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 + 2 * MIN + 5 * SEC },
    ])
    expect(resting.self.current).toEqual({ activity: 'rest', label: null, sinceMs: T0 })
    // A sleep, a sit and a rest last: still in progress after the 2 minutes a short activity is believed.
    expect(selfLine(resting, T0 + 10 * MIN, 'Luke')).not.toBeNull()
    const done = fold([{ kind: 'self', activity: 'rest', phase: 'end', atMs: T0 + 6 * MIN }], resting)
    expect(done.self.current).toBeNull()
    expect(done.self.recent[0]).toMatchObject({ activity: 'rest', durationMs: 6 * MIN })
    // Worth telling for half an hour, like a sit.
    expect(selfLine(done, T0 + 30 * MIN, 'Luke')).not.toBeNull()
  })

  it('tells what came before the activity in progress', () => {
    const state = fold([
      { kind: 'self', activity: 'held-back', phase: 'end', atMs: T0 },
      { kind: 'self', activity: 'zone-out', phase: 'start', atMs: T0 + MIN },
    ])
    expect(selfLine(state, T0 + 2 * MIN, 'Luke')).toBe('You are zoning out; before that you almost said something and let it go 2 min ago.')
  })

  it('renders in the situation block after the app lines, and can be left out', () => {
    const state = fold([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'self', activity: 'clip', phase: 'end', label: 'wave', atMs: T0 + MIN },
    ])
    const lines = renderSituation(state, T0 + 2 * MIN, { userName: 'Luke' }).text.split('\n')
    expect(lines[2]).toBe('- You did your "wave" move 1 min ago.')
    expect(renderSituation(state, T0 + 2 * MIN, { includeSelf: false }).text).not.toContain('wave')
  })
})

describe('own-day reason', () => {
  const collect = (situation: SituationState, nowMs: number) => collectReasons({ situation, reasons: { threads: { threads: [] }, rituals: null }, nowMs, sessionId: 's', heldTopics: new Set(), lastOwnDayAtMs: null })
    .find(reason => reason.kind === 'own-day')!
    .text

  it('is anchored to what she was visibly doing, and unchanged without it', () => {
    expect(collect(initialSituationState, T0)).toBe(REASON_TEXT['own-day'])
    const zoning = fold([{ kind: 'self', activity: 'zone-out', phase: 'start', atMs: T0 }])
    expect(selfHint(zoning, T0 + MIN)).toBe('you are zoning out')
    expect(collect(zoning, T0 + MIN)).toBe(`${REASON_TEXT['own-day']} (you are zoning out)`)
    const yawned = fold([{ kind: 'self', activity: 'yawn', phase: 'end', atMs: T0 }])
    expect(collect(yawned, T0 + MIN)).toBe(`${REASON_TEXT['own-day']} (you just yawned)`)
    expect(collect(yawned, T0 + 20 * MIN)).toBe(REASON_TEXT['own-day'])
  })
})
