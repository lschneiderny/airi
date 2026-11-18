import type { MemoryPressure, MemoryReading } from './parse'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { parseLinuxMemory, parseMacosMemory } from './parse'

/** One line of `memory.jsonl`. */
export interface MemorySample {
  /** ISO 8601 instant of the reading. */
  t: string
  usedBytes: number
  compressedBytes: number | null
  swapUsedBytes: number | null
  pressure: MemoryPressure | null
  psiSome10: number | null
}

export interface MemorySummary {
  /** False when the platform is unsupported or no read succeeded; every value below is then null. */
  available: boolean
  /** Why sampling is unavailable, or the first failed read or write of an otherwise available run. */
  error: string | null
  intervalMs: number
  samples: MemorySample[]
  totalBytes: number | null
  peakUsedBytes: number | null
  peakCompressedBytes: number | null
  maxPressure: MemoryPressure | null
  peakPsiSome10: number | null
  swapUsedStartBytes: number | null
  swapUsedEndBytes: number | null
}

/** Reads host memory once. It may throw; the sampler catches every failure. */
export type MemoryReader = () => Promise<MemoryReading>

const execFileAsync = promisify(execFile)

/** Each command answers in milliseconds; a slow one must not stack up behind the 2 s sampling interval. */
const READ_TIMEOUT_MS = 1_500

/** Returns the reader for a supported platform (macOS or Linux), or null. */
export function createHostMemoryReader(platform: NodeJS.Platform = process.platform): MemoryReader | null {
  if (platform === 'darwin') {
    return async () => {
      const [vmStat, sysctl] = await Promise.all([
        execFileAsync('vm_stat', [], { encoding: 'utf8', timeout: READ_TIMEOUT_MS }),
        execFileAsync('sysctl', ['-n', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level', 'hw.memsize'], { encoding: 'utf8', timeout: READ_TIMEOUT_MS }),
      ])
      return parseMacosMemory(vmStat.stdout, sysctl.stdout)
    }
  }
  if (platform === 'linux') {
    return async () => {
      const [meminfo, psi] = await Promise.all([
        readFile('/proc/meminfo', 'utf8'),
        // Kernels without PSI, or with it disabled, have no such file; the rest of the reading still counts.
        readFile('/proc/pressure/memory', 'utf8').catch(() => null),
      ])
      return parseLinuxMemory(meminfo, psi)
    }
  }
  return null
}

export interface SystemMemorySamplerOptions {
  /** Defaults to the host reader. Null means the platform is unsupported. */
  reader?: MemoryReader | null
  /** Clock for sample timestamps. */
  now?: () => Date
  /** JSONL file that receives one sample per line as it is taken. */
  outFile?: string
}

const PRESSURE_RANK: Record<MemoryPressure, number> = { normal: 0, warn: 1, critical: 2 }

/**
 * Samples host memory on an interval for the duration of a run. It never throws into the caller: a failed read skips
 * that tick, and a run with no successful read summarizes as unavailable. The owner calls `stop()` once, which waits
 * for an in-flight read before it summarizes.
 */
export class SystemMemorySampler {
  private readonly reader: MemoryReader | null
  private readonly now: () => Date
  private readonly outFile: string | undefined
  private readonly samples: MemorySample[] = []
  private totalBytes: number | null = null
  private error: string | null = null
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<void> | undefined
  private intervalMs = 0
  private started = false

  constructor(options: SystemMemorySamplerOptions = {}) {
    this.reader = options.reader === undefined ? createHostMemoryReader() : options.reader
    this.now = options.now ?? (() => new Date())
    this.outFile = options.outFile
  }

  /** Takes a first sample at once, then one per interval. A second call does nothing. */
  start(intervalMs = 2_000): void {
    if (this.started)
      return
    this.started = true
    this.intervalMs = intervalMs
    if (!this.reader) {
      this.error = `memory sampling is not supported on ${process.platform}`
      return
    }
    this.tick()
    this.timer = setInterval(() => this.tick(), intervalMs)
    // Sampling must not keep a finished CLI alive.
    this.timer.unref()
  }

  async stop(): Promise<MemorySummary> {
    clearInterval(this.timer)
    this.timer = undefined
    await this.inFlight
    return this.summarize()
  }

  private tick(): void {
    // A read slower than the interval skips ticks rather than queueing them.
    if (this.inFlight || !this.reader)
      return
    const reader = this.reader
    // The sample is stamped when the read starts, so a slow command does not shift it onto the next tick.
    const t = this.now().toISOString()
    this.inFlight = (async () => {
      try {
        const reading = await reader()
        const sample: MemorySample = {
          t,
          usedBytes: reading.usedBytes,
          compressedBytes: reading.compressedBytes,
          swapUsedBytes: reading.swapUsedBytes,
          pressure: reading.pressure,
          psiSome10: reading.psiSome10,
        }
        this.samples.push(sample)
        this.totalBytes = reading.totalBytes ?? this.totalBytes
        if (this.outFile)
          appendFileSync(this.outFile, `${JSON.stringify(sample)}\n`)
      }
      catch (error) {
        this.error ??= errorMessageFrom(error) ?? 'memory read failed'
      }
      finally {
        this.inFlight = undefined
      }
    })()
  }

  private summarize(): MemorySummary {
    const samples = [...this.samples]
    const base = { intervalMs: this.intervalMs, samples }
    if (!samples.length) {
      return {
        ...base,
        available: false,
        error: this.error ?? (this.started ? 'no memory sample was taken' : 'memory sampling was not started'),
        totalBytes: null,
        peakUsedBytes: null,
        peakCompressedBytes: null,
        maxPressure: null,
        peakPsiSome10: null,
        swapUsedStartBytes: null,
        swapUsedEndBytes: null,
      }
    }
    const peak = (values: (number | null)[]) => {
      const present = values.filter(value => value !== null)
      return present.length ? Math.max(...present) : null
    }
    let maxPressure: MemoryPressure | null = null
    for (const { pressure } of samples) {
      if (pressure && (!maxPressure || PRESSURE_RANK[pressure] > PRESSURE_RANK[maxPressure]))
        maxPressure = pressure
    }
    return {
      ...base,
      available: true,
      error: this.error,
      totalBytes: this.totalBytes,
      peakUsedBytes: peak(samples.map(sample => sample.usedBytes)),
      peakCompressedBytes: peak(samples.map(sample => sample.compressedBytes)),
      maxPressure,
      peakPsiSome10: peak(samples.map(sample => sample.psiSome10)),
      swapUsedStartBytes: samples[0].swapUsedBytes,
      swapUsedEndBytes: samples.at(-1)!.swapUsedBytes,
    }
  }
}

/** The compact memory figures a run prints in its stdout summary. */
export interface MemoryReport {
  peakUsedGiB: number
  peakCompressedGiB: number | null
  maxPressure: MemoryPressure | null
  peakPsiSome10: number | null
  /** Swap used at the last sample minus swap used at the first. */
  swapDeltaMiB: number | null
}

/** Rounds to two decimals, which is enough to compare runs on a 16 GiB host. */
function toUnit(bytes: number, unitBytes: number): number {
  return Math.round((bytes / unitBytes) * 100) / 100
}

/** Condenses a summary for a stdout summary, or null when sampling was unavailable. */
export function memoryReport(summary: MemorySummary): MemoryReport | null {
  if (!summary.available || summary.peakUsedBytes === null)
    return null
  const { swapUsedStartBytes: start, swapUsedEndBytes: end } = summary
  return {
    peakUsedGiB: toUnit(summary.peakUsedBytes, 1024 ** 3),
    peakCompressedGiB: summary.peakCompressedBytes === null ? null : toUnit(summary.peakCompressedBytes, 1024 ** 3),
    maxPressure: summary.maxPressure,
    peakPsiSome10: summary.peakPsiSome10,
    swapDeltaMiB: start === null || end === null ? null : toUnit(end - start, 1024 ** 2),
  }
}
