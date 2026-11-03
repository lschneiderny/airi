import type { WindowRectsRun } from './summary'

import { describe, expect, it } from 'vitest'

import { percentile, summarizeWindowRectsRun } from './summary'

function sample(durationUs: number, overrides: Partial<WindowRectsRun['paced'][number]> = {}) {
  return { durationUs, walked: 40, kept: 12, failures: 0, timedOut: false, ...overrides }
}

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1)

    expect([percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99), percentile(sorted, 100)]).toEqual([50, 95, 99, 100])
    expect(percentile([7], 99)).toBe(7)
    expect(percentile([], 99)).toBe(0)
  })
})

describe('summarizeWindowRectsRun', () => {
  it('summarizes both phases in the plan fixture shape and counts timed-out samples at their timeout', () => {
    const run: WindowRectsRun = {
      mode: 'worker',
      startedAt: '2026-11-03T00:00:00.000Z',
      error: null,
      backToBack: [sample(300), sample(100), sample(200)],
      paced: [sample(250_000, { timedOut: true, walked: 0, kept: 0, failures: 1 }), sample(400, { failures: 2 })],
      loopDelay: { baselineP99Ms: 1.2, pacedP99Ms: 1.5, deltaMs: 0.3 },
    }

    expect(summarizeWindowRectsRun(run, 'b')).toEqual({
      mode: 'worker',
      setup: 'b',
      samples: 5,
      p50Us: 300,
      p95Us: 250_000,
      p99Us: 250_000,
      maxUs: 250_000,
      walkedMean: 32,
      keptMean: 9.6,
      failures: 3,
      loopDelayDeltaMs: 0.3,
    })
  })
})
