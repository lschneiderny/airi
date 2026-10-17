import { createContext, defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDesktopActivityService } from './desktop-activity'

const host = vi.hoisted(() => ({
  isLinux: false,
}))

const powerMonitorMock = vi.hoisted(() => ({
  getSystemIdleTime: vi.fn<() => number>(),
}))

vi.mock('electron', () => ({
  powerMonitor: powerMonitorMock,
}))

vi.mock('std-env', () => ({
  get isLinux() {
    return host.isLinux
  },
}))

describe('createDesktopActivityService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function readIdleSeconds() {
    const context = createContext()
    createDesktopActivityService({ context: context as never, window: { once: vi.fn() } as never })
    return defineInvoke(context, electron.powerMonitor.getSystemIdleTime)()
  }

  it('reports unknown idle time on a Linux Wayland session, even when Electron reads 0', async () => {
    host.isLinux = true
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)

    await expect(readIdleSeconds()).resolves.toBeNull()
    expect(powerMonitorMock.getSystemIdleTime).not.toHaveBeenCalled()
  })

  it('passes the measured idle time through on a Linux X11 session, including 0', async () => {
    host.isLinux = true
    vi.stubEnv('XDG_SESSION_TYPE', 'x11')

    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)
    await expect(readIdleSeconds()).resolves.toBe(0)

    powerMonitorMock.getSystemIdleTime.mockReturnValue(42)
    await expect(readIdleSeconds()).resolves.toBe(42)
  })

  // Windows and macOS: a stray XDG_SESSION_TYPE must not hide real readings.
  it.each(['win32', 'darwin'])('passes the measured idle time through on %s, including 0', async () => {
    host.isLinux = false
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland')

    powerMonitorMock.getSystemIdleTime.mockReturnValue(0)
    await expect(readIdleSeconds()).resolves.toBe(0)

    powerMonitorMock.getSystemIdleTime.mockReturnValue(15)
    await expect(readIdleSeconds()).resolves.toBe(15)
  })
})
