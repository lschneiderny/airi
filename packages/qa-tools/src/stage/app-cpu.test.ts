import { describe, expect, it } from 'vitest'

import { parseProcStatCpu, treeCpuDelta } from './app-cpu'

describe('parseProcStatCpu', () => {
  it('reads utime + stime and the start time after a command name holding spaces and parentheses', () => {
    const stat = '4242 (Web (Content) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 75 3 4 20 0 30 0 98765 1000 50'

    expect(parseProcStatCpu(4242, stat)).toEqual({ pid: 4242, startTicks: 98765, cpuTicks: 325 })
  })

  it('returns null for a truncated stat line', () => {
    expect(parseProcStatCpu(1, '1 (init) S 0 1')).toBeNull()
  })
})

describe('treeCpuDelta', () => {
  it('sums carried deltas, counts a process started in the window from zero and drops an exited one', () => {
    const before = [
      { pid: 10, startTicks: 100, cpuTicks: 1_000 },
      { pid: 11, startTicks: 110, cpuTicks: 500 },
      { pid: 12, startTicks: 120, cpuTicks: 40 },
    ]
    const after = [
      { pid: 10, startTicks: 100, cpuTicks: 1_300 },
      { pid: 11, startTicks: 110, cpuTicks: 520 },
      // pid 12 was reused by a new process: its whole time belongs to the window.
      { pid: 12, startTicks: 900, cpuTicks: 7 },
      { pid: 13, startTicks: 950, cpuTicks: 3 },
    ]

    expect(treeCpuDelta(before, after)).toEqual({ cpuTicks: 300 + 20 + 7 + 3, carried: 2, started: 2, exited: 1 })
  })
})
