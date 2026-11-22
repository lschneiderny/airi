import type { PerformerReport } from './refractory'
import type { MindStimulus } from './types'

import { chooseMomentEntry, defaultExpressionPerformanceSettings as settings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { CharacterMind } from './mind'
import { ACTION_REFRACTORY_MS, DANCE_REFRACTORY_MS, GESTURE_REPEAT_MS, initialMindRefractoryState, LOOK_TOOL_REFRACTORY_MS, MOVE_TOOL_REFRACTORY_MS, POKE_SURPRISE_DEDUPE_MS, refractoryRemaining, reportRefractory } from './refractory'
import { step } from './step'
import { naturalMindState } from './test/fixtures'

/** Epoch milliseconds of the first report of every script. */
const T0 = 1_700_000_000_000
function never(): number {
  throw new Error('a refractory draws nothing')
}

function report(report: PerformerReport): MindStimulus {
  return { kind: 'performer-report', report }
}

const poke: MindStimulus = { kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0, y: 0 }, settings, voice: null }

describe('reportRefractory', () => {
  it.each([
    [{ kind: 'clip-ended', clip: 'action', source: 'act' }, { actionUntilMs: T0 + ACTION_REFRACTORY_MS }],
    [{ kind: 'clip-ended', clip: 'dance', source: 'tool' }, { danceUntilMs: T0 + DANCE_REFRACTORY_MS }],
    [{ kind: 'gesture-clip', clipId: 'wave', source: 'act' }, { gesture: { clipId: 'wave', untilMs: T0 + GESTURE_REPEAT_MS } }],
    [{ kind: 'tool-accepted', tool: 'come-here' }, { moveToolUntilMs: T0 + MOVE_TOOL_REFRACTORY_MS }],
    [{ kind: 'tool-accepted', tool: 'go-home' }, { moveToolUntilMs: T0 + MOVE_TOOL_REFRACTORY_MS }],
    [{ kind: 'tool-accepted', tool: 'look-at' }, { lookToolUntilMs: T0 + LOOK_TOOL_REFRACTORY_MS }],
    [{ kind: 'moment-marked', entryId: 'wink' }, { momentRest: { wink: T0 } }],
  ] as const)('stamps %o', (stamped, fields) => {
    expect(reportRefractory(initialMindRefractoryState, stamped, T0)).toEqual({ ...initialMindRefractoryState, ...fields })
  })

  it('arms nothing for a clip she played unasked or for a gesture clip that ended', () => {
    for (const ended of [
      { kind: 'clip-ended', clip: 'action', source: 'idle' },
      { kind: 'clip-ended', clip: 'dance', source: 'idle' },
      { kind: 'clip-ended', clip: 'gesture', source: 'act' },
      { kind: 'gesture-clip', clipId: 'wave', source: 'idle' },
    ] as const)
      expect(reportRefractory(initialMindRefractoryState, ended, T0)).toBe(initialMindRefractoryState)
  })
})

describe('refractoryRemaining', () => {
  it('counts each refractory down to 0 and drops a gesture whose window passed', () => {
    let state = initialMindRefractoryState
    state = reportRefractory(state, { kind: 'clip-ended', clip: 'action', source: 'act' }, T0)
    state = reportRefractory(state, { kind: 'gesture-clip', clipId: 'wave', source: 'debug' }, T0)

    expect(refractoryRemaining(state, T0 + 1_000)).toEqual({ actionMs: ACTION_REFRACTORY_MS - 1_000, danceMs: 0, gesture: { clipId: 'wave', remainingMs: GESTURE_REPEAT_MS - 1_000 }, moveToolMs: 0, lookToolMs: 0 })
    expect(refractoryRemaining(state, T0 + GESTURE_REPEAT_MS).gesture).toBeNull()
    expect(refractoryRemaining(state, T0 + ACTION_REFRACTORY_MS + 1).actionMs).toBe(0)
  })
})

describe('step: performer reports', () => {
  it('answers a director report with the refractory intent of the durations left', () => {
    const first = step(naturalMindState(), [report({ kind: 'tool-accepted', tool: 'look-at' })], T0, never)
    const second = step(first.state, [report({ kind: 'clip-ended', clip: 'dance', source: 'act' })], T0 + 5_000, never)

    expect(first.intents).toEqual([{ id: '1-refractory', cause: 1, channel: 'body', kind: 'refractory', remaining: { actionMs: 0, danceMs: 0, gesture: null, moveToolMs: 0, lookToolMs: LOOK_TOOL_REFRACTORY_MS } }])
    expect(second.intents.map(intent => intent.kind === 'refractory' && intent.remaining)).toEqual([{ actionMs: 0, danceMs: DANCE_REFRACTORY_MS, gesture: null, moveToolMs: 0, lookToolMs: LOOK_TOOL_REFRACTORY_MS - 5_000 }])
  })

  it('refuses the refractory intent without a body and still stamps the state', () => {
    const answer = step({ ...naturalMindState(), performer: { ...naturalMindState().performer, body: false } }, [report({ kind: 'tool-accepted', tool: 'go-home' })], T0, never)

    expect(answer.intents).toEqual([])
    expect(answer.refusals).toEqual([{ cause: 1, kind: 'refractory', reason: 'undeclared' }])
    expect(answer.state.refractory.moveToolUntilMs).toBe(T0 + MOVE_TOOL_REFRACTORY_MS)
  })

  it('rests a marked moment entry for the entry rest, with no intent', () => {
    const marked = step(naturalMindState(), [report({ kind: 'moment-marked', entryId: 'wink' })], T0, never)
    const offered = [{ id: 'wink', label: 'Wink', moments: ['poked' as const] }]
    const draw = { chance: 0, pick: 0 }

    expect(marked.intents).toEqual([])
    expect(chooseMomentEntry(offered, 'poked', marked.state.refractory.momentRest, { ...draw, nowMs: T0 + 59_999 })).toBeNull()
    expect(chooseMomentEntry(offered, 'poked', marked.state.refractory.momentRest, { ...draw, nowMs: T0 + 60_000 })?.id).toBe('wink')
  })

  it('surprises her once per dedupe window of the mind clock', () => {
    const surprises: boolean[] = []
    let state = naturalMindState()
    for (const atMs of [T0, T0 + 1_000, T0 + POKE_SURPRISE_DEDUPE_MS - 1, T0 + POKE_SURPRISE_DEDUPE_MS, T0 + POKE_SURPRISE_DEDUPE_MS + 1_500]) {
      const answer = step(state, [poke], atMs, () => 0.9)
      state = answer.state
      const reaction = answer.intents.find(intent => intent.kind === 'touch-reaction')
      surprises.push(reaction?.kind === 'touch-reaction' && reaction.gesture === 'poke' && reaction.surprise)
    }

    expect(surprises).toEqual([true, false, false, true, false])
  })

  it('keeps the refractories across steps and clears them at a reset', () => {
    let nowMs = T0
    const mind = new CharacterMind({ seed: 1, clock: () => nowMs })
    mind.receive({ kind: 'performer', capabilities: naturalMindState().performer })
    mind.receive(report({ kind: 'clip-ended', clip: 'action', source: 'act' }))
    nowMs += 4_000

    expect(mind.refractories().actionMs).toBe(ACTION_REFRACTORY_MS - 4_000)

    mind.reset({ pacing: null })

    expect(mind.state.refractory).toEqual(initialMindRefractoryState)
    expect(mind.refractories().actionMs).toBe(0)
  })
})
