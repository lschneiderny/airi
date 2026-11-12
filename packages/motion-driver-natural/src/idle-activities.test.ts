import type { NaturalMotionEvent } from './frame-types'
import type { IdleBehaviourKind, IdleStepInput, NaturalIdleDrive } from './idle-activities'

import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { idleActivityRate, idleActivityWeights, idleEnergyOffset, NaturalIdleActivities } from './idle-activities'
import { NaturalMotion } from './natural-motion'
import { createRandomStream } from './random'

const dt = 1 / 120
const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 }
const idleInput: IdleStepInput = { mode: 'idle', away: false, blocked: false, interrupt: false, rouse: false, placement: 0, screenPoint: { x: 0, y: -0.18 } }
const idleState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' } as const

function layer(seed = 7, drive: NaturalIdleDrive | null = neutralDrive) {
  const idle = new NaturalIdleActivities(createRandomStream(seed))
  const gaze = new NaturalGazeLayer(createRandomStream(4))
  idle.setDrive(drive)
  let at = 0
  /** Steps until `until` seconds or until `stop` holds, and returns the time reached. */
  const run = (until: number, input: IdleStepInput = idleInput, stop?: () => boolean) => {
    while (at < until) {
      idle.step(at, dt, input, gaze)
      gaze.step(dt)
      at += dt
      if (stop?.())
        break
    }
    return at
  }
  return { idle, gaze, run, now: () => at }
}

/** Runs a controller for `seconds` at 60 fps and returns the idle events it reported. */
function observe(motion: NaturalMotion, from: number, seconds: number) {
  const events: Extract<NaturalMotionEvent, { kind: 'idle' }>[] = []
  motion.setObserver((event) => {
    if (event.kind === 'idle')
      events.push(event)
  })
  for (let frame = 1; frame <= seconds * 60; frame++)
    motion.advance(from + frame / 60)
  motion.setObserver(null)
  return events
}

describe('idle activity odds', () => {
  it('favours yawns, zoning out and nodding off when she is tired', () => {
    const rested = idleActivityWeights(neutralDrive, { watching: false })
    const tired = idleActivityWeights({ ...neutralDrive, sleepiness: 0.9 }, { watching: false })
    expect(rested['nod-off']).toBe(0)
    expect(tired['nod-off']).toBeGreaterThan(0)
    expect(tired.yawn).toBeGreaterThan(5 * rested.yawn)
    expect(tired['zone-out']).toBeGreaterThan(rested['zone-out'])
    expect(tired['look-around']).toBeLessThan(rested['look-around'])
  })

  it('watches the screen more while the user is active and checks in more after a long silence', () => {
    expect(idleActivityWeights(neutralDrive, { watching: true }).peer).toBeGreaterThan(3 * idleActivityWeights(neutralDrive, { watching: false }).peer)
    expect(idleActivityWeights({ ...neutralDrive, solitude: 1 }, { watching: false })['check-in'])
      .toBeGreaterThan(1.5 * idleActivityWeights(neutralDrive, { watching: false })['check-in'])
  })

  it('sways only while music plays', () => {
    expect(idleActivityWeights(neutralDrive, { watching: false }).sway).toBe(0)
    expect(idleActivityWeights({ ...neutralDrive, music: true }, { watching: false }).sway).toBeGreaterThan(0)
  })

  it('paces activities by mood energy and the host rate, and treats bad numbers as neutral', () => {
    const base = idleActivityRate(neutralDrive, { watching: false })
    expect(idleActivityRate({ ...neutralDrive, energy: 1 }, { watching: false })).toBeGreaterThan(base)
    expect(idleActivityRate({ ...neutralDrive, energy: -1 }, { watching: false })).toBeLessThan(base)
    expect(idleActivityRate({ ...neutralDrive, rate: 0 }, { watching: false })).toBe(0)
    expect(idleActivityRate(neutralDrive, { watching: true })).toBeLessThan(base)
    expect(idleActivityRate({ ...neutralDrive, energy: Number.NaN }, { watching: false })).toBe(base)
  })

  it('moves the Natural energy with the slow mood and the hour, and not at all without a drive', () => {
    expect(idleEnergyOffset(null)).toBe(0)
    expect(idleEnergyOffset(neutralDrive)).toBe(0)
    expect(idleEnergyOffset({ ...neutralDrive, energy: 1 })).toBeCloseTo(0.3)
    expect(idleEnergyOffset({ ...neutralDrive, sleepiness: 1 })).toBeCloseTo(-0.15)
  })
})

describe('idle activity layer', () => {
  it('stays inert without a drive', () => {
    const { idle, run } = layer(7, null)
    run(600)
    expect(idle.seq).toBe(0)
    expect(idle.contributing).toBe(false)
    expect(idle.output.lidClose).toBe(0)
  })

  it('starts varied activities, rests between them, and returns to neutral after each', () => {
    const { idle, run, now } = layer()
    const seen: IdleBehaviourKind[] = []
    let endedAt = 0
    let seq = 0
    let previous: IdleBehaviourKind | null = null
    run(1800, idleInput, () => {
      if (idle.seq !== seq) {
        seq = idle.seq
        // The rest after an activity is at least 6 s.
        if (seen.length > 0)
          expect(now() - endedAt).toBeGreaterThanOrEqual(6 - dt)
        seen.push(idle.behaviour!)
      }
      if (previous !== null && idle.behaviour === null) {
        endedAt = now()
        // A finished activity hands every channel back without a jump.
        expect(Math.max(...idle.output.head.map(Math.abs), ...idle.output.body.map(Math.abs), idle.output.lidClose, idle.output.mouthOpen)).toBeLessThan(0.02)
      }
      previous = idle.behaviour
      return false
    })
    // Half an hour holds a few dozen activities of at least four kinds, never the same one twice in a row.
    expect(seen.length).toBeGreaterThan(12)
    expect(seen.length).toBeLessThan(60)
    expect(new Set(seen).size).toBeGreaterThanOrEqual(4)
    expect(seen.some((kind, i) => i > 0 && kind === seen[i - 1])).toBe(false)
    // A rested, daytime character never nods off or sways to music that is not playing.
    expect(seen).not.toContain('nod-off')
    expect(seen).not.toContain('sway')
    expect(seen).not.toContain('sleep')
  })

  it('replays the same activities for the same seed', () => {
    const sequence = (seed: number) => {
      const { idle, run } = layer(seed)
      const seen: string[] = []
      let seq = 0
      run(900, idleInput, () => {
        if (idle.seq !== seq) {
          seq = idle.seq
          seen.push(`${idle.behaviour}@${idle.seq}`)
        }
        return false
      })
      return seen
    }
    expect(sequence(11)).toEqual(sequence(11))
    expect(sequence(11)).not.toEqual(sequence(12))
  })

  it('yields at once to an interruption and fades out within 0.4 s', () => {
    const { idle, gaze, run, now } = layer()
    run(900, idleInput, () => idle.behaviour !== null && idle.contributing && Math.hypot(...idle.output.head) > 0.05)
    expect(idle.behaviour).not.toBeNull()
    idle.step(now(), dt, { ...idleInput, interrupt: true }, gaze)
    expect(idle.behaviour).toBeNull()
    expect(idle.eyesOwned(now())).toBe(false)
    const startedAt = now()
    run(startedAt + 0.45)
    expect(idle.contributing).toBe(false)
    expect(idle.output.head).toEqual([0, 0, 0])
  })

  it('starts nothing while another layer owns her, and ends an activity when she starts to talk', () => {
    const blocked = layer()
    blocked.run(600, { ...idleInput, blocked: true })
    expect(blocked.idle.seq).toBe(0)

    const { idle, gaze, run, now } = layer()
    run(900, idleInput, () => idle.behaviour !== null)
    idle.step(now(), dt, { ...idleInput, mode: 'talking' }, gaze)
    expect(idle.behaviour).toBeNull()
  })

  it('falls asleep while the user is away and wakes when they return', () => {
    const { idle, run, now } = layer()
    const away = { ...idleInput, away: true }
    run(31, away, () => idle.behaviour === 'sleep')
    expect(idle.behaviour).toBe('sleep')
    // She does not fall asleep the moment the user leaves.
    expect(now()).toBeGreaterThan(12)
    run(now() + 8, away)
    expect(idle.output.lidClose).toBeCloseTo(1, 5)
    expect(idle.output.head[1]).toBeLessThan(-0.3)
    expect(idle.output.breathPeriodScale).toBeGreaterThan(1.3)
    // Sleep lasts as long as the absence; a busy screen does not wake her.
    run(now() + 600, { ...away, interrupt: true })
    expect(idle.behaviour).toBe('sleep')
    const wokeAt = run(now() + dt, idleInput)
    expect(idle.behaviour).toBeNull()
    run(wokeAt + 1.7, { ...idleInput, blocked: true })
    expect(idle.output.lidClose).toBe(0)
  })

  it('wakes with a start when she is touched', () => {
    const { idle, gaze, run, now } = layer()
    const away = { ...idleInput, away: true }
    run(31, away, () => idle.behaviour === 'sleep')
    run(now() + 8, away)
    idle.step(now(), dt, { ...away, interrupt: true, rouse: true }, gaze)
    expect(idle.behaviour).toBeNull()
    run(now() + 0.4, { ...away, blocked: true })
    expect(idle.output.lidClose).toBe(0)
  })

  it('never sleeps when the renderer plays its own sleep stance', () => {
    const { idle, run } = layer(7, { ...neutralDrive, allowSleep: false })
    run(300, { ...idleInput, away: true })
    expect(idle.seq).toBe(0)
  })

  it('holds a look at the user before a reach-out and lets it go when she stays silent', () => {
    const { idle, gaze, run, now } = layer(7, { ...neutralDrive, rate: 0 })
    run(1)
    idle.cue('about-to-speak')
    run(2)
    expect(idle.behaviour).toBe('about-to-speak')
    expect(idle.eyesOwned(now())).toBe(true)
    expect(idle.output.head[1]).toBeGreaterThan(0.04)
    // Thinking about her own turn does not end the hold.
    run(3, { ...idleInput, mode: 'thinking' })
    expect(idle.behaviour).toBe('about-to-speak')
    idle.cue('let-go')
    run(now() + 0.8)
    expect(idle.behaviour).toBe('let-go')
    expect(idle.output.head[1]).toBeLessThan(0)
    run(now() + 3)
    expect(idle.behaviour).toBeNull()
    // A second let-go has no hold left to answer.
    idle.cue('let-go')
    idle.step(now(), dt, idleInput, gaze)
    expect(idle.behaviour).toBeNull()
  })

  it('drops the hold when she speaks, and still lets go when the decision comes after the hold ran out', () => {
    const speaking = layer(7, { ...neutralDrive, rate: 0 })
    speaking.idle.cue('about-to-speak')
    speaking.run(1)
    speaking.idle.step(speaking.now(), dt, { ...idleInput, mode: 'talking' }, speaking.gaze)
    expect(speaking.idle.behaviour).toBeNull()

    const slow = layer(7, { ...neutralDrive, rate: 0 })
    slow.idle.cue('about-to-speak')
    slow.run(11)
    expect(slow.idle.behaviour).toBeNull()
    slow.idle.cue('let-go')
    slow.run(11.5)
    expect(slow.idle.behaviour).toBe('let-go')
  })
})

describe('idle activities in the controller', () => {
  it('leaves the motion unchanged without a drive, and with a drive that starts nothing', () => {
    const plain = new NaturalMotion({ seed: 41 })
    const off = new NaturalMotion({ seed: 41 })
    const quiet = new NaturalMotion({ seed: 41 })
    off.setIdleDrive(null, 0)
    quiet.setIdleDrive({ ...neutralDrive, rate: 0, allowSleep: false }, 0)
    // Every controller takes its time origin from its first call.
    plain.advance(0)
    for (let frame = 1; frame <= 60 * 60; frame++) {
      const expected = plain.advance(frame / 60)
      expect(off.advance(frame / 60)).toEqual(expected)
      expect(quiet.advance(frame / 60)).toEqual(expected)
    }
  })

  it('reports each activity once as a start and an end, in order', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setIdleDrive(neutralDrive, 0)
    motion.setPerformance(idleState, 0.5, 0)
    const events = observe(motion, 0, 900)
    expect(events.length).toBeGreaterThan(6)
    events.forEach((event, index) => {
      expect(event.phase).toBe(index % 2 === 0 ? 'start' : 'end')
      if (event.phase === 'end')
        expect(event.behaviour).toBe(events[index - 1].behaviour)
    })
    expect(motion.idleState.seq).toBe(Math.ceil(events.length / 2))
  })

  it('closes her eyes while the user is away and opens them when they are back', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setIdleDrive({ ...neutralDrive, rate: 0 }, 0)
    motion.setPerformance({ ...idleState, away: true }, 0.5, 0)
    let frame = motion.advance(0)
    for (let step = 1; step <= 45 * 60; step++)
      frame = motion.advance(step / 60)
    expect(motion.idleState.behaviour).toBe('sleep')
    expect(frame.blink.blinkFactor).toBeLessThan(1e-6)
    expect(frame.pose.headY).toBeLessThan(-0.2)
    motion.setPerformance(idleState, 0.5, 45)
    let open = 0
    for (let step = 1; step <= 4 * 60; step++)
      open = Math.max(open, motion.advance(45 + step / 60).blink.blinkFactor)
    expect(motion.idleState.behaviour).not.toBe('sleep')
    expect(open).toBe(1)
  })

  it('yawns with an open mouth in silence, and keeps the mouth with speech while she talks', () => {
    const tired = { ...neutralDrive, sleepiness: 1, energy: -1 }
    const peakMouth = (speaking: boolean) => {
      const motion = new NaturalMotion({ seed: 5 })
      motion.setIdleDrive(tired, 0)
      motion.setPerformance(idleState, 0.5, 0)
      motion.setVoice({ speaking: false, speechActiveOrRecent: speaking, level: 0 })
      let peak = 0
      let yawned = false
      for (let step = 1; step <= 600 * 60; step++) {
        const frame = motion.advance(step / 60)
        if (motion.idleState.behaviour === 'yawn') {
          yawned = true
          peak = Math.max(peak, frame.face.silentMouthOpen)
        }
      }
      expect(yawned).toBe(true)
      return peak
    }
    expect(peakMouth(false)).toBeGreaterThan(0.6)
    expect(peakMouth(true)).toBe(0)
  })

  it('keeps every pose channel in range through half an hour of activities', () => {
    const motion = new NaturalMotion({ seed: 9 })
    motion.setIdleDrive({ ...neutralDrive, sleepiness: 0.8, music: true, energy: 0.4 }, 0)
    motion.setPerformance(idleState, 0.5, 0)
    for (let step = 1; step <= 1800 * 30; step++) {
      const { pose, blink } = motion.advance(step / 30)
      for (const value of Object.values(pose))
        expect(Math.abs(value ?? 0)).toBeLessThanOrEqual(1)
      expect(blink.blinkFactor).toBeGreaterThanOrEqual(0)
      expect(blink.blinkFactor).toBeLessThanOrEqual(1)
    }
  })
})
