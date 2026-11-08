import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupSpotlightWindowManager } from '.'
import { getCurrentHostCapabilities } from '../../services/electron/host-capabilities'

const window = vi.hoisted(() => ({
  setBounds: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  webContents: { focus: vi.fn() },
}))

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => '' } },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 2200, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 1920, y: 0, width: 1600, height: 1000 } })),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 25, width: 1920, height: 1055 } })),
  },
}))

// Window creation and its services are outside this display-selection test.
vi.mock('../../libs/electron/window-manager', () => ({
  createReusableWindow: () => ({ getWindow: async () => window }),
}))
vi.mock('../../libs/electron/location', () => ({
  getElectronMainDirname: () => '/app/main',
  baseUrl: () => 'file:///app/renderer',
}))
vi.mock('../../libs/electron/window-context', () => ({}))
vi.mock('../shared/app-icon', () => ({}))
vi.mock('../shared/window', () => ({}))

function setup() {
  return setupSpotlightWindowManager({
    serverChannel: {} as never,
    i18n: {} as never,
    chatWindow: {} as never,
    globalShortcut: { registerMainShortcut: () => ({ ok: true, id: 'spotlight' }) } as never,
    appConfig: { get: () => ({}) } as never,
  })
}

describe('spotlight display selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('places Spotlight on the primary display when the host withholds its cursor', async () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))

    await setup().show()

    expect(window.setBounds).toHaveBeenCalledWith({ x: 600, y: 257, width: 720, height: 100 })
    expect(screen.getDisplayNearestPoint).not.toHaveBeenCalled()
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled()
  })

  it.each(['windows', 'macos'] as const)('keeps Spotlight on the cursor display on %s', async (host) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))

    await setup().show()

    expect(window.setBounds).toHaveBeenCalledWith({ x: 2360, y: 220, width: 720, height: 100 })
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2200, y: 100 })
    expect(screen.getPrimaryDisplay).not.toHaveBeenCalled()
  })
})
