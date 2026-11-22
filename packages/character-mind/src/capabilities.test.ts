import type { MindStimulus } from './types'

import { defaultExpressionPerformanceSettings as settings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { NO_CAPABILITIES } from './capabilities'
import { seededRandom } from './random'
import { initialMindState, step } from './step'
import { allCapabilities } from './test/fixtures'

describe('declared mind answers', () => {
  it('starts with no capabilities and refuses an emotion without consuming its draw or changing its reaction', () => {
    const source = seededRandom(41)
    const untouched = seededRandom(41)
    const initial = initialMindState()
    const result = step(initial, [{ kind: 'emotion', emotion: 'happy', nominal: 0.7, source: 'act', settings }], 0, source)
    expect(initial.performer).toBe(NO_CAPABILITIES)
    expect(result.intents).toEqual([])
    expect(result.refusals).toEqual([{ cause: 1, kind: 'emotion', reason: 'undeclared' }])
    expect(result.state.reaction).toBe(initial.reaction)
    expect(source()).toBe(untouched())
  })

  it('keeps presence voice observations while refusing the undeclared performer channels', () => {
    const rng = vi.fn(() => 0.5)
    const away = step(initialMindState(), [{ kind: 'presence', away: true, wake: null }], 0, rng)
    const returned = step(away.state, [{ kind: 'presence', away: false, wake: { cause: 'unlock', atMs: 1000 } }], 1000, rng)
    expect(returned.intents.map(intent => intent.kind)).toEqual(['observe-wake', 'observe-return'])
    expect(returned.refusals.map(refusal => refusal.kind)).toEqual(['desktop-reaction', 'moment', 'away'])
    expect(rng).not.toHaveBeenCalled()
  })

  it('refuses a shrug with the Live2D gesture set without a draw', () => {
    const rng = vi.fn(() => 0.5)
    const result = step(initialMindState(), [
      { kind: 'performer', capabilities: { ...allCapabilities, body: false, gestures: ['nod', 'shake', 'glance'] } },
      { kind: 'cue-gesture', gesture: 'shrug', count: 1, source: 'act' },
    ], 0, rng)
    expect(result.intents).toEqual([])
    expect(result.refusals).toEqual([{ cause: 2, kind: 'gesture', reason: 'undeclared' }])
    expect(rng).not.toHaveBeenCalled()
  })

  it.each<MindStimulus>([
    { kind: 'idle-play', act: 'yawn' },
    { kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0, y: 0 }, settings, voice: null },
    { kind: 'expression-request', source: 'act', entryId: 'smile', lease: { holdSeconds: 3, until: 'hold' }, mapping: { emotion: 'happy', minBand: 'clear' }, settings },
    { kind: 'cursor', report: { requestId: 1, band: 'near', opportunity: 'moved' } },
  ])('spends no draw on undeclared $kind', (stimulus) => {
    const rng = vi.fn(() => 0.5)
    const result = step(initialMindState(), [stimulus], 0, rng)
    expect(result.intents).toEqual([])
    expect(result.refusals).toHaveLength(1)
    expect(rng).not.toHaveBeenCalled()
  })
})
