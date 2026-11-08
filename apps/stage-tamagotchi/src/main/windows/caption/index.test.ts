import type { Rectangle } from 'electron'

import { createHash } from 'node:crypto'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentHostCapabilities } from '../../services/electron/host-capabilities'
import { setupCaptionWindowManager } from './index'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    bounds = { x: 0, y: 0, width: 480, height: 180 }
    getBounds = vi.fn(() => ({ ...this.bounds }))
    setBounds = vi.fn((bounds: Partial<Rectangle>) => Object.assign(this.bounds, bounds))
    setSize = vi.fn((width: number, height: number) => Object.assign(this.bounds, { width, height }))
    setPosition = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    isDestroyed = () => false
    isMinimized = () => false
    isVisible = () => true
    show = vi.fn()
    focus = vi.fn()
  }
  return {
    Window,
    config: {
      isFollowing: true,
      matrices: {} as Record<string, { bounds: { x?: number, y?: number, width: number, height: number }, relativeToMain?: { dx: number, dy: number } }>,
    },
  }
})

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
  BrowserWindow: mocks.Window,
  ipcMain: { setMaxListeners: vi.fn() },
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }],
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 25, width: 1440, height: 801 } })),
    getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 25, width: 1440, height: 801 } })),
  },
}))
vi.mock('std-env', () => ({ isMacOS: false }))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../libs/electron/window-context', () => ({ createWindowContext: () => ({ context: { emit: vi.fn() } }) }))
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: () => vi.fn(),
}))
vi.mock('../../libs/electron/location', () => ({
  baseUrl: () => 'http://localhost',
  getElectronMainDirname: () => '/main',
  withHashRoute: (_base: string, route: string) => route,
  load: async () => {},
}))
vi.mock('../../libs/electron/persistence', () => ({
  createConfig: () => ({
    setup: vi.fn(),
    get: () => mocks.config,
    update: (next: typeof mocks.config) => mocks.config = next,
  }),
}))
vi.mock('../shared/app-icon', () => ({ showWindowOnAllWorkspaces: vi.fn() }))
vi.mock('../shared/window', () => ({
  protectPrivilegedWindowNavigation: vi.fn(),
  setupBaseWindowElectronInvokes: async () => {},
  setWindowAlwaysOnTop: vi.fn(),
  transparentWindowConfig: () => ({}),
}))

const hash = createHash('sha256').update('0,0,1920,1080,1').digest('hex').slice(0, 16)

function setup() {
  const main = new mocks.Window()
  main.bounds = { x: 500, y: 200, width: 450, height: 600 }
  const manager = setupCaptionWindowManager({ mainWindow: main as never, serverChannel: {} as never, i18n: {} as never })
  return { main, manager }
}

describe('caption origin policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.config = { isFollowing: true, matrices: {} }
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows'))
  })

  it.each([false, true])('creates and follows a size-only Wayland caption with saved bounds: %s', async (saved) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    if (saved)
      mocks.config.matrices[hash] = { bounds: { x: 700, y: 300, width: 500, height: 200 } }
    const { manager, main } = setup()
    const window = await manager.getWindow()
    const target = vi.mocked(window)

    expect(target.setSize).toHaveBeenCalledWith(saved ? 500 : 640, 200)
    expect(target.setBounds).not.toHaveBeenCalled()
    expect(main.getBounds).not.toHaveBeenCalled()
    expect(screen.getDisplayMatching).not.toHaveBeenCalled()
    window.emit('resize')
    await manager.setFollowWindow(true)
    main.emit('move')
    await manager.resetToSide()
    expect(target.setPosition).not.toHaveBeenCalled()
    expect(target.setBounds).not.toHaveBeenCalled()
    expect(mocks.config.matrices[hash]?.relativeToMain).toBeUndefined()
    expect(mocks.config.matrices[hash]?.bounds).toEqual({
      ...saved ? { x: 700, y: 300 } : {},
      width: 640,
      height: 200,
    })
    window.emit('closed')
  })

  it('uses one live main-window reading for both display selection and initial placement', async () => {
    const { manager, main } = setup()
    main.getBounds.mockReturnValueOnce({ x: 200, y: 200, width: 450, height: 600 })
    main.getBounds.mockReturnValue({ x: 900, y: 200, width: 450, height: 600 })
    const window = await manager.getWindow()
    expect(screen.getDisplayMatching).toHaveBeenCalledWith({ x: 200, y: 200, width: 450, height: 600 })
    expect(window.setBounds).toHaveBeenCalledWith({ x: 666, y: 600, width: 640, height: 200 })
    window.emit('closed')
  })

  it.each([false, true])('places a Windows caption and retains its offset after losing origin trust with saved bounds: %s', async (saved) => {
    if (saved)
      mocks.config.matrices[hash] = { bounds: { x: 700, y: 300, width: 500, height: 200 } }
    const { manager, main } = setup()
    const window = await manager.getWindow()
    expect(window.setBounds).toHaveBeenCalledWith(saved
      ? { x: 700, y: 300, width: 500, height: 200 }
      : { x: 400, y: 600, width: 640, height: 200 })
    expect(mocks.config.matrices[hash]?.relativeToMain).toEqual(saved ? { dx: 200, dy: 100 } : { dx: -100, dy: 400 })
    window.emit('resize')
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    vi.mocked(window.setPosition).mockClear()
    window.setSize(550, 220)
    window.emit('resize')
    main.emit('move')
    expect(mocks.config.matrices[hash]).toEqual({
      bounds: { x: saved ? 700 : 400, y: saved ? 300 : 600, width: 550, height: 220 },
      relativeToMain: saved ? { dx: 200, dy: 100 } : { dx: -100, dy: 400 },
    })
    expect(window.setPosition).not.toHaveBeenCalled()
    window.emit('closed')
  })
})
