import { describe, expect, it } from 'vitest'

import { processInfoCpuSeconds } from './app-cpu'

describe('processInfoCpuSeconds', () => {
  it('sums the CPU seconds of every app process', () => {
    const response = { id: 1, result: { processInfo: [{ type: 'browser', id: 1, cpuTime: 0.29 }, { type: 'renderer', id: 2, cpuTime: 0.02 }, { type: 'GPU', id: 3, cpuTime: 0.42 }] } }

    expect(processInfoCpuSeconds(response)).toBeCloseTo(0.73)
  })

  it('throws on a response without process info', () => {
    expect(() => processInfoCpuSeconds({ id: 1, result: {} })).toThrow()
  })
})
