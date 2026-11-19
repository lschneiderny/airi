import type { HostLoad } from './wait'

import { describe, expect, it } from 'vitest'

import { formatHostLoad, waitForHostQuiet } from './wait'

const calm: HostLoad = { load1: 1, cores: 8, externalCpuPct: 5, psiCpuSomeAvg10: 0.5 }
const busy: HostLoad = { load1: 7, cores: 8, externalCpuPct: 60, psiCpuSomeAvg10: 25 }

/** Replays host readings in order, one per sample, on a clock that the injected sleep advances. */
function replay(readings: HostLoad[]) {
  let clock = 0
  let samples = 0
  return {
    sample: async () => readings[Math.min(samples++, readings.length - 1)],
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
    samples: () => samples,
  }
}

describe('waitForHostQuiet', () => {
  it('is quiet after one sample on a calm host', async () => {
    const host = replay([calm])

    expect(await waitForHostQuiet({ ...host, waitSeconds: 60 })).toEqual({ quiet: true, waitedSeconds: 0, sample: calm })
    expect(host.samples()).toBe(1)
  })

  it('refuses at once without a wait', async () => {
    const host = replay([busy])

    expect(await waitForHostQuiet({ ...host, waitSeconds: 0 })).toEqual({ quiet: false, waitedSeconds: 0, sample: busy })
    expect(host.samples()).toBe(1)
  })

  it('waits until the host calms down, within the wait', async () => {
    const host = replay([busy, busy, calm])

    expect(await waitForHostQuiet({ ...host, waitSeconds: 60, pollMs: 2_000 })).toEqual({ quiet: true, waitedSeconds: 4, sample: calm })
  })

  it('gives up after the wait with the last reading', async () => {
    const host = replay([busy])

    expect(await waitForHostQuiet({ ...host, waitSeconds: 5, pollMs: 2_000 })).toEqual({ quiet: false, waitedSeconds: 5, sample: busy })
  })

  it('counts a host busy on load alone, without PSI', async () => {
    const host = replay([{ load1: 6, cores: 8, externalCpuPct: 0, psiCpuSomeAvg10: null }])

    expect((await waitForHostQuiet({ ...host, waitSeconds: 0 })).quiet).toBe(false)
  })
})

describe('formatHostLoad', () => {
  it('names the load, the CPU pressure and the machine CPU', () => {
    expect(formatHostLoad(busy)).toBe('load 7.00 on 8 cores, CPU PSI some avg10 25.0, machine CPU 60% busy')
    expect(formatHostLoad({ ...calm, psiCpuSomeAvg10: null })).toBe('load 1.00 on 8 cores, PSI unavailable, machine CPU 5% busy')
  })
})
