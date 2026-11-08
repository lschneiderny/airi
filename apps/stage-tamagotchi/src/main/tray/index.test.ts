import type { MenuItemConstructorOptions } from 'electron'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { afterEach, expect, it, vi } from 'vitest'

import { emitAppBeforeQuit } from '../libs/bootkit/lifecycle'
import { getCurrentHostCapabilities } from '../services/electron/host-capabilities'
import { setupTray } from './index'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const image = { resize: () => image, setTemplateImage: vi.fn() }
  class Tray extends EventEmitter {
    setContextMenu = vi.fn()
    setToolTip = vi.fn()
    destroy = vi.fn()
  }
  return { image, Tray, menus: [] as MenuItemConstructorOptions[][], EventEmitter }
})
vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
  ipcMain: {},
  Menu: {
    buildFromTemplate: (menu: MenuItemConstructorOptions[]) => {
      mocks.menus.push(menu)
      return menu
    },
  },
  Tray: mocks.Tray,
  nativeImage: { createFromPath: () => mocks.image },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 801 } }),
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 801 } }],
  },
}))
vi.mock('std-env', () => ({ isMacOS: false }))
vi.mock('../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../../resources/tray-icon-macos.png?asset', () => ({ default: 'tray.png' }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@moeru/eventa/adapters/electron/main', () => ({ createContext: () => ({ context: {} }) }))
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: () => vi.fn(),
}))
vi.mock('../windows/shared/app-icon', () => ({
  AppIconVisibility: class { hidden = false },
}))
vi.mock('../windows/shared/window', () => ({ toggleWindowShow: vi.fn() }))

afterEach(async () => {
  await emitAppBeforeQuit()
  vi.useRealTimers()
})

it('runs tray size commands without reading Wayland bounds and restores Windows anchoring after a status flip', async () => {
  vi.useFakeTimers()
  Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
  const getBounds = vi.fn(() => ({
    get x(): number { throw new Error('Hidden window x used') },
    get y(): number { throw new Error('Hidden window y used') },
    width: 450,
    height: 600,
  }))
  const window = Object.assign(new mocks.EventEmitter(), {
    webContents: { isDestroyed: () => false, isCrashed: () => false },
    isDestroyed: () => false,
    getBounds,
    setResizable: vi.fn(),
    setBounds: vi.fn(),
    setSize: vi.fn(),
    show: vi.fn(),
  })
  setupTray({
    mainWindow: window,
    captionWindow: { isVisible: () => false, getIsFollowingWindow: () => true, onVisibilityChanged: () => vi.fn() },
    i18n: { t: (key: string) => key.split('.').at(-1), locale: () => 'en' },
  } as never)
  await vi.advanceTimersByTimeAsync(50)
  const menu = mocks.menus.at(-1)
  const sizes = menu?.find(item => item.label === 'adjust_sizes')?.submenu
  if (!Array.isArray(sizes))
    throw new Error('Missing size menu')
  const fullScreen = sizes.find(item => item.label === 'full_screen')
  if (typeof fullScreen?.click !== 'function')
    throw new Error('Missing full screen command')
  getBounds.mockClear()

  fullScreen.click({} as never, {} as never, {} as never)

  expect(window.setSize).toHaveBeenCalledWith(1440, 801)
  expect(window.setBounds).not.toHaveBeenCalled()
  expect(getBounds).not.toHaveBeenCalled()
  expect(window.show).toHaveBeenCalledOnce()

  Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows'))
  getBounds.mockReturnValue({ x: 1000, y: 500, width: 300, height: 250 })
  const recommended = sizes.find(item => item.label === 'recommended_size')
  if (typeof recommended?.click !== 'function')
    throw new Error('Missing recommended size command')
  recommended.click({} as never, {} as never, {} as never)
  expect(window.setBounds).toHaveBeenCalledWith({ x: 850, y: 150, width: 450, height: 600 })
})
