import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'
import type { LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import type { LinuxDesktopBridge } from '../linux-desktop'

import { readlinkSync } from 'node:fs'
import { posix } from 'node:path'

/** How long after an AIRI window's focus event the compositor may take to report it active. */
const FOCUS_CONFIRM_MS = 1000

/** Longest caption a backend passes on. The KWin bridge script cuts a longer one to this length. */
const CAPTION_MAX_UNITS = 4096

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
 * - `appNames` lists every name the block list may match: the executable, the window class, and the desktop
 *   file name. Apps that share one `electron` or `python` executable differ only in the last two. A window that
 *   reports no desktop file name, such as an XWayland or X11 window, takes every id `desktopIdsFor` finds for its class.
 *   `appKey` is the first of the desktop file name, the window class, and the executable that the host read.
 *   These names stay in the main process; only `sample` crosses IPC.
 * - `titleCut` is true when the caption is as long as a backend passes on, so its end may be missing.
 */
export function createLinuxSampler(
  bridge: Pick<LinuxDesktopBridge, 'activeWindow' | 'busyHint'>,
  isOwnProcess: (pid: number) => boolean,
  desktopIdsFor: (windowClass: string) => readonly string[] = () => [],
) {
  return function read(): { sample: ForegroundWindowSample, appNames: readonly (string | null)[], appKey: string | null, titleCut: boolean } | null {
    const active = bridge.activeWindow()
    if (!active)
      return null

    const exePath = readExePath(active.pid)
    const exeName = exePath != null ? posix.basename(exePath) : active.resourceClass || null
    const desktopIds = active.desktopFileName ? [active.desktopFileName] : active.resourceClass ? desktopIdsFor(active.resourceClass) : []
    return {
      sample: {
        exePath,
        exeName,
        title: active.caption,
        pid: active.pid,
        windowId: active.windowId,
        ownProcess: isOwnProcess(active.pid),
        busy: active.fullScreen ? 'fullscreen' : bridge.busyHint() ?? 'accepts',
        sampledAtMs: Date.now(),
      },
      appNames: [exeName, active.resourceClass, ...desktopIds],
      // The desktop file name tells apart apps that share one `electron` or `python` executable.
      appKey: desktopIds[0] || active.resourceClass || exeName,
      titleCut: active.caption.length >= CAPTION_MAX_UNITS,
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
