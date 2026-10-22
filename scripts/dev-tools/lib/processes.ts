import process from 'node:process'

import { capture } from './exec'

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  memoryMb: number
  /** Percent of one core, so a busy multi-threaded process can exceed 100. */
  cpuPercent: number
  startedAt: string | null
  command: string
}

/** One raw perf-counter reading: cumulative CPU time and the system clock it was read at, both in 100 ns units. */
export interface RawCpuSample {
  /** IDProcess */
  i: number
  /** PercentProcessorTime (raw: cumulative processor time) */
  c: number
  /** Timestamp_Sys100NS */
  t: number
}

/**
 * Percent of one core per PID from two raw readings, so a busy multi-threaded process can exceed 100.
 * PID 0 (Idle and `_Total`) is dropped, and a PID missing from either reading or whose counter went backwards (PID reuse) is left out.
 */
export function cpuPercentFromRaw(first: RawCpuSample[], second: RawCpuSample[]): Map<number, number> {
  const before = new Map(first.filter(sample => sample.i !== 0).map(sample => [sample.i, sample]))
  const result = new Map<number, number>()
  for (const after of second) {
    const earlier = before.get(after.i)
    if (after.i === 0 || !earlier)
      continue
    const elapsed = after.t - earlier.t
    const used = after.c - earlier.c
    if (elapsed > 0 && used >= 0)
      result.set(after.i, used / elapsed * 100)
  }
  return result
}

// NOTICE: raw counter deltas replace the Formatted class, whose percentage spans its own previous sample.
// A query soon after another reader reported 21.49 cores for a steady ~3.5-core load.
// Removal: none expected.
const windowsSnapshot = `
function Read-Raw { Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { [pscustomobject]@{ i = [int]$_.IDProcess; c = [double]$_.PercentProcessorTime; t = [double]$_.Timestamp_Sys100NS } } }
$first = @(Read-Raw)
Start-Sleep -Milliseconds 1000
$processes = @(Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    name = $_.Name
    memoryMb = [math]::Round($_.WorkingSetSize / 1MB)
    startedAt = $(if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { $null })
    command = $(if ($_.CommandLine) { $_.CommandLine } else { '' })
  }
})
$second = @(Read-Raw)
[pscustomobject]@{ first = $first; second = $second; processes = $processes } | ConvertTo-Json -Compress -Depth 4
`

interface WindowsSnapshot {
  first: RawCpuSample[]
  second: RawCpuSample[]
  processes: Omit<ProcessInfo, 'cpuPercent'>[]
}

export function snapshotProcesses(): ProcessInfo[] {
  if (process.platform === 'win32') {
    const snapshot = JSON.parse(capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsSnapshot], { cwd: process.cwd() })) as WindowsSnapshot
    const cpu = cpuPercentFromRaw(snapshot.first, snapshot.second)
    return snapshot.processes.map(info => ({ ...info, cpuPercent: cpu.get(info.pid) ?? 0 }))
  }
  // `lstart` prints five space-separated tokens, such as `Tue Oct 20 17:31:59 2026`.
  return capture('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,lstart=,args='], { cwd: process.cwd() }).split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10 || !/^\d+$/.test(fields[0]))
      return []
    const command = fields.slice(9).join(' ')
    return [{ pid: Number(fields[0]), ppid: Number(fields[1]), name: fields[9].split('/').pop() ?? '', memoryMb: Math.round(Number(fields[2]) / 1024), cpuPercent: Number(fields[3]), startedAt: new Date(fields.slice(4, 9).join(' ')).toISOString(), command }]
  })
}

/** Lowercase, forward slashes, no `file:///` prefix, so Windows, POSIX, and file-URL spellings of one path compare equal. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/file:\/\/\//gi, '').replace(/\/+$/, '').toLowerCase()
}

/** Ordered: the first match wins, so specific tools come before the runtimes that host them. */
const toolPatterns: [string, RegExp][] = [
  ['pnpm install', /pnpm(?:\.mjs|\.cjs|\.cmd)?["']?\s+(?:-\S+\s+)*(?:install|i|add)(?:\s|$)/],
  ['vitest', /vitest/],
  ['vue-tsc', /vue-tsc/],
  ['tsc', /typescript[/\\]lib[/\\]tsc|[/\\]tsc(?:\.js)?\b/],
  ['eslint', /eslint/],
  ['oxlint', /oxlint/],
  ['turbo', /turbo/],
  ['electron-vite', /electron-vite/],
  ['vite', /[/\\]vite[/\\]|vite\.js|\bvite\b/],
  ['qa-tools', /qa-tools|motion\.ts/],
  ['electron', /electron(?:\.exe)?/],
  ['godot', /godot/],
  ['tsx', /tsx[/\\]dist/],
  ['pnpm', /pnpm/],
  ['playwright', /playwright|chrome-headless|ms-playwright/],
]

export function classifyTool(info: Pick<ProcessInfo, 'name' | 'command'>): string {
  const haystack = `${info.name} ${info.command}`.toLowerCase()
  return toolPatterns.find(([, pattern]) => pattern.test(haystack))?.[0] ?? info.name.replace(/\.exe$/i, '').toLowerCase()
}

const devRuntime = /^(?:node|electron|godot\w*|esbuild|rolldown|chrome|chromium|msedge|bun|deno|turbo)(?:\.exe)?$/i

/** Worktree paths sorted longest first, so `dtuber-wt/x` beats `dtuber`; a match must end at a path boundary. */
function matchWorktree(command: string, worktrees: string[]): string | null {
  const normalized = normalizePath(command)
  for (const worktree of worktrees) {
    let index = normalized.indexOf(worktree)
    while (index !== -1) {
      const next = normalized[index + worktree.length]
      if (next === undefined || /[/\s"':]/.test(next))
        return worktree
      index = normalized.indexOf(worktree, index + 1)
    }
  }
  return null
}

export interface AttributedProcess extends ProcessInfo {
  tool: string
  /** Normalized worktree path from the process's own command line or its nearest attributed ancestor. */
  worktree: string | null
  parentAlive: boolean
}

export function attribute(processes: ProcessInfo[], worktreePaths: string[]): AttributedProcess[] {
  const worktrees = worktreePaths.map(normalizePath).sort((a, b) => b.length - a.length)
  const byPid = new Map(processes.map(info => [info.pid, info]))
  const memo = new Map<number, string | null>()
  const worktreeOf = (pid: number, seen: Set<number>): string | null => {
    if (memo.has(pid))
      return memo.get(pid) ?? null
    const info = byPid.get(pid)
    if (!info || seen.has(pid))
      return null
    seen.add(pid)
    const own = matchWorktree(info.command, worktrees)
    const result = own ?? (info.ppid === pid ? null : worktreeOf(info.ppid, seen))
    memo.set(pid, result)
    return result
  }
  return processes.map(info => ({ ...info, tool: classifyTool(info), worktree: worktreeOf(info.pid, new Set()), parentAlive: byPid.has(info.ppid) }))
}

/** A dev runtime whose parent has exited. Windows never reparents, so the parent PID points at nothing. */
export function isOrphan(info: AttributedProcess): boolean {
  return !info.parentAlive && info.worktree !== null && devRuntime.test(info.name)
}

export interface Rollup {
  worktree: string | null
  count: number
  memoryMb: number
  cpuPercent: number
  tools: { tool: string, count: number, memoryMb: number, cpuPercent: number }[]
  orphans: number
}

/** Groups attributed processes by worktree, plus a `null` group for dev runtimes outside every worktree. */
export function rollup(processes: AttributedProcess[]): Rollup[] {
  const groups = new Map<string | null, AttributedProcess[]>()
  for (const info of processes) {
    if (info.worktree === null && !devRuntime.test(info.name))
      continue
    groups.set(info.worktree, [...(groups.get(info.worktree) ?? []), info])
  }
  return [...groups.entries()].map(([worktree, members]) => {
    const tools = new Map<string, { tool: string, count: number, memoryMb: number, cpuPercent: number }>()
    for (const info of members) {
      const entry = tools.get(info.tool) ?? { tool: info.tool, count: 0, memoryMb: 0, cpuPercent: 0 }
      entry.count++
      entry.memoryMb += info.memoryMb
      entry.cpuPercent += info.cpuPercent
      tools.set(info.tool, entry)
    }
    return {
      worktree,
      count: members.length,
      memoryMb: members.reduce((sum, info) => sum + info.memoryMb, 0),
      cpuPercent: members.reduce((sum, info) => sum + info.cpuPercent, 0),
      tools: [...tools.values()].sort((a, b) => b.memoryMb - a.memoryMb),
      orphans: members.filter(isOrphan).length,
    }
  }).sort((a, b) => b.memoryMb - a.memoryMb)
}

/** PIDs of `pid` and every ancestor still alive, so a caller never kills the process tree it runs in. */
export function ancestry(processes: ProcessInfo[], pid: number): Set<number> {
  const byPid = new Map(processes.map(info => [info.pid, info]))
  const chain = new Set<number>()
  let current = byPid.get(pid)
  while (current && !chain.has(current.pid)) {
    chain.add(current.pid)
    current = byPid.get(current.ppid)
  }
  return chain
}
