import { expect, it } from 'vitest'

import { capabilitiesForHost } from '.'

// Captured from unchanged origin/main on 2026-11-09, before the Linux contract edit.
const signals = {
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

it.each(['windows', 'macos'] as const)('preserves the captured %s capability profile', (host) => {
  // The diagnostic field is additive; existing host and signal guarantees must stay exact.
  const { linuxDesktopBackend: _backend, ...profile } = capabilitiesForHost(host)
  expect(profile).toEqual({ host, signals, resolvedAtMs: 0 })
})
