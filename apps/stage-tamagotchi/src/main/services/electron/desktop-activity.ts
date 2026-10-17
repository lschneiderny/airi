import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { powerMonitor } from 'electron'
import { isLinux } from 'std-env'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

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
  // Linux Wayland answers `null` (unknown), so the resolver falls back to `idle`.
  // Electron can return a constant 0 there, which would read as recent input.
  // Elsewhere 0 is a real reading. Source: docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md.
  // Removal condition: Electron measures idle time on Wayland sessions.
  const idleTimeUnknown = isLinux && process.env.XDG_SESSION_TYPE === 'wayland'
  const offGetSystemIdleTime = defineInvokeHandler(params.context, electron.powerMonitor.getSystemIdleTime, () => idleTimeUnknown ? null : powerMonitor.getSystemIdleTime())

  const offBeforeQuit = onAppBeforeQuit(offGetSystemIdleTime)
  params.window.once('closed', () => {
    offGetSystemIdleTime()
    offBeforeQuit()
  })
}
