import type { CpuTimes, ProcessCpuReading, SampleRecord } from '@proj-airi/stage-shared/perf/usage'
import type { ProcessMetric } from 'electron'

import { decideHostContended, machineExternalCpuPct, parsePsiCpu, processRole } from '@proj-airi/stage-shared/perf/usage'

/** The members of Electron's `ProcessMetric` the recorder reads. It never reads `cpu.percentCPUUsage`. */
export type PerfProcessMetric = Pick<ProcessMetric, 'pid' | 'creationTime' | 'type' | 'name' | 'serviceName'> & {
  cpu: Pick<ProcessMetric['cpu'], 'cumulativeCPUUsage'>
  memory: Pick<ProcessMetric['memory'], 'workingSetSize' | 'peakWorkingSetSize'>
}

/** A renderer process the app can name: a window's own renderer, or the DevTools renderer inspecting it. */
export interface PerfRendererOwner {
  osPid: number
  label: string
  /** OS process id of the DevTools renderer while DevTools is open for this window. */
  devtoolsOsPid: number | null
}

export interface PerfMachineReading {
  load1: number
  cores: number
  cpuTimes: CpuTimes[]
  /** The text of `/proc/pressure/cpu`; `null` where PSI is unavailable. */
  psiText: string | null
}

/** CPU milliseconds in a `process.cpuUsage()` delta, user plus system. */
export function cpuUsageMs(usage: NodeJS.CpuUsage): number {
  return (usage.user + usage.system) / 1000
}

export function cpuReadings(metrics: readonly PerfProcessMetric[]): ProcessCpuReading[] {
  return metrics.map(metric => ({ pid: metric.pid, creationTime: metric.creationTime, cumulativeCpuSec: metric.cpu.cumulativeCPUUsage }))
}

/** Names every process and attaches its CPU share from `cpuByKey` (keyed `${pid}:${creationTime}`) and its memory in KiB. */
export function describeProcesses(
  metrics: readonly PerfProcessMetric[],
  owners: readonly PerfRendererOwner[],
  cpuByKey: ReadonlyMap<string, number | null>,
): SampleRecord['processes'] {
  const windowByPid = new Map<number, string>()
  const devtoolsByPid = new Map<number, string>()
  for (const owner of owners) {
    windowByPid.set(owner.osPid, owner.label)
    if (owner.devtoolsOsPid !== null)
      devtoolsByPid.set(owner.devtoolsOsPid, owner.label)
  }

  return metrics.map((metric) => {
    const windowLabel = metric.type === 'Tab' ? windowByPid.get(metric.pid) : undefined
    const devtoolsKind = metric.type === 'Tab' && windowLabel === undefined ? devtoolsByPid.get(metric.pid) : undefined
    return {
      pid: metric.pid,
      creationTime: metric.creationTime,
      role: processRole({ type: metric.type, name: metric.name, serviceName: metric.serviceName, windowLabel, devtoolsKind }),
      label: windowLabel ?? devtoolsKind ?? '',
      cpuPctOfCore: cpuByKey.get(`${metric.pid}:${metric.creationTime}`) ?? null,
      workingSetKb: metric.memory.workingSetSize,
      peakWorkingSetKb: metric.memory.peakWorkingSetSize,
    }
  })
}

/**
 * Machine load around the app between two readings. `previousCpuTimes` is `null` before the first reading,
 * which makes the external share 0.
 */
export function measureMachine(params: {
  reading: PerfMachineReading
  previousCpuTimes: readonly CpuTimes[] | null
  processes: SampleRecord['processes']
}): { machine: SampleRecord['machine'], hostContended: boolean } {
  const { reading } = params
  let appCpuPctOfCoreSum = 0
  for (const entry of params.processes)
    appCpuPctOfCoreSum += entry.cpuPctOfCore ?? 0

  const machine = {
    load1: reading.load1,
    cores: reading.cores,
    externalCpuPct: params.previousCpuTimes === null
      ? 0
      : machineExternalCpuPct({ prevTimes: params.previousCpuTimes, nowTimes: reading.cpuTimes, appCpuPctOfCoreSum, cores: reading.cores }),
    psiCpuSomeAvg10: reading.psiText === null ? null : parsePsiCpu(reading.psiText),
  }
  return { machine, hostContended: decideHostContended(machine) }
}
