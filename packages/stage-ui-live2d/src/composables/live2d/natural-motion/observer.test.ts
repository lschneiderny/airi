import type { Live2DNaturalMotionOptions, NaturalMotionEvent, NaturalMotionObserver } from './frame-types'

import { createHash } from 'node:crypto'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Live2DNaturalMotion } from '../natural-motion'
import { naturalEmotions } from './emotions'

// sha256 per seed (1, 2, 3) over `${JSON.stringify({ pose, fixation, face, blink, breath })}\n` of every frame.
// Emotion values were re-pinned when gesture clips began ducking idle posture motion; idle values are the
// qa-tooling golden idle hash and did not change.
const idleHashes = [
  '271ed8f4b89ff30c62ebc970c6f82a2a6fd9dff3810734d3a16b0d921a8d21c0',
  '8410d296a2ebdb0034a3e96d78f07e3c5551bd1c6877f34b1cd79b821384a7c4',
  '8265e97b67c03b83747d1339ece468ca8eb563ed849c4f02eac9000a5cf1179a',
]
const emotionHashes = [
  '97b8b918c1b1cc0fe1df2b25b9aa8bb8d3f29f8f9c048db63be998dd46e95b43',
  'eace468fb6acfd282b9383ce99165a554b50339e031953b2d2152cec121fb5f5',
  'a8203be081cdf98809ad645d521babe0d753791bc77ac555286ea17d1bca6a4f',
]

const rate = 120
const step = 1 / rate
/** Inputs applied before `advance(t)` of the frame they are keyed by. */
type Timeline = Record<number, (motion: Live2DNaturalMotion, t: number) => void>

/** Angry strong at 20 s, happy clear at 40 s (each an impulse plus a hold), release at 50 s. */
const emotionTimeline: Timeline = {
  [20 * rate]: (motion, t) => {
    motion.impulse({ id: 'angry-20', emotion: 'angry', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false }, t)
    motion.setHeldEmotion({ emotion: 'angry', strength: 0.9 }, t)
  },
  [40 * rate]: (motion, t) => {
    motion.impulse({ id: 'happy-40', emotion: 'happy', nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false }, t)
    motion.setHeldEmotion({ emotion: 'happy', strength: 0.6 }, t)
  },
  [50 * rate]: (motion, t) => motion.setHeldEmotion(null, t),
}

/** Simulates the desk fixture at 120 Hz from frame 0 to `seconds` inclusive and hashes every frame. */
function run(seed: number, seconds: number, timeline: Timeline, options: { observer?: NaturalMotionObserver, setup?: (motion: Live2DNaturalMotion) => void } & Pick<Live2DNaturalMotionOptions, 'emotionTable'> = {}) {
  const motion = new Live2DNaturalMotion({ seed, home: 'desk', emotionTable: options.emotionTable })
  options.setup?.(motion)
  if (options.observer)
    motion.setObserver(options.observer)
  const hash = createHash('sha256')
  for (let frame = 0; frame <= seconds * rate; frame++) {
    const t = frame / rate
    timeline[frame]?.(motion, t)
    const { pose, fixation, face, blink, breath } = motion.advance(t)
    hash.update(`${JSON.stringify({ pose, fixation, face, blink, breath })}\n`)
  }
  return hash.digest('hex')
}

function recorder() {
  const events: NaturalMotionEvent[] = []
  return { events, observer: (event: NaturalMotionEvent) => events.push(event) }
}

/** Mean of `browLY - browRY` over `[from, to]` s after `input` runs at `at` s. */
function browAsymmetry(seed: number, at: number, from: number, to: number, input: (motion: Live2DNaturalMotion, t: number) => void) {
  const { events, observer } = recorder()
  const motion = new Live2DNaturalMotion({ seed, home: 'desk' })
  motion.setObserver(observer)
  let sum = 0
  let count = 0
  for (let frame = 0; frame <= to * rate; frame++) {
    const t = frame / rate
    if (frame === at * rate)
      input(motion, t)
    const { face } = motion.advance(t)
    if (t >= from) {
      sum += face.browLY - face.browRY
      count++
    }
  }
  return { asymmetry: sum / count, events }
}

describe('natural motion observer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([1, 2, 3])('keeps 600 s of idle frames bit-identical with and without an observer for seed %i', (seed) => {
    const { events, observer } = recorder()

    expect(run(seed, 600, {})).toBe(idleHashes[seed - 1])
    expect(run(seed, 600, {}, { observer })).toBe(idleHashes[seed - 1])
    expect(events).toEqual([])
  }, 30_000)

  it.each([1, 2, 3])('keeps the emotion timeline bit-identical with and without an observer for seed %i', (seed) => {
    const { events, observer } = recorder()

    expect(run(seed, 60, emotionTimeline)).toBe(emotionHashes[seed - 1])
    expect(run(seed, 60, emotionTimeline, { observer })).toBe(emotionHashes[seed - 1])
    expect(events.map(event => event.kind)).toEqual(['impulse', 'gesture', 'hold', 'impulse', 'gesture', 'hold', 'hold'])
  })

  it('reports impulses, gestures, and holds at the grid step that performs them', () => {
    const { events, observer } = recorder()
    run(1, 60, emotionTimeline, { observer })
    const side = expect.any(Number)

    expect(events).toEqual([
      { kind: 'impulse', at: expect.any(Number), emotion: 'angry', band: 'strong', intensity: 0.9, side },
      { kind: 'gesture', at: expect.any(Number), gesture: expect.stringMatching(/^(?:shake|drop)$/), side },
      { kind: 'hold', at: expect.any(Number), emotion: 'angry', strength: 0.9, side },
      { kind: 'impulse', at: expect.any(Number), emotion: 'happy', band: 'clear', intensity: 0.6, side },
      { kind: 'gesture', at: expect.any(Number), gesture: 'laugh', side },
      { kind: 'hold', at: expect.any(Number), emotion: 'happy', strength: 0.6, side },
      { kind: 'hold', at: expect.any(Number), emotion: null, strength: 0, side: null },
    ])
    expect(events.slice(0, 6).every(event => 'side' in event && (event.side === -1 || event.side === 1))).toBe(true)
    // Inputs before `advance(t)` start on the first grid step at or after `t`.
    for (const [index, input] of [20, 20, 20, 40, 40, 40, 50].entries()) {
      expect(events[index].at).toBeGreaterThanOrEqual(input - 1e-9)
      expect(events[index].at).toBeLessThan(input + step + 1e-9)
    }
  })

  it.each([1, 2, 3])('reports the hold side the face shows for seed %i', (seed) => {
    // Held think raises one brow by 0.4: side 1 raises the left brow.
    const { asymmetry, events } = browAsymmetry(seed, 1, 4, 6, (motion, t) => motion.setHeldEmotion({ emotion: 'think', strength: 1 }, t))
    const hold = events.find(event => event.kind === 'hold')

    expect(hold?.kind === 'hold' && hold.side).toBe(Math.sign(asymmetry))
    expect(Math.abs(asymmetry)).toBeGreaterThan(0.2)
  })

  it.each([1, 2, 3])('reports the impulse side the face shows for seed %i', (seed) => {
    // A question impulse raises one brow by 0.25 x intensity: a negative side raises the left brow.
    const { asymmetry, events } = browAsymmetry(seed, 1, 1.3, 2, (motion, t) => motion.impulse({ id: 'question', emotion: 'question', nominal: 0.9, intensity: 0.9, band: 'clear', escalation: false }, t))
    const impulse = events.find(event => event.kind === 'impulse')

    expect(impulse?.kind === 'impulse' && impulse.side).toBe(-Math.sign(asymmetry))
    expect(Math.abs(asymmetry)).toBeGreaterThan(0.1)
  })

  it('keeps motion and later reports intact when the observer throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const observer = vi.fn(() => {
      throw new Error('observer fixture failure')
    })

    expect(run(1, 60, emotionTimeline, { observer })).toBe(emotionHashes[0])
    expect(observer).toHaveBeenCalledTimes(7)
    expect(error).toHaveBeenCalledTimes(7)
    expect(error).toHaveBeenCalledWith('[natural-motion] The observer failed:', 'observer fixture failure')
  })

  it('reports the current hold on attach and nothing after detach', () => {
    const { events, observer } = recorder()
    const timeline: Timeline = {
      ...emotionTimeline,
      [30 * rate]: motion => motion.setObserver(observer),
      [35 * rate]: motion => motion.setObserver(null),
    }

    expect(run(1, 60, timeline)).toBe(emotionHashes[0])
    expect(events).toEqual([{ kind: 'hold', at: expect.any(Number), emotion: 'angry', strength: 0.9, side: expect.any(Number) }])
    // Attaching does not advance time: the report comes from the next grid step, which starts within one step of 30 s.
    expect(Math.abs(events[0].at - 30)).toBeLessThanOrEqual(step + 1e-9)
  })

  it('reports impulses but no holds or gestures while held emotions are off', () => {
    const { events, observer } = recorder()
    const setup = (motion: Live2DNaturalMotion) => motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
    run(1, 60, emotionTimeline, { observer, setup })

    expect(events.map(event => event.kind)).toEqual(['impulse', 'impulse'])
  })

  it('performs the injected recipe table', () => {
    const { events, observer } = recorder()
    const empty = Object.fromEntries(Object.keys(naturalEmotions).map(emotion => [emotion, { mood: [0, 0, 0] as const }])) as typeof naturalEmotions

    expect(run(1, 60, emotionTimeline, { emotionTable: naturalEmotions })).toBe(emotionHashes[0])
    // Without recipes no emotion performs anything, so the timeline replays idle motion exactly.
    expect(run(1, 60, emotionTimeline, { emotionTable: empty, observer })).toBe(run(1, 60, {}))
    expect(events).toEqual([])
  })
})
