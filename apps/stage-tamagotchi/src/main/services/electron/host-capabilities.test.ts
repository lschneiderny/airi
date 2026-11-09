import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { getHostCapabilities, hostCapabilitiesChanged, reportPointerSample, reportSystemAudioHeard } from '@proj-airi/electron-eventa'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { screen } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import nativeWaylandIdle from '../../../../../../packages/stage-shared/src/host-capabilities/__fixtures__/native-wayland-idle.json'

const host = vi.hoisted(() => ({
  platform: 'linux',
  version: '14.2.0',
  electronVersion: '43.8.7',
  ready: true,
  switches: {} as Record<string, string>,
  getSwitchValue: vi.fn<(name: string) => string>(),
}))

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ id: 1 })),
    getDisplayMatching: vi.fn(() => ({ id: 2 })),
  },
  app: {
    isReady: () => host.ready,
    commandLine: { getSwitchValue: host.getSwitchValue },
  },
}))

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>()
  return {
    default: {
      ...actual,
      get platform() { return host.platform },
      get versions() { return { ...actual.versions, electron: host.electronVersion } },
      getSystemVersion: () => host.version,
    },
  }
})

vi.mock('std-env', () => ({
  get isLinux() { return host.platform === 'linux' },
  get isMacOS() { return host.platform === 'darwin' },
  get isWindows() { return host.platform === 'win32' },
}))

describe('host capability service', () => {
  let service: typeof import('./host-capabilities')
  let lifecycle: typeof import('../../libs/bootkit/lifecycle')

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    Object.assign(host, { platform: 'linux', version: '14.2.0', electronVersion: '43.8.7', ready: true, switches: {} })
    host.getSwitchValue.mockImplementation(name => host.switches[name] ?? '')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    service = await import('./host-capabilities')
    lifecycle = await import('../../libs/bootkit/lifecycle')
  })

  afterEach(async () => {
    await lifecycle.emitAppBeforeQuit()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function registerWindow() {
    const context = createContext()
    const window = new EventEmitter()
    const changes: HostCapabilities[] = []
    context.on(hostCapabilitiesChanged, ({ body }) => {
      if (body)
        changes.push(body)
    })
    service.createHostCapabilitiesService({ context: context as never, window: window as never })
    return { context, window, changes, read: defineInvoke(context, getHostCapabilities) }
  }

  it('publishes Linux bridge facts once and retains reports before readiness', async () => {
    host.ready = false
    service.reportLinuxDesktop({ backend: 'kwin', bridge: 'starting' })
    expect(host.getSwitchValue).not.toHaveBeenCalled()
    host.ready = true
    const reader = registerWindow()
    await expect(reader.read()).resolves.toMatchObject({
      linuxDesktopBackend: 'kwin',
      signals: { foregroundWindow: { kind: 'unavailable', reason: 'linux-bridge-starting' } },
    })
    service.reportLinuxDesktop({ bridge: 'ready', lockSource: 'screensaver' })
    service.reportLinuxDesktop({ bridge: 'ready', lockSource: 'screensaver' })
    expect(reader.changes).toHaveLength(1)
    await expect(reader.read()).resolves.toMatchObject({
      signals: {
        foregroundWindow: { kind: 'unavailable', reason: 'linux-foreground-verifying' },
        screenLock: { kind: 'live' },
      },
    })
  })

  it('emits a backend change even when every signal stays equal', () => {
    host.switches['ozone-platform'] = 'x11'
    service.reportLinuxDesktop({ backend: 'kwin', bridge: 'failed', bridgeFailure: 'other' })
    const reader = registerWindow()
    const before = service.getCurrentHostCapabilities().signals
    service.reportLinuxDesktop({ backend: 'x11-ewmh' })
    expect(reader.changes).toHaveLength(1)
    expect(reader.changes[0]?.signals).toEqual(before)
    expect(reader.changes[0]?.linuxDesktopBackend).toBe('x11-ewmh')
  })

  it.each([
    ['43.7.5', 'unavailable'],
    ['43.7.6', 'degraded'],
    ['43.8.7', 'degraded'],
    ['44.0.0', 'degraded'],
    ['42.99.99', 'unavailable'],
  ])('uses Electron %s for the Linux click-through toggle', (version, kind) => {
    host.electronVersion = version
    host.switches['ozone-platform'] = 'x11'
    service.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready', cursorVerified: true })
    expect(service.getCurrentHostCapabilities().signals.clickThroughForward.kind).toBe(kind)
  })

  it.each(['win32', 'darwin'])('ignores Linux reports on %s', async (platform) => {
    host.platform = platform
    const reader = registerWindow()
    service.reportLinuxDesktop({ backend: 'kwin', bridge: 'ready', lockSource: 'logind' })
    expect(reader.changes).toEqual([])
    await expect(reader.read()).resolves.toMatchObject({ linuxDesktopBackend: null })
  })

  it.each(['linux', 'win32', 'darwin'])('acknowledges the reserved pointer invoke without granting facts on %s', async (platform) => {
    host.platform = platform
    const reader = registerWindow()
    const before = await reader.read()
    await expect(defineInvoke(reader.context, reportPointerSample)({ clientX: 10, clientY: 20, atMs: 1000 })).resolves.toBeUndefined()
    await expect(reader.read()).resolves.toEqual(before)
    expect(reader.changes).toEqual([])
    reader.window.emit('closed')
    expect(reader.context.listeners.get(reportPointerSample.sendEvent.id)?.size ?? 0).toBe(0)
    expect(reader.context.listeners.get(reportSystemAudioHeard.sendEvent.id)?.size ?? 0).toBe(0)
  })

  it('marks Linux system audio live once when a capture hears audio', async () => {
    const reader = registerWindow()
    const report = defineInvoke(reader.context, reportSystemAudioHeard)
    await expect(reader.read()).resolves.toMatchObject({
      signals: { systemAudioCapture: { kind: 'degraded', reason: 'linux-capture-audio-unverified' } },
    })
    await report({ level: 0.05 })
    await report({ level: Number.NaN })
    expect(reader.changes).toEqual([])
    await report({ level: 0.4 })
    await report({ level: 0.6 })
    expect(reader.changes.map(caps => caps.signals.systemAudioCapture)).toEqual([{ kind: 'live' }])
    await expect(reader.read()).resolves.toEqual(reader.changes[0])

    // The proof is process memory: a restarted main process starts unverified.
    vi.resetModules()
    service = await import('./host-capabilities')
    expect(service.getCurrentHostCapabilities().signals.systemAudioCapture).toEqual({ kind: 'degraded', reason: 'linux-capture-audio-unverified' })
  })

  it.each(['win32', 'darwin'])('keeps system audio unchanged when a capture hears audio on %s', async (platform) => {
    host.platform = platform
    const reader = registerWindow()
    const before = await reader.read()
    await defineInvoke(reader.context, reportSystemAudioHeard)({ level: 0.6 })
    expect(reader.changes).toEqual([])
    await expect(reader.read()).resolves.toEqual(before)
  })

  it.each(['windows', 'macos', 'linux-x11', 'linux-xwayland', 'linux-wayland'] as const)('chooses the display from the current %s origin status', (name) => {
    Object.assign(service.getCurrentHostCapabilities(), capabilitiesForHost(name))
    const getBounds = vi.fn(() => ({ x: 10, y: 20, width: 300, height: 400 }))

    expect(service.displayForWindow({ getBounds }).id).toBe(name === 'linux-wayland' ? 1 : 2)
    expect(getBounds).toHaveBeenCalledTimes(name === 'linux-wayland' ? 0 : 1)
  })

  it('rechecks origin trust after status loss and recovery', () => {
    const snapshot = service.getCurrentHostCapabilities()
    const getBounds = vi.fn(() => ({ x: 10, y: 20, width: 300, height: 400 }))
    Object.assign(snapshot, capabilitiesForHost('windows'))
    expect(service.displayForWindow({ getBounds }).id).toBe(2)
    Object.assign(snapshot, capabilitiesForHost('linux-wayland'))
    expect(service.displayForWindow({ getBounds }).id).toBe(1)
    expect(getBounds).toHaveBeenCalledTimes(1)
    Object.assign(snapshot, capabilitiesForHost('windows'))
    expect(service.displayForWindow({ getBounds }).id).toBe(2)
    expect(screen.getDisplayMatching).toHaveBeenCalledTimes(2)
  })

  it('withholds native Wayland window origins and starts idle unverified', async () => {
    const reader = registerWindow()
    await expect(reader.read()).resolves.toMatchObject({
      host: 'linux-wayland',
      signals: {
        windowOrigin: { kind: 'unavailable', reason: 'wayland-window-origin-hidden' },
        systemIdleTime: { kind: 'unavailable', reason: 'wayland-idle-unverified' },
      },
    })
  })

  it.each(['ozone-platform', 'ozone-platform-hint'])('keeps XWayland idle unavailable with the %s switch', async (name) => {
    host.switches[name] = 'x11'
    const reader = registerWindow()
    for (let second = 0; second <= 30; second++)
      service.recordWaylandIdleSample(second, second * 1000)
    await expect(reader.read()).resolves.toMatchObject({
      host: 'linux-xwayland',
      signals: { systemIdleTime: { kind: 'unavailable', reason: 'xwayland-idle-constant-zero' } },
    })
    expect(reader.changes).toEqual([])
  })

  it('broadcasts a binding failure once to every window and serves the changed snapshot to new windows', async () => {
    host.platform = 'win32'
    const readers = [registerWindow(), registerWindow()]
    service.reportForegroundBindingFailed()
    vi.mocked(Date.now).mockReturnValue(2000)
    service.reportForegroundBindingFailed()
    for (const reader of readers) {
      expect(reader.changes).toHaveLength(1)
      expect(reader.changes[0]?.signals.foregroundWindow).toEqual({ kind: 'unavailable', reason: 'foreground-binding-load-failed' })
      await expect(reader.read()).resolves.toEqual(reader.changes[0])
    }
    await expect(registerWindow().read()).resolves.toEqual(readers[0].changes[0])
  })

  it.each([
    ['darwin', 'accessibility-denied', 'macos-accessibility-denied'],
    ['win32', 'start', 'global-input-hook-start-failed'],
    ['win32', 'load', 'global-input-hook-load-failed'],
  ] as const)('reports and recovers %s hook failure %s without repeated events', async (platform, failure, reason) => {
    host.platform = platform
    const reader = registerWindow()
    service.reportGlobalInputHookFailure(failure)
    vi.mocked(Date.now).mockReturnValue(2000)
    service.reportGlobalInputHookFailure(failure)
    expect(reader.changes).toHaveLength(1)
    expect(reader.changes[0]?.signals.globalKeyUp).toEqual({ kind: 'unavailable', reason })
    await expect(reader.read()).resolves.toEqual(reader.changes[0])
    service.reportGlobalInputHookFailure('none')
    service.reportGlobalInputHookFailure('none')
    expect(reader.changes).toHaveLength(2)
    expect(reader.changes[1]?.signals.globalKeyUp).toEqual({ kind: 'live' })
    await expect(reader.read()).resolves.toEqual(reader.changes[1])
  })

  it('publishes macOS title trust loss and recovery once each', async () => {
    host.platform = 'darwin'
    const reader = registerWindow()
    service.reportForegroundTitleTrust(false)
    service.reportForegroundTitleTrust(false)
    service.reportForegroundTitleTrust(true)
    service.reportForegroundTitleTrust(true)
    expect(reader.changes.map(caps => caps.signals.foregroundWindow)).toEqual([
      { kind: 'degraded', reason: 'macos-window-titles-untrusted' },
      { kind: 'live' },
    ])
    await expect(reader.read()).resolves.toEqual(reader.changes[1])
  })

  it('recovers title trust when different windows observe successive permission changes', async () => {
    host.platform = 'darwin'
    const reader = registerWindow()
    const { createDarwinSampler } = await import('./foreground-window-darwin')
    let trusted = true
    const binding: Parameters<typeof createDarwinSampler>[0] = {
      isProcessTrusted: () => Number(trusted),
      readSession: () => ({ onConsole: true, locked: false }),
      withFrontApplication: read => read({
        pid: 123,
        bundleIdentifier: 'example.editor',
        exePath: '/editor',
        terminated: false,
      }),
      readDisplays: () => ({ status: 0, displays: [] }),
      readWindows: () => [],
      createTitleReader: () => () => ({ title: 'Document', timedOut: false }),
    }
    const first = createDarwinSampler(binding, () => false)
    const second = createDarwinSampler(binding, () => false)
    first()
    second()
    trusted = false
    first()
    trusted = true
    second()
    expect(reader.changes.map(caps => caps.signals.foregroundWindow)).toEqual([
      { kind: 'degraded', reason: 'macos-window-titles-untrusted' },
      { kind: 'live' },
    ])
  })

  it.each([
    ['synthetic advancing', Array.from({ length: 31 }, (_, seconds) => ({ seconds, atMs: seconds * 1000 }))],
    ['captured native Wayland', nativeWaylandIdle],
    ['reset then advancing suffix', [{ seconds: 100, atMs: 0 }, ...Array.from({ length: 31 }, (_, seconds) => ({ seconds, atMs: (seconds + 1) * 1000 }))]],
    ['advancing after the ring rolls over', [...Array.from({ length: 120 }, (_, second) => ({ seconds: 0, atMs: second * 1000 })), ...Array.from({ length: 31 }, (_, seconds) => ({ seconds, atMs: (seconds + 120) * 1000 }))]],
  ])('verifies idle once from the %s series', async (_name, samples) => {
    const reader = registerWindow()
    for (const sample of samples)
      service.recordWaylandIdleSample(sample.seconds, sample.atMs)
    // Once verified, normal activity resets and further samples cannot flip it back.
    service.recordWaylandIdleSample(0, 200_000)
    service.recordWaylandIdleSample(42, 242_000)
    expect(reader.changes).toHaveLength(1)
    expect(reader.changes[0]?.signals.systemIdleTime).toEqual({ kind: 'live' })
    await expect(reader.read()).resolves.toEqual(reader.changes[0])
  })

  it('never verifies a constant-zero sensor after 120 readings', async () => {
    const reader = registerWindow()
    for (let second = 0; second < 120; second++)
      service.recordWaylandIdleSample(0, second * 1000)
    expect(reader.changes).toEqual([])
    await expect(reader.read()).resolves.toMatchObject({
      signals: { systemIdleTime: { kind: 'unavailable', reason: 'wayland-idle-unverified' } },
    })
  })

  it('discards readings older than the last 60 before verifying idle', async () => {
    const reader = registerWindow()
    service.recordWaylandIdleSample(0, 0)
    for (let index = 0; index < 60; index++)
      service.recordWaylandIdleSample(0, 10_000 + index)
    service.recordWaylandIdleSample(20, 20_000)
    expect(reader.changes).toEqual([])
    await expect(reader.read()).resolves.toMatchObject({
      signals: { systemIdleTime: { kind: 'unavailable', reason: 'wayland-idle-unverified' } },
    })
  })

  it('retains early failure reports without reading host APIs before app readiness', async () => {
    host.platform = 'win32'
    host.ready = false
    service.reportForegroundBindingFailed()
    service.reportGlobalInputHookFailure('load')
    expect(host.getSwitchValue).not.toHaveBeenCalled()
    expect(() => service.getCurrentHostCapabilities()).toThrow('Host capabilities require app readiness')
    host.ready = true
    await expect(registerWindow().read()).resolves.toMatchObject({
      signals: {
        foregroundWindow: { kind: 'unavailable', reason: 'foreground-binding-load-failed' },
        globalKeyUp: { kind: 'unavailable', reason: 'global-input-hook-load-failed' },
      },
    })
  })

  it('suppresses reports masked by host limitations', async () => {
    const reader = registerWindow()
    service.reportForegroundBindingFailed()
    service.reportForegroundTitleTrust(false)
    service.reportGlobalInputHookFailure('load')
    expect(reader.changes).toEqual([])
    await expect(reader.read()).resolves.toMatchObject({ resolvedAtMs: 1000 })
  })

  it.each(['closed', 'before-quit'])('removes the invoke and broadcasts on %s', async (event) => {
    host.platform = 'win32'
    const reader = registerWindow()
    const surviving = registerWindow()
    await expect(reader.read()).resolves.toMatchObject({ host: 'windows' })
    if (event === 'closed')
      reader.window.emit('closed')
    else
      await lifecycle.emitAppBeforeQuit()
    service.reportForegroundBindingFailed()
    expect(reader.changes).toEqual([])
    expect(surviving.changes).toHaveLength(event === 'closed' ? 1 : 0)
    expect(reader.context.listeners.get(getHostCapabilities.sendEvent.id)?.size ?? 0).toBe(0)

    // Eventa leaves unhandled invokes pending; a controlled abort bounds the failure.
    // A retained handler would resolve before the abort and fail this assertion.
    vi.useFakeTimers()
    const controller = new AbortController()
    const rejected = expect(reader.read(undefined, { signal: controller.signal })).rejects.toThrow('closed window has no handler')
    setTimeout(() => controller.abort(new Error('closed window has no handler')), 1)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
  })
})
