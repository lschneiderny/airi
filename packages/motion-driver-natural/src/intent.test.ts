import type { NaturalBodyIntent, NaturalMotionEvent, NaturalMotionFrame } from './frame-types'

import { Buffer } from 'node:buffer'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { impulseEnvelope } from './impulses'
import { NaturalMotion } from './natural-motion'
import { createRandomStream, deriveSeed } from './random'
import { NaturalSpeechEmphasis } from './speech-emphasis'

const dt = 1 / 120
const idle = { mode: 'idle', attention: 'camera', away: false } as const

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
    motion.impulse({ id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false, gesture: 'laugh' }, time)
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

  it('plays an emotion gesture only when the episode carries the mind\'s order', () => {
    const ordered = new NaturalMotion({ seed: 41 })
    const unordered = new NaturalMotion({ seed: 41 })
    const episode = { id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false } as const
    ordered.advance(0)
    unordered.advance(0)
    ordered.impulse({ ...episode, gesture: 'laugh' }, 0)
    unordered.impulse(episode, 0)
    ordered.advance(0.1)
    unordered.advance(0.1)
    expect(ordered.bodyIntent().gesture).toMatchObject({ kind: 'laugh' })
    expect(unordered.bodyIntent().impulse).toMatchObject({ emotion: 'happy' })
    expect(unordered.bodyIntent().gesture).toBeNull()
  })

  it('numbers accepted impulses and emotion gestures independently of observer attachment and refusals', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const episode = { id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false } as const
    motion.advance(0)
    expect(motion.bodyIntent().impulse).toBeNull()
    // The mind orders the laugh with a new episode and none with its escalation inside the laugh cooldown.
    motion.impulse({ ...episode, gesture: 'laugh' }, 0)
    motion.impulse({ ...episode, gesture: 'laugh' }, 0)
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
    motion.impulse({ ...episode, id: 'next', gesture: 'laugh' }, 5)
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
    motion.react('wake', 0)
    motion.react('screen-change', 0)
    motion.advance(2 * dt)
    const started = motion.bodyIntent()
    expect(started.cue).toMatchObject({ seq: 2, kind: 'glance', start: dt })
    expect(started.touch.poke).toEqual({ seq: 2, at: dt, region: 'body', x: 0.7, y: 0.2 })
    expect(started.impulse).toMatchObject({ seq: 1, emotion: 'surprised', intensity: 1 })
    expect(started.react).toEqual({ seq: 2, at: dt, kind: 'screen-change' })
    motion.setPerformance(idle, 0.5, 0.1)
    motion.advance(1)
    const later = motion.bodyIntent()
    expect(later.react).toEqual(started.react)
    expect(later.touch.poke).toEqual(started.touch.poke)
    expect(later.energy.reactingUntil).toBe(dt + 2)
  })

  it('starts no desktop reaction from setPerformance', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPerformance(idle, 0.5, 0)
    motion.setPerformance({ ...idle, away: true }, 0.5, 0.5)
    motion.setPerformance(idle, 0.5, 1)
    motion.advance(2)
    expect(motion.bodyIntent().react).toBeNull()
  })

  it('stays asleep when away turns false alone, and wakes when asked', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setIdleDrive({ energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 0 }, 0)
    motion.setPerformance({ ...idle, away: true }, 0.5, 0)
    // The character mind decides the sleep; Natural performs it.
    motion.idle({ id: 'sleep', kind: 'act', act: 'sleep', seed: 1, requested: false }, 0)
    for (let step = 0; step <= 45 * 60; step++)
      motion.advance(step / 60)
    expect(motion.idleState.behaviour).toBe('sleep')
    motion.setPerformance(idle, 0.5, 45)
    for (let step = 1; step <= 4 * 60; step++)
      motion.advance(45 + step / 60)
    expect(motion.idleState.behaviour).toBe('sleep')
    motion.wake(49)
    motion.advance(49.1)
    expect(motion.idleState.behaviour).not.toBe('sleep')
  })

  it('glances at the screen when asked to react to a screen change', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPerformance(idle, 0.5, 0)
    const glances: Extract<NaturalMotionEvent, { kind: 'glance' }>[] = []
    motion.setObserver((event) => {
      if (event.kind === 'glance')
        glances.push(event)
    })
    motion.react('screen-change', 0)
    motion.advance(2 * dt)
    expect(glances).toEqual([expect.objectContaining({ at: dt, cause: 'screen-change', hold: 0.4 })])
    expect(motion.bodyIntent().react).toEqual({ seq: 1, at: dt, kind: 'screen-change' })
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

describe('the beat in the controller', () => {
  const drive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }
  const sway = (id: string, seed = 21) => ({ id, kind: 'act', act: 'sway', seed, requested: true }) as const

  /** A controller at 60 fps that hears 120 BPM over [from, to) seconds, each beat at the first frame after it. */
  function metronome(motion: NaturalMotion, from: number, to: number, script: (time: number) => void = () => {}) {
    const events: NaturalMotionEvent[] = []
    motion.setObserver(event => events.push(event))
    let nextBeat = from
    const phases: (number | null)[] = []
    for (let frame = 1; frame <= to * 60; frame++) {
      const now = frame / 60
      if (now >= nextBeat && nextBeat < to) {
        motion.beat(0.5, now)
        nextBeat += 0.5
      }
      script(now)
      motion.advance(now)
      phases.push(motion.bodyIntent().idle.groovePhase)
    }
    motion.setObserver(null)
    return { events: events.filter(event => event.kind === 'groove-lock'), phases }
  }

  function controller() {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setIdleDrive(drive, 0)
    motion.setPerformance(idle, 0.5, 0)
    motion.advance(0)
    return motion
  }

  it('locks a sway to beats it heard, with one event per bind and its phase through the release', () => {
    const motion = controller()
    let releasedAt = 0
    const { events, phases } = metronome(motion, 1, 30, (now) => {
      if (now === 6)
        motion.idle(sway('a'), now)
      if (now === 10)
        motion.setPerformance({ ...idle, mode: 'talking' }, 0.5, now)
      if (now === 11)
        motion.setPerformance(idle, 0.5, now)
      if (now === 15)
        motion.idle(sway('b', 22), now)
      if (motion.bodyIntent().idle.behaviour?.seq === 2 && motion.bodyIntent().idle.behaviour?.releasedAt != null && releasedAt === 0)
        releasedAt = now
    })
    expect(events).toEqual([
      { kind: 'groove-lock', at: expect.closeTo(6, 1), beatSeconds: 0.5, beatsPerCycle: 4 },
      { kind: 'groove-lock', at: expect.closeTo(15, 1), beatSeconds: 0.5, beatsPerCycle: 4 },
    ])
    expect(phases.slice(0, 6 * 60 - 1).every(phase => phase === null)).toBe(true)
    expect(phases.slice(6 * 60, 10 * 60).every(phase => typeof phase === 'number')).toBe(true)
    // The talking interruption releases the sway over 0.4 s; its phase lasts as long as the release.
    expect(typeof phases[10 * 60 + 12]).toBe('number')
    expect(phases.slice(10 * 60 + 30, 15 * 60 - 1).every(phase => phase === null)).toBe(true)
  })

  it('binds nothing after a suspension, which drops beats and clears the clock', () => {
    const cleared = controller()
    metronome(cleared, 1, 6)
    cleared.setSuspended(true, 6)
    cleared.setSuspended(false, 6)
    cleared.idle(sway('a'), 6)
    cleared.advance(6.1)
    expect(cleared.bodyIntent().idle.behaviour?.kind).toBe('sway')
    expect(cleared.bodyIntent().idle.groovePhase).toBeNull()

    const dropped = controller()
    dropped.setSuspended(true, 0)
    for (let beat = 0; beat < 10; beat++)
      dropped.beat(0.5, 1 + beat / 2)
    dropped.setSuspended(false, 6)
    dropped.idle(sway('a'), 6)
    dropped.advance(6.1)
    expect(dropped.bodyIntent().idle.groovePhase).toBeNull()
  })

  it('never snaps the head or the body through a bound sway, a tempo step, a lost beat, and an interruption', () => {
    const channels = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'] as const
    for (const interrupted of [false, true]) {
      const motion = controller()
      let previous = motion.advance(0)
      let fastest = 0
      let nextBeat = 1
      for (let step = 1; step <= 40 * 120; step++) {
        const now = step / 120
        // 120 BPM, then 128 BPM from 21 s, then silence from 24 s, all inside the sway's shortest length of 8 s.
        const interval = nextBeat < 21 ? 0.5 : 60 / 128
        if (now >= nextBeat && nextBeat < 24) {
          motion.beat(interval, now)
          nextBeat += interval
        }
        if (step === 18 * 120)
          motion.idle(sway('a', 31), now)
        if (interrupted && step === 25.5 * 120)
          motion.setPerformance({ ...idle, mode: 'talking' }, 0.5, now)
        const frame = motion.advance(now)
        for (const channel of channels)
          fastest = Math.max(fastest, Math.abs((frame.pose[channel] ?? 0) - (previous.pose[channel] ?? 0)) * 120)
        previous = frame
      }
      expect(fastest, interrupted ? 'interrupted' : 'ran its course').toBeLessThan(6)
    }
  })
})
