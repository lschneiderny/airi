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

const windowsSnapshot = `
$cpu = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { $cpu[[int]$_.IDProcess] = [double]$_.PercentProcessorTime }
Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    name = $_.Name
    memoryMb = [math]::Round($_.WorkingSetSize / 1MB)
    cpuPercent = $(if ($cpu.ContainsKey([int]$_.ProcessId)) { $cpu[[int]$_.ProcessId] } else { 0 })
    startedAt = $(if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { $null })
    command = $(if ($_.CommandLine) { $_.CommandLine } else { '' })
  }
} | ConvertTo-Json -Compress -Depth 2
`

export function snapshotProcesses(): ProcessInfo[] {
  if (process.platform === 'win32') {
    const json = capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsSnapshot], { cwd: process.cwd() })
    const parsed = JSON.parse(json) as ProcessInfo | ProcessInfo[]
    return Array.isArray(parsed) ? parsed : [parsed]
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
