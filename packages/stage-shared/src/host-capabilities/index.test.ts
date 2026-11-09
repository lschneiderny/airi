import type { HostFacts, HostId, HostSignal, SignalStatus } from '.'

import { describe, expect, it } from 'vitest'

import { capabilitiesForHost, idleAdvances, presenceNoticeKey, resolveHostCapabilities } from '.'

function facts(overrides: Partial<HostFacts> = {}): HostFacts {
  return {
    platform: 'win32',
    waylandSession: false,
    waylandOzone: false,
    macosMajorMinor: null,
    foregroundBindingFailed: false,
    globalInputHookFailure: 'none',
    foregroundTitlesTrusted: null,
    waylandIdleVerified: false,
    linuxDesktop: null,
    ...overrides,
  }
}

const live: SignalStatus = { kind: 'live' }
const allLive: Record<HostSignal, SignalStatus> = {
  cursorScreenPoint: live,
  windowOrigin: live,
  displayOrigins: live,
  systemIdleTime: live,
  screenLock: live,
  foregroundWindow: live,
  globalKeyUp: live,
  clickThroughForward: live,
  alwaysOnTop: live,
  systemAudioCapture: live,
}
const linuxSignals: Record<HostSignal, SignalStatus> = {
  ...allLive,
  screenLock: { kind: 'degraded', reason: 'linux-lock-events-undocumented' },
  foregroundWindow: { kind: 'unavailable', reason: 'platform-no-foreground-binding' },
  clickThroughForward: { kind: 'unavailable', reason: 'linux-no-click-through-forward' },
  systemAudioCapture: { kind: 'degraded', reason: 'linux-capture-audio-unverified' },
}
const waylandSignals: Record<HostSignal, SignalStatus> = {
  ...linuxSignals,
  cursorScreenPoint: { kind: 'unavailable', reason: 'wayland-cursor-unreported' },
  windowOrigin: { kind: 'unavailable', reason: 'wayland-window-origin-hidden' },
  displayOrigins: { kind: 'degraded', reason: 'wayland-display-origin-unverified' },
  systemIdleTime: { kind: 'unavailable', reason: 'wayland-idle-unverified' },
  globalKeyUp: { kind: 'unavailable', reason: 'wayland-no-global-input-hook' },
  alwaysOnTop: { kind: 'unavailable', reason: 'wayland-no-z-order' },
}
const hostRows: Array<{ host: HostId, facts: HostFacts, signals: Record<HostSignal, SignalStatus> }> = [
  { host: 'windows', facts: facts(), signals: allLive },
  { host: 'macos', facts: facts({ platform: 'darwin', macosMajorMinor: [14, 2] }), signals: allLive },
  { host: 'linux-x11', facts: facts({ platform: 'linux' }), signals: linuxSignals },
  {
    host: 'linux-xwayland',
    facts: facts({ platform: 'linux', waylandSession: true }),
    signals: {
      ...linuxSignals,
      cursorScreenPoint: { kind: 'unavailable', reason: 'wayland-cursor-unreported' },
      systemIdleTime: { kind: 'unavailable', reason: 'xwayland-idle-constant-zero' },
      globalKeyUp: { kind: 'unavailable', reason: 'wayland-no-global-input-hook' },
    },
  },
  {
    host: 'linux-wayland',
    facts: facts({ platform: 'linux', waylandSession: true, waylandOzone: true }),
    signals: waylandSignals,
  },
  {
    host: 'web',
    facts: facts({ platform: 'web' }),
    signals: {
      cursorScreenPoint: { kind: 'degraded', reason: 'web-page-pointer-only' },
      windowOrigin: { kind: 'unavailable', reason: 'web-sandbox' },
      displayOrigins: { kind: 'unavailable', reason: 'web-sandbox' },
      systemIdleTime: { kind: 'unavailable', reason: 'web-sandbox' },
      screenLock: { kind: 'unavailable', reason: 'web-sandbox' },
      foregroundWindow: { kind: 'unavailable', reason: 'web-sandbox' },
      globalKeyUp: { kind: 'unavailable', reason: 'web-sandbox' },
      clickThroughForward: { kind: 'unavailable', reason: 'web-sandbox' },
      alwaysOnTop: { kind: 'unavailable', reason: 'web-sandbox' },
      systemAudioCapture: { kind: 'unavailable', reason: 'web-sandbox' },
    },
  },
]

describe('resolveHostCapabilities', () => {
  it.each(hostRows)('resolves every signal for $host', ({ host, facts, signals }) => {
    expect(resolveHostCapabilities(facts, 1234)).toEqual({ host, linuxDesktopBackend: null, signals, resolvedAtMs: 1234 })
  })

  it('enables native Wayland idle only with runtime verification', () => {
    const caps = resolveHostCapabilities(facts({
      platform: 'linux',
      waylandSession: true,
      waylandOzone: true,
      waylandIdleVerified: true,
    }), 10)

    expect(caps.signals).toEqual({ ...waylandSignals, systemIdleTime: live })
  })

  it.each([
    [13, 6, 'degraded'],
    [14, 1, 'degraded'],
    [14, 2, 'live'],
    [15, 0, 'live'],
  ] as const)('resolves macOS %i.%i audio as %s', (major, minor, kind) => {
    const caps = resolveHostCapabilities(facts({ platform: 'darwin', macosMajorMinor: [major, minor] }), 0)

    expect(caps.signals.systemAudioCapture).toEqual(kind === 'live'
      ? live
      : { kind: 'degraded', reason: 'macos-capture-audio-requires-14-2' })
  })

  const platforms = ['win32', 'darwin', 'linux'] as const
  const failures = ['none', 'load', 'start', 'accessibility-denied'] as const
  const failureReasons = {
    'load': 'global-input-hook-load-failed',
    'start': 'global-input-hook-start-failed',
    'accessibility-denied': 'macos-accessibility-denied',
  } as const

  it.each(platforms.flatMap(platform => failures.map(failure => ({ platform, failure }))))(
    'resolves $failure hook failure on $platform',
    ({ platform, failure }) => {
      const caps = resolveHostCapabilities(facts({ platform, globalInputHookFailure: failure }), 0)

      expect(caps.signals.globalKeyUp).toEqual(
        failure === 'none' || (failure === 'accessibility-denied' && platform !== 'darwin')
          ? live
          : { kind: 'unavailable', reason: failureReasons[failure] },
      )
    },
  )

  it.each(platforms)('resolves foreground binding failure on %s without replacing host unavailability', (platform) => {
    const caps = resolveHostCapabilities(facts({ platform, foregroundBindingFailed: true }), 0)

    expect(caps.signals.foregroundWindow).toEqual({
      kind: 'unavailable',
      reason: platform === 'linux' ? 'platform-no-foreground-binding' : 'foreground-binding-load-failed',
    })
  })

  it.each([false, null, true])('resolves macOS title trust %s', (foregroundTitlesTrusted) => {
    const caps = resolveHostCapabilities(facts({ platform: 'darwin', foregroundTitlesTrusted }), 0)

    expect(caps.signals.foregroundWindow).toEqual(foregroundTitlesTrusted === false
      ? { kind: 'degraded', reason: 'macos-window-titles-untrusted' }
      : live)
  })

  it('keeps a binding failure unavailable when macOS titles are untrusted', () => {
    const caps = resolveHostCapabilities(facts({
      platform: 'darwin',
      foregroundBindingFailed: true,
      foregroundTitlesTrusted: false,
    }), 0)

    expect(caps.signals.foregroundWindow).toEqual({ kind: 'unavailable', reason: 'foreground-binding-load-failed' })
  })

  it.each(hostRows.filter(row => ['linux-xwayland', 'linux-wayland', 'web'].includes(row.host)))(
    'preserves unavailable host signals over runtime failures on $host',
    ({ facts: hostFacts, signals }) => {
      const caps = resolveHostCapabilities({
        ...hostFacts,
        foregroundBindingFailed: true,
        globalInputHookFailure: 'load',
      }, 0)

      expect(caps.signals).toEqual(signals)
    },
  )
})

describe('capabilitiesForHost', () => {
  it.each(hostRows)('provides the canonical $host profile without verified idle', ({ host, signals }) => {
    expect(capabilitiesForHost(host)).toEqual({ host, linuxDesktopBackend: null, signals, resolvedAtMs: 0 })
  })
})

describe('idleAdvances', () => {
  it.each([
    { name: 'rising 0..30 over 30 seconds', samples: [[0, 0], [10_000, 10], [30_000, 30]], expected: true },
    { name: 'constant 42', samples: [[0, 42], [10_000, 42], [30_000, 42]], expected: false },
    { name: 'fewer than three readings', samples: [[0, 0], [30_000, 30]], expected: false },
    { name: 'decreasing values', samples: [[0, 0], [10_000, 15], [20_000, 10], [30_000, 30]], expected: false },
    { name: 'null in the middle', samples: [[0, 0], [10_000, 10], [20_000, null], [30_000, 30]], expected: true },
    { name: 'only null readings', samples: [[0, null], [10_000, null], [30_000, null]], expected: false },
    { name: 'empty readings', samples: [], expected: false },
    { name: 'less than 20 seconds', samples: [[0, 0], [10_000, 10], [19_999, 20]], expected: false },
    { name: 'exactly 80 percent advancement over 20 seconds', samples: [[0, 0], [10_000, 8], [20_000, 16]], expected: true },
    { name: 'less than 80 percent advancement', samples: [[0, 0], [10_000, 8], [20_000, 15.9]], expected: false },
    { name: 'final value below five', samples: [[0, -20], [10_000, -10], [20_000, 4]], expected: false },
    { name: 'final value exactly five', samples: [[0, -15], [10_000, -5], [20_000, 5]], expected: true },
  ] satisfies Array<{ name: string, samples: Array<[number, number | null]>, expected: boolean }>)(
    'verifies $name: $expected',
    ({ samples, expected }) => {
      expect(idleAdvances(samples.map(([atMs, seconds]) => ({ atMs, seconds })))).toBe(expected)
    },
  )
})

describe('presenceNoticeKey', () => {
  it('returns null for live Windows presence signals', () => {
    expect(presenceNoticeKey(capabilitiesForHost('windows'))).toBeNull()
  })

  it('sorts native Wayland presence reasons and ignores transient idle verification', () => {
    const caps = capabilitiesForHost('linux-wayland')

    expect(presenceNoticeKey(caps)).toBe('linux-wayland:platform-no-foreground-binding,wayland-cursor-unreported,wayland-no-global-input-hook,wayland-window-origin-hidden')
    expect(presenceNoticeKey({ ...caps, signals: { ...caps.signals, systemIdleTime: live } })).toBe(presenceNoticeKey(caps))
  })

  it('returns null when only the transient idle status is unavailable', () => {
    expect(presenceNoticeKey({ host: 'linux-wayland', linuxDesktopBackend: null, signals: { ...allLive, systemIdleTime: waylandSignals.systemIdleTime }, resolvedAtMs: 0 })).toBeNull()
  })

  it('ignores non-presence audio degradation on macOS', () => {
    expect(presenceNoticeKey(resolveHostCapabilities(facts({ platform: 'darwin', macosMajorMinor: [14, 1] }), 0))).toBeNull()
  })
})
