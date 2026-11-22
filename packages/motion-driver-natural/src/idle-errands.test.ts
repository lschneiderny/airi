import type { IdleErrandRecord } from './idle-errands'

import { describe, expect, it } from 'vitest'

import { IdleErrandReports } from './idle-errands'

describe('idle errands', () => {
  it('reports each errand once, and ends the one in progress when its reader closes', () => {
    const reports = new IdleErrandReports()
    const errand: IdleErrandRecord = { seq: 1, kind: 'pastime', start: 0, end: 100, holdSeconds: 100, pick: 0.5, endedAt: null, outcome: null }
    expect(reports.read(errand).map(report => report.phase)).toEqual(['start'])
    expect(reports.read(errand)).toEqual([])
    expect(reports.close(40)).toEqual([{ phase: 'end', errand: { ...errand, endedAt: 40, outcome: 'interrupted' } }])
    expect(reports.close(41)).toEqual([])
    expect(reports.read({ ...errand, endedAt: 100, outcome: 'done' })).toEqual([])
  })
})
