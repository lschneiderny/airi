import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'
import type { BrowserWindow } from 'electron'

import type { LinuxDesktopBridge } from '../linux-desktop'

import process from 'node:process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { isLinux, isMacOS, isWindows } from 'std-env'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { createDarwinSampler, loadDarwinBinding } from './foreground-window-darwin'
import { createLinuxForegroundVerifier, createLinuxSampler } from './foreground-window-linux'
import { createWin32Sampler, loadWin32Binding } from './foreground-window-win32'
import { getCurrentHostCapabilities, reportForegroundBindingFailed, reportLinuxDesktop } from './host-capabilities'

/** Linux backends whose bridge reports the active window. */
const LINUX_FOREGROUND_BACKENDS: ReadonlySet<LinuxDesktopBridge['backend']> = new Set(['kwin', 'x11-ewmh', 'sway', 'hyprland'])

const linuxVerifiers = new WeakMap<LinuxDesktopBridge, ReturnType<typeof createLinuxForegroundVerifier>>()

function linuxVerifierFor(bridge: LinuxDesktopBridge) {
  let verifier = linuxVerifiers.get(bridge)
  if (!verifier) {
    const created = createLinuxForegroundVerifier(bridge, reportLinuxDesktop)
    onAppBeforeQuit(() => created.dispose())
    linuxVerifiers.set(bridge, created)
    verifier = created
  }
  return verifier
}

/**
 * Answers the renderer's foreground window reads through native calls over koffi.
 *
 * Use when:
 * - A window composes the shared base invokes and its renderer samples what the user has in front
 *
 * Expects:
 * - The renderer sets the sampling rate; this service never polls on its own
 * - `getSidecarPid`, when given, returns the running Godot stage sidecar's pid or `null`,
 *   so its windows count as AIRI's own
 * - `bridge` is the Linux desktop bridge on Linux. Its active-window reading backs the sampler,
 *   and this window's focus events verify that reading against AIRI's own pids
 * - koffi loads lazily on the first read, once per window, and never at module load
 *
 * Returns:
 * - Nothing; the handler goes with the window, or with the app if it quits first.
 *   Reads resolve `null` off Windows/macOS and after a failed koffi load, instead of rejecting.
 */
export function createForegroundWindowService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
  getSidecarPid?: () => number | null
  bridge?: LinuxDesktopBridge
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

  const linuxBridge = isLinux && params.bridge && LINUX_FOREGROUND_BACKENDS.has(params.bridge.backend) ? params.bridge : undefined

  function getSampler() {
    // On Linux the snapshot gate below keeps reads off until the bridge is ready and verified.
    sampler ??= (isWindows
      ? loadWin32Binding().then(binding => createWin32Sampler(binding, isOwnProcess))
      : isMacOS
        ? loadDarwinBinding().then(binding => createDarwinSampler(binding, isOwnProcess))
        : Promise.resolve(linuxBridge ? createLinuxSampler(linuxBridge, isOwnProcess) : null)).catch((error) => {
      reportForegroundBindingFailed()
      log.withError(error).warn(`foreground window sampling is unavailable: ${errorMessageFrom(error) ?? 'koffi failed to load'}`)
      return null
    })
    return sampler
  }

  const offSample = defineInvokeHandler(params.context, electron.foregroundWindow.sample, async () => {
    // A degraded snapshot (untrusted macOS window titles) still samples; an unavailable one never does.
    if (getCurrentHostCapabilities().signals.foregroundWindow.kind === 'unavailable')
      return null
    const sample = await getSampler()
    return sample?.() ?? null
  })

  const onFocus = linuxBridge ? () => linuxVerifierFor(linuxBridge).focused(isOwnProcess) : undefined
  if (onFocus)
    params.window.on('focus', onFocus)

  const offBeforeQuit = onAppBeforeQuit(offSample)
  params.window.once('closed', () => {
    offSample()
    offBeforeQuit()
    if (onFocus)
      params.window.off('focus', onFocus)
  })
}
