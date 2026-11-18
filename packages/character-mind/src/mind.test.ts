import type { MindStep } from './mind'
import type { MindStimulus } from './types'

import { defaultExpressionPerformanceSettings as settings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { CharacterMind } from './mind'

function happy(nominal: number): MindStimulus {
  return { kind: 'emotion', source: 'act', emotion: 'happy', nominal, turnId: 'A', settings }
}

/** A clock that returns the given epoch milliseconds in order. */
function scriptedClock(...times: number[]) {
  let index = 0
  return () => times[index++]
}

describe('character mind', () => {
  it('answers on its own clock and keeps the state of the last step', () => {
    const mind = new CharacterMind({ seed: 41, clock: scriptedClock(10_000, 11_000) })
    expect(mind.state.seq).toBe(0)
    expect(mind.receive(happy(0.6))).toMatchObject([{ kind: 'emotion', episode: { id: 'happy-1', escalation: false } }])
    expect(mind.receive(happy(0.9))).toMatchObject([{ kind: 'emotion', episode: { id: 'happy-1', escalation: true } }])
    expect(mind.state.seq).toBe(2)
    expect(mind.state.reaction.lastAt).toBe(11)
  })

  it('never lets time run backwards', () => {
    const mind = new CharacterMind({ seed: 41, clock: scriptedClock(10_000, 4_000, 10_500) })
    const steps: MindStep[] = []
    mind.onStep(step => steps.push(step))
    mind.receive(happy(0.6))
    // On the raw clock this stimulus would be older than the last one, and the rule would drop it.
    expect(mind.receive(happy(0.9))).toMatchObject([{ kind: 'emotion', episode: { escalation: true } }])
    mind.receive()
    expect(steps.map(step => step.atMs)).toEqual([10_000, 10_000, 10_500])
  })

  it('gives the same intents for the same seed and script', () => {
    const script = [happy(0.6), happy(0.9), { kind: 'expression-clear', source: 'act' } as const]
    function run(seed: number) {
      const mind = new CharacterMind({ seed, clock: scriptedClock(0, 1000, 2000) })
      return script.map(stimulus => mind.receive(stimulus))
    }
    expect(run(41)).toEqual(run(41))
    expect(run(42)).not.toEqual(run(41))
  })

  it('reports every step to its listeners until they stop', () => {
    const mind = new CharacterMind({ seed: 41, clock: scriptedClock(1000, 2000) })
    const steps: MindStep[] = []
    const stop = mind.onStep(step => steps.push(step))
    const stimulus = happy(0.6)
    const intents = mind.receive(stimulus)
    expect(steps).toEqual([{ atMs: 1000, stimuli: [stimulus], intents, state: mind.state }])
    stop()
    mind.receive(happy(0.9))
    expect(steps).toHaveLength(1)
  })
})
