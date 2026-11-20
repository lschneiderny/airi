import type { IdleBehaviourKind, IdleStepInput, NaturalIdleDrive } from './idle-activities'
import type { IdleErrandKind, IdleErrandRecord } from './idle-errands'
import type { IdleView } from './idle-schedule'

import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { NaturalIdleActivities } from './idle-activities'
import { IDLE_ERRAND_PACING, IdleErrandReports, PASTIME_HOLD_SECONDS } from './idle-errands'
import { advanceIdleSchedule, applyIdleEdge, idleActivityRate, idleActivityWeights, initialIdleSchedule, nextIdleDeadline } from './idle-schedule'
import { createRandomStream } from './random'

const dt = 1 / 120
const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 }
const idleInput: IdleStepInput = { mode: 'idle', away: false, blocked: false, interrupt: false, rouse: false, wake: false, placement: 0, screenPoint: { x: 0, y: -0.18 } }

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

/**
 * Runs the layer with a realiser that answers each errand at once with `answer` (or never, for a pastime it lets run),
 * and returns the errands started and the seconds the replaced timer counted toward its own urge.
 */
function simulate(options: { drive: NaturalIdleDrive, seconds: number, dt: number, answer: 'done' | 'refused' | null, input?: (at: number) => IdleStepInput }) {
  const idle = new NaturalIdleActivities(createRandomStream(5))
  const gaze = new NaturalGazeLayer(createRandomStream(4))
  idle.setDrive(options.drive)
  const reports = new IdleErrandReports()
  const started: IdleErrandRecord[] = []
  const ended: IdleErrandRecord[] = []
  // `decideIdleClip` counted quiet time only, and the scene's quiet body had no Natural behaviour in progress.
  let quietSeconds = 0
  for (let at = 0; at < options.seconds; at += options.dt) {
    if (idle.behaviour === null)
      quietSeconds += options.dt
    idle.step(at, options.dt, options.input?.(at) ?? idleInput, gaze)
    gaze.step(options.dt)
    for (const report of reports.read(idle.errand)) {
      if (report.phase === 'start') {
        started.push(report.errand)
        if (options.answer)
          idle.answerErrand(report.errand.seq, options.answer)
      }
      else {
        ended.push(report.errand)
      }
    }
  }
  return { idle, started, ended, quietSeconds }
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
    const bodyKinds = ['sigh', 'shoulder-roll', 'arm-swing', 'shift-stance', 'clasp-hands'] as const
    const live2d = idleActivityWeights(neutralDrive, { watching: false })
    const mmd = idleActivityWeights({ ...neutralDrive, body: true }, { watching: false })
    const bright = idleActivityWeights({ ...neutralDrive, body: true, valence: 0.5 }, { watching: false })
    for (const kind of [...bodyKinds, 'hair-touch', 'heel-rock'] as const)
      expect([live2d[kind], idleActivityWeights({ ...neutralDrive, valence: 0.5 }, { watching: false })[kind]], kind).toEqual([0, 0])
    for (const kind of bodyKinds)
      expect(mmd[kind], kind).toBeGreaterThan(0)
    // Each takes its 4e act weight: the stance shift 1.2 (act 3), the clasp 0.7 (act 6), the hair tuck 0.5 (act 8), and
    // the heel raise 0 unless valence is above 0.3, then 0.8 (act 11).
    expect(mmd['shift-stance']).toBe(1.2)
    expect(mmd['clasp-hands']).toBe(0.7)
    expect([mmd['hair-touch'], bright['hair-touch']]).toEqual([0.5, 0.5])
    expect([mmd['heel-rock'], bright['heel-rock']]).toEqual([0, 0.8])
  })

  it('never draws a whole-body kind the host\'s body cannot perform, and leaves the others as they were', () => {
    const body = { ...neutralDrive, body: true }
    const all = idleActivityWeights(body, { watching: false })
    const limited = idleActivityWeights({ ...body, unreachable: ['clasp-hands', 'hair-touch'] }, { watching: false })
    expect(all['clasp-hands']).toBeGreaterThan(0)
    expect(all['hair-touch']).toBeGreaterThan(0)
    expect([limited['clasp-hands'], limited['hair-touch']]).toEqual([0, 0])
    expect({ ...limited, 'clasp-hands': all['clasp-hands'], 'hair-touch': all['hair-touch'] }).toEqual(all)
  })

  it('starts nothing that needs her arms or a standing posture while she is settled in', () => {
    const settled = { watching: false, settled: true }
    const weights = idleActivityWeights({ ...neutralDrive, body: true, sleepiness: 0.5 }, settled)
    for (const kind of ['stretch', 'peer', 'shoulder-roll', 'arm-swing'] as const)
      expect(weights[kind], kind).toBe(0)
    // Architecture 4f lets the sigh, the yawn and the foot re-plant play while she rests.
    expect(weights['shift-stance']).toBeGreaterThan(0)
    expect(weights.sigh).toBeGreaterThan(0)
    expect(weights.yawn).toBeGreaterThan(0)
  })

  it('weighs a kind she showed recently less on a body host, back to its full weight after 300 s', () => {
    const body = { ...neutralDrive, body: true }
    const fresh = idleActivityWeights(body, { watching: false })
    const recent = idleActivityWeights(body, { watching: false, since: { 'look-around': 60 } })
    expect(recent['look-around']).toBeCloseTo(fresh['look-around'] / 5)
    expect(recent['check-in']).toBe(fresh['check-in'])
    expect(idleActivityWeights(body, { watching: false, since: { 'look-around': 300 } })['look-around']).toBe(fresh['look-around'])
    // A head-only host draws as it did before.
    expect(idleActivityWeights(neutralDrive, { watching: false, since: { 'look-around': 60 } })).toEqual(idleActivityWeights(neutralDrive, { watching: false }))
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
})

describe('idle schedule', () => {
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

  it('draws as before without a body for seeds recorded at the base of the recency rule', () => {
    // Recorded at cd101c9fe with this loop (E/g4/i/scratch/base-sequence.ts): every start in 900 s.
    const base: Record<number, string[]> = {
      3: ['stretch@57.317', 'check-in@133.908', 'look-around@180.900', 'check-in@209.433', 'zone-out@247.192', 'look-around@275.983', 'check-in@299.975', 'look-around@347.658', 'zone-out@410.558', 'look-around@517.550', 'yawn@573.017', 'check-in@632.767', 'look-around@654.908', 'stretch@720.850', 'check-in@756.775', 'look-around@772.483', 'check-in@809.283', 'look-around@824.708'],
      23: ['stretch@4.375', 'look-around@35.642', 'check-in@121.942', 'zone-out@266.450', 'look-around@306.275', 'stretch@340.208', 'look-around@399.983', 'check-in@429.875', 'look-around@495.242', 'peer@672.658', 'look-around@798.275'],
      42: ['look-around@41.350', 'peer@63.425', 'stretch@104.950', 'look-around@161.467', 'peer@229.142', 'check-in@251.333', 'look-around@274.808', 'check-in@307.917', 'look-around@424.942', 'yawn@598.600', 'look-around@626.967', 'zone-out@738.108', 'check-in@813.550', 'look-around@826.475', 'peer@871.892'],
      101: ['peer@6.558', 'stretch@44.958', 'look-around@76.492', 'check-in@96.108', 'look-around@115.542', 'peer@182.250', 'zone-out@256.125', 'look-around@320.558', 'zone-out@342.400', 'look-around@391.175', 'zone-out@513.800', 'look-around@548.917', 'check-in@589.850', 'look-around@619.742', 'yawn@667.717', 'look-around@759.175', 'check-in@802.692', 'look-around@845.500', 'check-in@882.450'],
    }
    for (const seed of [3, 23, 42, 101]) {
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

  it('on a body host draws a kind she has just shown far less often than its weight alone gives', () => {
    // The same seeds twice: she shows a check-in, or a peer in its place, then a zone-out; the next drawn kind counts.
    const nextAfter = (shown: IdleBehaviourKind) => {
      let checkIns = 0
      for (let seed = 1; seed <= 300; seed++) {
        const { idle, gaze, run, now } = layer(seed, { ...neutralDrive, body: true })
        idle.play(shown)
        idle.step(now(), dt, idleInput, gaze)
        idle.play('zone-out')
        run(now() + 2 * dt)
        const zoned = idle.seq
        run(now() + 600, idleInput, () => idle.seq > zoned)
        if (idle.behaviour === 'check-in')
          checkIns++
      }
      return checkIns
    }
    expect(nextAfter('check-in')).toBeLessThan(0.5 * nextAfter('peer'))
  })

  it('takes a fresh while to fall asleep after she talked to someone the desktop calls away', () => {
    const { idle, run, now } = layer()
    const away = { ...idleInput, away: true }
    run(31, away, () => idle.behaviour === 'sleep')
    // A reply longer than the longest wait: the wait must not run out while she speaks.
    const spokeUntil = run(now() + 40, { ...away, mode: 'talking' })
    expect(idle.behaviour).toBeNull()
    run(spokeUntil + 31, away, () => idle.behaviour === 'sleep')
    expect(idle.behaviour).toBe('sleep')
    expect(now() - spokeUntil).toBeGreaterThan(12)
  })

  it('follows a long sleep with a yawn and never a stretch while she is settled in', () => {
    const seen = new Set<IdleBehaviourKind>()
    for (let seed = 1; seed <= 30; seed++) {
      const { idle, run, now } = layer(seed, { ...neutralDrive, body: true })
      const away = { ...idleInput, away: true }
      run(31, away, () => idle.behaviour === 'sleep')
      run(now() + 130, away)
      expect(idle.settled, `seed ${seed}`).toBe(true)
      const wokeAt = run(now() + dt, { ...idleInput, wake: true })
      run(wokeAt + 4, idleInput, () => idle.behaviour !== null)
      if (idle.behaviour)
        seen.add(idle.behaviour)
    }
    expect([...seen]).toEqual(['yawn'])
  })

  it('can still stretch after a long sleep when the return stands her up', () => {
    const seen = new Set<IdleBehaviourKind>()
    for (let seed = 1; seed <= 30; seed++) {
      const { idle, run, now } = layer(seed, { ...neutralDrive, body: true })
      const away = { ...idleInput, away: true }
      run(31, away, () => idle.behaviour === 'sleep')
      run(now() + 130, away)
      const watching = { ...idleInput, mode: 'watching' as const }
      const wokeAt = run(now() + dt, { ...watching, wake: true })
      expect(idle.settled, `seed ${seed}`).toBe(false)
      run(wokeAt + 4, watching, () => idle.behaviour !== null)
      if (idle.behaviour)
        seen.add(idle.behaviour)
    }
    expect(seen.has('stretch')).toBe(true)
  })

  it('never sleeps when the renderer plays its own sleep stance', () => {
    const { idle, run } = layer(7, { ...neutralDrive, allowSleep: false })
    run(300, { ...idleInput, away: true })
    expect(idle.seq).toBe(0)
  })

  it('names the time of the first decision: the end of the rest, then the crossing of the hazard that a grid search finds', () => {
    const view: IdleView = { drive: neutralDrive, active: true, mode: 'idle', away: false, blocked: false, settled: false, current: null, errand: null }
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = createRandomStream(seed)
      let state = applyIdleEdge(applyIdleEdge(initialIdleSchedule(), { kind: 'started', act: 'yawn' }, 0, random), { kind: 'ended', act: 'yawn', how: 'finished', sleptSeconds: null }, 0, random)
      // In the rest nothing is due but its end, where the hazard draws its threshold.
      expect(nextIdleDeadline(state, view, 0)).toBe(state.restUntil)
      let at = 0
      let deadline: number | null = null
      let decidedAt: number | null = null
      for (let step = 0; decidedAt === null && step < 3600 / dt; step++) {
        at = step * dt
        const result = advanceIdleSchedule(state, view, at, dt, random)
        state = result.state
        if (result.decision !== null)
          decidedAt = at
        // The first step that drew the threshold fixes the crossing: the urge reaches it at the deadline.
        else if (deadline === null && state.threshold !== null)
          deadline = nextIdleDeadline(state, view, at + dt)
      }
      expect(deadline, `seed ${seed}`).not.toBeNull()
      expect(decidedAt, `seed ${seed}`).not.toBeNull()
      // The grid decides at the step whose span reaches the crossing.
      expect(decidedAt!, `seed ${seed}`).toBeGreaterThanOrEqual(deadline! - dt - 1e-9)
      expect(decidedAt!, `seed ${seed}`).toBeLessThan(deadline! + 1e-9)
    }
  })

  it('starts as many activities per hour as before the schedule moved, inactive and working', () => {
    // Measured with this layer over 1000 hours per mode (four seeds of 250 hours at 30 steps a second) when the schedule
    // moved out of it; the idle agency ADR's evidence read 59 and 44 per hour under other conditions.
    const perHour = { idle: 58.0, watching: 41.7 } as const
    const hours = 40
    const step = 1 / 30
    for (const mode of ['idle', 'watching'] as const) {
      const idle = new NaturalIdleActivities(createRandomStream(9))
      const gaze = new NaturalGazeLayer(createRandomStream(4))
      idle.setDrive(neutralDrive)
      const input = { ...idleInput, mode }
      for (let index = 0; index < hours * 3600 / step; index++) {
        idle.step(index * step, step, input, gaze)
        gaze.step(step)
      }
      const rate = idle.seq / hours
      // Starts are a renewal count over `hours`, so four Poisson standard deviations bound the difference.
      const bound = 4 * Math.sqrt(perHour[mode] * hours) / hours
      expect(Math.abs(rate - perHour[mode]), `${mode}: ${rate.toFixed(2)} per hour now, ${perHour[mode]} before`).toBeLessThan(bound)
    }
  }, 30_000)
})

describe('idle errand pacing', () => {
  it('starts each errand at about the long-run rate of the timer it replaces', () => {
    // The old timers' own code, run for 1000 free hours at the U5 base aadf13984 (evidence u5/old-rates.txt).
    const old: Record<IdleErrandKind, number> = { 'pastime': 5.39, 'idle-clip': 12.006, 'wander': 4.176 }
    const hours = 200
    for (const kind of ['pastime', 'idle-clip', 'wander'] as const) {
      const drive = { ...neutralDrive, body: kind !== 'pastime', errands: [kind] }
      const { started, quietSeconds } = simulate({ drive, seconds: hours * 3600, dt: 0.25, answer: kind === 'pastime' ? null : 'done' })
      const counted = (kind === 'idle-clip' ? quietSeconds : hours * 3600) / 3600
      const perHour = started.length / counted
      // Starts are a renewal count over `counted` hours, so four Poisson standard deviations bound the difference.
      const bound = 4 * Math.sqrt(old[kind] * counted) / counted
      expect(Math.abs(perHour - old[kind]), `${kind}: ${perHour.toFixed(3)} per hour now, ${old[kind]} before`).toBeLessThan(bound)
    }
  })

  it('keeps a pastime 90 to 300 s and puts it away when she is spoken to', () => {
    const drive = { ...neutralDrive, errands: ['pastime'] as const }
    const free = simulate({ drive, seconds: 4 * 3600, dt: 0.25, answer: null })
    expect(free.ended.length).toBeGreaterThan(0)
    for (const errand of free.ended) {
      expect(errand.outcome).toBe('done')
      expect(errand.endedAt! - errand.start).toBeGreaterThanOrEqual(PASTIME_HOLD_SECONDS.min)
      expect(errand.endedAt! - errand.start).toBeLessThanOrEqual(PASTIME_HOLD_SECONDS.max + 0.25)
    }
    const spoken = simulate({ drive, seconds: 2 * 3600, dt: 0.25, answer: null, input: at => at % 600 < 400 ? idleInput : { ...idleInput, mode: 'talking' } })
    const cut = spoken.ended.filter(errand => errand.outcome === 'interrupted')
    expect(cut.length).toBeGreaterThan(0)
    for (const errand of cut)
      expect(errand.endedAt! % 600).toBeCloseTo(400, 0)
  })

  it('treats a refused errand as spent and keeps its refractory', () => {
    for (const kind of ['pastime', 'idle-clip', 'wander'] as const) {
      const { started, ended } = simulate({ drive: { ...neutralDrive, body: kind !== 'pastime', errands: [kind] }, seconds: 6 * 3600, dt: 0.25, answer: 'refused' })
      expect(started.length, kind).toBeGreaterThan(2)
      expect(ended.every(errand => errand.outcome === 'refused' && errand.endedAt! - errand.start <= 0.25), kind).toBe(true)
      const { refractory, from } = IDLE_ERRAND_PACING[kind]
      for (let i = 1; i < started.length; i++) {
        const since = from === 'start' ? started[i - 1].start : ended[i - 1].endedAt!
        expect(started[i].start - since, kind).toBeGreaterThanOrEqual(refractory)
      }
    }
  })
})
