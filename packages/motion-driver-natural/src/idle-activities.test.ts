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

  it('draws the whole-body kinds only for a host that performs a body', () => {
    const bodyKinds = ['sigh', 'shoulder-roll', 'shift-stance', 'clasp-hands', 'hair-touch', 'arm-swing'] as const
    const live2d = idleActivityWeights(neutralDrive, { watching: false })
    const mmd = idleActivityWeights({ ...neutralDrive, body: true }, { watching: false })
    for (const kind of [...bodyKinds, 'heel-rock'] as const)
      expect(live2d[kind], kind).toBe(0)
    for (const kind of bodyKinds)
      expect(mmd[kind], kind).toBeGreaterThan(0)
    // Heel rocks are a bright mood's (architecture 4e act 11).
    expect(mmd['heel-rock']).toBe(0)
    expect(idleActivityWeights({ ...neutralDrive, body: true, valence: 0.5 }, { watching: false })['heel-rock']).toBeGreaterThan(0)
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

  it('draws exactly the activities, at exactly the times, it drew before the whole-body kinds existed when the host performs no body', () => {
    // Recorded at 101fc9543, before the kinds existed (E/g4/a/scratch/base-sequence.ts), with this loop: every start
    // in 900 s for two seeds. The same kinds at the same ticks means the pick consumed no extra draw.
    const base: Record<number, string[]> = { 7: ['stretch@0.525', 'check-in@50.483', 'look-around@122.633', 'peer@181.400', 'look-around@219.833', 'peer@313.675', 'check-in@487.067', 'peer@517.500', 'stretch@583.008', 'zone-out@655.758', 'look-around@764.392', 'peer@793.367', 'look-around@816.892', 'check-in@864.492'], 11: ['check-in@32.242', 'stretch@83.267', 'check-in@126.258', 'look-around@192.267', 'check-in@275.425', 'zone-out@345.508', 'check-in@404.083', 'stretch@442.433', 'check-in@491.317', 'peer@510.683', 'look-around@562.283', 'zone-out@602.725', 'look-around@716.825', 'peer@776.575', 'stretch@843.350', 'check-in@890.383'] }
    for (const seed of [7, 11]) {
      const idle = new NaturalIdleActivities(createRandomStream(seed))
      const gaze = new NaturalGazeLayer(createRandomStream(4))
      idle.setDrive(neutralDrive)
      const seen: string[] = []
      let seq = 0
      for (let at = 0; at < 900; at += dt) {
        idle.step(at, dt, idleInput, gaze)
        gaze.step(dt)
        if (idle.seq !== seq) {
          seq = idle.seq
          seen.push(`${idle.behaviour}@${at.toFixed(3)}`)
        }
      }
      expect(seen, `seed ${seed}`).toEqual(base[seed])
    }
  })

  it('settles in after two minutes of idle only when the host performs a body, and gets up when the mode changes', () => {
    const live2d = layer(7, neutralDrive)
    live2d.run(300)
    expect(live2d.idle.settled).toBe(false)

    const { idle, gaze, run, now } = layer(7, { ...neutralDrive, body: true, rate: 0 })
    run(119)
    expect(idle.settled).toBe(false)
    run(121)
    expect(idle.settled).toBe(true)
    idle.step(now(), dt, { ...idleInput, mode: 'talking' }, gaze)
    expect(idle.settled).toBe(false)
    const talked = now()
    run(talked + 60)
    expect(idle.settled).toBe(false)
    // The count starts again after the interruption: she settles in two minutes after it, not before.
    run(talked + 119)
    expect(idle.settled).toBe(false)
    run(talked + 121)
    expect(idle.settled).toBe(true)
  })

  it('records the running behaviour with its timing and drawn parameters, and keeps it after it ends', () => {
    const { idle, run, now } = layer(7, { ...neutralDrive, rate: 0 })
    expect(idle.record).toBeNull()
    idle.play('look-around')
    run(0.1)
    const record = idle.record!
    expect(record).toMatchObject({ seq: 1, kind: 'look-around', releasedAt: null })
    expect(record.end).toBeGreaterThan(record.start)
    expect(record.glances.length).toBeGreaterThanOrEqual(2)
    expect(record.glances[0].at).toBe(0)
    run(30, idleInput, () => idle.behaviour === null)
    // A finished behaviour ends on its planned end, released without a fade.
    expect(idle.record).toMatchObject({ seq: 1, kind: 'look-around', releaseSeconds: 0 })
    expect(idle.record!.releasedAt).toBeCloseTo(record.end, 1)
    expect(now()).toBeLessThan(30)
  })

  it('marks an interrupted behaviour as released before its end, with its fade', () => {
    const { idle, gaze, run, now } = layer(7, { ...neutralDrive, rate: 0, body: true })
    idle.play('clasp-hands')
    run(1)
    expect(idle.record).toMatchObject({ kind: 'clasp-hands', releasedAt: null })
    expect(idle.record!.end - idle.record!.start).toBeGreaterThanOrEqual(4)
    idle.step(now(), dt, { ...idleInput, interrupt: true }, gaze)
    expect(idle.record).toMatchObject({ kind: 'clasp-hands', releasedAt: now(), releaseSeconds: 0.4 })
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

  it('plays a requested behaviour at once in place of the running one, and drops the request while she is busy', () => {
    const { idle, run, now } = layer()
    idle.play('zone-out')
    run(0.1)
    expect(idle.behaviour).toBe('zone-out')
    idle.play('yawn')
    run(now() + 0.1)
    expect(idle.behaviour).toBe('yawn')
    run(now() + 6)
    expect(idle.behaviour).not.toBe('yawn')

    const busy = layer()
    busy.idle.play('yawn')
    busy.run(0.1, { ...idleInput, mode: 'talking' })
    expect(busy.idle.seq).toBe(0)
    // The request does not wait for her to be free.
    busy.run(0.2)
    expect(busy.idle.behaviour).toBeNull()
  })

  it('plays sleep without the user away and wakes her after 14 s', () => {
    const { idle, run } = layer()
    idle.play('sleep')
    run(8)
    expect(idle.behaviour).toBe('sleep')
    expect(idle.output.lidClose).toBeCloseTo(1, 2)
    run(14.2)
    expect(idle.behaviour).toBeNull()
    run(17)
    expect(idle.output.lidClose).toBe(0)
  })

  it('ignores a play request without a drive', () => {
    const { idle, run } = layer(7, null)
    idle.play('stretch')
    run(1)
    expect(idle.seq).toBe(0)
    expect(idle.contributing).toBe(false)
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

  it('hands the latest behaviour and the settled state to the body intent', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPerformance(idleState, 0.5, 0)
    motion.advance(0)
    expect(motion.bodyIntent().idle).toEqual({ behaviour: null, settled: false })
    motion.setIdleDrive({ ...neutralDrive, rate: 0, body: true }, 0)
    motion.idlePlay('shoulder-roll', 1)
    motion.advance(1.1)
    expect(motion.bodyIntent().idle.behaviour).toMatchObject({ seq: 1, kind: 'shoulder-roll', releasedAt: null })
    for (let frame = 1; frame <= 125 * 60; frame++)
      motion.advance(1.1 + frame / 60)
    expect(motion.bodyIntent().idle.behaviour?.releasedAt).not.toBeNull()
    expect(motion.bodyIntent().idle.settled).toBe(true)
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

  it('never snaps the head or the body: every behaviour starts, ends and yields within a bounded speed', () => {
    const kinds: IdleBehaviourKind[] = ['stretch', 'yawn', 'look-around', 'check-in', 'peer', 'zone-out', 'nod-off', 'sway', 'sleep', 'about-to-speak', 'let-go']
    const channels = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'] as const
    const hz = 120
    // Normalized units per second. The fastest intended move is the head jerk of a nod-off, about 4; a posture
    // amplitude that switched in one step measured 17 to 32.
    const limit = 6
    for (const kind of kinds) {
      for (const interruptAt of [null, 2]) {
        const motion = new NaturalMotion({ seed: 11 })
        motion.setIdleDrive({ ...neutralDrive, rate: 0 }, 0)
        motion.setPerformance(idleState, 0.5, 0)
        let previous = motion.advance(0)
        let fastest = 0
        for (let step = 1; step <= 44 * hz; step++) {
          const now = step / hz
          if (step === 20 * hz)
            motion.idlePlay(kind, now)
          if (interruptAt !== null && step === (20 + interruptAt) * hz)
            motion.setPerformance({ ...idleState, mode: 'talking' }, 0.5, now)
          const frame = motion.advance(now)
          for (const channel of channels)
            fastest = Math.max(fastest, Math.abs((frame.pose[channel] ?? 0) - (previous.pose[channel] ?? 0)) * hz)
          previous = frame
        }
        expect(fastest, `${kind}${interruptAt === null ? '' : ' interrupted'}`).toBeLessThan(limit)
      }
    }
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
  }, 30_000)
})
