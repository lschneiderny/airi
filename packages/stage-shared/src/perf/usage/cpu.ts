/** One process reading for {@link CpuDeltaTracker}, taken from Electron's `ProcessMetric`. */
export interface ProcessCpuReading {
  readonly pid: number
  /** Process creation time in epoch milliseconds; with `pid` it identifies a process across pid reuse. */
  readonly creationTime: number
  /** `cpu.cumulativeCPUUsage`, total CPU seconds since process start; Electron leaves it optional. */
  readonly cumulativeCpuSec: number | undefined
}

/**
 * Turns cumulative CPU seconds into per-process CPU percentages of one core between two `update` calls.
 *
 * It replaces `ProcessMetric.cpu.percentCPUUsage`, whose interval every `app.getAppMetrics()` caller in the main
 * process shares and resets. Processes are keyed by `${pid}:${creationTime}`, so a reused pid starts over.
 * A process with more than one busy thread can exceed 100.
 */
export class CpuDeltaTracker {
  readonly #previous = new Map<string, { readonly cpuSec: number, readonly atMs: number }>()

  /**
   * Returns each listed process's CPU percentage of one core since its previous reading.
   * The value is `null` on first sighting, without a finite cumulative CPU time, when no wall time passed,
   * or when the cumulative time went backwards. Processes missing from `processes` are forgotten.
   */
  update(processes: readonly ProcessCpuReading[], nowMs: number): Map<string, number | null> {
    const result = new Map<string, number | null>()
    for (const { pid, creationTime, cumulativeCpuSec } of processes) {
      const key = `${pid}:${creationTime}`
      const previous = this.#previous.get(key)
      if (cumulativeCpuSec === undefined || !Number.isFinite(cumulativeCpuSec)) {
        // Keeps the last good reading so the next one measures over the longer interval.
        result.set(key, null)
        continue
      }
      this.#previous.set(key, { cpuSec: cumulativeCpuSec, atMs: nowMs })
      if (!previous) {
        result.set(key, null)
        continue
      }
      const cpuSec = cumulativeCpuSec - previous.cpuSec
      const wallSec = (nowMs - previous.atMs) / 1000
      result.set(key, cpuSec >= 0 && wallSec > 0 ? cpuSec / wallSec * 100 : null)
    }
    for (const key of this.#previous.keys()) {
      if (!result.has(key))
        this.#previous.delete(key)
    }
    return result
  }
}

/**
 * Cumulative CPU time counters of one CPU or of the whole machine. On Linux they come from the aggregate `cpu` line
 * of `/proc/stat` in clock ticks; elsewhere from `os.cpus()` times in milliseconds, which have no `iowait`, `softirq`
 * or `steal`, so those are 0. Only ratios of deltas are used, so the unit does not matter, but both readings of one
 * delta must come from the same source.
 */
export interface CpuTimes {
  readonly user: number
  readonly nice: number
  readonly sys: number
  readonly idle: number
  /** Idle time spent waiting on I/O; it counts as idle. */
  readonly iowait: number
  readonly irq: number
  readonly softirq: number
  /** Time a hypervisor gave to another guest; it counts as busy. */
  readonly steal: number
}

function sumTimes(times: readonly CpuTimes[]): { busy: number, total: number } {
  let busy = 0
  let idle = 0
  for (const time of times) {
    busy += time.user + time.nice + time.sys + time.irq + time.softirq + time.steal
    idle += time.idle + time.iowait
  }
  return { busy, total: busy + idle }
}

/**
 * Reads the aggregate `cpu` line of `/proc/stat`; `null` when it is missing or has fewer than eight numeric counters.
 * `guest` and `guest_nice` are left out because the kernel already counts them in `user` and `nice`.
 */
export function parseProcStatCpu(text: string): CpuTimes | null {
  const match = /^cpu (.*)$/m.exec(text)
  const counters = match ? match[1].trim().split(/\s+/).map(Number) : []
  if (counters.length < 8 || !counters.slice(0, 8).every(Number.isFinite))
    return null
  const [user, nice, sys, idle, iowait, irq, softirq, steal] = counters
  return { user, nice, sys, idle, iowait, irq, softirq, steal }
}

/**
 * Percentage of the whole machine's CPU (0 to 100) that something other than the app used between two
 * {@link CpuTimes} readings. `appCpuPctOfCoreSum` is the sum of the app's per-process percentages of one core.
 *
 * Only processes in `app.getAppMetrics()` count as the app, so AIRI's own child processes outside it,
 * such as MCP servers and the computer-use daemon, count as external. Returns 0 when the counters did not advance.
 */
export function machineExternalCpuPct(params: {
  prevTimes: readonly CpuTimes[]
  nowTimes: readonly CpuTimes[]
  appCpuPctOfCoreSum: number
  cores: number
}): number {
  const previous = sumTimes(params.prevTimes)
  const now = sumTimes(params.nowTimes)
  const total = now.total - previous.total
  if (!(total > 0) || !(params.cores > 0))
    return 0
  const machineBusyPct = (now.busy - previous.busy) / total * 100
  const appPct = params.appCpuPctOfCoreSum / params.cores
  return Math.min(100, Math.max(0, machineBusyPct - appPct))
}

/** External CPU percentage of the machine at which the host counts as contended. */
export const HOST_CONTENDED_EXTERNAL_CPU_PCT = 25
/** Linux `/proc/pressure/cpu` `some avg10` at which the host counts as contended. */
export const HOST_CONTENDED_PSI_SOME_AVG10 = 10
/** One-minute load average per core at which the host counts as contended. */
export const HOST_CONTENDED_LOAD_PER_CORE = 0.75

/**
 * Tags a sample as taken on a busy host, so comparisons can keep contended and calm samples apart.
 * `psiCpuSomeAvg10` is `null` where PSI is unavailable (macOS, Windows, kernels without PSI).
 */
export function decideHostContended(params: {
  load1: number
  cores: number
  externalCpuPct: number
  psiCpuSomeAvg10: number | null
}): boolean {
  return params.externalCpuPct >= HOST_CONTENDED_EXTERNAL_CPU_PCT
    || (params.psiCpuSomeAvg10 !== null && params.psiCpuSomeAvg10 >= HOST_CONTENDED_PSI_SOME_AVG10)
    || (params.cores > 0 && params.load1 / params.cores >= HOST_CONTENDED_LOAD_PER_CORE)
}

/**
 * Electron's `ProcessMetric['type']`. Stage Shared does not depend on Electron, so callers pass `metric.type`
 * and their typecheck fails here when Electron adds a type.
 */
export type ProcessMetricType = 'Browser' | 'Tab' | 'Utility' | 'Zygote' | 'Sandbox helper' | 'GPU' | 'Pepper Plugin' | 'Pepper Plugin Broker' | 'Unknown'

export interface ProcessRoleInput {
  readonly type: ProcessMetricType
  readonly name?: string
  readonly serviceName?: string
  /** The app's label for the window whose renderer this process is. */
  readonly windowLabel?: string
  /** Set when the renderer hosts DevTools, for example `detached`. */
  readonly devtoolsKind?: string
}

/** Names what a process does, for example `browser`, `window:stage`, or `utility:network.mojom.NetworkService`. */
export function processRole(input: ProcessRoleInput): string {
  switch (input.type) {
    case 'Browser':
      return 'browser'
    case 'GPU':
      return 'gpu'
    case 'Zygote':
      return 'zygote'
    case 'Utility':
      return `utility:${input.serviceName ?? input.name ?? 'unknown'}`
    case 'Tab':
      if (input.windowLabel !== undefined)
        return `window:${input.windowLabel}`
      if (input.devtoolsKind !== undefined)
        return `devtools:${input.devtoolsKind}`
      return 'renderer:unmapped'
    case 'Sandbox helper':
    case 'Pepper Plugin':
    case 'Pepper Plugin Broker':
    case 'Unknown':
      return 'other'
    default: {
      const unhandled: never = input.type
      return unhandled
    }
  }
}

/** Reads `some avg10` from the text of `/proc/pressure/cpu`; `null` when the line is missing or malformed. */
export function parsePsiCpu(text: string): number | null {
  const match = /^some\s(?:.*\s)?avg10=(\d+(?:\.\d+)?)(?:\s|$)/m.exec(text)
  return match ? Number(match[1]) : null
}
