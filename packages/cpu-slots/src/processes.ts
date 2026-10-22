import process from 'node:process'

import { spawnSync } from 'node:child_process'

export interface ProcessRecord {
  pid: number
  ppid: number
  pgid?: number
  startedAt: number
}

export interface ProcessSnapshot {
  platform: NodeJS.Platform
  processes: ProcessRecord[]
}

export type ProcessCommand = (command: string, args: string[]) => { stdout: string, pid?: number }

const runCommand: ProcessCommand = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'C' },
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw Object.assign(new Error(result.stderr || `${command} exited ${result.status}`), { status: result.status })
  return { stdout: result.stdout, pid: result.pid }
}

/**
 * The process that created `info`, when the snapshot still holds it. Windows
 * keeps a dead parent's pid in ParentProcessId and reuses pids, so a holder
 * created after the child is a later process that merely reuses that pid.
 */
export function liveParent(info: ProcessRecord, byPid: ReadonlyMap<number, ProcessRecord>): ProcessRecord | undefined {
  const parent = byPid.get(info.ppid)
  return parent && parent !== info && parent.startedAt <= info.startedAt ? parent : undefined
}

function descendsFrom(info: ProcessRecord, ancestor: ProcessRecord, byPid: ReadonlyMap<number, ProcessRecord>): boolean {
  const visited = new Set<ProcessRecord>()
  let current: ProcessRecord | undefined = info
  while (current && current.startedAt >= ancestor.startedAt && !visited.has(current)) {
    if (current === ancestor)
      return true
    visited.add(current)
    current = liveParent(current, byPid)
  }
  return false
}

function creationTime(value: string): number {
  const milliseconds = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(value)
  return milliseconds ? Number(milliseconds[1]) : Date.parse(value)
}

/** Synchronous so release and process exit use the same workload check. */
export function snapshotProcesses(platform = process.platform, run: ProcessCommand = runCommand): ProcessSnapshot {
  let processes: ProcessRecord[]
  let probePid: number | undefined
  if (platform === 'win32') {
    const result = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress',
    ])
    probePid = result.pid
    const text = result.stdout.trim()
    const rows = (text ? JSON.parse(text) : []) as { ProcessId: number, ParentProcessId: number, CreationDate: string }[] | { ProcessId: number, ParentProcessId: number, CreationDate: string }
    processes = (Array.isArray(rows) ? rows : [rows]).map(row => ({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      startedAt: creationTime(row.CreationDate),
    }))
  }
  else {
    const result = run('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart='])
    probePid = result.pid
    processes = result.stdout.split('\n').filter(line => line.trim()).map((line) => {
      const [pid, ppid, pgid, ...date] = line.trim().split(/\s+/)
      return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), startedAt: Date.parse(date.join(' ')) }
    })
  }
  // The probe is our own child, not leased work; keeping it would retain every
  // idle lease on release. Drop only what the probe created: it may hold a dead
  // owner's pid, which that owner's surviving children still name as parent.
  const byPid = new Map(processes.map(info => [info.pid, info]))
  const probe = probePid === undefined ? undefined : byPid.get(probePid)
  return {
    platform,
    processes: probe ? processes.filter(info => !descendsFrom(info, probe, byPid)) : processes,
  }
}

/** Undefined means the OS no longer has this PID; command failures propagate. */
export function processStartedAt(pid: number, platform = process.platform, run: ProcessCommand = runCommand): number | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid process id')
  if (platform === 'win32') {
    const text = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CreationDate | ConvertTo-Json -Compress`,
    ]).stdout.trim()
    return text ? creationTime((JSON.parse(text) as { CreationDate: string }).CreationDate) : undefined
  }
  try {
    const text = run('ps', ['-o', 'lstart=', '-p', String(pid)]).stdout.trim()
    return text ? Date.parse(text) : undefined
  }
  catch (error) {
    // ps exits 1 when the selected process no longer exists.
    if (error instanceof Error && 'status' in error && error.status === 1)
      return undefined
    throw error
  }
}
