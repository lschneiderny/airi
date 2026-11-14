import type { OwnedProcess } from '../env/processes'

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

import { descendantsOf, listLiveProcesses } from '../env/processes'

/** One process's CPU time in clock ticks; `startTicks` (boot-relative start time) tells a reused PID apart. */
export interface ProcCpu {
  pid: number
  startTicks: number
  cpuTicks: number
}

export interface TreeCpuSnapshot {
  atMs: number
  processes: ProcCpu[]
}

export interface TreeCpuDelta {
  cpuTicks: number
  carried: number
  /** Processes first seen at the end; their whole CPU time falls in the window. */
  started: number
  /** Processes gone at the end; their time inside the window is lost, so a high count makes the delta a lower bound. */
  exited: number
}

/** The app tree's CPU over one measured window, as a percentage of one core. */
export interface AppCpuWindow extends TreeCpuDelta {
  wallMs: number
  clockTicksPerSecond: number
  cpuPctOfCore: number
  processes: number
}

/**
 * Parses `/proc/<pid>/stat` into utime + stime (fields 14 and 15) and starttime (field 22). The command name in
 * parentheses may hold spaces and parentheses, so fields are counted after the last `)`.
 */
export function parseProcStatCpu(pid: number, stat: string): ProcCpu | null {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const utime = Number(fields[11])
  const stime = Number(fields[12])
  const startTicks = Number(fields[19])
  if (fields.length < 20 || !Number.isInteger(utime) || !Number.isInteger(stime) || !Number.isInteger(startTicks))
    return null
  return { pid, startTicks, cpuTicks: utime + stime }
}

export function treeCpuDelta(before: readonly ProcCpu[], after: readonly ProcCpu[]): TreeCpuDelta {
  const key = (entry: ProcCpu) => `${entry.pid}:${entry.startTicks}`
  const earlier = new Map(before.map(entry => [key(entry), entry.cpuTicks]))
  let cpuTicks = 0
  let carried = 0
  for (const entry of after) {
    const start = earlier.get(key(entry))
    if (start !== undefined)
      carried += 1
    cpuTicks += entry.cpuTicks - (start ?? 0)
  }
  return { cpuTicks, carried, started: after.length - carried, exited: before.length - carried }
}

function readStat(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8')
  }
  catch {
    // The process exited between the listing and the read.
    return null
  }
}

/**
 * Reads the CPU time of a launched app's process tree (the dev root and every descendant in the QA session listing)
 * from `/proc`, Linux only. Each snapshot lists the tree again, so renderers spawned during the window are counted.
 */
export class AppTreeCpu {
  private constructor(private readonly root: OwnedProcess, private readonly clockTicksPerSecond: number) {}

  static async create(root: OwnedProcess): Promise<AppTreeCpu> {
    const { stdout } = await promisify(execFile)('getconf', ['CLK_TCK'])
    const clockTicks = Number(stdout.trim())
    if (!Number.isInteger(clockTicks) || clockTicks <= 0)
      throw new Error(`getconf CLK_TCK printed ${JSON.stringify(stdout.trim())}`)
    return new AppTreeCpu(root, clockTicks)
  }

  async snapshot(): Promise<TreeCpuSnapshot> {
    const pids = [this.root.pid, ...descendantsOf(await listLiveProcesses(), this.root).map(entry => entry.pid)]
    const processes = pids.flatMap((pid) => {
      const stat = readStat(pid)
      const parsed = stat === null ? null : parseProcStatCpu(pid, stat)
      return parsed ? [parsed] : []
    })
    return { atMs: performance.now(), processes }
  }

  window(before: TreeCpuSnapshot, after: TreeCpuSnapshot): AppCpuWindow {
    const delta = treeCpuDelta(before.processes, after.processes)
    const wallMs = after.atMs - before.atMs
    return {
      ...delta,
      wallMs,
      clockTicksPerSecond: this.clockTicksPerSecond,
      cpuPctOfCore: delta.cpuTicks / this.clockTicksPerSecond / (wallMs / 1000) * 100,
      processes: after.processes.length,
    }
  }
}
