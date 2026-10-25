import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { isWindows } from 'std-env'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { createWin32Sampler, loadWin32Binding } from './foreground-window-win32'

/**
 * Answers the renderer's foreground window reads through Win32 calls over koffi.
 *
 * Use when:
 * - A window composes the shared base invokes and its renderer samples what the user has in front
 *
 * Expects:
 * - The renderer sets the sampling rate; this service never polls on its own
 * - `getSidecarPid`, when given, returns the running Godot stage sidecar's pid or `null`,
 *   so its windows count as AIRI's own
 * - koffi loads lazily on the first read, once per window, and never at module load
 *
 * Returns:
 * - Nothing; the handler goes with the window, or with the app if it quits first.
 *   Reads resolve `null` off Windows and after a failed koffi load, instead of rejecting.
 */
export function createForegroundWindowService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
  getSidecarPid?: () => number | null
}) {
  const log = useLogg('foreground-window').useGlobalConfig()

  // One load attempt per window. Concurrent first reads share it, and a failed load stays
  // failed so a 1 Hz poll cannot retry it every second.
  let sampler: Promise<(() => ForegroundWindowSample | null) | null> | undefined

  function isOwnProcess(pid: number): boolean {
    // `app.getAppMetrics()` lists only Electron processes, so the Godot stage sidecar comes from
    // its own source. It is read per sample because the sidecar starts, stops, and restarts.
    return pid === process.pid || pid === params.getSidecarPid?.() || app.getAppMetrics().some(metric => metric.pid === pid)
  }

  function getSampler() {
    sampler ??= isWindows
      ? loadWin32Binding().then(binding => createWin32Sampler(binding, isOwnProcess), (error) => {
          log.withError(error).warn(`foreground window sampling is unavailable: ${errorMessageFrom(error) ?? 'koffi failed to load'}`)
          return null
        })
      : Promise.resolve(null)
    return sampler
  }

  const offSample = defineInvokeHandler(params.context, electron.foregroundWindow.sample, async () => {
    const sample = await getSampler()
    return sample?.() ?? null
  })

  const offBeforeQuit = onAppBeforeQuit(offSample)
  params.window.once('closed', () => {
    offSample()
    offBeforeQuit()
  })
}
