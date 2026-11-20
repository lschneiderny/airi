import type { NaturalMotionEvent } from './frame-types'
import type { IdleBehaviourKind, IdleStepInput, NaturalIdleDrive } from './idle-activities'
import type { IdleOrder, IdleReport } from './idle-schedule'

import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { idleEnergyOffset, NaturalIdleActivities } from './idle-activities'
import { NaturalMotion } from './natural-motion'
import { createRandomStream } from './random'

const dt = 1 / 120
const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }
const idleInput: IdleStepInput = { mode: 'idle', away: false, blocked: false, interrupt: false, rouse: false, wake: false, placement: 0, screenPoint: { x: 0, y: -0.18 } }
const idleState = { mode: 'idle', attention: 'camera', away: false } as const

let orders = 0
/** An act order as the mind sends it; `seed` draws the act's shape. */
function act(kind: IdleBehaviourKind, options: { seed?: number, requested?: boolean } = {}): IdleOrder {
  return { id: `order-${++orders}`, kind: 'act', act: kind, seed: options.seed ?? 7, requested: options.requested ?? false }
}

function layer(seed = 7, drive: NaturalIdleDrive | null = neutralDrive) {
  const idle = new NaturalIdleActivities(createRandomStream(seed))
  const gaze = new NaturalGazeLayer(createRandomStream(4))
  idle.setDrive(drive)
  const reports: IdleReport[] = []
  let at = 0
  /** Steps until `until` seconds or until `stop` holds, and returns the time reached. */
  const run = (until: number, input: IdleStepInput = idleInput, stop?: () => boolean) => {
    while (at < until) {
      idle.step(at, dt, input, gaze)
      idle.drainReports(reports)
      gaze.step(dt)
      at += dt
      if (stop?.())
        break
    }
    return at
  }
  return { idle, gaze, run, reports, now: () => at }
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

describe('idle activity layer', () => {
  it('moves the Natural energy with the slow mood and the hour, and not at all without a drive', () => {
    expect(idleEnergyOffset(null)).toBe(0)
    expect(idleEnergyOffset(neutralDrive)).toBe(0)
    expect(idleEnergyOffset({ ...neutralDrive, energy: 1 })).toBeCloseTo(0.3)
    expect(idleEnergyOffset({ ...neutralDrive, sleepiness: 1 })).toBeCloseTo(-0.15)
  })

  it('stays inert without a drive and refuses every order', () => {
    const { idle, run, reports } = layer(7, null)
    const order = act('stretch', { requested: true })
    idle.order(order)
    run(600)
    expect(idle.seq).toBe(0)
    expect(idle.contributing).toBe(false)
    expect(idle.output.lidClose).toBe(0)
    expect(reports).toEqual([{ kind: 'refused', intentId: order.id }])
    expect(idle.view).toEqual({ drive: null, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null })
  })

  it('settles in after two minutes of idle only when the host performs a body, and gets up when the mode changes', () => {
    const live2d = layer(7, neutralDrive)
    live2d.run(300)
    expect(live2d.idle.settled).toBe(false)

    const { idle, gaze, run, now } = layer(7, { ...neutralDrive, body: true })
    run(119)
    expect(idle.settled).toBe(false)
    run(121)
    expect(idle.settled).toBe(true)
    expect(idle.view?.settled).toBe(true)
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
    const { idle, run, now, reports } = layer()
    expect(idle.record).toBeNull()
    const order = act('look-around')
    idle.order(order)
    run(0.1)
    const record = idle.record!
    expect(record).toMatchObject({ seq: 1, kind: 'look-around', releasedAt: null })
    expect(record.end).toBeGreaterThan(record.start)
    expect(record.glances.length).toBeGreaterThanOrEqual(2)
    expect(record.glances[0].at).toBe(0)
    expect(idle.view?.current).toEqual({ seq: 1, kind: 'look-around' })
    run(30, idleInput, () => idle.behaviour === null)
    // A finished behaviour ends on its planned end, released without a fade.
    expect(idle.record).toMatchObject({ seq: 1, kind: 'look-around', releaseSeconds: 0 })
    expect(idle.record!.releasedAt).toBeCloseTo(record.end, 1)
    expect(now()).toBeLessThan(30)
    expect(reports).toEqual([
      { kind: 'started', intentId: order.id, seq: 1, act: 'look-around' },
      { kind: 'ended', seq: 1, act: 'look-around', how: 'finished' },
    ])
    expect(idle.view?.current).toBeNull()
  })

  it('draws an ordered act\'s shape from its seed alone, whatever the layer drew before', () => {
    const shape = (seed: number, cues: number) => {
      const { idle, run, now } = layer(3 + cues)
      for (let index = 0; index < cues; index++) {
        idle.cue('about-to-speak')
        run(now() + 0.1)
        idle.cue('let-go')
        run(now() + 4)
      }
      idle.order(act('look-around', { seed }))
      run(now() + 0.1)
      const { start, end, side, keys, glances } = idle.record!
      // The record's times are relative to the act's start, equal up to float rounding.
      const rounded = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' ? Math.round(item * 1e9) / 1e9 : item))
      return rounded({ length: end - start, side, keys, glances })
    }
    expect(shape(21, 0)).toEqual(shape(21, 2))
    expect(shape(21, 0)).not.toEqual(shape(22, 0))
  })

  it('marks an interrupted behaviour as released before its end, with its fade', () => {
    const { idle, gaze, run, now, reports } = layer(7, { ...neutralDrive, body: true })
    idle.order(act('clasp-hands'))
    run(1)
    expect(idle.record).toMatchObject({ kind: 'clasp-hands', releasedAt: null })
    expect(idle.record!.end - idle.record!.start).toBeGreaterThanOrEqual(4)
    idle.step(now(), dt, { ...idleInput, interrupt: true }, gaze)
    idle.drainReports(reports)
    expect(idle.record).toMatchObject({ kind: 'clasp-hands', releasedAt: now(), releaseSeconds: 0.4 })
    expect(reports.at(-1)).toEqual({ kind: 'ended', seq: 1, act: 'clasp-hands', how: 'released' })
  })

  it('yields at once to an interruption and fades out within 0.4 s', () => {
    const { idle, gaze, run, now } = layer()
    idle.order(act('look-around'))
    run(30, idleInput, () => idle.behaviour !== null && idle.contributing && Math.hypot(...idle.output.head) > 0.05)
    expect(idle.behaviour).not.toBeNull()
    idle.step(now(), dt, { ...idleInput, interrupt: true }, gaze)
    expect(idle.behaviour).toBeNull()
    expect(idle.eyesOwned(now())).toBe(false)
    const startedAt = now()
    run(startedAt + 0.45)
    expect(idle.contributing).toBe(false)
    expect(idle.output.head).toEqual([0, 0, 0])
  })

  it('hands every channel back without a jump when an act runs its course', () => {
    for (const kind of ['stretch', 'yawn', 'look-around', 'check-in', 'peer', 'zone-out', 'nod-off', 'sway'] as const) {
      const { idle, run } = layer(7, neutralDrive)
      idle.order(act(kind))
      run(0.1)
      run(60, idleInput, () => idle.behaviour === null)
      expect(Math.max(...idle.output.head.map(Math.abs), ...idle.output.body.map(Math.abs), idle.output.lidClose, idle.output.mouthOpen), kind).toBeLessThan(0.02)
    }
  })

  it('refuses an order she is not free for: blocked, claimed by a mode, already in an act, or away for a waking act', () => {
    const blocked = layer()
    const first = act('look-around')
    blocked.idle.order(first)
    blocked.run(1, { ...idleInput, blocked: true })
    const talking = act('look-around')
    blocked.idle.order(talking)
    blocked.run(2, { ...idleInput, mode: 'talking' })
    expect(blocked.idle.seq).toBe(0)

    const busy = layer()
    busy.idle.order(act('zone-out'))
    busy.run(1)
    const second = act('check-in')
    busy.idle.order(second)
    busy.run(2)
    expect(busy.idle.behaviour).toBe('zone-out')

    const away = layer()
    const look = act('look-around')
    away.idle.order(look)
    away.run(1, { ...idleInput, away: true })
    expect(away.idle.seq).toBe(0)
    away.idle.order(act('sleep'))
    away.run(2, { ...idleInput, away: true })
    expect(away.idle.behaviour).toBe('sleep')

    const refusals = (reports: IdleReport[]) => reports.filter(report => report.kind === 'refused')
    expect(refusals(blocked.reports)).toEqual([{ kind: 'refused', intentId: first.id }, { kind: 'refused', intentId: talking.id }])
    expect(refusals(busy.reports)).toEqual([{ kind: 'refused', intentId: second.id }])
    expect(refusals(away.reports)).toEqual([{ kind: 'refused', intentId: look.id }])
  })

  it('ends an activity when she starts to talk', () => {
    const { idle, gaze, run, now } = layer()
    idle.order(act('zone-out'))
    run(1)
    idle.step(now(), dt, { ...idleInput, mode: 'talking' }, gaze)
    expect(idle.behaviour).toBeNull()
  })

  it('sleeps while the user is away and wakes when asked', () => {
    const { idle, run, now, reports } = layer()
    const away = { ...idleInput, away: true }
    idle.order(act('sleep'))
    run(8, away)
    expect(idle.behaviour).toBe('sleep')
    expect(idle.output.lidClose).toBeCloseTo(1, 5)
    expect(idle.output.head[1]).toBeLessThan(-0.3)
    expect(idle.output.breathPeriodScale).toBeGreaterThan(1.3)
    // Sleep lasts as long as the absence; a busy screen does not wake her.
    run(now() + 600, { ...away, interrupt: true })
    expect(idle.behaviour).toBe('sleep')
    // The user's return alone does not end it; the wake input does.
    run(now() + 1, idleInput)
    expect(idle.behaviour).toBe('sleep')
    const wokeAt = run(now() + dt, { ...idleInput, wake: true })
    expect(idle.behaviour).toBeNull()
    expect(reports.at(-1)).toEqual({ kind: 'ended', seq: 1, act: 'sleep', how: 'woken-on-request' })
    run(wokeAt + 1.7, { ...idleInput, blocked: true })
    expect(idle.output.lidClose).toBe(0)
  })

  it('wakes with a start when she is touched', () => {
    const { idle, gaze, run, now } = layer()
    const away = { ...idleInput, away: true }
    idle.order(act('sleep'))
    run(8, away)
    idle.step(now(), dt, { ...away, interrupt: true, rouse: true }, gaze)
    expect(idle.behaviour).toBeNull()
    run(now() + 0.4, { ...away, blocked: true })
    expect(idle.output.lidClose).toBe(0)
  })

  it('holds a look at the user before a reach-out and lets it go when she stays silent', () => {
    const { idle, gaze, run, now, reports } = layer()
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
    // A cue names no order.
    expect(reports.filter(report => report.kind === 'started')).toEqual([
      { kind: 'started', intentId: null, seq: 1, act: 'about-to-speak' },
      { kind: 'started', intentId: null, seq: 2, act: 'let-go' },
    ])
  })

  it('drops the hold when she speaks, and still lets go when the decision comes after the hold ran out', () => {
    const speaking = layer()
    speaking.idle.cue('about-to-speak')
    speaking.run(1)
    speaking.idle.step(speaking.now(), dt, { ...idleInput, mode: 'talking' }, speaking.gaze)
    expect(speaking.idle.behaviour).toBeNull()

    const slow = layer()
    slow.idle.cue('about-to-speak')
    slow.run(11)
    expect(slow.idle.behaviour).toBeNull()
    slow.idle.cue('let-go')
    slow.run(11.5)
    expect(slow.idle.behaviour).toBe('let-go')
  })

  it('lets a cue that arrives in the same step win over an ordered act', () => {
    const { idle, run, reports } = layer()
    const order = act('look-around')
    idle.cue('about-to-speak')
    idle.order(order)
    run(0.1)
    expect(idle.behaviour).toBe('about-to-speak')
    expect(reports).toContainEqual({ kind: 'refused', intentId: order.id })
  })

  it('plays a requested behaviour at once in place of the running one, and refuses the request while she is busy', () => {
    const { idle, run, now } = layer()
    idle.order(act('zone-out', { requested: true }))
    run(0.1)
    expect(idle.behaviour).toBe('zone-out')
    idle.order(act('yawn', { requested: true }))
    run(now() + 0.1)
    expect(idle.behaviour).toBe('yawn')
    run(now() + 6)
    expect(idle.behaviour).not.toBe('yawn')

    const busy = layer()
    const order = act('yawn', { requested: true })
    busy.idle.order(order)
    busy.run(0.1, { ...idleInput, mode: 'talking' })
    expect(busy.idle.seq).toBe(0)
    // The request does not wait for her to be free.
    busy.run(0.2)
    expect(busy.idle.behaviour).toBeNull()
    expect(busy.reports).toEqual([{ kind: 'refused', intentId: order.id }])
  })

  it('plays a requested sleep without the user away and wakes her after 24 s', () => {
    const { idle, run, reports } = layer()
    idle.order(act('sleep', { requested: true }))
    run(8)
    expect(idle.behaviour).toBe('sleep')
    expect(idle.output.lidClose).toBeCloseTo(1, 2)
    run(24.2)
    expect(idle.behaviour).toBeNull()
    expect(reports.at(-1)).toEqual({ kind: 'ended', seq: 1, act: 'sleep', how: 'woken' })
    run(27)
    expect(idle.output.lidClose).toBe(0)
  })

  it('nods slowly in her sleep, and leaves the nod to the doze of a body host', () => {
    const pitchAt = (seconds: number, drive: NaturalIdleDrive) => {
      const { idle, run } = layer(7, drive)
      idle.order(act('sleep', { requested: true }))
      run(seconds)
      return idle.output.head[1]
    }
    // Sampled at multiples of half the 6.5 s breath, where the breath adds nothing. She has settled by 6.5 s, the
    // first nod is most of the way down at 9.75 s, and her head is back by 19.5 s.
    for (const [drive, nods] of [[neutralDrive, true], [{ ...neutralDrive, body: true }, false]] as const) {
      const settled = pitchAt(6.5, drive)
      expect(settled - pitchAt(9.75, drive) > 0.08).toBe(nods)
      expect(pitchAt(19.5, drive)).toBeCloseTo(settled, 2)
    }
  })

  it('keeps a pastime for its ordered hold, and puts it away when she is spoken to', () => {
    const drive = { ...neutralDrive, errands: ['pastime'] as const }
    const held = layer(7, drive)
    const order: IdleOrder = { id: 'pastime-1', kind: 'errand', errand: 'pastime', pick: 0.25, holdSeconds: 120 }
    held.idle.order(order)
    held.run(1)
    expect(held.idle.errand).toMatchObject({ seq: 1, kind: 'pastime', start: 0, end: 120, pick: 0.25, endedAt: null })
    expect(held.idle.view?.errand).toEqual({ seq: 1, kind: 'pastime' })
    held.run(121)
    expect(held.idle.errand).toMatchObject({ outcome: 'done' })
    expect(held.idle.errand!.endedAt).toBeCloseTo(120, 1)
    expect(held.reports).toEqual([
      { kind: 'errand-started', intentId: 'pastime-1', seq: 1, errand: 'pastime' },
      { kind: 'errand-ended', seq: 1, errand: 'pastime', outcome: 'done' },
    ])

    const spoken = layer(7, drive)
    spoken.idle.order(order)
    spoken.run(10)
    spoken.run(10 + dt, { ...idleInput, mode: 'talking' })
    expect(spoken.idle.errand).toMatchObject({ outcome: 'interrupted' })
  })

  it('refuses an errand the drive does not list, or one she is not free for', () => {
    const unlisted = layer()
    unlisted.idle.order({ id: 'clip-1', kind: 'errand', errand: 'idle-clip', pick: 0, holdSeconds: null })
    unlisted.run(1)
    const busy = layer(7, { ...neutralDrive, body: true, errands: ['idle-clip'] })
    busy.idle.order(act('zone-out'))
    busy.run(1)
    busy.idle.order({ id: 'clip-2', kind: 'errand', errand: 'idle-clip', pick: 0, holdSeconds: null })
    busy.run(2)
    expect([unlisted.idle.errand, busy.idle.errand]).toEqual([null, null])
    expect(unlisted.reports).toEqual([{ kind: 'refused', intentId: 'clip-1' }])
    expect(busy.reports.at(-1)).toEqual({ kind: 'refused', intentId: 'clip-2' })
  })
})

/** A controller asleep while the user stays away, and the time it was left at. */
function asleep() {
  const motion = new NaturalMotion({ seed: 41 })
  motion.setIdleDrive(neutralDrive, 0)
  motion.setPerformance({ ...idleState, away: true }, 0.5, 0)
  motion.idle(act('sleep'), 0)
  for (let step = 0; step <= 45 * 60; step++)
    motion.advance(step / 60)
  expect(motion.idleState.behaviour).toBe('sleep')
  return { motion, at: 45 }
}

describe('idle activities in the controller', () => {
  it('leaves the motion unchanged without a drive, and with a drive while nothing is ordered', () => {
    const plain = new NaturalMotion({ seed: 41 })
    const off = new NaturalMotion({ seed: 41 })
    const quiet = new NaturalMotion({ seed: 41 })
    off.setIdleDrive(null, 0)
    quiet.setIdleDrive(neutralDrive, 0)
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
    expect(motion.bodyIntent().idle).toEqual({ behaviour: null, settled: false, errand: null })
    motion.setIdleDrive({ ...neutralDrive, body: true }, 0)
    motion.idle(act('shoulder-roll', { requested: true }), 1)
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
    const kinds = ['look-around', 'check-in', 'stretch', 'peer', 'yawn', 'zone-out'] as const
    const events: Extract<NaturalMotionEvent, { kind: 'idle' }>[] = []
    for (const [index, kind] of kinds.entries()) {
      motion.idle(act(kind), index * 30)
      events.push(...observe(motion, index * 30, 30))
    }
    expect(events.map(event => `${event.phase}:${event.behaviour}`)).toEqual(kinds.flatMap(kind => [`start:${kind}`, `end:${kind}`]))
    expect(motion.idleState.seq).toBe(kinds.length)
  })

  it('reports to the mind what started and ended, and its view only when a field changed', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const batches: (readonly IdleReport[])[] = []
    motion.onIdleReports(reports => batches.push(reports))
    motion.setPerformance(idleState, 0.5, 0)
    motion.setIdleDrive(neutralDrive, 0)
    for (let frame = 1; frame <= 120; frame++) {
      // A host sends a fresh copy of the same drive every second.
      if (frame % 60 === 0)
        motion.setIdleDrive({ ...neutralDrive }, frame / 60)
      motion.advance(frame / 60)
    }
    // The controller's first grid step ran before the drive was set.
    expect(batches).toEqual([
      [{ kind: 'view', view: { drive: null, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null } }],
      [{ kind: 'view', view: { drive: neutralDrive, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null } }],
    ])

    const order = act('check-in')
    motion.idle(order, 2)
    motion.advance(2 + 1 / 60)
    expect(batches.at(-1)).toEqual([
      { kind: 'started', intentId: order.id, seq: 1, act: 'check-in' },
      { kind: 'view', view: expect.objectContaining({ current: { seq: 1, kind: 'check-in' } }) },
    ])
    motion.setIdleDrive({ ...neutralDrive, energy: 0.5 }, 2.1)
    motion.advance(2.1 + 1 / 60)
    expect(batches.at(-1)).toEqual([{ kind: 'view', view: expect.objectContaining({ drive: { ...neutralDrive, energy: 0.5 } }) }])
  })

  it('reports idle time stopping and resuming with the suspension, and refuses an order while suspended', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const batches: (readonly IdleReport[])[] = []
    motion.setIdleDrive(neutralDrive, 0)
    motion.setPerformance(idleState, 0.5, 0)
    motion.advance(0.1)
    motion.onIdleReports(reports => batches.push(reports))
    motion.setSuspended(true, 0.2)
    motion.setSuspended(true, 0.3)
    const order = act('yawn', { requested: true })
    motion.idle(order, 0.4)
    motion.setSuspended(false, 0.5)
    motion.advance(0.6)
    expect(batches).toEqual([
      [{ kind: 'view', view: expect.objectContaining({ active: false }) }],
      [{ kind: 'refused', intentId: order.id }],
      [{ kind: 'view', view: expect.objectContaining({ active: true }) }],
    ])
  })

  it('closes her eyes while she sleeps and opens them when she is woken', () => {
    const { motion } = asleep()
    let frame = motion.advance(45)
    expect(frame.blink.blinkFactor).toBeLessThan(1e-6)
    expect(frame.pose.headY).toBeLessThan(-0.2)
    motion.setPerformance(idleState, 0.5, 45)
    motion.wake(45)
    let open = 0
    for (let step = 1; step <= 4 * 60; step++) {
      frame = motion.advance(45 + step / 60)
      open = Math.max(open, frame.blink.blinkFactor)
    }
    expect(motion.idleState.behaviour).not.toBe('sleep')
    expect(open).toBe(1)
  })

  it('wakes with a start on a desktop wake reaction while the user is still away', () => {
    const { motion, at } = asleep()
    motion.react('wake', at)
    motion.advance(at + 0.1)
    expect(motion.idleState.behaviour).not.toBe('sleep')
    expect(motion.bodyIntent().idle.behaviour).toMatchObject({ kind: 'sleep', releaseSeconds: 0.35 })
  })

  it('wakes gently on request while the user is still away, with her eyes on the camera as the lids open', () => {
    const { motion, at } = asleep()
    motion.wake(at)
    let frame = motion.advance(at + 0.1)
    expect(motion.idleState.behaviour).not.toBe('sleep')
    expect(motion.bodyIntent().idle.behaviour).toMatchObject({ kind: 'sleep', releaseSeconds: 1.6 })
    for (let step = 1; step <= 60; step++)
      frame = motion.advance(at + 0.1 + step / 60)
    expect(Math.hypot(frame.fixation.x, frame.fixation.y)).toBeLessThan(0.05)
  })

  it('ignores a wake request while she is awake', () => {
    const plain = new NaturalMotion({ seed: 41 })
    const woken = new NaturalMotion({ seed: 41 })
    for (const motion of [plain, woken]) {
      motion.setIdleDrive(neutralDrive, 0)
      motion.setPerformance(idleState, 0.5, 0)
      motion.idle(act('zone-out', { seed: 3 }), 0)
    }
    for (let frame = 1; frame <= 120 * 60; frame++) {
      if (frame % 600 === 0)
        woken.wake(frame / 60)
      expect(woken.advance(frame / 60)).toEqual(plain.advance(frame / 60))
    }
  })

  it('yawns with an open mouth in silence, and keeps the mouth with speech while she talks', () => {
    const peakMouth = (speaking: boolean) => {
      const motion = new NaturalMotion({ seed: 5 })
      motion.setIdleDrive({ ...neutralDrive, sleepiness: 1, energy: -1 }, 0)
      motion.setPerformance(idleState, 0.5, 0)
      motion.setVoice({ speaking: false, speechActiveOrRecent: speaking, level: 0 })
      motion.idle(act('yawn'), 0)
      let peak = 0
      let yawned = false
      for (let step = 1; step <= 10 * 60; step++) {
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
        motion.setIdleDrive(neutralDrive, 0)
        motion.setPerformance(idleState, 0.5, 0)
        let previous = motion.advance(0)
        let fastest = 0
        for (let step = 1; step <= 44 * hz; step++) {
          const now = step / hz
          if (step === 20 * hz)
            motion.idle(act(kind, { seed: 11, requested: true }), now)
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
    const kinds = ['stretch', 'yawn', 'look-around', 'check-in', 'peer', 'zone-out', 'nod-off', 'sway'] as const
    const motion = new NaturalMotion({ seed: 9 })
    motion.setIdleDrive({ ...neutralDrive, sleepiness: 0.8, energy: 0.4 }, 0)
    motion.setPerformance(idleState, 0.5, 0)
    for (let step = 1; step <= 1800 * 30; step++) {
      // A new act every 25 s, each with its own seed; one still running refuses it.
      if (step % (25 * 30) === 0)
        motion.idle(act(kinds[(step / (25 * 30)) % kinds.length], { seed: step }), step / 30)
      const { pose, blink } = motion.advance(step / 30)
      for (const value of Object.values(pose))
        expect(Math.abs(value ?? 0)).toBeLessThanOrEqual(1)
      expect(blink.blinkFactor).toBeGreaterThanOrEqual(0)
      expect(blink.blinkFactor).toBeLessThanOrEqual(1)
    }
    expect(motion.idleState.seq).toBeGreaterThan(30)
  }, 30_000)
})
