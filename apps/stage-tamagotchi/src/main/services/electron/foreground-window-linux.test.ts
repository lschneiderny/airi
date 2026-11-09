import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLinuxForegroundVerifier, createLinuxSampler } from './foreground-window-linux'

const fsMock = vi.hoisted(() => ({
  links: new Map<string, string>(),
  readlinkSync: vi.fn((path: string) => {
    const target = fsMock.links.get(path)
    if (target === undefined)
      throw Object.assign(new Error(`EACCES: permission denied, readlink '${path}'`), { code: 'EACCES' })
    return target
  }),
  readFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readlinkSync: fsMock.readlinkSync,
  readFileSync: fsMock.readFileSync,
}))

type Active = { caption: string, resourceClass: string, desktopFileName: string, pid: number, fullScreen: boolean } | null

function createBridge() {
  const listeners = new Set<(value: Active) => void>()
  const bridge = {
    active: null as Active,
    busy: null as 'busy' | 'quiet' | null,
    activeWindow: () => bridge.active,
    busyHint: () => bridge.busy,
    onActive: (listener: (value: Active) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value: Active) {
      bridge.active = value
      for (const listener of listeners)
        listener(value)
    },
    listeners,
  }
  return bridge
}

const konsole = { caption: 'luke@host:~', resourceClass: 'org.kde.konsole', desktopFileName: 'org.kde.konsole', pid: 4321, fullScreen: false }

describe('createLinuxSampler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.links.clear()
    fsMock.links.set('/proc/4321/exe', '/usr/bin/konsole')
  })

  it('maps the active window to a sample with the caption, pid and executable', () => {
    const bridge = createBridge()
    bridge.active = konsole

    expect(createLinuxSampler(bridge, () => false)()).toEqual({
      title: 'luke@host:~',
      pid: 4321,
      exePath: '/usr/bin/konsole',
      exeName: 'konsole',
      ownProcess: false,
      busy: 'accepts',
      sampledAtMs: expect.any(Number),
    })
    expect(fsMock.readlinkSync).toHaveBeenCalledExactlyOnceWith('/proc/4321/exe')
  })

  it('returns null when no window is active', () => {
    expect(createLinuxSampler(createBridge(), () => false)()).toBeNull()
    expect(fsMock.readlinkSync).not.toHaveBeenCalled()
  })

  it('returns null once the active window closed between samples', () => {
    const bridge = createBridge()
    bridge.active = konsole
    const sample = createLinuxSampler(bridge, () => false)
    expect(sample()).not.toBeNull()

    bridge.active = null
    expect(sample()).toBeNull()
  })

  it('falls back to the resource class when /proc refuses the executable link', () => {
    const bridge = createBridge()
    bridge.active = { ...konsole, pid: 77 }

    expect(createLinuxSampler(bridge, () => false)()).toMatchObject({ pid: 77, exePath: null, exeName: 'org.kde.konsole' })
  })

  it('reports a null exeName when neither the link nor the resource class is known', () => {
    const bridge = createBridge()
    bridge.active = { ...konsole, pid: 77, resourceClass: '' }

    expect(createLinuxSampler(bridge, () => false)()).toMatchObject({ exePath: null, exeName: null })
  })

  it('never reads the command line or environment of the window process', () => {
    const bridge = createBridge()
    bridge.active = konsole
    createLinuxSampler(bridge, () => false)()

    expect(fsMock.readFileSync).not.toHaveBeenCalled()
    for (const [path] of fsMock.readlinkSync.mock.calls)
      expect(path).not.toMatch(/cmdline|environ/)
  })

  it('asks the ownership policy about the window pid', () => {
    const bridge = createBridge()
    bridge.active = konsole
    const isOwnProcess = vi.fn((pid: number) => pid === 4321)

    expect(createLinuxSampler(bridge, isOwnProcess)()).toMatchObject({ ownProcess: true })
    expect(isOwnProcess).toHaveBeenCalledWith(4321)
  })

  it.each([
    [true, 'busy', 'fullscreen'],
    [true, null, 'fullscreen'],
    [false, 'busy', 'busy'],
    [false, 'quiet', 'quiet'],
    [false, null, 'accepts'],
  ] as const)('maps fullScreen %s with busy hint %s to %s', (fullScreen, hint, expected) => {
    const bridge = createBridge()
    bridge.active = { ...konsole, fullScreen }
    bridge.busy = hint

    expect(createLinuxSampler(bridge, () => false)()).toMatchObject({ busy: expected })
  })
})

describe('createLinuxForegroundVerifier', () => {
  const own = { ...konsole, pid: 1000 }
  const isOwnProcess = (pid: number) => pid === 1000

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('verifies at once when the active window is already AIRI\'s own', () => {
    const bridge = createBridge()
    bridge.active = own
    const report = vi.fn()

    createLinuxForegroundVerifier(bridge, report).focused(isOwnProcess)

    expect(report).toHaveBeenCalledExactlyOnceWith({ foregroundVerified: true })
    expect(bridge.listeners.size).toBe(0)
  })

  it('verifies when the compositor reports an own pid within one second of the focus event', () => {
    const bridge = createBridge()
    bridge.active = konsole
    const report = vi.fn()

    createLinuxForegroundVerifier(bridge, report).focused(isOwnProcess)
    vi.advanceTimersByTime(900)
    bridge.emit(own)

    expect(report).toHaveBeenCalledExactlyOnceWith({ foregroundVerified: true })
    expect(bridge.listeners.size).toBe(0)
  })

  it('does not verify from an own pid that arrives after the one-second window', () => {
    const bridge = createBridge()
    const report = vi.fn()

    createLinuxForegroundVerifier(bridge, report).focused(isOwnProcess)
    vi.advanceTimersByTime(1000)
    bridge.emit(own)

    expect(report).not.toHaveBeenCalled()
    expect(bridge.listeners.size).toBe(0)
  })

  it('reports false after three consecutive focus events see a foreign or null pid', () => {
    const bridge = createBridge()
    const report = vi.fn()
    const verifier = createLinuxForegroundVerifier(bridge, report)

    bridge.active = konsole
    verifier.focused(isOwnProcess)
    vi.advanceTimersByTime(1000)
    bridge.active = null
    verifier.focused(isOwnProcess)
    vi.advanceTimersByTime(1000)
    expect(report).not.toHaveBeenCalled()

    bridge.active = konsole
    verifier.focused(isOwnProcess)
    vi.advanceTimersByTime(1000)
    expect(report).toHaveBeenCalledExactlyOnceWith({ foregroundVerified: false })
  })

  it('restarts the miss count after a verified focus', () => {
    const bridge = createBridge()
    const report = vi.fn()
    const verifier = createLinuxForegroundVerifier(bridge, report)

    for (let i = 0; i < 2; i++) {
      verifier.focused(isOwnProcess)
      vi.advanceTimersByTime(1000)
    }
    bridge.active = own
    verifier.focused(isOwnProcess)
    bridge.active = null
    for (let i = 0; i < 2; i++) {
      verifier.focused(isOwnProcess)
      vi.advanceTimersByTime(1000)
    }

    expect(report.mock.calls).toEqual([[{ foregroundVerified: true }]])
  })

  it('does not count a focus superseded by a newer one as a miss', () => {
    const bridge = createBridge()
    const report = vi.fn()
    const verifier = createLinuxForegroundVerifier(bridge, report)

    for (let i = 0; i < 5; i++)
      verifier.focused(isOwnProcess)
    vi.advanceTimersByTime(1000)

    expect(report).not.toHaveBeenCalled()
    expect(bridge.listeners.size).toBe(0)
  })

  it('drops a pending check on dispose', () => {
    const bridge = createBridge()
    const report = vi.fn()
    const verifier = createLinuxForegroundVerifier(bridge, report)

    verifier.focused(isOwnProcess)
    verifier.dispose()
    bridge.emit(own)
    vi.advanceTimersByTime(1000)

    expect(report).not.toHaveBeenCalled()
    expect(bridge.listeners.size).toBe(0)
  })
})
