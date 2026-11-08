import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, powerMonitor } from 'electron'
import { isLinux } from 'std-env'

import { electron } from '../../../shared/eventa'
import { resolveIsWayland } from '../../app/ozone'
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
  // XWayland answers `null` (unknown): Chromium's X11 path reads a constant 0 there, which would read as recent input.
  // Native Wayland measures idle time through compositor protocols, so its readings pass through.
  // Source: docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md, https://github.com/electron/electron/issues/34826.
  // Removal condition: Chromium's X11 Ozone backend measures idle time under XWayland.
  const waylandSession = resolveIsWayland({ env: process.env })
  const waylandOzone = resolveIsWayland({
    explicitOzonePlatform: app.commandLine.getSwitchValue('ozone-platform'),
    ozonePlatformHint: app.commandLine.getSwitchValue('ozone-platform-hint'),
    env: process.env,
  })
  const idleTimeUnknown = isLinux && waylandSession && !waylandOzone
  const offGetSystemIdleTime = defineInvokeHandler(params.context, electron.powerMonitor.getSystemIdleTime, () => idleTimeUnknown ? null : powerMonitor.getSystemIdleTime())

  const offBeforeQuit = onAppBeforeQuit(offGetSystemIdleTime)
  params.window.once('closed', () => {
    offGetSystemIdleTime()
    offBeforeQuit()
  })
}
