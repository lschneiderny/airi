import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron, hostCapabilitiesChanged } from '@proj-airi/electron-eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  platform: 'linux',
  switches: {} as Record<string, string>,
}))

const powerMonitorMock = vi.hoisted(() => ({
  getSystemIdleTime: vi.fn<() => number>(),
}))

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    commandLine: { getSwitchValue: (name: string) => host.switches[name] ?? '' },
  },
  powerMonitor: powerMonitorMock,
}))

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>()
  return {
    default: {
      ...actual,
      get platform() { return host.platform },
      getSystemVersion: () => '14.2.0',
    },
  }
})

describe('createDesktopActivityService', () => {
  let nowMs = 1_000
  let changes = 0

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    host.platform = 'linux'
    host.switches = {}
    nowMs = 1_000
    changes = 0
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    vi.stubEnv('WAYLAND_DISPLAY', '')
    vi.stubEnv('XDG_SESSION_TYPE', '')
  })

  afterEach(async () => {
    await (await import('../../libs/bootkit/lifecycle')).emitAppBeforeQuit()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  async function createReader() {
    const { createDesktopActivityService } = await import('./desktop-activity')
    const { createHostCapabilitiesService } = await import('./host-capabilities')
    const context = createContext()
    context.on(hostCapabilitiesChanged, () => {
      changes += 1
    })
    createHostCapabilitiesService({ context: context as never, window: new EventEmitter() as never })
    createDesktopActivityService({ context: context as never, window: { once: vi.fn() } as never })
    const read = defineInvoke(context, electron.powerMonitor.getSystemIdleTime)
    // The renderer polls once per second.
    return async () => {
      nowMs += 1_000
      return read()
    }
  }

  it('reports unknown idle time under XWayland, even when Electron reads 0', async () => {
    host.switches = { 'ozone-platform': 'x11' }
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)

    const poll = await createReader()
    for (let i = 0; i < 5; i++)
      await expect(poll()).resolves.toBeNull()
    expect(powerMonitorMock.getSystemIdleTime).not.toHaveBeenCalled()
  })

  it('stays unknown on native Wayland while Electron reads a constant 0, on every poll', async () => {
    host.switches = { 'ozone-platform-hint': 'auto' }
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)

    const poll = await createReader()
    for (let i = 0; i < 120; i++)
      await expect(poll()).resolves.toBeNull()
    expect(powerMonitorMock.getSystemIdleTime).toHaveBeenCalledTimes(120)
    expect(changes).toBe(0)
  })

  it('verifies native Wayland idle time once it advances, then passes readings through with a single change', async () => {
    host.switches = { 'ozone-platform-hint': 'auto' }
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
    let second = 0
    powerMonitorMock.getSystemIdleTime.mockImplementation(() => second++)

    const poll = await createReader()
    const answers: Array<number | null> = []
    for (let i = 0; i < 40; i++)
      answers.push(await poll())

    expect(answers[0]).toBeNull()
    const firstLive = answers.findIndex(answer => answer !== null)
    expect(firstLive).toBeGreaterThan(0)
    expect(answers.slice(0, firstLive).every(answer => answer === null)).toBe(true)
    expect(answers.slice(firstLive)).toEqual(Array.from({ length: 40 - firstLive }, (_, i) => firstLive + i))
    expect(changes).toBe(1)

    // A later reset to 0 is real input now: the verification does not flip back.
    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)
    await expect(poll()).resolves.toBe(0)
    expect(changes).toBe(1)
  })

  it('passes the measured idle time through on a Linux X11 session, including 0', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11')
    const poll = await createReader()

    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)
    await expect(poll()).resolves.toBe(0)

    powerMonitorMock.getSystemIdleTime.mockReturnValue(42)
    await expect(poll()).resolves.toBe(42)
  })

  // Windows and macOS: a stray XDG_SESSION_TYPE must not hide real readings.
  it.each(['win32', 'darwin'])('passes the measured idle time through on %s, including 0', async (platform) => {
    host.platform = platform
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    const poll = await createReader()

    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)
    await expect(poll()).resolves.toBe(0)

    powerMonitorMock.getSystemIdleTime.mockReturnValue(15)
    await expect(poll()).resolves.toBe(15)
  })
})
