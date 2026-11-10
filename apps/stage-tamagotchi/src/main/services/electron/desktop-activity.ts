import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { HostReasons } from '@proj-airi/stage-shared/host-capabilities'
import { powerMonitor } from 'electron'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { getCurrentHostCapabilities, recordWaylandIdleSample } from './host-capabilities'

/**
 * Answers the renderer's desktop activity polls with built-in Electron data.
 *
 * Use when:
 * - A window composes the shared base invokes and its renderer samples desktop idle time
 *
 * Expects:
 * - The renderer polls only while the stage is visible; this service never polls on its own
 *
 * Returns:
 * - Nothing; the handler goes with the window, or with the app if it quits first
 */
export function createDesktopActivityService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  // Idle time is the only signal read here. Lock, unlock, suspend, and resume
  // already reach the renderer through the power monitor service.

  // NOTICE:
  // Idle time answers `null` unless the snapshot says `systemIdleTime` is live.
  // XWayland reads a constant 0, so it is never read there; native Wayland feeds the verifier each poll.
  // Source: docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md, https://github.com/electron/electron/issues/34826.
  // Removal condition: Chromium's X11 Ozone backend measures idle time under XWayland.
  const offGetSystemIdleTime = defineInvokeHandler(params.context, electron.powerMonitor.getSystemIdleTime, () => {
    const idle = getCurrentHostCapabilities().signals.systemIdleTime
    if (idle.kind === 'live')
      return powerMonitor.getSystemIdleTime()
    if (idle.kind === 'unavailable' && idle.reason === HostReasons.WaylandIdleUnverified)
      recordWaylandIdleSample(powerMonitor.getSystemIdleTime(), Date.now())
    return null
  })

  const offBeforeQuit = onAppBeforeQuit(offGetSystemIdleTime)
  onWindowClosed(params.window, () => {
    offGetSystemIdleTime()
    offBeforeQuit()
  })
}
