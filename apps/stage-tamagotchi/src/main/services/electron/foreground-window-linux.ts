import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'
import type { LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import type { LinuxDesktopBridge } from '../linux-desktop'

import { readlinkSync } from 'node:fs'
import { posix } from 'node:path'

/** How long after an AIRI window's focus event the compositor may take to report it active. */
const FOCUS_CONFIRM_MS = 1000

/** Consecutive unconfirmed focus events that revoke foreground verification. */
const MISSES_TO_REVOKE = 3

/** Reads the executable link only; the command line and environment are never read. */
function readExePath(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/exe`)
  }
  catch {
    // The process exited, belongs to another user, or runs in another pid namespace.
    return null
  }
}

/**
 * Builds the Linux sampler over the desktop bridge's pushed active-window reading.
 *
 * Expects:
 * - `isOwnProcess` answers whether a pid belongs to AIRI itself; the caller owns that policy
 * - The caller gates sampling on the host capability snapshot, which is unavailable until the
 *   bridge is ready and its foreground reading verified
 *
 * Returns:
 * - A synchronous read of the last pushed reading; it never queries the compositor.
 *   The title is untrusted and raw; presence consumers normalize and cap it and nothing here logs it.
 */
export function createLinuxSampler(bridge: Pick<LinuxDesktopBridge, 'activeWindow' | 'busyHint'>, isOwnProcess: (pid: number) => boolean) {
  return function sample(): ForegroundWindowSample | null {
    const active = bridge.activeWindow()
    if (!active)
      return null

    const exePath = readExePath(active.pid)
    return {
      exePath,
      exeName: exePath != null ? posix.basename(exePath) : active.resourceClass || null,
      title: active.caption,
      pid: active.pid,
      ownProcess: isOwnProcess(active.pid),
      busy: active.fullScreen ? 'fullscreen' : bridge.busyHint() ?? 'accepts',
      sampledAtMs: Date.now(),
    }
  }
}

/**
 * Correlates AIRI window focus events with the bridge's active-window pid.
 *
 * Use when:
 * - An AIRI `BrowserWindow` emits `focus` on a backend that reports the active window
 *
 * Expects:
 * - One verifier per bridge, shared by every AIRI window, so misses count across windows
 *
 * Returns:
 * - `focused(isOwnProcess)` reports `foregroundVerified: true` when the bridge reports an own pid
 *   within 1 s, and `false` after three consecutive focus events that saw only foreign or null pids.
 *   A newer focus event supersedes a pending one without counting it.
 */
export function createLinuxForegroundVerifier(
  bridge: Pick<LinuxDesktopBridge, 'activeWindow' | 'onActive'>,
  report: (patch: Pick<LinuxDesktopFacts, 'foregroundVerified'>) => void,
) {
  let misses = 0
  let cancelPending: (() => void) | undefined

  function confirmed() {
    misses = 0
    report({ foregroundVerified: true })
  }

  return {
    focused(isOwnProcess: (pid: number) => boolean) {
      cancelPending?.()
      const isOwn = (active: ReturnType<LinuxDesktopBridge['activeWindow']>) => active != null && isOwnProcess(active.pid)
      if (isOwn(bridge.activeWindow())) {
        confirmed()
        return
      }

      let offActive = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => {
        offActive()
        clearTimeout(timer)
        cancelPending = undefined
      }
      offActive = bridge.onActive((active) => {
        if (!isOwn(active))
          return
        cancel()
        confirmed()
      })
      timer = setTimeout(() => {
        cancel()
        if (++misses >= MISSES_TO_REVOKE)
          report({ foregroundVerified: false })
      }, FOCUS_CONFIRM_MS)
      cancelPending = cancel
    },
    dispose() {
      cancelPending?.()
    },
  }
}
