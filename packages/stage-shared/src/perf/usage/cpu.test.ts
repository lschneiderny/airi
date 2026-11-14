import type { CpuTimes, ProcessMetricType, ProcessRoleInput } from './cpu'

import { describe, expect, it } from 'vitest'

import {
  CpuDeltaTracker,
  decideHostContended,
  HOST_CONTENDED_EXTERNAL_CPU_PCT,
  HOST_CONTENDED_LOAD_PER_CORE,
  HOST_CONTENDED_PSI_SOME_AVG10,
  machineExternalCpuPct,
  parsePsiCpu,
  processRole,
} from './cpu'

describe('cpuDeltaTracker', () => {
  it('reports CPU seconds over wall seconds as a percentage of one core', () => {
    const tracker = new CpuDeltaTracker()
    const first = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 5 }], 0)
    const second = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 7 }], 4000)

    expect(first.get('10:1000')).toBeNull()
    expect(second.get('10:1000')).toBe(50)
  })

  it('treats a reused pid with a new creation time as a new process', () => {
    const tracker = new CpuDeltaTracker()
    tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 1 }], 0)
    const reused = tracker.update([{ pid: 10, creationTime: 2000, cumulativeCpuSec: 3 }], 4000)

    expect([...reused]).toEqual([['10:2000', null]])
  })

  it('reports null for a missing or non-finite cumulative CPU time', () => {
    const tracker = new CpuDeltaTracker()
    tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 1 }, { pid: 11, creationTime: 1000, cumulativeCpuSec: 1 }], 0)
    const next = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: undefined }, { pid: 11, creationTime: 1000, cumulativeCpuSec: Number.NaN }], 4000)

    expect([...next]).toEqual([['10:1000', null], ['11:1000', null]])
  })

  it('reports null for a negative CPU delta and measures from the new value afterwards', () => {
    const tracker = new CpuDeltaTracker()
    tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 9 }], 0)
    const backwards = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 3 }], 4000)
    const after = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 4 }], 8000)

    expect(backwards.get('10:1000')).toBeNull()
    expect(after.get('10:1000')).toBe(25)
  })

  it('reports null when no wall time has passed', () => {
    const tracker = new CpuDeltaTracker()
    tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 1 }], 5000)
    const same = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 2 }], 5000)

    expect(same.get('10:1000')).toBeNull()
  })

  it('drops a vanished process so its return is a first sighting', () => {
    const tracker = new CpuDeltaTracker()
    tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 1 }], 0)
    const without = tracker.update([{ pid: 11, creationTime: 1000, cumulativeCpuSec: 1 }], 4000)
    const back = tracker.update([{ pid: 10, creationTime: 1000, cumulativeCpuSec: 3 }], 8000)

    expect(without.has('10:1000')).toBe(false)
    expect(back.get('10:1000')).toBeNull()
  })
})

function cpus(count: number, busyMs: number, idleMs: number): CpuTimes[] {
  return Array.from({ length: count }, () => ({ user: busyMs, nice: 0, sys: 0, idle: idleMs, irq: 0 }))
}

describe('machineExternalCpuPct', () => {
  it('subtracts the app share of the machine from machine busy time', () => {
    // 4 cores at 50% busy is 50% of the machine; the app uses 80% of one core, 20% of the machine.
    const external = machineExternalCpuPct({ prevTimes: cpus(4, 0, 0), nowTimes: cpus(4, 500, 500), appCpuPctOfCoreSum: 80, cores: 4 })

    expect(external).toBe(30)
  })

  it('clamps to 0 when the app accounts for more than the machine measured', () => {
    expect(machineExternalCpuPct({ prevTimes: cpus(2, 0, 0), nowTimes: cpus(2, 100, 900), appCpuPctOfCoreSum: 150, cores: 2 })).toBe(0)
  })

  it('reports 0 when the counters did not advance', () => {
    expect(machineExternalCpuPct({ prevTimes: cpus(2, 100, 100), nowTimes: cpus(2, 100, 100), appCpuPctOfCoreSum: 0, cores: 2 })).toBe(0)
  })

  it('stays within 0 and 100 when the counters run backwards', () => {
    const external = machineExternalCpuPct({ prevTimes: cpus(2, 900, 100), nowTimes: cpus(2, 100, 200), appCpuPctOfCoreSum: 0, cores: 2 })

    expect(external).toBeGreaterThanOrEqual(0)
    expect(external).toBeLessThanOrEqual(100)
  })
})

describe('decideHostContended', () => {
  const calm = { load1: 0, cores: 8, externalCpuPct: 0, psiCpuSomeAvg10: 0 }

  it('stays false on a calm host and when PSI is unavailable', () => {
    expect(decideHostContended(calm)).toBe(false)
    expect(decideHostContended({ ...calm, psiCpuSomeAvg10: null })).toBe(false)
  })

  it.each([
    ['external CPU', { externalCpuPct: HOST_CONTENDED_EXTERNAL_CPU_PCT }, { externalCpuPct: HOST_CONTENDED_EXTERNAL_CPU_PCT - 0.01 }],
    ['PSI some avg10', { psiCpuSomeAvg10: HOST_CONTENDED_PSI_SOME_AVG10 }, { psiCpuSomeAvg10: HOST_CONTENDED_PSI_SOME_AVG10 - 0.01 }],
    ['load per core', { load1: HOST_CONTENDED_LOAD_PER_CORE * 8 }, { load1: HOST_CONTENDED_LOAD_PER_CORE * 8 - 0.01 }],
  ])('turns true at the %s threshold and stays false just below it', (_name, atThreshold, belowThreshold) => {
    expect(decideHostContended({ ...calm, ...atThreshold })).toBe(true)
    expect(decideHostContended({ ...calm, ...belowThreshold })).toBe(false)
  })
})

describe('processRole', () => {
  const roles: Record<ProcessMetricType, [ProcessRoleInput, string][]> = {
    'Browser': [[{ type: 'Browser' }, 'browser']],
    'GPU': [[{ type: 'GPU' }, 'gpu']],
    'Zygote': [[{ type: 'Zygote' }, 'zygote']],
    'Utility': [
      [{ type: 'Utility', serviceName: 'network.mojom.NetworkService', name: 'Network Service' }, 'utility:network.mojom.NetworkService'],
      [{ type: 'Utility', name: 'Audio Service' }, 'utility:Audio Service'],
      [{ type: 'Utility' }, 'utility:unknown'],
    ],
    'Tab': [
      [{ type: 'Tab', windowLabel: 'stage', devtoolsKind: 'detached' }, 'window:stage'],
      [{ type: 'Tab', devtoolsKind: 'detached' }, 'devtools:detached'],
      [{ type: 'Tab' }, 'renderer:unmapped'],
    ],
    'Sandbox helper': [[{ type: 'Sandbox helper' }, 'other']],
    'Pepper Plugin': [[{ type: 'Pepper Plugin' }, 'other']],
    'Pepper Plugin Broker': [[{ type: 'Pepper Plugin Broker' }, 'other']],
    'Unknown': [[{ type: 'Unknown' }, 'other']],
  }

  it.each(Object.values(roles).flat())('maps %o to %s', (input, role) => {
    expect(processRole(input)).toBe(role)
  })
})

describe('parsePsiCpu', () => {
  it('reads some avg10 from /proc/pressure/cpu', () => {
    const text = 'some avg10=1.23 avg60=0.50 avg300=0.10 total=123456\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'

    expect(parsePsiCpu(text)).toBe(1.23)
  })

  it.each(['', 'garbage', 'full avg10=4.00 avg60=0.00 avg300=0.00 total=0', 'some avg10=abc avg60=0.00', 'some avg10=-1.00 avg60=0.00'])('returns null for %j', (text) => {
    expect(parsePsiCpu(text)).toBeNull()
  })
})
