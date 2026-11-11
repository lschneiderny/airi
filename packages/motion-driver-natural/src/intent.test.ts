import type { NaturalBodyIntent, NaturalMotionFrame } from './frame-types'

import { Buffer } from 'node:buffer'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { impulseEnvelope } from './impulses'
import { NaturalMotion } from './natural-motion'
import { createRandomStream, deriveSeed } from './random'
import { NaturalSpeechEmphasis } from './speech-emphasis'

const dt = 1 / 120
const idle = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' } as const

/** Raw IEEE-754 bytes, including signed zero, for every pre-intent numeric output. */
function legacyBytes(frame: NaturalMotionFrame) {
  const values = [frame.pose, frame.face, frame.blink, frame.breath, frame.fixation]
    .flatMap(value => Object.values(value))
    .map(value => value ?? Number.NaN)
  return Buffer.from(new Float64Array(values).buffer)
}

function script(motion: NaturalMotion, time: number) {
  if (time === 10)
    motion.setCursor({ x: 1.4, y: 0.6 }, time)
  if (time === 20)
    motion.setCursor(null, time)
  motion.setVoice({ speaking: time >= 25 && time < 45, speechActiveOrRecent: time >= 25 && time < 46, level: time >= 25 && time < 45 && time % 1.8 < 0.35 ? 0.9 : 0 })
  if (time === 50)
    motion.impulse({ id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false }, time)
  if (time === 60)
    motion.setHeldEmotion({ emotion: 'think', strength: 0.8 }, time)
  if (time === 70)
    motion.setHeldEmotion(null, time)
  if (time === 75)
    motion.gesture('shrug', 1, time)
  if (time === 85)
    motion.poke('head', 0.4, -0.6, time)
  if (time === 95)
    motion.setPet({ x: 0.7, y: -0.4 }, time)
  if (time === 100)
    motion.setPet(null, time)
}

describe('natural body intent', () => {
  it('returns the cached intent on repeated reads without adding any frame property', () => {
    const motion = new NaturalMotion({ seed: 41 })
    expect(() => motion.bodyIntent()).toThrow('Call advance() before reading bodyIntent()')
    const frame = motion.advance(0)
    const { pose, face, blink, breath, fixation } = frame
    const intent = motion.bodyIntent()
    const saved = structuredClone(intent)
    expect(intent.time).toBe(0)
    expect(motion.bodyIntent()).toBe(intent)
    expect(motion.bodyIntent()).toEqual(saved)
    expect(Object.hasOwn(frame, 'intent')).toBe(false)
    expect({ ...frame }).toEqual({ pose, face, blink, breath, fixation })
    expect(JSON.parse(JSON.stringify(frame))).toEqual({ pose, face, blink, breath, fixation })
  })

  it.each([30, 60, 144])('keeps whole frames equal and every output bit-equal for 120 seconds at %i Hz while bodyIntent is read', (rate) => {
    const reader = new NaturalMotion({ seed: 41 })
    const legacy = new NaturalMotion({ seed: 41 })
    reader.setObserver(() => {})
    for (let i = 0; i <= 120 * rate; i++) {
      const time = i / rate
      script(reader, time)
      script(legacy, time)
      const frame = reader.advance(time)
      // Traverse the snapshot while the control never calls the accessor.
      const intent = structuredClone(reader.bodyIntent())
      expect(intent.time).toBeCloseTo(time, 10)
      const controlFrame = legacy.advance(time)
      expect(frame).toStrictEqual(controlFrame)
      expect(legacyBytes(frame).equals(legacyBytes(controlFrame)), `frame ${i}`).toBe(true)
    }
  }, 30_000)

  it('numbers accepted impulses and emotion gestures independently of observer attachment and refusals', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const episode = { id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false } as const
    motion.advance(0)
    expect(motion.bodyIntent().impulse).toBeNull()
    motion.impulse(episode, 0)
    motion.impulse(episode, 0)
    motion.advance(2 * dt)
    const first = motion.bodyIntent()
    expect(first.impulse).toMatchObject({ seq: 1, at: dt, emotion: 'happy', band: 'strong', intensity: 0.9 })
    expect(first.gesture).toMatchObject({ seq: 1, at: dt, kind: 'laugh', scale: 0.9 })
    expect(first.gesture?.lifetime).toBeGreaterThan(1)
    expect([-1, 1]).toContain(first.impulse?.side)
    expect([-1, 1]).toContain(first.gesture?.side)
    motion.setObserver(() => {})
    motion.impulse({ ...episode, intensity: 1, escalation: true }, 0.1)
    motion.advance(0.2)
    const escalated = motion.bodyIntent()
    expect(escalated.impulse).toMatchObject({ seq: 2, emotion: 'happy', intensity: 1, side: first.impulse?.side })
    expect(escalated.gesture).toEqual(first.gesture)
    motion.setObserver(null)
    motion.impulse({ ...episode, id: 'next' }, 5)
    motion.advance(5.1)
    const next = motion.bodyIntent()
    expect(next.impulse?.seq).toBe(3)
    expect(next.gesture?.seq).toBe(2)
    expect(first.impulse?.seq).toBe(1)
  })

  it('counts cue starts exactly once, including deferred starts but excluding duplicates and expiry', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.advance(0)
    motion.gesture('nod', 1, 0)
    motion.gesture('nod', 1, 0)
    motion.gesture('shake', 2, 0)
    motion.advance(2 * dt)
    const first = motion.bodyIntent().cue
    expect(first).toMatchObject({ seq: 1, kind: 'nod', count: 1, start: dt, end: dt + 0.45 })
    expect([-1, 1]).toContain(first?.side)
    motion.advance(0.6)
    const queued = motion.bodyIntent().cue
    expect(queued).toMatchObject({ seq: 2, kind: 'shake', count: 2, start: dt + 0.45 })
    expect(queued?.end).toBe((dt + 0.45) + 1)
    motion.advance(2)
    expect(motion.bodyIntent().cue).toEqual(queued)
    motion.gesture('lean', 1, 2)
    motion.gesture('shrug', 1, 2)
    motion.advance(5)
    expect(motion.bodyIntent().cue).toMatchObject({ seq: 3, kind: 'lean' })
  })

  it('retains the latest disjoint cue and every same-tick poke or desktop reaction in its sequence', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPerformance(idle, 0.5, 0)
    motion.gesture('nod', 1, 0)
    motion.gesture('glance', 1, 0)
    motion.poke('head', -0.4, -0.6, 0)
    motion.poke('body', 0.7, 0.2, 0)
    motion.setPerformance({ ...idle, reactSeq: 1, reactKind: 'wake' }, 0.5, 0)
    motion.setPerformance({ ...idle, reactSeq: 2, reactKind: 'screen-change' }, 0.5, 0)
    motion.advance(2 * dt)
    const started = motion.bodyIntent()
    expect(started.cue).toMatchObject({ seq: 2, kind: 'glance', start: dt })
    expect(started.touch.poke).toEqual({ seq: 2, at: dt, region: 'body', x: 0.7, y: 0.2 })
    expect(started.impulse).toMatchObject({ seq: 1, emotion: 'surprised', intensity: 1 })
    expect(started.react).toEqual({ seq: 2, at: dt, kind: 'screen-change' })
    motion.setPerformance({ ...idle, reactSeq: 2, reactKind: 'screen-change' }, 0.5, 0.1)
    motion.advance(1)
    const later = motion.bodyIntent()
    expect(later.react).toEqual(started.react)
    expect(later.touch.poke).toEqual(started.touch.poke)
    expect(later.energy.reactingUntil).toBe(dt + 2)
  })

  it('exposes each accepted emphasis payload and the detector envelope without consuming them', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false, mood: false })
    const reference = new NaturalSpeechEmphasis(createRandomStream(deriveSeed(41, 10)))
    reference.step(dt, 0, 0.25)
    motion.advance(0)
    let seq = 0
    let referenceTime = dt
    const records: NonNullable<NaturalBodyIntent['voice']['emphasis']>[] = []
    for (let i = 1; i <= 20 * 120; i++) {
      const level = i % 240 < 42 ? 0.9 : 0
      motion.setVoice({ speaking: true, speechActiveOrRecent: true, level })
      // The constructor has already integrated the first tick with silent voice.
      const offset = i === 1 ? [0, 0, 0] : reference.step(dt, level, 0.25)
      if (i > 1)
        referenceTime += dt
      motion.advance(i * dt)
      const voice = motion.bodyIntent().voice
      expect(voice.slow).toBe(reference.slowEnvelope)
      expect(voice.onsetSeq).toBe(reference.onsetCount)
      if (voice.emphasis && voice.emphasis.seq !== seq) {
        expect(voice.emphasis.seq).toBe(seq + 1)
        expect(voice.emphasis.at).toBeCloseTo(referenceTime, 12)
        expect(voice.emphasis.magnitude).toBeGreaterThanOrEqual(0.02)
        expect(voice.emphasis.magnitude).toBeLessThanOrEqual(0.05)
        expect(voice.emphasis.tau).toBeGreaterThanOrEqual(0.25)
        expect(voice.emphasis.tau).toBeLessThanOrEqual(0.5)
        expect(['nod', 'tilt']).toContain(voice.emphasis.kind)
        expect([-1, 1]).toContain(voice.emphasis.side)
        seq = voice.emphasis.seq
        records.push(voice.emphasis)
      }
      const reconstructed = [0, 0, 0]
      for (const record of records) {
        const age = referenceTime - record.at
        if (age <= 15 * record.tau)
          reconstructed[record.kind === 'nod' ? 1 : 2] += impulseEnvelope(age, record.tau) * record.magnitude * (record.kind === 'nod' ? -1 : record.side)
      }
      for (const axis of [0, 1, 2])
        expect(reconstructed[axis]).toBeCloseTo(offset[axis], 12)
    }
    expect(seq).toBe(reference.emphasisCount)
    expect(seq).toBeGreaterThan(0)
  })

  it('sums the six applied terms and posture to the reported head at grid endpoints', () => {
    const motion = new NaturalMotion({ seed: 41 })
    let error = 0
    for (let i = 0; i <= 120 * 120; i++) {
      const time = i * dt
      script(motion, time)
      const frame = motion.advance(time)
      if (i === 0)
        continue // At the origin the displayed pose is the unintegrated home.
      const { head } = motion.bodyIntent()
      for (const [axis, reported] of [frame.pose.headX, frame.pose.headY, frame.pose.headZ].entries()) {
        const sum = head.posture[axis] + head.emphasis[axis] + head.impulse[axis] + head.pet[axis] + head.held[axis] + head.gesture[axis] + head.cue[axis]
        const composed = Math.max(-1, Math.min(1, sum))
        const expected = axis === 1 ? Math.max(-1, Math.min(1, composed + frame.breath.headY)) : composed
        error = Math.max(error, Math.abs(expected - reported))
      }
    }
    expect(error).toBeLessThan(1e-10)
  })

  it('reports eased pet state and freezes intent during suspension without retaining mutable frame data', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.advance(0)
    motion.setPet({ x: 0.7, y: -0.4 }, 0)
    motion.advance(1)
    const pet = motion.bodyIntent()
    expect(pet.touch.pet.active).toBe(true)
    // The request starts after the constructor's already-integrated first tick.
    expect(pet.touch.pet.x).toBeCloseTo(0.7 * (1 - Math.exp(-(1 - dt) / 0.25)), 10)
    expect(pet.touch.pet.y).toBeCloseTo(-0.4 * (1 - Math.exp(-(1 - dt) / 0.25)), 10)
    expect(pet.gaze.on).toBe('pet')
    const saved = structuredClone(pet)
    motion.setSuspended(true, 1)
    motion.advance(10)
    expect(motion.bodyIntent()).toEqual(saved)
    motion.setSuspended(false, 10)
    motion.setPet(null, 10)
    motion.advance(11)
    expect(motion.bodyIntent().touch.pet.active).toBe(false)
    expect(pet).toEqual(saved)
  })
})
