export type HostId = 'windows' | 'macos' | 'linux-x11' | 'linux-xwayland' | 'linux-wayland' | 'web'

export const HostReasons = Object.freeze({
  WaylandCursorUnreported: 'wayland-cursor-unreported',
  WaylandWindowOriginHidden: 'wayland-window-origin-hidden',
  WaylandDisplayOriginUnverified: 'wayland-display-origin-unverified',
  XwaylandIdleConstantZero: 'xwayland-idle-constant-zero',
  WaylandIdleUnverified: 'wayland-idle-unverified',
  LinuxLockEventsUndocumented: 'linux-lock-events-undocumented',
  PlatformNoForegroundBinding: 'platform-no-foreground-binding',
  ForegroundBindingLoadFailed: 'foreground-binding-load-failed',
  WaylandNoGlobalInputHook: 'wayland-no-global-input-hook',
  GlobalInputHookLoadFailed: 'global-input-hook-load-failed',
  GlobalInputHookStartFailed: 'global-input-hook-start-failed',
  MacosAccessibilityDenied: 'macos-accessibility-denied',
  MacosWindowTitlesUntrusted: 'macos-window-titles-untrusted',
  LinuxNoClickThroughForward: 'linux-no-click-through-forward',
  WaylandNoZOrder: 'wayland-no-z-order',
  LinuxCaptureAudioUnverified: 'linux-capture-audio-unverified',
  MacosCaptureAudioRequires14_2: 'macos-capture-audio-requires-14-2',
  WebSandbox: 'web-sandbox',
  WebPagePointerOnly: 'web-page-pointer-only',
} as const)

export type HostReason = typeof HostReasons[keyof typeof HostReasons]

export type SignalStatus
  = | { kind: 'live' }
    | { kind: 'degraded', reason: HostReason }
    | { kind: 'unavailable', reason: HostReason }

export type HostSignal
  = | 'cursorScreenPoint'
    | 'windowOrigin'
    | 'displayOrigins'
    | 'systemIdleTime'
    | 'screenLock'
    | 'foregroundWindow'
    | 'globalKeyUp'
    | 'clickThroughForward'
    | 'alwaysOnTop'
    | 'systemAudioCapture'

export interface HostCapabilities {
  host: HostId
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

  return { host, signals, resolvedAtMs: nowMs }
}

/** Deterministic QA facts; native Wayland idle remains unavailable until verified at runtime. */
export function capabilitiesForHost(host: HostId): HostCapabilities {
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

/** Stable dismissal key for presence limitations; idle verification alone never prompts a notice. */
export function presenceNoticeKey(caps: HostCapabilities): string | null {
  const presenceSignals = ['cursorScreenPoint', 'windowOrigin', 'systemIdleTime', 'foregroundWindow', 'globalKeyUp'] as const
  const reasons = presenceSignals.flatMap((signal) => {
    const status = caps.signals[signal]
    return status.kind === 'live' || status.reason === HostReasons.WaylandIdleUnverified ? [] : [status.reason]
  }).sort()
  return reasons.length === 0 ? null : `${caps.host}:${reasons.join(',')}`
}
