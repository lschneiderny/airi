import { execFile } from 'node:child_process'
import { platform } from 'node:process'

/** One row of the live process table. `created` identifies the process together with `pid`, since PIDs are reused. */
export interface LiveProcess {
  pid: number
  parentPid: number
  commandLine: string
  /** Creation time as a number that is stable for the life of the process (Windows FILETIME UTC); `undefined` where the OS listing has none. */
  created?: number
}

/** A process this run owns, as recorded while it was known to be ours. */
export interface OwnedProcess {
  pid: number
  created?: number
  commandLine: string
}

export interface KillReceipt {
  pid: number
  commandLine: string
  invocation: string
  exitCode: number | null
  output: string
}

export type ProcessLister = () => Promise<LiveProcess[]>
export type TreeKiller = (pid: number) => Promise<Omit<KillReceipt, 'commandLine'>>

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase()
}

/**
 * Splits a command line into arguments the way Windows and POSIX shells group them: whitespace separates arguments
 * except inside double quotes, and the quotes are removed. `"C:/wt/a copy/x.exe" .` is two arguments.
 */
export function splitCommandLine(commandLine: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  let started = false
  for (const char of commandLine) {
    if (char === '"') {
      quoted = !quoted
      started = true
    }
    else if (!quoted && /\s/.test(char)) {
      if (started)
        args.push(current)
      current = ''
      started = false
    }
    else {
      current += char
      started = true
    }
  }
  if (started)
    args.push(current)
  return args
}

/**
 * Whether one argument of `commandLine` names `dir` itself or a path inside it. Within an argument the path must start
 * at the argument start or after a non-path character (as in `--user-data-dir=<dir>`), and must end at the argument
 * end or at a path separator. So `<dir> copy/x` (one quoted argument) and `<dir>-x/y` never match, while a different
 * case or slash direction of the same path does.
 */
export function commandLineContainsPath(commandLine: string, dir: string): boolean {
  const needle = normalizePath(dir).replace(/\/+$/, '')
  if (needle.length === 0)
    return false
  return splitCommandLine(commandLine).some((arg) => {
    const haystack = normalizePath(arg)
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
      const previous = index === 0 ? undefined : haystack[index - 1]
      const next = haystack[index + needle.length]
      if ((previous === undefined || !/[\w.\- /]/.test(previous)) && (next === undefined || next === '/'))
        return true
    }
    return false
  })
}

/** Whether a live row is still the same process that was recorded: same PID and, when both know it, same creation time. */
export function isSameProcess(live: LiveProcess, owned: Pick<OwnedProcess, 'pid' | 'created'>): boolean {
  if (live.pid !== owned.pid)
    return false
  return owned.created === undefined || live.created === undefined || live.created === owned.created
}

/** Every live descendant of `rootPid`, following parent links and refusing links to a parent created after its child (a reused PID). */
export function descendantsOf(listing: readonly LiveProcess[], root: Pick<OwnedProcess, 'pid' | 'created'>): LiveProcess[] {
  const byParent = new Map<number, LiveProcess[]>()
  for (const entry of listing) {
    const siblings = byParent.get(entry.parentPid) ?? []
    siblings.push(entry)
    byParent.set(entry.parentPid, siblings)
  }
  const found: LiveProcess[] = []
  const queue: Pick<LiveProcess, 'pid' | 'created'>[] = [root]
  const seen = new Set<number>([root.pid])
  while (queue.length > 0) {
    const parent = queue.shift()!
    for (const child of byParent.get(parent.pid) ?? []) {
      if (seen.has(child.pid))
        continue
      if (parent.created !== undefined && child.created !== undefined && child.created < parent.created)
        continue
      seen.add(child.pid)
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/** Parses the JSON that `Get-CimInstance Win32_Process` prints through `listProcessesCommand`. */
export function parseWindowsProcessListing(stdout: string): LiveProcess[] {
  const parsed = JSON.parse(stdout) as WindowsRow | WindowsRow[]
  return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
    pid: row.ProcessId,
    parentPid: row.ParentProcessId ?? 0,
    commandLine: row.CommandLine ?? '',
    created: typeof row.Created === 'number' ? row.Created : undefined,
  }))
}

interface WindowsRow {
  ProcessId: number
  ParentProcessId?: number
  CommandLine: string | null
  Created?: number | null
}

/** Parses `ps -eo pid=,ppid=,args=` output. */
export function parsePosixProcessListing(stdout: string): LiveProcess[] {
  return stdout.split('\n').flatMap((line) => {
    const [pid, parentPid, ...args] = line.trim().split(/ +/)
    return pid && parentPid && /^\d+$/.test(pid) && /^\d+$/.test(parentPid) ? [{ pid: Number(pid), parentPid: Number(parentPid), commandLine: args.join(' ') }] : []
  })
}

const windowsListScript = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,@{n=\'Created\';e={$_.CreationDate.ToFileTimeUtc()}} | ConvertTo-Json -Compress'

/** Lists every live process with its parent and command line. Bounded by `timeoutMs`. */
export function listLiveProcesses(timeoutMs = 20_000): Promise<LiveProcess[]> {
  const [command, args] = platform === 'win32'
    ? ['powershell', ['-NoProfile', '-NonInteractive', '-Command', windowsListScript]] as const
    : ['ps', ['-eo', 'pid=,ppid=,args=']] as const
  return new Promise((resolveList, reject) => {
    execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      try {
        resolveList(platform === 'win32' ? parseWindowsProcessListing(stdout) : parsePosixProcessListing(stdout))
      }
      catch (parseError) {
        reject(parseError)
      }
    })
  })
}

/** Builds the tree-kill command for one PID: `taskkill /PID <pid> /T /F` on Windows, a process-group SIGKILL elsewhere. */
export function treeKillCommand(pid: number, os: NodeJS.Platform = platform): { command: string, args: string[] } {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error(`Refusing to kill PID ${pid}`)
  return os === 'win32'
    ? { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
    : { command: 'kill', args: ['-KILL', `-${pid}`] }
}

/** Runs `treeKillCommand(pid)`; never throws for a non-zero exit, the receipt carries it. */
export const killTree: TreeKiller = pid => new Promise((resolveKill) => {
  const { command, args } = treeKillCommand(pid)
  execFile(command, args, { timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
    const exitCode = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? null : 0
    resolveKill({ pid, invocation: [command, ...args].join(' '), exitCode, output: `${stdout}${stderr}`.trim() })
  })
})

export interface OwnershipCheck {
  /** Paths, at least one of which the live command line must contain: the worktree or the run's profile. */
  ownedPaths: readonly string[]
}

/**
 * Kills the tree of `target` only after re-reading the live process table: the PID must still be the same process
 * (creation time) and its live command line must contain one of `ownedPaths`. Returns `null` when the process is gone.
 * Throws, without killing, when the PID now belongs to a process that is not ours.
 */
export async function killOwnedTree(target: Pick<OwnedProcess, 'pid' | 'created'>, check: OwnershipCheck, deps: { list: ProcessLister, kill: TreeKiller }): Promise<KillReceipt | null> {
  const live = (await deps.list()).find(entry => entry.pid === target.pid)
  if (!live || !isSameProcess(live, target))
    return null
  if (!check.ownedPaths.some(path => commandLineContainsPath(live.commandLine, path)))
    throw new Error(`Refusing to kill PID ${target.pid}: its live command line does not contain ${check.ownedPaths.join(' or ')}: ${live.commandLine}`)
  return { ...(await deps.kill(target.pid)), commandLine: live.commandLine }
}
