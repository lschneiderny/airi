import type { Status } from '@proj-airi/cpu-slots'

import { isPathInside } from '../../../../scripts/dev-tools/lib/paths'

type BrokerLease = Status['leases'][number]

export interface CaptureHolder {
  id: string
  class: BrokerLease['class']
  slots: number
  pid: number
  ageSeconds: number
  command: string
  cwd: string
}

export interface CapturePreflight {
  quiet: boolean
  waitedSeconds: number
  /** Leases that compete with the capture for CPU. */
  busy: CaptureHolder[]
  /** The `live` leases of app sessions from this checkout: the app being captured, which the capture needs running. */
  ownApp: CaptureHolder[]
}

function holder(lease: BrokerLease): CaptureHolder {
  return { id: lease.id, class: lease.class, slots: lease.slots, pid: lease.pid, ageSeconds: Math.round(lease.age / 1000), command: lease.command, cwd: lease.cwd }
}

/**
 * Splits the broker's leases into the capture's competitors and this checkout's own app sessions. An app session from
 * another worktree renders too, so it competes.
 */
export function captureHolders(leases: readonly BrokerLease[], repoRoot: string): Pick<CapturePreflight, 'busy' | 'ownApp'> {
  const own = (lease: BrokerLease) => lease.class === 'live' && isPathInside(repoRoot, lease.cwd)
  return { busy: leases.filter(lease => !own(lease)).map(holder), ownApp: leases.filter(own).map(holder) }
}

export function formatHolders(holders: readonly CaptureHolder[]): string {
  return holders.map(item => `  ${item.class} ${item.slots} slot(s), pid ${item.pid}, ${item.ageSeconds}s: ${item.command} (${item.cwd})`).join('\n')
}

/**
 * Reads the broker until no competing lease is held or `waitSeconds` has passed. `read`, `now` and `sleep` are the
 * broker, the clock and the timer, so tests replay recorded broker states without waiting.
 */
export async function waitForQuiet(options: {
  read: () => readonly BrokerLease[]
  repoRoot: string
  waitSeconds: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  pollMs?: number
}): Promise<CapturePreflight> {
  const pollMs = options.pollMs ?? 2000
  const started = options.now()
  for (;;) {
    const holders = captureHolders(options.read(), options.repoRoot)
    const waited = options.now() - started
    if (!holders.busy.length || waited >= options.waitSeconds * 1000)
      return { quiet: !holders.busy.length, waitedSeconds: Math.round(waited / 1000), ...holders }
    await options.sleep(Math.min(pollMs, options.waitSeconds * 1000 - waited))
  }
}

/**
 * Why `--exclusive` cannot work, or `null`. The broker grants an exclusive lease only when no lease is held, and the
 * app being captured keeps its `live` lease for the whole capture, so the request would wait until it timed out.
 */
export function exclusiveRefusal(preflight: CapturePreflight): string | null {
  if (!preflight.ownApp.length)
    return null
  return `--exclusive cannot be granted: the CPU slot broker grants an exclusive lease only when no lease is held, and this checkout's app session holds its live lease for the whole capture:\n${formatHolders(preflight.ownApp)}\nCapture without --exclusive; the pre-flight already refuses while other leases are held.`
}
