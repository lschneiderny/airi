import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { powerMonitor } from 'electron'

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
  const offGetSystemIdleTime = defineInvokeHandler(params.context, electron.powerMonitor.getSystemIdleTime, () => powerMonitor.getSystemIdleTime())

  const offBeforeQuit = onAppBeforeQuit(offGetSystemIdleTime)
  params.window.once('closed', () => {
    offGetSystemIdleTime()
    offBeforeQuit()
  })
}
