import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyStageInputIsolation, createStageWindowOptions } from './window-contract'

const mocks = vi.hoisted(() => ({
  platform: { isMacOS: false },
  setWindowAlwaysOnTop: vi.fn(),
}))

vi.mock('std-env', () => ({
  get isMacOS() {
    return mocks.platform.isMacOS
  },
}))
vi.mock('../shared/window', () => ({ setWindowAlwaysOnTop: mocks.setWindowAlwaysOnTop }))
// The update launcher knows where the running bundle keeps its preload scripts.
vi.mock('@ergosphere-it/electron/main', () => ({
  activeBundle: { preloadOf: (name: string) => `/opt/airi/bundles/2/preload/${name}.cjs` },
}))

function createWindow() {
  return {
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    setHiddenInMissionControl: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
  }
}

const workArea = { x: -1440, y: 25, width: 1440, height: 875 }

describe.each([
  { name: 'win32', isMacOS: false, type: undefined },
  { name: 'darwin', isMacOS: true, type: 'panel' },
])('stage window contract on $name', ({ isMacOS, type }) => {
  beforeEach(() => {
    mocks.platform.isMacOS = isMacOS
    vi.clearAllMocks()
  })

  it('creates a hidden, frameless, transparent, focusable window over the work area', () => {
    const options = createStageWindowOptions({ workArea })

    expect(options).toMatchObject({
      x: -1440,
      y: 25,
      width: 1440,
      height: 875,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      roundedCorners: false,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      webPreferences: { sandbox: false, backgroundThrottling: false },
    })
    expect(options.type).toBe(type)
  })

  // ROOT CAUSE:
  //
  // The stage window built its own preload path, `../preload/index.mjs` beside the main bundle. The update launcher
  // moved the preload scripts into the running bundle, so that file was gone: the page loaded without a preload, had
  // no `window.electron`, and stopped at the first bridge that needs it ("OpenCode Go desktop transport requires an
  // Electron window").
  //
  // The window now takes the shared preload of the running bundle, as every other window does.
  it('loads the shared preload script of the running bundle', () => {
    expect(createStageWindowOptions({ workArea }).webPreferences?.preload).toBe('/opt/airi/bundles/2/preload/index.cjs')
  })

  it('makes the window click-through and always on top, without content protection', () => {
    const window = createWindow()

    applyStageInputIsolation(window)

    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(mocks.setWindowAlwaysOnTop).toHaveBeenCalledWith(window, true)
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
    expect(window.setContentProtection).not.toHaveBeenCalled()
    expect(window.setWindowButtonVisibility.mock.calls).toEqual(isMacOS ? [[false]] : [])
    expect(window.setHiddenInMissionControl.mock.calls).toEqual(isMacOS ? [[true]] : [])
  })
})
