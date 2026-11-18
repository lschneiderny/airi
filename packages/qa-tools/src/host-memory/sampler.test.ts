import type { MemoryReading } from './parse'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHostMemoryReader, memoryReport, SystemMemorySampler } from './sampler'

const GiB = 1024 ** 3
const MiB = 1024 ** 2

function reading(overrides: Partial<MemoryReading>): MemoryReading {
  return { usedBytes: 8 * GiB, compressedBytes: GiB, swapUsedBytes: 100 * MiB, pressure: 'normal', psiSome10: null, totalBytes: 16 * GiB, ...overrides }
}

/** A reader that returns the given readings in order, or throws where an entry is an Error. */
function scriptedReader(steps: (MemoryReading | Error)[]) {
  let index = 0
  return vi.fn(async () => {
    const step = steps[Math.min(index++, steps.length - 1)]
    if (step instanceof Error)
      throw step
    return step
  })
}

describe('systemMemorySampler', () => {
  let dir: string
  let clock: number
  const now = () => new Date(clock)

  beforeEach(() => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'qa-memory-test-'))
    clock = Date.UTC(2026, 0, 1)
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Starts a sampler, lets it take one sample per interval for `ticks` intervals, and stops it. */
  async function sample(sampler: SystemMemorySampler, ticks: number) {
    sampler.start(2_000)
    for (let tick = 0; tick < ticks; tick++) {
      clock += 2_000
      await vi.advanceTimersByTimeAsync(2_000)
    }
    return sampler.stop()
  }

  it('summarizes peaks, the worst pressure, and swap at the first and last sample', async () => {
    const reader = scriptedReader([
      reading({ usedBytes: 9 * GiB, compressedBytes: GiB, swapUsedBytes: 100 * MiB, pressure: 'normal' }),
      reading({ usedBytes: 13 * GiB, compressedBytes: 2 * GiB, swapUsedBytes: 300 * MiB, pressure: 'warn' }),
      reading({ usedBytes: 11 * GiB, compressedBytes: 3 * GiB, swapUsedBytes: 612 * MiB, pressure: 'normal' }),
    ])
    const summary = await sample(new SystemMemorySampler({ reader, now }), 2)
    expect(summary).toMatchObject({
      available: true,
      error: null,
      intervalMs: 2_000,
      totalBytes: 16 * GiB,
      peakUsedBytes: 13 * GiB,
      peakCompressedBytes: 3 * GiB,
      maxPressure: 'warn',
      peakPsiSome10: null,
      swapUsedStartBytes: 100 * MiB,
      swapUsedEndBytes: 612 * MiB,
    })
    expect(summary.samples).toHaveLength(3)
    expect(memoryReport(summary)).toEqual({ peakUsedGiB: 13, peakCompressedGiB: 3, maxPressure: 'warn', peakPsiSome10: null, swapDeltaMiB: 512 })
  })

  it('appends one timestamped sample per line to the output file', async () => {
    const outFile = join(dir, 'memory.jsonl')
    const reader = scriptedReader([reading({ usedBytes: 9 * GiB }), reading({ usedBytes: 10 * GiB, pressure: 'critical' })])
    await sample(new SystemMemorySampler({ reader, now, outFile }), 1)
    const lines = readFileSync(outFile, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([
      { t: '2026-01-01T00:00:00.000Z', usedBytes: 9 * GiB, compressedBytes: GiB, swapUsedBytes: 100 * MiB, pressure: 'normal', psiSome10: null },
      { t: '2026-01-01T00:00:02.000Z', usedBytes: 10 * GiB, compressedBytes: GiB, swapUsedBytes: 100 * MiB, pressure: 'critical', psiSome10: null },
    ])
  })

  it('skips a failed read, keeps the rest, and reports the first error', async () => {
    const reader = scriptedReader([reading({}), new Error('vm_stat timed out'), reading({ usedBytes: 12 * GiB })])
    const summary = await sample(new SystemMemorySampler({ reader, now }), 2)
    expect(summary.available).toBe(true)
    expect(summary.samples).toHaveLength(2)
    expect(summary.peakUsedBytes).toBe(12 * GiB)
    expect(summary.error).toBe('vm_stat timed out')
  })

  it('summarizes as unavailable and writes nothing when every read fails', async () => {
    const outFile = join(dir, 'memory.jsonl')
    const summary = await sample(new SystemMemorySampler({ reader: scriptedReader([new Error('sysctl failed')]), now, outFile }), 2)
    expect(summary).toMatchObject({ available: false, error: 'sysctl failed', samples: [], peakUsedBytes: null, maxPressure: null })
    expect(memoryReport(summary)).toBeNull()
    expect(() => readFileSync(outFile)).toThrow()
  })

  it('summarizes as unavailable on an unsupported platform', async () => {
    const summary = await sample(new SystemMemorySampler({ reader: null, now }), 1)
    expect(summary.available).toBe(false)
    expect(summary.error).toContain('not supported')
  })

  it('does not stack reads that outlast the interval', async () => {
    let release: () => void = () => {}
    const reader = vi.fn(() => new Promise<MemoryReading>((resolve) => {
      release = () => resolve(reading({}))
    }))
    const sampler = new SystemMemorySampler({ reader, now })
    sampler.start(2_000)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(reader).toHaveBeenCalledTimes(1)
    release()
    const summary = await sampler.stop()
    expect(summary.samples).toHaveLength(1)
  })

  it('does not support platforms other than macOS and Linux', () => {
    expect(createHostMemoryReader('win32')).toBeNull()
  })
})
