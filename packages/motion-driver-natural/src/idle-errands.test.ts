import type { IdleStepInput, NaturalIdleDrive } from './idle-activities'
import type { IdleErrandKind, IdleErrandRecord } from './idle-errands'

import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { NaturalIdleActivities } from './idle-activities'
import { IDLE_ERRAND_PACING, IdleErrandReports, PASTIME_HOLD_SECONDS } from './idle-errands'
import { createRandomStream } from './random'

const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 }
const idleInput: IdleStepInput = { mode: 'idle', away: false, blocked: false, interrupt: false, rouse: false, placement: 0, screenPoint: { x: 0, y: -0.18 } }

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

describe('idle errands', () => {
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

  it('reports each errand once, and ends the one in progress when its reader closes', () => {
    const reports = new IdleErrandReports()
    const errand: IdleErrandRecord = { seq: 1, kind: 'pastime', start: 0, end: 100, pick: 0.5, endedAt: null, outcome: null }
    expect(reports.read(errand).map(report => report.phase)).toEqual(['start'])
    expect(reports.read(errand)).toEqual([])
    expect(reports.close(40)).toEqual([{ phase: 'end', errand: { ...errand, endedAt: 40, outcome: 'interrupted' } }])
    expect(reports.close(41)).toEqual([])
    expect(reports.read({ ...errand, endedAt: 100, outcome: 'done' })).toEqual([])
  })

  it('draws no errand without a drive, or with a drive that lists none', () => {
    for (const drive of [null, { ...neutralDrive, body: true }]) {
      const idle = new NaturalIdleActivities(createRandomStream(5))
      const gaze = new NaturalGazeLayer(createRandomStream(4))
      idle.setDrive(drive)
      for (let at = 0; at < 4 * 3600; at += 0.25)
        idle.step(at, 0.25, idleInput, gaze)
      expect(idle.errand).toBeNull()
    }
  })
})
