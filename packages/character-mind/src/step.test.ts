import type { MindRandom, MindStimulus } from './types'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { seededRandom } from './random'
import { step } from './step'
import { naturalMindState } from './test/fixtures'

/** Without jitter an episode's intensity is its dose, so the cases below can state it. */
const settings = {
  ...defaultExpressionPerformanceSettings,
  intensity: { ...defaultExpressionPerformanceSettings.intensity, jitter: 0 },
}
/** The draw of the cases without jitter, where its value cannot show. */
const rng: MindRandom = () => 0.5
const release = { emotion: null, strength: 0, holdSeconds: 0, until: 'hold' }

type Emotion = Extract<MindStimulus, { kind: 'emotion' }>
function emotion(name: Emotion['emotion'], nominal: number, turnId?: string, document = settings): Emotion {
  return { kind: 'emotion', source: 'act', emotion: name, nominal, turnId, settings: document }
}
function request(mapping: Extract<MindStimulus, { kind: 'expression-request' }>['mapping'], document = settings): MindStimulus {
  return { kind: 'expression-request', source: 'tool', entryId: 'tied', lease: { holdSeconds: 5, until: 'hold' }, mapping, turnId: 'A', settings: document }
}

describe('step: emotion', () => {
  it('answers an emotion of a turn with an episode and a hold that lasts until its speech ends', () => {
    const { state, intents } = step(naturalMindState(), [emotion('happy', 0.6, 'A')], 0, rng)
    expect(intents).toEqual([{
      id: '1-emotion',
      cause: 1,
      channel: 'face',
      kind: 'emotion',
      episode: { id: 'happy-1', emotion: 'happy', nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false },
      hold: { emotion: 'happy', strength: 0.6, holdSeconds: 4, until: 'speech', turnId: 'A' },
      reason: 'act',
      turnId: 'A',
    }, { id: '1-emotion-gesture', cause: 1, channel: 'posture', kind: 'emotion-gesture', gesture: 'laugh', episodeId: 'happy-1' }])
    expect(state.seq).toBe(1)
  })

  it('holds a turnless emotion for the configured seconds and a lingering one twice as long', () => {
    const turnless = step(naturalMindState(), [emotion('happy', 0.6)], 0, rng).intents
    expect(turnless).toMatchObject([{ hold: { emotion: 'happy', holdSeconds: 4, until: 'hold' } }, { kind: 'emotion-gesture' }])
    const lingering = step(naturalMindState(), [emotion('sad', 0.6, 'A')], 0, rng).intents
    expect(lingering).toMatchObject([{ hold: { emotion: 'sad', holdSeconds: 8, until: 'speech' } }])
  })

  it('escalates a stronger repeat inside the escalation window and ignores a weaker one', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6, 'A')], 0, rng)
    const weaker = step(first.state, [emotion('happy', 0.5, 'A')], 500, rng)
    expect(weaker.intents).toEqual([])
    expect(weaker.state.seq).toBe(2)
    const stronger = step(weaker.state, [emotion('happy', 0.9, 'A')], 1000, rng)
    expect(stronger.intents).toMatchObject([{
      id: '3-emotion',
      cause: 3,
      episode: { id: 'happy-1', intensity: 0.9, band: 'strong', escalation: true },
      hold: { strength: 0.9 },
    }])
    const equal = step(stronger.state, [emotion('happy', 0.9, 'A')], 1500, rng)
    expect(equal.intents).toEqual([])
  })

  it('decides the episode whether or not automatic expressions are on', () => {
    const off = step(naturalMindState(), [emotion('happy', 0.9, 'A', { ...settings, autoExpressions: false })], 0, rng)
    expect(off.intents).toEqual(step(naturalMindState(), [emotion('happy', 0.9, 'A')], 0, rng).intents)
    // The episode and its laugh.
    expect(off.intents).toHaveLength(2)
  })

  it('holds each emotion of a script and releases the hold on a clear and on a neutral', () => {
    const script: [number, MindStimulus][] = [
      [0, emotion('happy', 0.6, 'A')],
      [1000, emotion('happy', 0.9, 'A')],
      [5000, emotion('sad', 0.6)],
      [6000, { kind: 'expression-clear', source: 'act' }],
      [7000, emotion('neutral', 0.6, 'B')],
    ]
    let state = naturalMindState()
    const held = script.map(([atMs, stimulus]) => {
      const answer = step(state, [stimulus], atMs, rng)
      state = answer.state
      return answer.intents.filter(intent => intent.channel === 'face').map(intent => 'hold' in intent ? intent.hold?.emotion : undefined)
    })
    expect(held).toEqual([['happy'], ['happy'], ['sad'], [null], [null]])
  })

  it('weakens a repeat of the same emotion after the escalation window', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6)], 0, rng)
    const repeat = step(first.state, [emotion('happy', 0.6)], 3000, rng)
    expect(repeat.intents).toMatchObject([{ episode: { id: 'happy-2', band: 'slight', escalation: false } }])
    const [intent] = repeat.intents
    expect(intent.kind === 'emotion' && intent.episode.intensity).toBeCloseTo(0.6 * settings.intensity.habituationBase)
  })

  it('doses every emotion alike when bands are off', () => {
    const { intents } = step(naturalMindState(), [emotion('happy', 0.95, undefined, { ...settings, bands: false })], 0, rng)
    expect(intents).toMatchObject([{ episode: { nominal: 0.6, intensity: 0.6 } }, { kind: 'emotion-gesture', gesture: 'laugh' }])
  })

  it('releases the automatic slots and the hold when a neutral resets the reaction', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6, 'A')], 0, rng)
    const neutral = step(first.state, [emotion('neutral', 0.6, 'A')], 1000, rng)
    expect(neutral.intents).toEqual([{ id: '2-release', cause: 2, channel: 'face', kind: 'release', scope: 'neutral', hold: { ...release, turnId: 'A' }, reason: 'act', turnId: 'A' }])
    expect(neutral.state.reaction.current).toBeNull()
    // Habituation went with the reset: the next episode is at full strength.
    const again = step(neutral.state, [emotion('happy', 0.6, 'A')], 3000, rng)
    expect(again.intents).toMatchObject([{ episode: { intensity: 0.6 } }])
  })
})

describe('step: named entries', () => {
  it('derives an episode from the entry mapping and holds it for the entry lease', () => {
    const first = step(naturalMindState(), [request({ emotion: 'sad', minBand: 'clear' })], 0, rng)
    expect(first.intents).toEqual([{
      id: '1-entry',
      cause: 1,
      channel: 'face',
      kind: 'entry',
      entryId: 'tied',
      episode: { id: 'sad-1', emotion: 'sad', nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false },
      hold: { emotion: 'sad', strength: 0.6, holdSeconds: 5, until: 'hold', turnId: 'A' },
      reason: 'tool',
      turnId: 'A',
    }])
  })

  it('refreshes the hold at the running strength when a repeat starts no episode', () => {
    const first = step(naturalMindState(), [emotion('sad', 0.9, 'A')], 0, rng)
    const repeat = step(first.state, [request({ emotion: 'sad', minBand: 'clear' })], 1000, rng)
    expect(repeat.intents).toMatchObject([{ kind: 'entry', episode: null, hold: { emotion: 'sad', strength: 0.9, holdSeconds: 5, until: 'hold' } }])
  })

  it('refreshes the hold of a mapped entry even when its configured dose is zero', () => {
    const zero = { ...settings, intensity: { ...settings.intensity, strong: 0 } }
    const { intents } = step(naturalMindState(), [request({ emotion: 'angry', minBand: 'strong' }, zero)], 0, rng)
    expect(intents).toMatchObject([{ kind: 'entry', episode: null, hold: { emotion: 'angry', strength: 0, holdSeconds: 5, until: 'hold', turnId: 'A' } }])
  })

  it('escalates an episode an entry derived with a later stronger emotion, also after a JSON round trip', () => {
    const first = step(naturalMindState(), [request({ emotion: 'sad', minBand: 'clear' })], 0, rng)
    const stronger = [emotion('sad', 0.9, 'A')]
    const direct = step(first.state, stronger, 1000, rng)
    const resumed = step(JSON.parse(JSON.stringify(first.state)), stronger, 1000, rng)
    expect(direct.intents).toMatchObject([{ kind: 'emotion', episode: { emotion: 'sad', escalation: true }, hold: { strength: 0.9 } }])
    expect(resumed).toEqual(direct)
  })

  it('sends an entry alone when it maps to no emotion or held emotions are off', () => {
    const initial = naturalMindState()
    const unmapped = step(initial, [request(null)], 0, rng)
    expect(unmapped.intents).toMatchObject([{ kind: 'entry', entryId: 'tied', episode: null, hold: null }])
    expect(unmapped.state.reaction).toBe(initial.reaction)
    const off = step(initial, [request({ emotion: 'sad', minBand: 'clear' }, { ...settings, heldEmotions: false })], 0, rng)
    expect(off.intents).toMatchObject([{ kind: 'entry', episode: null, hold: null }])
    expect(off.state.reaction).toBe(initial.reaction)
  })
})

describe('step: emotion gestures', () => {
  it('follows the face intent of a new episode with its gesture and spends the cooldown on the mind clock', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6, 'A')], 10_000, rng)
    expect(first.intents).toEqual([
      expect.objectContaining({ id: '1-emotion', kind: 'emotion' }),
      { id: '1-emotion-gesture', cause: 1, channel: 'posture', kind: 'emotion-gesture', gesture: 'laugh', episodeId: 'happy-1' },
    ])
    expect(first.state.gesture.lastAtSeconds).toEqual({ laugh: 10 })
    // A stronger repeat escalates the episode inside the laugh cooldown: a face intent and no gesture.
    const escalated = step(first.state, [emotion('happy', 0.9, 'A')], 11_000, rng)
    expect(escalated.intents.map(intent => intent.kind)).toEqual(['emotion'])
    // Past the cooldown a new episode plays it again.
    const again = step(escalated.state, [emotion('happy', 0.9, 'B')], 14_000, rng)
    expect(again.intents.map(intent => intent.kind)).toEqual(['emotion', 'emotion-gesture'])
  })

  it('answers a mapped expression request that starts an episode with a gesture', () => {
    const { intents } = step(naturalMindState(), [request({ emotion: 'surprised', minBand: 'clear' })], 0, rng)
    expect(intents).toEqual([
      expect.objectContaining({ kind: 'entry', episode: expect.objectContaining({ id: 'surprised-1' }) }),
      { id: '1-emotion-gesture', cause: 1, channel: 'posture', kind: 'emotion-gesture', gesture: 'recoil', episodeId: 'surprised-1' },
    ])
  })

  it('reports the gesture undeclared without posture and spends no cooldown', () => {
    const faceOnly = { ...naturalMindState(), performer: { ...naturalMindState().performer, posture: false } }
    const answer = step(faceOnly, [emotion('happy', 0.6, 'A')], 0, rng)
    expect(answer.intents.map(intent => intent.kind)).toEqual(['emotion'])
    expect(answer.refusals).toEqual([{ cause: 1, kind: 'emotion-gesture', reason: 'undeclared' }])
    expect(answer.state.gesture).toBe(faceOnly.gesture)
  })

  it('plays no gesture with held emotions off', () => {
    const { intents, state } = step(naturalMindState(), [emotion('happy', 0.6, 'A', { ...settings, heldEmotions: false })], 0, rng)
    expect(intents.map(intent => intent.kind)).toEqual(['emotion'])
    expect(state.gesture.lastAtSeconds).toEqual({})
  })

  it('draws nothing for a gesture', () => {
    const draw = vi.fn(rng)
    step(naturalMindState(), [emotion('angry', 0.9, 'A')], 0, draw)
    // The one draw is the new episode's jitter.
    expect(draw).toHaveBeenCalledTimes(1)
  })
})

describe('step: clears', () => {
  it('releases the hold when no slot is named, and keeps it and the reaction history when one is', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6, 'A')], 0, rng)
    const all = step(first.state, [{ kind: 'expression-clear', source: 'act' }], 1000, rng)
    expect(all.intents).toEqual([{ id: '2-release', cause: 2, channel: 'face', kind: 'release', scope: 'all', hold: release, reason: 'act' }])
    const named = step(first.state, [{ kind: 'expression-clear', source: 'tool', slot: 'face', turnId: 'A' }], 1000, rng)
    expect(named.intents).toEqual([{ id: '2-release', cause: 2, channel: 'face', kind: 'release', scope: 'face', hold: null, reason: 'tool', turnId: 'A' }])
    expect(named.state.reaction).toBe(first.state.reaction)
  })
})

describe('step: state', () => {
  /** Default settings keep the jitter, so the seed shows in every intensity. */
  const script: { atMs: number, stimuli: MindStimulus[] }[] = [
    { atMs: 0, stimuli: [emotion('happy', 0.6, 'A', defaultExpressionPerformanceSettings)] },
    { atMs: 1000, stimuli: [emotion('happy', 0.9, 'A', defaultExpressionPerformanceSettings), { kind: 'expression-clear', source: 'act', slot: 'effect' }] },
    { atMs: 4000, stimuli: [request({ emotion: 'happy', minBand: 'slight' }, defaultExpressionPerformanceSettings)] },
    { atMs: 9000, stimuli: [emotion('angry', 0.7, 'B', defaultExpressionPerformanceSettings), emotion('neutral', 0, 'B', defaultExpressionPerformanceSettings)] },
    { atMs: 12000, stimuli: [emotion('angry', 0.7, 'B', defaultExpressionPerformanceSettings)] },
  ]
  function run(rng: MindRandom = seededRandom(41), state = naturalMindState(), steps = script) {
    return steps.reduce((run, { atMs, stimuli }) => {
      const answer = step(run.state, stimuli, atMs, rng)
      return { state: answer.state, intents: [...run.intents, ...answer.intents] }
    }, { state, intents: [] as ReturnType<typeof step>['intents'] })
  }

  it('numbers stimuli across calls and gives the intents of one stimulus its number', () => {
    const { state, intents } = run()
    expect(state.seq).toBe(7)
    // The escalation at 1 s and the angry repeat at 12 s fall inside their gestures' cooldowns.
    expect(intents.map(intent => intent.id)).toEqual(['1-emotion', '1-emotion-gesture', '2-emotion', '3-release', '4-entry', '5-emotion', '5-emotion-gesture', '6-release', '7-emotion'])
    expect(intents.map(intent => intent.cause)).toEqual([1, 1, 2, 3, 4, 5, 5, 6, 7])
  })

  it('gives the same intents for the same seed and script, and others for another seed', () => {
    expect(run().intents).toEqual(run().intents)
    expect(run(seededRandom(42)).intents).not.toEqual(run().intents)
  })

  it('continues identically after a JSON round trip of the state', () => {
    // The state holds no random source, so each run gets its own stream, advanced through the first half.
    const direct = seededRandom(41)
    const resumed = seededRandom(41)
    const half = run(direct, naturalMindState(), script.slice(0, 3))
    const restored = JSON.parse(JSON.stringify(run(resumed, naturalMindState(), script.slice(0, 3)).state))
    expect(restored).toEqual(half.state)
    expect(run(resumed, restored, script.slice(3))).toEqual(run(direct, half.state, script.slice(3)))
  })

  it('draws once for each new episode and for nothing else', () => {
    const draw = vi.fn(seededRandom(41))
    let state = naturalMindState()
    const drawn = [
      emotion('happy', 0.6, 'A'),
      emotion('happy', 0.9, 'A'),
      emotion('happy', 0.5, 'A'),
      { kind: 'expression-clear', source: 'act' } as const,
      request(null),
      request({ emotion: 'sad', minBand: 'clear' }),
      emotion('neutral', 0.6, 'A'),
    ].map((stimulus, index) => {
      state = step(state, [stimulus], index * 500, draw).state
      return draw.mock.calls.length
    })
    // A new episode, its escalation, a weaker repeat, a clear, an unmapped entry, a mapped entry, a neutral.
    expect(drawn).toEqual([1, 1, 1, 1, 1, 2, 2])
  })

  it('drops a stimulus older than the last one it accepted', () => {
    const first = step(naturalMindState(), [emotion('happy', 0.6)], 5000, rng)
    const late = step(first.state, [emotion('happy', 0.9)], 4000, rng)
    expect(late.intents).toEqual([])
    expect(late.state.reaction).toBe(first.state.reaction)
  })
})
