import type { LinuxDesktopBackend } from '@proj-airi/stage-shared/host-capabilities'

import type { BridgeCallbacks, DesktopDriver } from './bridge'

import { pid } from 'node:process'

import { app } from 'electron'

import { reportLinuxDesktop } from '../electron/host-capabilities'
import { HyprlandBackend } from './backends/hyprland'
import { KwinBackend } from './backends/kwin'
import { SwayBackend } from './backends/sway'
import { X11EwmhBackend } from './backends/x11'
import { X11BackendError } from './backends/x11/binding'
import { LinuxDesktopBridge } from './bridge'
import { DbusTransport } from './dbus/transport'
import { detectLinuxDesktop } from './detect'

export type { LinuxDesktopBridge, LinuxDesktopBridgeState } from './bridge'

/** The sole environment-to-backend boundary. Injected buses transfer ownership. */
export function createLinuxDesktopBridge(options: {
  env: Readonly<Record<string, string | undefined>>
  tempDir: string
  sessionBus?: DbusTransport
  systemBus?: DbusTransport
}): LinuxDesktopBridge {
  const { env } = options
  const tempDir = env.XDG_RUNTIME_DIR ?? options.tempDir
  const sessionAddress = env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${tempDir}/bus`
  const systemAddress = env.DBUS_SYSTEM_BUS_ADDRESS ?? 'unix:path=/var/run/dbus/system_bus_socket'
  const ownPids = () => [...new Set([pid, ...app.getAppMetrics().map(metric => metric.pid)])]
  type Factory = (bus: DbusTransport, callbacks: BridgeCallbacks) => DesktopDriver | undefined
  const { session, candidate } = detectLinuxDesktop(env)
  // Each backend receives its display, socket or runtime directory from `env`
  // only; a missing value fails startup with the backend's reason. Detection
  // selects `x11-ewmh` only for X11 sessions, never XWayland.
  const backends: Partial<Record<LinuxDesktopBackend, Factory>> = {
    'kwin': (transport, callbacks) => new KwinBackend({ transport, tempDir, ownPids, ...callbacks }),
    'x11-ewmh': (_bus, { onFailure, onState }) => {
      const backend = new X11EwmhBackend({ sessionType: session, display: env.DISPLAY ?? '' })
      return {
        start: async () => {
          await backend.start()
          onState('ready')
        },
        stop: () => backend.stop(),
        readActive: () => {
          try {
            const active = backend.activeWindow()
            return active && { ...active, desktopFileName: '' }
          }
          catch (error) {
            void backend.stop()
            onFailure(error instanceof X11BackendError ? error.reason : 'transport-failed')
            return null
          }
        },
      }
    },
    'sway': (_bus, { onMessage, onFailure, onState }) => {
      const backend = new SwayBackend({ socketPath: env.SWAYSOCK ?? '', ownPids, onFailure })
      backend.onActive(payload => onMessage({ method: 'Active', payload }))
      backend.onOwnWindows(payload => onMessage({ method: 'OwnWindows', payload: [...payload] }))
      return {
        start: async () => {
          await backend.start()
          onState('ready')
        },
        stop: () => backend.stop(),
      }
    },
    // Todo 9 owns the renderer-paced cursor tick that calls `requestCursor`.
    'hyprland': (_bus, { onMessage, onFailure, onState }) => {
      const backend = new HyprlandBackend({
        env: { XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR, HYPRLAND_INSTANCE_SIGNATURE: env.HYPRLAND_INSTANCE_SIGNATURE },
        ownPids,
        onMessage,
        onFailure,
      })
      return {
        start: async () => {
          await backend.start()
          onState('ready')
        },
        stop: () => backend.stop(),
        setCursorStreaming: on => backend.setCursorStreaming(on),
      }
    },
    // Reason-only desktops: no driver, so the bridge reports ready at once with no samples.
    // GNOME would need a Shell extension, which AIRI neither ships nor downloads.
    'gnome': () => undefined,
    'none': () => undefined,
  }
  const factory = backends[candidate]
  return new LinuxDesktopBridge({
    backend: factory ? candidate : 'none',
    ownPids,
    report: reportLinuxDesktop,
    createBackend: (bus, callbacks) => factory?.(bus, callbacks),
    openSessionBus: () => DbusTransport.session(sessionAddress),
    connect: async () => {
      const [session, system] = await Promise.allSettled([
        options.sessionBus ?? DbusTransport.session(sessionAddress),
        options.systemBus ?? DbusTransport.system(systemAddress),
      ])
      if (session.status === 'rejected') {
        if (system.status === 'fulfilled')
          await system.value.close()
        throw session.reason
      }
      return { sessionBus: session.value, systemBus: system.status === 'fulfilled' ? system.value : null }
    },
  })
}
