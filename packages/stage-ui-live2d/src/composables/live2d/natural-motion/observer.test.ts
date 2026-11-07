import type { NaturalMotionEvent, NaturalMotionObserver, NaturalMotionOptions } from '@proj-airi/motion-driver-natural/frame-types'

import { createHash } from 'node:crypto'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SHA-256 per seed over each frame's serialized output; pins come from Node Vitest.
// Pins reflect face low-pass, boost removal, duck, laugh, slow-head eye compensation, and the idle reshape
// (continuous retune, human holds, activity spells, realigning postponement, talking amplitude 1.4).
// The darwin-arm64 pins were re-pinned for the idle reshape on an M2 Mac (Node 26.11.1) on 2026-11-07.
// Darwin x64 and arm64 libm differ in the last bit; arm64 measurements: task-1-observer-rootcause.txt.
const idleHashes = process.platform === 'darwin' && process.arch === 'arm64'
  ? [
      'e37af22e8490c0c659418326f19d218b8d0a7347c8a0564272c5cf2f5acb61f8',
      'fd8addaebb260b5ed3fd7642f04c502c6e9c64d92e81f12331778713a51ec433',
      '6bdb3ba1007b8e22881ffe2dc43f98c1ee015b80e3d4584b9f27b31812248b20',
    ]
  : [
      '1f1f413dbdd2026b06c32385d2948395b8d53557b6e459aa188eb1df95e08b1c',
      '86aef4d07d8f2094cdfa223c4a9807a23a1549577930e7e1cd7b8a4800c884b8',
      'b462b2f9f881b2a6c3168fa7f8accddc9abb24a30d6ee1247fe655c833003f72',
    ]
const emotionHashes = process.platform === 'darwin' && process.arch === 'arm64'
  ? [
      '70d0b16f596f5dbcfeb2974f3b2daa2213e72d0425476c529876f98d9dc6bdf7',
      'f849923ad033e2ba9c607894adc1f72517267cc70cde3e2f91a015f4861c73fd',
      '83cc7947d9bae3b972fb754bf3d22a8d6baae597125823fc6d7c9a64d7bd3fdd',
    ]
  : [
      '590cdad69d46134b262a97e38749cdb03188de066450eea37b427a50fb80bd40',
      'e81f99030586d9090f8c9edac82006de8430c5c273b6760c12834226ee0b34c1',
      '00ffb326c8313f9722d799101672654cd8528cb7d199106e4a9b4aec56e86b81',
    ]

const rate = 120
const step = 1 / rate
/** Inputs applied before `advance(t)` of the frame they are keyed by. */
type Timeline = Record<number, (motion: NaturalMotion, t: number) => void>

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
function run(seed: number, seconds: number, timeline: Timeline, options: { observer?: NaturalMotionObserver, setup?: (motion: NaturalMotion) => void } & Pick<NaturalMotionOptions, 'emotionTable'> = {}) {
  const motion = new NaturalMotion({ seed, home: 'desk', emotionTable: options.emotionTable })
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
function browAsymmetry(seed: number, at: number, from: number, to: number, input: (motion: NaturalMotion, t: number) => void) {
  const { events, observer } = recorder()
  const motion = new NaturalMotion({ seed, home: 'desk' })
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
  it.each([1, 2, 3])('keeps interleaved null chat bit-identical to idleHashes for seed %i', (seed) => {
    const timeline: Timeline = {}
    for (let second = 0; second <= 600; second++)
      timeline[second * rate] = (motion, t) => motion.setChat(null, t)
    expect(run(seed, 600, timeline)).toBe(idleHashes[seed - 1])
  }, 30_000)

  it.each([1, 2, 3])('keeps interleaved null and centered placement bit-identical to idleHashes for seed %i', (seed) => {
    const timeline: Timeline = {}
    for (let second = 0; second <= 600; second++)
      timeline[second * rate] = (motion, t) => motion.setPlacement(second % 2 === 0 ? null : 0, t)
    expect(run(seed, 600, timeline)).toBe(idleHashes[seed - 1])
  }, 30_000)

  it('reports eased placement yaw and exactly one zero event when disabled', () => {
    const { events, observer } = recorder()
    const motion = new NaturalMotion({ seed: 1, home: 'desk' })
    motion.setObserver(observer)
    motion.advance(0)
    motion.setPlacement(1, 1)
    for (let frame = rate + 1; frame < 30 * rate; frame++)
      motion.advance(frame / rate)
    const placement = events.filter(event => event.kind === 'placement')
    expect(placement.length).toBeGreaterThan(0)
    const last = placement.at(-1)!
    expect(last.yawBias).toBeGreaterThanOrEqual(0.095)
    expect(last.yawBias).toBeLessThanOrEqual(0.105)
    expect(last.inward).toBeCloseTo(last.yawBias / 0.1, 12)
    motion.setPlacement(null, 30)
    motion.advance(30 + step)
    const disabled = events.filter(event => event.kind === 'placement' && event.yawBias === 0)
    expect(disabled).toEqual([{ kind: 'placement', at: 30, inward: 0, yawBias: 0 }])
  })

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
    const setup = (motion: NaturalMotion) => motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
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
