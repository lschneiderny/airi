import type { HostId, HostSignal, SignalStatus } from '.'

import { HostReasons } from './reasons'

export const LINUX_DESKTOP_BACKENDS = ['kwin', 'x11-ewmh', 'sway', 'hyprland', 'gnome', 'none'] as const
export type LinuxDesktopBackend = typeof LINUX_DESKTOP_BACKENDS[number]

/** Process-local proofs. Producers revoke them when their source stops being trustworthy. */
export interface LinuxDesktopFacts {
  readonly backend: LinuxDesktopBackend
  readonly bridge: 'starting' | 'ready' | 'failed'
  readonly foregroundVerified: boolean
  readonly cursorVerified: boolean
  readonly geometryVerified: boolean
  readonly keepAboveVerified: boolean
  readonly lockSource: 'logind' | 'screensaver' | null
  readonly portalShortcuts: 'absent' | 'session' | 'bound'
  readonly bridgeFailure: 'api-unsupported' | 'other' | null
  readonly clickThroughToggle: boolean
  readonly systemAudioVerified: boolean
}

/** Layers runtime proofs onto the resolver's mutable Linux signal accumulator. */
export function applyLinuxDesktopCapabilities(host: HostId, desktop: LinuxDesktopFacts, signals: Record<HostSignal, SignalStatus>): void {
  const nativeWayland = host === 'linux-wayland'
  const wayland = nativeWayland || host === 'linux-xwayland'
  if (desktop.lockSource !== null)
    signals.screenLock = { kind: 'live' }
  if (desktop.systemAudioVerified)
    signals.systemAudioCapture = { kind: 'live' }
  if (wayland) {
    switch (desktop.portalShortcuts) {
      case 'bound':
        signals.globalKeyUp = { kind: 'live' }
        break
      case 'session':
        signals.globalKeyUp = { kind: 'unavailable', reason: HostReasons.LinuxPortalShortcutUnbound }
        break
      case 'absent':
        break
    }
  }

  // Session services (lock, audio, portal) do not depend on the compositor bridge.
  const bridgeSignals: Partial<Record<HostSignal, SignalStatus>> = {}
  switch (desktop.backend) {
    case 'kwin':
    case 'hyprland':
    case 'sway':
      if (desktop.backend !== 'sway' && wayland)
        bridgeSignals.cursorScreenPoint = desktop.cursorVerified ? { kind: 'live' } : { kind: 'unavailable', reason: HostReasons.LinuxCursorVerifying }
      if (desktop.backend === 'kwin' && nativeWayland)
        bridgeSignals.alwaysOnTop = desktop.keepAboveVerified ? { kind: 'live' } : { kind: 'unavailable', reason: HostReasons.LinuxKeepAboveVerifying }
      bridgeSignals.foregroundWindow = desktop.foregroundVerified ? { kind: 'live' } : { kind: 'unavailable', reason: HostReasons.LinuxForegroundVerifying }
      if (nativeWayland) {
        bridgeSignals.windowOrigin = desktop.geometryVerified ? { kind: 'live' } : { kind: 'unavailable', reason: HostReasons.LinuxGeometryVerifying }
        bridgeSignals.displayOrigins = desktop.geometryVerified ? { kind: 'live' } : signals.displayOrigins
      }
      break
    case 'x11-ewmh':
      if (host === 'linux-x11')
        bridgeSignals.foregroundWindow = desktop.foregroundVerified ? { kind: 'live' } : { kind: 'unavailable', reason: HostReasons.LinuxForegroundVerifying }
      break
    case 'gnome':
    case 'none':
      break
  }

  switch (desktop.bridge) {
    case 'starting':
      for (const signal of ['foregroundWindow', 'cursorScreenPoint', 'windowOrigin', 'displayOrigins', 'alwaysOnTop'] as const) {
        if (bridgeSignals[signal] !== undefined)
          signals[signal] = { kind: 'unavailable', reason: HostReasons.LinuxBridgeStarting }
      }
      break
    case 'failed':
      signals.foregroundWindow = {
        kind: 'unavailable',
        reason: desktop.bridgeFailure === 'api-unsupported' ? HostReasons.KwinApiUnsupported : HostReasons.LinuxBridgeFailed,
      }
      break
    case 'ready':
      Object.assign(signals, bridgeSignals)
      switch (desktop.backend) {
        case 'sway':
          signals.cursorScreenPoint = { kind: 'unavailable', reason: HostReasons.SwayCursorUnreported }
          break
        case 'gnome':
          signals.foregroundWindow = { kind: 'unavailable', reason: HostReasons.GnomeNeedsExtension }
          signals.cursorScreenPoint = { kind: 'unavailable', reason: HostReasons.GnomeNeedsExtension }
          if (nativeWayland)
            signals.windowOrigin = { kind: 'unavailable', reason: HostReasons.GnomeNeedsExtension }
          break
        case 'none':
          signals.foregroundWindow = { kind: 'unavailable', reason: HostReasons.LinuxDesktopUnsupported }
          break
        case 'kwin':
        case 'x11-ewmh':
        case 'hyprland':
          break
      }
      break
  }

  // A failed bridge means the desktop no longer matches what was verified, so emulation stops even where Electron
  // still reports live X11 coordinates.
  if (desktop.clickThroughToggle && desktop.bridge !== 'failed' && signals.cursorScreenPoint.kind === 'live' && signals.windowOrigin.kind === 'live')
    signals.clickThroughForward = { kind: 'degraded', reason: HostReasons.LinuxClickThroughEmulated }
}
