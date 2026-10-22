import type { CpuSlotsStatus } from './cpu-slots'

import { StoreBusyError } from '@proj-airi/cpu-slots'
import { describe, expect, it } from 'vitest'

import { cpuSlotsJson, readCpuSlots, renderCpuSlots } from './cpu-slots'

const empty: CpuSlotsStatus = { budget: 12, held: 0, leases: [], queue: [] }

const busyStatus: CpuSlotsStatus = {
  budget: 12,
  held: 5,
  leases: [
    { class: 'test', slots: 2, pid: 1111, command: 'vitest run', age: 65_000 },
    { class: 'build', slots: 3, pid: 2222, command: 'turbo build', age: 4_000 },
  ],
  queue: [{ class: 'gate', pid: 3333, command: 'qa:motion gate', wait: 9_500 }],
}

describe('renderCpuSlots', () => {
  it('prints a zero header for an empty store', () => {
    expect(renderCpuSlots({ kind: 'ok', status: empty })).toEqual(['cpu slots: held 0/12, 0 queued'])
  })

  it('prints one line per lease and per queued ticket', () => {
    const lines = renderCpuSlots({ kind: 'ok', status: busyStatus })
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('held 5/12, 1 queued')
    expect(lines[1]).toContain('pid 1111')
    expect(lines[1]).toContain('2 slots')
    expect(lines[2]).toContain('pid 2222')
    expect(lines[3]).toContain('pid 3333')
  })

  it('reports a busy lock without a status body', () => {
    const lines = renderCpuSlots({ kind: 'busy' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('busy')
  })
})

describe('readCpuSlots', () => {
  it('retries once after a busy lock and reports busy when it is still held', () => {
    let reads = 0
    let pauses = 0
    const view = readCpuSlots(() => {
      reads += 1
      throw new StoreBusyError('lock-busy')
    }, () => { pauses += 1 })
    expect(view).toEqual({ kind: 'busy' })
    expect(reads).toBe(2)
    expect(pauses).toBe(1)
  })

  it('returns the status when the retry succeeds', () => {
    let reads = 0
    const view = readCpuSlots(() => {
      reads += 1
      if (reads === 1)
        throw new StoreBusyError('lock-busy')
      return empty
    }, () => {})
    expect(view).toEqual({ kind: 'ok', status: empty })
  })

  it('reports other read errors without throwing', () => {
    const view = readCpuSlots(() => {
      throw new Error('store unreadable')
    }, () => {})
    expect(view).toEqual({ kind: 'error', message: 'store unreadable' })
  })
})

describe('cpuSlotsJson', () => {
  it('emits the busy marker', () => {
    expect(cpuSlotsJson({ kind: 'busy' })).toEqual({ busy: true })
  })

  it('emits budget, held, leases, and queue', () => {
    expect(cpuSlotsJson({ kind: 'ok', status: busyStatus })).toEqual({
      budget: 12,
      held: 5,
      leases: busyStatus.leases,
      queue: busyStatus.queue,
    })
  })
})
