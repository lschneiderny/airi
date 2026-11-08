import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { describe, expect, it, vi } from 'vitest'

import { getCurrentHostCapabilities } from '../../services/electron/host-capabilities'
import { resizeBoundsByDelta, resizeWindowByDelta, setWindowAlwaysOnTop } from './window'

const mocks = vi.hoisted(() => ({
  isMacOS: false,
  isWindows: false,
}))

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
  shell: {
    openExternal: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('std-env', () => ({
  get isMacOS() {
    return mocks.isMacOS
  },
  get isWindows() {
    return mocks.isWindows
  },
}))

vi.mock('../../services/electron', () => ({
  createAppService: vi.fn(),
  createAppVersionService: vi.fn(),
  createDesktopActivityService: vi.fn(),
  createForegroundWindowService: vi.fn(),
  createPowerMonitorService: vi.fn(),
  createScreenService: vi.fn(),
  createSystemPreferencesService: vi.fn(),
  createWindowService: vi.fn(),
}))

describe('setWindowAlwaysOnTop', () => {
  it('disables always-on-top when flag is false', () => {
    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, false)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  it('applies standard always-on-top on Linux', () => {
    mocks.isMacOS = false
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('applies screen-saver level and relative offset on macOS', () => {
    mocks.isMacOS = true
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 1)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
  })

  it('applies screen-saver level and relative offset on Windows', () => {
    mocks.isMacOS = false
    mocks.isWindows = true

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 2)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 2)
  })
})

describe('resizeBoundsByDelta', () => {
  it.each([
    ['windows', 'w', { x: 80, y: 100, width: 420, height: 500 }],
    ['windows', 'n', { x: 100, y: 70, width: 400, height: 530 }],
    ['linux-wayland', 'w', { x: 80, y: 100, width: 420, height: 500 }],
    ['linux-wayland', 'n', { x: 100, y: 70, width: 400, height: 530 }],
  ] as const)('resizes %s edge %s using only the origin the host can report', (host, direction, expected) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const setBounds = vi.fn()
    const setSize = vi.fn()
    const window = { getBounds: () => ({ x: 100, y: 100, width: 400, height: 500 }), setBounds, setSize }
    resizeWindowByDelta({ window: window as never, direction, deltaX: -20, deltaY: -30 })
    if (host === 'windows') {
      expect(setBounds).toHaveBeenCalledWith(expected)
      expect(setSize).not.toHaveBeenCalled()
    }
    else {
      expect(setSize).toHaveBeenCalledWith(expected.width, expected.height)
      expect(setBounds).not.toHaveBeenCalled()
    }
  })

  it('keeps the opposite corner still while a corner grip is dragged', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: -20, deltaY: -30, direction: 'nw' }))
      .toEqual({ x: 80, y: 70, width: 420, height: 530 })
    expect(resizeBoundsByDelta(bounds, { deltaX: 20, deltaY: 30, direction: 'se' }))
      .toEqual({ x: 100, y: 100, width: 420, height: 530 })
  })

  it('stops at the minimum size and keeps the opposite edges still', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: 1000, deltaY: 1000, direction: 'nw', minWidth: 300, minHeight: 250 }))
      .toEqual({ x: 200, y: 350, width: 300, height: 250 })
  })
})
