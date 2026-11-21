import type { CueGestureStimulus, MindRandom } from './types'

import { describe, expect, it } from 'vitest'

import { initialMindState, step } from './step'

const T0 = 1_700_000_000_000

describe('chat activity', () => {
  it('answers a typed send with a read of its words and one attend, and an unfold with a read only, drawing nothing', () => {
    let draws = 0
    const rng: MindRandom = () => {
      draws++
      return 0.5
    }
    const sent = step(initialMindState(), [{ kind: 'chat', cue: 'sent', words: 7 }], T0, rng)
    const unfold = step(sent.state, [{ kind: 'chat', cue: 'unfold' }], T0 + 1000, rng)

    expect(sent.intents).toEqual([
      { id: '1-chat-read', cause: 1, channel: 'gaze', kind: 'chat-read', cue: 'sent', words: 7 },
      { id: '1-attend', cause: 1, channel: 'body', kind: 'attend', target: 'cursor', windowMs: 60_000 },
    ])
    expect(unfold.intents).toEqual([{ id: '2-chat-read', cause: 2, channel: 'gaze', kind: 'chat-read', cue: 'unfold', words: 0 }])
    expect(draws).toBe(0)
  })
})

describe('cue gestures', () => {
  it.each<CueGestureStimulus['gesture']>(['nod', 'shake', 'shrug', 'lean', 'glance'])('answers %s with one gesture intent of its kind and count, drawing nothing', (gesture) => {
    let draws = 0
    const rng: MindRandom = () => {
      draws++
      return 0.5
    }
    const act = step(initialMindState(), [{ kind: 'cue-gesture', gesture, count: 2, source: 'act', turnId: 'turn-1' }], T0, rng)
    const devtools = step(act.state, [{ kind: 'cue-gesture', gesture, count: 1, source: 'devtools' }], T0 + 1000, rng)

    expect(act.intents).toEqual([{ id: '1-gesture', cause: 1, channel: 'posture', kind: 'gesture', gesture, count: 2 }])
    expect(devtools.intents).toEqual([{ id: '2-gesture', cause: 2, channel: 'posture', kind: 'gesture', gesture, count: 1 }])
    expect(draws).toBe(0)
  })
})
