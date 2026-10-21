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
  // The snapshot command is our own child, not leased work. Keeping it would
  // make every release see a live descendant and retain an otherwise idle lease.
  const byPid = new Map(processes.map(info => [info.pid, info]))
  return {
    platform,
    processes: processes.filter((info) => {
      const visited = new Set<number>()
      let current: ProcessRecord | undefined = info
      while (current && !visited.has(current.pid)) {
        if (current.pid === probePid)
          return false
        visited.add(current.pid)
        current = byPid.get(current.ppid)
      }
      return true
    }),
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
