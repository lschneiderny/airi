import type { Rectangle } from 'electron'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentHostCapabilities } from '../../services/electron/host-capabilities'
import { setupDashboardWindow } from '../dashboard'
import { setupMainWindow } from './index'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    bounds: Rectangle = { x: 0, y: 0, width: 450, height: 600 }
    webContents = { openDevTools: vi.fn() }
    getBounds = () => ({ ...this.bounds })
    isDestroyed = () => false
    setVisibleOnAllWorkspaces = vi.fn()
    showInactive = vi.fn()
  }
  return {
    Window,
    config: { windows: [] as Array<{ title: string, tag: string, x?: number, y?: number, width?: number, height?: number }> },
  }
})

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
  BrowserWindow: mocks.Window,
}))
vi.mock('std-env', () => ({ isMacOS: false, isLinux: true }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@proj-airi/electron-screen-capture/main', () => ({ initScreenCaptureForWindow: vi.fn() }))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../libs/electron/persistence', () => ({
  createConfig: () => ({ setup: vi.fn(), get: () => mocks.config, update: (next: typeof mocks.config) => mocks.config = next }),
}))
vi.mock('../../libs/electron/location', () => ({
  baseUrl: () => 'http://localhost',
  getElectronMainDirname: () => '/main',
  withHashRoute: (_base: string, route: string) => route,
  load: async () => {},
}))
vi.mock('../shared', () => ({ protectPrivilegedWindowNavigation: vi.fn(), setWindowAlwaysOnTop: vi.fn(), transparentWindowConfig: () => ({}) }))
vi.mock('./hide-on-close', () => ({ hideOnClose: vi.fn() }))
vi.mock('./rpc/index.electron', () => ({ setupMainWindowElectronInvokes: async () => {} }))
vi.mock('../dashboard/rpc/index.electron', () => ({ setupDashboardWindowElectronInvokes: async () => {} }))

describe.each(['main', 'dashboard'] as const)('%s bounds persistence', (tag) => {
  beforeEach(() => {
    mocks.config = { windows: [] }
  })

  it.each([
    ['linux-wayland', false],
    ['linux-wayland', true],
    ['windows', false],
    ['windows', true],
  ] as const)('persists only known coordinates on %s with saved config %s', async (host, saved) => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host))
    const title = tag === 'main' ? 'AIRI' : 'AIRI Dashboard'
    if (saved)
      mocks.config.windows.push({ title, tag, x: 123, y: 456, width: 300, height: 400 })
    const window = tag === 'main'
      ? await setupMainWindow({ inlayWindow: async () => new mocks.Window() } as never)
      : await setupDashboardWindow({} as never)
    window.emit('resize')

    expect(mocks.config.windows).toEqual([{
      title,
      tag,
      ...host === 'windows' ? { x: 0, y: 0 } : saved ? { x: 123, y: 456 } : {},
      width: 450,
      height: 600,
    }])

    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost(host === 'windows' ? 'linux-wayland' : 'windows'))
    window.emit('move')
    expect(mocks.config.windows[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 450,
      height: 600,
    })
    window.emit('closed')
  })
})
