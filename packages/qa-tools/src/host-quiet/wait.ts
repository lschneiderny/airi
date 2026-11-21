import type { CpuTimes } from '@proj-airi/stage-shared/perf/usage'

import { readFileSync } from 'node:fs'
import { availableParallelism, cpus, loadavg } from 'node:os'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import { decideHostContended, machineExternalCpuPct, parsePsiCpu } from '@proj-airi/stage-shared/perf/usage'

/** One reading of how busy the machine is, in the inputs of `decideHostContended`. */
export interface HostLoad {
  /** One-minute load average. */
  load1: number
  cores: number
  /**
   * Busy share of the whole machine (0 to 100) over the sample interval, less the measured app's share when the caller
   * names the app; this process counts as well.
   */
  externalCpuPct: number
  /** The measured app's own share of the machine (0 to 100), left out of `externalCpuPct`; absent when no app was named. */
  appCpuPct?: number
  /** `some avg10` of `/proc/pressure/cpu`; `null` where PSI is unavailable. */
  psiCpuSomeAvg10: number | null
}

export interface HostQuietResult {
  quiet: boolean
  waitedSeconds: number
  /** The last reading, which decided `quiet`. */
  sample: HostLoad
}

function cpuTimes(): CpuTimes[] {
  return cpus().map(core => ({ ...core.times, iowait: 0, softirq: 0, steal: 0 }))
}

function readPsi(): number | null {
  try {
    return parsePsiCpu(readFileSync('/proc/pressure/cpu', 'utf8'))
  }
  catch {
    // macOS, Windows, kernels without PSI, and some containers have no readable file; PSI then does not vote.
    return null
  }
}

/**
 * Reads the load average and PSI, and the machine's busy share between two `os.cpus()` snapshots `intervalMs` apart.
 * `appCpuSeconds` reads the cumulative CPU seconds of an app the caller is about to measure; the app's share over the
 * same interval is left out of the busy share, because it is the target and not outside load. The load average and
 * PSI still count the app.
 */
export async function sampleHost(options: { intervalMs?: number, signal?: AbortSignal, appCpuSeconds?: () => Promise<number> } = {}): Promise<HostLoad> {
  const appBefore = await options.appCpuSeconds?.()
  const prevTimes = cpuTimes()
  const started = performance.now()
  await delay(options.intervalMs ?? 1_000, undefined, { signal: options.signal })
  const nowTimes = cpuTimes()
  const elapsedSeconds = (performance.now() - started) / 1_000
  const appAfter = await options.appCpuSeconds?.()
  const cores = availableParallelism()
  // Percent of one core, summed over the app's processes. A process that exited between the reads lowers the sum.
  const appCpuPctOfCoreSum = appBefore === undefined || appAfter === undefined ? 0 : Math.max(0, appAfter - appBefore) / elapsedSeconds * 100
  return {
    load1: loadavg()[0],
    cores,
    externalCpuPct: machineExternalCpuPct({ prevTimes, nowTimes, appCpuPctOfCoreSum, cores }),
    psiCpuSomeAvg10: readPsi(),
    ...(appBefore === undefined ? {} : { appCpuPct: appCpuPctOfCoreSum / cores }),
  }
}

export function formatHostLoad(sample: HostLoad): string {
  const psi = sample.psiCpuSomeAvg10 === null ? 'PSI unavailable' : `CPU PSI some avg10 ${sample.psiCpuSomeAvg10.toFixed(1)}`
  const app = sample.appCpuPct === undefined ? '' : ` besides the app's ${sample.appCpuPct.toFixed(0)}%`
  return `load ${sample.load1.toFixed(2)} on ${sample.cores} cores, ${psi}, machine CPU ${sample.externalCpuPct.toFixed(0)}% busy${app}`
}

/**
 * Samples the host until `decideHostContended` calls it calm or `waitSeconds` has passed. `sample`, `now` and `sleep`
 * default to the real host, clock and timer; tests replace them to replay readings without waiting.
 */
export async function waitForHostQuiet(options: {
  waitSeconds: number
  signal?: AbortSignal
  pollMs?: number
  sample?: () => Promise<HostLoad>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<HostQuietResult> {
  const sample = options.sample ?? (() => sampleHost({ signal: options.signal }))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => delay(ms, undefined, { signal: options.signal }))
  const pollMs = options.pollMs ?? 2_000
  const started = now()
  for (;;) {
    const reading = await sample()
    const quiet = !decideHostContended(reading)
    const waited = now() - started
    if (quiet || waited >= options.waitSeconds * 1_000)
      return { quiet, waitedSeconds: Math.round(waited / 1_000), sample: reading }
    await sleep(Math.min(pollMs, options.waitSeconds * 1_000 - waited))
  }
}
