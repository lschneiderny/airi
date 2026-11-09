import type { HostId, HostSignal, LinuxDesktopFacts, SignalStatus } from '.'

import { describe, expect, it } from 'vitest'

import { capabilitiesForHost, presenceLimitations, resolveHostCapabilities } from '.'

const live = { kind: 'live' } as const
const desktop: LinuxDesktopFacts = {
  backend: 'kwin',
  bridge: 'ready',
  foregroundVerified: false,
  cursorVerified: false,
  geometryVerified: false,
  keepAboveVerified: false,
  lockSource: null,
  portalShortcuts: 'absent',
  bridgeFailure: null,
  clickThroughToggle: false,
  systemAudioVerified: false,
}

interface ResolutionRow {
  name: string
  host?: HostId
  facts: Partial<LinuxDesktopFacts>
  signals: Partial<Record<HostSignal, SignalStatus>>
}

const rows: ResolutionRow[] = [
  { name: 'lock without a source stays degraded', facts: {}, signals: { screenLock: { kind: 'degraded', reason: 'linux-lock-events-undocumented' } } },
  ...(['logind', 'screensaver'] as const).map(lockSource => ({ name: `${lockSource} subscription makes lock live`, facts: { lockSource }, signals: { screenLock: live } })),
  { name: 'unverified audio stays degraded', facts: {}, signals: { systemAudioCapture: { kind: 'degraded', reason: 'linux-capture-audio-unverified' } } },
  { name: 'verified audio becomes live independently of bridge failure', facts: { systemAudioVerified: true, bridge: 'failed' }, signals: { systemAudioCapture: live } },
  { name: 'absent portal keeps key release unavailable', facts: {}, signals: { globalKeyUp: { kind: 'unavailable', reason: 'wayland-no-global-input-hook' } } },
  { name: 'kwin ready unverified foreground stays unavailable', facts: {}, signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-foreground-verifying' } } },
  { name: 'kwin verified foreground becomes live', facts: { foregroundVerified: true }, signals: { foregroundWindow: live } },
  { name: 'kwin unverified cursor stays unavailable', facts: {}, signals: { cursorScreenPoint: { kind: 'unavailable', reason: 'linux-cursor-verifying' } } },
  { name: 'T2-TEST-KWIN-CURSOR preserves live X11 cursor without bridge proof', host: 'linux-x11', facts: { cursorVerified: false }, signals: { cursorScreenPoint: live } },
  { name: 'kwin unverified XWayland cursor waits for proof', host: 'linux-xwayland', facts: { cursorVerified: false }, signals: { cursorScreenPoint: { kind: 'unavailable', reason: 'linux-cursor-verifying' } } },
  { name: 'kwin verified cursor becomes live', facts: { cursorVerified: true }, signals: { cursorScreenPoint: live } },
  { name: 'kwin geometry waits for proof', facts: {}, signals: { windowOrigin: { kind: 'unavailable', reason: 'linux-geometry-verifying' }, displayOrigins: { kind: 'degraded', reason: 'wayland-display-origin-unverified' } } },
  { name: 'kwin verified geometry makes both origins live', facts: { geometryVerified: true }, signals: { windowOrigin: live, displayOrigins: live } },
  { name: 'kwin keep above waits for proof', facts: {}, signals: { alwaysOnTop: { kind: 'unavailable', reason: 'linux-keep-above-verifying' } } },
  { name: 'kwin verified keep above becomes live', facts: { keepAboveVerified: true }, signals: { alwaysOnTop: live } },
  { name: 'T2-TEST-KWIN-NATIVE preserves live XWayland always on top without bridge proof', host: 'linux-xwayland', facts: { keepAboveVerified: false }, signals: { alwaysOnTop: live } },
  { name: 'failed bridge preserves static Wayland signals', facts: { bridge: 'failed', foregroundVerified: true, cursorVerified: true, geometryVerified: true, keepAboveVerified: true }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-bridge-failed' }, cursorScreenPoint: { kind: 'unavailable', reason: 'wayland-cursor-unreported' }, windowOrigin: { kind: 'unavailable', reason: 'wayland-window-origin-hidden' }, displayOrigins: { kind: 'degraded', reason: 'wayland-display-origin-unverified' }, alwaysOnTop: { kind: 'unavailable', reason: 'wayland-no-z-order' } } },
  { name: 'unsupported KWin API reports precise failure', facts: { bridge: 'failed', bridgeFailure: 'api-unsupported' }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'kwin-api-unsupported' } } },
  { name: 'x11 EWMH verifies foreground only', host: 'linux-x11', facts: { backend: 'x11-ewmh', foregroundVerified: true }, signals: { foregroundWindow: live, cursorScreenPoint: live, windowOrigin: live, displayOrigins: live, alwaysOnTop: live, globalKeyUp: live } },
  { name: 'x11 EWMH foreground waits for proof', host: 'linux-x11', facts: { backend: 'x11-ewmh' }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-foreground-verifying' } } },
  { name: 'x11 EWMH cannot promote a Wayland session', facts: { backend: 'x11-ewmh', foregroundVerified: true }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'platform-no-foreground-binding' } } },
  { name: 'T2-TEST-EWMH-SESSION cannot promote verified foreground on XWayland', host: 'linux-xwayland', facts: { backend: 'x11-ewmh', foregroundVerified: true }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'platform-no-foreground-binding' } } },
  ...(['sway', 'hyprland'] as const).flatMap(backend => [
    { name: `${backend} foreground and geometry wait for proof`, facts: { backend }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-foreground-verifying' }, windowOrigin: { kind: 'unavailable', reason: 'linux-geometry-verifying' }, displayOrigins: { kind: 'degraded', reason: 'wayland-display-origin-unverified' } } },
    { name: `${backend} verifies foreground and geometry but cannot keep above`, facts: { backend, foregroundVerified: true, geometryVerified: true, keepAboveVerified: true }, signals: { foregroundWindow: live, windowOrigin: live, displayOrigins: live, alwaysOnTop: { kind: 'unavailable', reason: 'wayland-no-z-order' } } },
  ] satisfies ResolutionRow[]),
  { name: 'sway never invents cursor support', facts: { backend: 'sway', cursorVerified: true }, signals: { cursorScreenPoint: { kind: 'unavailable', reason: 'sway-cursor-unreported' } } },
  { name: 'hyprland cursor waits for proof', facts: { backend: 'hyprland' }, signals: { cursorScreenPoint: { kind: 'unavailable', reason: 'linux-cursor-verifying' } } },
  { name: 'hyprland verified cursor becomes live', facts: { backend: 'hyprland', cursorVerified: true }, signals: { cursorScreenPoint: live } },
  { name: 'GNOME requires an extension for hidden signals', facts: { backend: 'gnome', foregroundVerified: true, cursorVerified: true, geometryVerified: true }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'gnome-needs-extension' }, cursorScreenPoint: { kind: 'unavailable', reason: 'gnome-needs-extension' }, windowOrigin: { kind: 'unavailable', reason: 'gnome-needs-extension' } } },
  { name: 'GNOME preserves Electron XWayland origin', host: 'linux-xwayland', facts: { backend: 'gnome' }, signals: { windowOrigin: live } },
  { name: 'no backend explains unsupported foreground', facts: { backend: 'none', foregroundVerified: true }, signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-desktop-unsupported' } } },
  { name: 'click through needs a verified toggle', facts: { cursorVerified: true, geometryVerified: true }, signals: { clickThroughForward: { kind: 'unavailable', reason: 'linux-no-click-through-forward' } } },
  { name: 'click through needs a verified cursor', facts: { clickThroughToggle: true, geometryVerified: true }, signals: { clickThroughForward: { kind: 'unavailable', reason: 'linux-no-click-through-forward' } } },
  { name: 'click through needs a verified origin', facts: { clickThroughToggle: true, cursorVerified: true }, signals: { clickThroughForward: { kind: 'unavailable', reason: 'linux-no-click-through-forward' } } },
  { name: 'verified native Wayland click through is emulated', facts: { clickThroughToggle: true, cursorVerified: true, geometryVerified: true }, signals: { clickThroughForward: { kind: 'degraded', reason: 'linux-click-through-emulated' } } },
  { name: 'required case a XWayland KWin click through uses Electron origin', host: 'linux-xwayland', facts: { clickThroughToggle: true, cursorVerified: true }, signals: { windowOrigin: live, clickThroughForward: { kind: 'degraded', reason: 'linux-click-through-emulated' } } },
  { name: 'X11 click through uses existing live coordinates', host: 'linux-x11', facts: { backend: 'x11-ewmh', clickThroughToggle: true }, signals: { clickThroughForward: { kind: 'degraded', reason: 'linux-click-through-emulated' } } },
  { name: 'X11 click through is emulated while the bridge starts', host: 'linux-x11', facts: { backend: 'x11-ewmh', bridge: 'starting', clickThroughToggle: true }, signals: { clickThroughForward: { kind: 'degraded', reason: 'linux-click-through-emulated' } } },
  { name: 'a failed bridge ends emulated click through even with live X11 coordinates', host: 'linux-x11', facts: { backend: 'x11-ewmh', bridge: 'failed', clickThroughToggle: true }, signals: { cursorScreenPoint: live, windowOrigin: live, clickThroughForward: { kind: 'unavailable', reason: 'linux-no-click-through-forward' } } },
  { name: 'XWayland idle stays unavailable even with all bridge proofs', host: 'linux-xwayland', facts: { cursorVerified: true, geometryVerified: true }, signals: { systemIdleTime: { kind: 'unavailable', reason: 'xwayland-idle-constant-zero' } } },
]

describe('runtime Linux desktop capabilities', () => {
  it.each(rows)('$name', ({ host = 'linux-wayland', facts, signals }) => {
    expect(capabilitiesForHost(host, { ...desktop, ...facts }).signals).toMatchObject(signals)
  })

  it.each([
    { backend: 'kwin', pending: ['foregroundWindow', 'cursorScreenPoint', 'windowOrigin', 'displayOrigins', 'alwaysOnTop'] },
    { backend: 'x11-ewmh', host: 'linux-x11' as const, pending: ['foregroundWindow'] },
    { backend: 'sway', pending: ['foregroundWindow', 'windowOrigin', 'displayOrigins'] },
    { backend: 'hyprland', pending: ['foregroundWindow', 'cursorScreenPoint', 'windowOrigin', 'displayOrigins'] },
    { backend: 'gnome', pending: [] },
    { backend: 'none', pending: [] },
  ] satisfies Array<{ backend: LinuxDesktopFacts['backend'], host?: HostId, pending: HostSignal[] }>)(
    '$backend starting withholds exactly the signals it can provide',
    ({ backend, host = 'linux-wayland', pending }: { backend: LinuxDesktopFacts['backend'], host?: HostId, pending: HostSignal[] }) => {
      const caps = capabilitiesForHost(host, { ...desktop, backend, bridge: 'starting' })
      const starting = Object.entries(caps.signals).filter(([, status]) => status.kind === 'unavailable' && status.reason === 'linux-bridge-starting').map(([signal]) => signal)
      expect(starting.sort()).toEqual([...pending].sort())
    },
  )

  it.each(['linux-wayland', 'linux-xwayland'] as const)('required case b revokes portal key release on %s', (host) => {
    const sequence = (['session', 'bound', 'session'] as const).map(portalShortcuts => capabilitiesForHost(host, { ...desktop, portalShortcuts }).signals.globalKeyUp)
    expect(sequence).toEqual([{ kind: 'unavailable', reason: 'linux-portal-shortcut-unbound' }, live, { kind: 'unavailable', reason: 'linux-portal-shortcut-unbound' }])
  })

  it('keeps portal bindings independent of an X11 hook failure', () => {
    expect(resolveHostCapabilities({
      platform: 'linux',
      waylandSession: true,
      waylandOzone: true,
      macosMajorMinor: null,
      foregroundBindingFailed: true,
      globalInputHookFailure: 'load',
      foregroundTitlesTrusted: null,
      waylandIdleVerified: true,
      linuxDesktop: { ...desktop, foregroundVerified: true, portalShortcuts: 'bound' },
    }, 42).signals).toMatchObject({ foregroundWindow: live, globalKeyUp: live, systemIdleTime: live })
  })

  it.each(['linux-foreground-verifying', 'linux-cursor-verifying', 'linux-geometry-verifying', 'linux-keep-above-verifying', 'linux-bridge-starting', 'linux-portal-shortcut-unbound'] as const)(
    'omits transient %s from presence warnings',
    (reason) => {
      const caps = capabilitiesForHost('windows')
      expect(presenceLimitations({ ...caps, signals: { ...caps.signals, foregroundWindow: { kind: 'unavailable', reason } } })).toEqual([])
    },
  )

  it.each(['windows', 'macos', 'web'] as const)('ignores Linux facts for %s', (host) => {
    expect(capabilitiesForHost(host, { ...desktop, foregroundVerified: true })).toEqual(capabilitiesForHost(host))
  })

  it('reports the selected backend only when Linux facts are supplied', () => {
    expect(capabilitiesForHost('linux-wayland', desktop).linuxDesktopBackend).toBe('kwin')
    expect(capabilitiesForHost('linux-wayland').linuxDesktopBackend).toBeNull()
  })
})
