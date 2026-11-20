import type { IdleStepInput, NaturalIdleDrive } from './idle-activities'
import type { IdleErrandRecord } from './idle-errands'

import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { NaturalIdleActivities } from './idle-activities'
import { IdleErrandReports } from './idle-errands'
import { createRandomStream } from './random'

const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 }
const idleInput: IdleStepInput = { mode: 'idle', away: false, blocked: false, interrupt: false, rouse: false, wake: false, placement: 0, screenPoint: { x: 0, y: -0.18 } }

describe('idle errands', () => {
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
