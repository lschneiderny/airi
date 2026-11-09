import type { LinuxDesktopBackend, LinuxDesktopFacts } from './linux-desktop'
import type { HostReason } from './reasons'

import { applyLinuxDesktopCapabilities } from './linux-desktop'
import { HostReasons } from './reasons'

export { LINUX_DESKTOP_BACKENDS } from './linux-desktop'
export type { LinuxDesktopBackend, LinuxDesktopFacts } from './linux-desktop'
export { HOST_REASONS, HostReasons } from './reasons'
export type { HostReason } from './reasons'

/** The one list of host ids; schemas, CLIs and the `HostId` union all derive from it. */
export const HOST_IDS = ['windows', 'macos', 'linux-x11', 'linux-xwayland', 'linux-wayland', 'web'] as const
export type HostId = typeof HOST_IDS[number]

/** The one list of host signals, in display order; schemas, UIs and the `HostSignal` union all derive from it. */
export const HOST_SIGNALS = [
  'cursorScreenPoint',
  'windowOrigin',
  'displayOrigins',
  'systemIdleTime',
  'screenLock',
  'foregroundWindow',
  'globalKeyUp',
  'clickThroughForward',
  'alwaysOnTop',
  'systemAudioCapture',
] as const
export type HostSignal = typeof HOST_SIGNALS[number]

export type SignalStatus
  = | { kind: 'live' }
    | { kind: 'degraded', reason: HostReason }
    | { kind: 'unavailable', reason: HostReason }

/** Only a live host guarantee makes a screen cursor reading trustworthy. */
export function acceptCursorReading(cursor: SignalStatus): boolean {
  return cursor.kind === 'live'
}

export interface HostCapabilities {
  host: HostId
  linuxDesktopBackend: LinuxDesktopBackend | null
  signals: Record<HostSignal, SignalStatus>
  /** Explicit producer time in epoch milliseconds; canonical QA profiles use zero. */
  resolvedAtMs: number
}

export interface HostFacts {
  platform: 'win32' | 'darwin' | 'linux' | 'web'
  waylandSession: boolean
  waylandOzone: boolean
  macosMajorMinor: [number, number] | null
  foregroundBindingFailed: boolean
  globalInputHookFailure: 'none' | 'load' | 'start' | 'accessibility-denied'
  foregroundTitlesTrusted: boolean | null
  /** Evidence from the running host, never a persisted machine assumption. */
  waylandIdleVerified: boolean
  linuxDesktop: LinuxDesktopFacts | null
}

/** Resolves host guarantees and runtime failures without sampling signals or reading clocks. */
export function resolveHostCapabilities(facts: HostFacts, nowMs: number): HostCapabilities {
  let host: HostId
  const signals: Record<HostSignal, SignalStatus> = {
    cursorScreenPoint: { kind: 'live' },
    windowOrigin: { kind: 'live' },
    displayOrigins: { kind: 'live' },
    systemIdleTime: { kind: 'live' },
    screenLock: { kind: 'live' },
    foregroundWindow: { kind: 'live' },
    globalKeyUp: { kind: 'live' },
    clickThroughForward: { kind: 'live' },
    alwaysOnTop: { kind: 'live' },
    systemAudioCapture: { kind: 'live' },
  }

  switch (facts.platform) {
    case 'win32':
      host = 'windows'
      break
    case 'darwin':
      host = 'macos'
      if (facts.macosMajorMinor !== null) {
        const [major, minor] = facts.macosMajorMinor
        if (major < 14 || (major === 14 && minor < 2))
          signals.systemAudioCapture = { kind: 'degraded', reason: HostReasons.MacosCaptureAudioRequires14_2 }
      }
      if (facts.foregroundTitlesTrusted === false)
        signals.foregroundWindow = { kind: 'degraded', reason: HostReasons.MacosWindowTitlesUntrusted }
      break
    case 'linux':
      host = facts.waylandSession ? (facts.waylandOzone ? 'linux-wayland' : 'linux-xwayland') : 'linux-x11'
      signals.screenLock = { kind: 'degraded', reason: HostReasons.LinuxLockEventsUndocumented }
      signals.foregroundWindow = { kind: 'unavailable', reason: HostReasons.PlatformNoForegroundBinding }
      signals.clickThroughForward = { kind: 'unavailable', reason: HostReasons.LinuxNoClickThroughForward }
      signals.systemAudioCapture = { kind: 'degraded', reason: HostReasons.LinuxCaptureAudioUnverified }
      if (facts.waylandSession) {
        signals.cursorScreenPoint = { kind: 'unavailable', reason: HostReasons.WaylandCursorUnreported }
        signals.globalKeyUp = { kind: 'unavailable', reason: HostReasons.WaylandNoGlobalInputHook }
        if (facts.waylandOzone) {
          signals.windowOrigin = { kind: 'unavailable', reason: HostReasons.WaylandWindowOriginHidden }
          signals.displayOrigins = { kind: 'degraded', reason: HostReasons.WaylandDisplayOriginUnverified }
          signals.alwaysOnTop = { kind: 'unavailable', reason: HostReasons.WaylandNoZOrder }
          if (!facts.waylandIdleVerified)
            signals.systemIdleTime = { kind: 'unavailable', reason: HostReasons.WaylandIdleUnverified }
        }
        else {
          signals.systemIdleTime = { kind: 'unavailable', reason: HostReasons.XwaylandIdleConstantZero }
        }
      }
      break
    case 'web':
      return {
        host: 'web',
        linuxDesktopBackend: null,
        signals: {
          cursorScreenPoint: { kind: 'degraded', reason: HostReasons.WebPagePointerOnly },
          windowOrigin: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          displayOrigins: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          systemIdleTime: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          screenLock: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          foregroundWindow: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          globalKeyUp: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          clickThroughForward: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          alwaysOnTop: { kind: 'unavailable', reason: HostReasons.WebSandbox },
          systemAudioCapture: { kind: 'unavailable', reason: HostReasons.WebSandbox },
        },
        resolvedAtMs: nowMs,
      }
  }

  // Host limitations take precedence over failures of a binding the host cannot support.
  if (facts.foregroundBindingFailed && signals.foregroundWindow.kind !== 'unavailable')
    signals.foregroundWindow = { kind: 'unavailable', reason: HostReasons.ForegroundBindingLoadFailed }
  if (signals.globalKeyUp.kind !== 'unavailable') {
    switch (facts.globalInputHookFailure) {
      case 'none':
        break
      case 'load':
        signals.globalKeyUp = { kind: 'unavailable', reason: HostReasons.GlobalInputHookLoadFailed }
        break
      case 'start':
        signals.globalKeyUp = { kind: 'unavailable', reason: HostReasons.GlobalInputHookStartFailed }
        break
      case 'accessibility-denied':
        if (host === 'macos')
          signals.globalKeyUp = { kind: 'unavailable', reason: HostReasons.MacosAccessibilityDenied }
        break
    }
  }

  // Compositor and portal proofs supersede failures from the older native bindings.
  if (facts.platform === 'linux' && facts.linuxDesktop !== null)
    applyLinuxDesktopCapabilities(host, facts.linuxDesktop, signals)

  return { host, linuxDesktopBackend: facts.platform === 'linux' ? facts.linuxDesktop?.backend ?? null : null, signals, resolvedAtMs: nowMs }
}

/** Deterministic QA facts; native Wayland idle remains unavailable until verified at runtime. */
export function capabilitiesForHost(host: HostId, linuxDesktop?: LinuxDesktopFacts): HostCapabilities {
  const platforms = {
    'windows': 'win32',
    'macos': 'darwin',
    'linux-x11': 'linux',
    'linux-xwayland': 'linux',
    'linux-wayland': 'linux',
    'web': 'web',
  } as const
  return resolveHostCapabilities({
    platform: platforms[host],
    waylandSession: host === 'linux-wayland' || host === 'linux-xwayland',
    waylandOzone: host === 'linux-wayland',
    macosMajorMinor: host === 'macos' ? [14, 2] : null,
    foregroundBindingFailed: false,
    globalInputHookFailure: 'none',
    foregroundTitlesTrusted: null,
    waylandIdleVerified: false,
    linuxDesktop: platforms[host] === 'linux' ? linuxDesktop ?? null : null,
  }, 0)
}

/** Checks readings in sampling order, ignoring nulls; frozen and resetting sensors fail. */
export function idleAdvances(samples: Array<{ atMs: number, seconds: number | null }>): boolean {
  const readings = samples.filter((sample): sample is { atMs: number, seconds: number } => sample.seconds !== null)
  if (readings.length < 3)
    return false
  const first = readings[0]
  const last = readings[readings.length - 1]
  const elapsedMs = last.atMs - first.atMs
  return elapsedMs >= 20_000
    && readings.every((sample, index) => index === 0 || sample.seconds >= readings[index - 1].seconds)
    && last.seconds - first.seconds >= 0.8 * elapsedMs / 1000
    && last.seconds >= 5
}

const presenceSignals = ['cursorScreenPoint', 'windowOrigin', 'systemIdleTime', 'foregroundWindow', 'globalKeyUp'] as const
const transientReasons = new Set<HostReason>([
  HostReasons.WaylandIdleUnverified,
  HostReasons.LinuxBridgeStarting,
  HostReasons.LinuxForegroundVerifying,
  HostReasons.LinuxCursorVerifying,
  HostReasons.LinuxGeometryVerifying,
  HostReasons.LinuxKeepAboveVerifying,
  HostReasons.LinuxPortalShortcutUnbound,
])

/** Presence signals worth telling the user about; idle verification alone never prompts a notice. */
export function presenceLimitations(caps: HostCapabilities): Array<{ signal: HostSignal, reason: HostReason }> {
  return presenceSignals.flatMap((signal) => {
    const status = caps.signals[signal]
    return status.kind === 'live' || transientReasons.has(status.reason) ? [] : [{ signal, reason: status.reason }]
  })
}

/** Stable dismissal key for presence limitations. */
export function presenceNoticeKey(caps: HostCapabilities): string | null {
  const reasons = presenceLimitations(caps).map(limitation => limitation.reason).sort()
  return reasons.length === 0 ? null : `${caps.host}:${reasons.join(',')}`
}
