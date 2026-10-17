import { BrowserWindow, ipcMain } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setupSettingsWindowInvokes } from './index.electron'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    ipcMain: new EventEmitter(),
    BrowserWindow: class extends EventEmitter {
      private destroyed = false
      private contents = { isDestroyed: () => this.destroyed, send: vi.fn() }

      isDestroyed() {
        return this.destroyed
      }

      get webContents() {
        if (this.destroyed)
          throw new TypeError('Object has been destroyed')
        return this.contents
      }

      close() {
        this.destroyed = true
        this.emit('closed')
      }
    },
  }
})

vi.mock('../../shared/window', () => ({ setupBaseWindowElectronInvokes: vi.fn() }))
vi.mock('../../shared/display', () => ({ centerWindowOnDisplay: vi.fn() }))
vi.mock('../../../services/airi/auth', () => ({ createAuthService: vi.fn() }))
vi.mock('../../../services/airi/godot-stage', () => ({ createGodotStageService: vi.fn() }))
vi.mock('../../../services/airi/mcp-servers', () => ({ createMcpServersService: vi.fn() }))
vi.mock('../../../services/airi/widgets', () => ({ createWidgetsService: vi.fn() }))
vi.mock('../../../services/electron', () => ({ createAutoUpdaterService: vi.fn() }))
vi.mock('../../../services/airi/io-trace-recording/register', () => ({
  registerIOTraceRecording: vi.fn(() => vi.fn()),
}))

async function setup(window: BrowserWindow) {
  type Params = Parameters<typeof setupSettingsWindowInvokes>[0]
  return setupSettingsWindowInvokes({
    settingsWindow: window,
    globalShortcut: {
      registerWindow: vi.fn(),
      registerMainShortcut: vi.fn(),
      dispose: vi.fn(),
    },
    widgetsManager: {} as Params['widgetsManager'],
    autoUpdater: {} as Params['autoUpdater'],
    devtoolsWindow: {} as Params['devtoolsWindow'],
    serverChannel: {} as Params['serverChannel'],
    godotStageManager: {} as Params['godotStageManager'],
    mcpManager: {} as Params['mcpManager'],
    i18n: {} as Params['i18n'],
    spotlightWindow: {} as Params['spotlightWindow'],
    ioTraceRecording: {} as Params['ioTraceRecording'],
  })
}

describe('settings IPC lifetime', () => {
  afterEach(() => {
    ipcMain.removeAllListeners()
  })

  it('removes IPC listeners when Settings closes', async () => {
    const settings = new BrowserWindow()
    await setup(settings)
    expect(ipcMain.listenerCount('eventa-message')).toBe(1)

    settings.close()

    expect(ipcMain.listenerCount('eventa-message')).toBe(0)
    expect(ipcMain.listenerCount('eventa-error')).toBe(0)
  })

  it('keeps a reopened Settings context active after closing the old window', async () => {
    const oldSettings = new BrowserWindow()
    await setup(oldSettings)
    oldSettings.close()
    const settings = new BrowserWindow()
    await setup(settings)

    expect(ipcMain.listenerCount('eventa-message')).toBe(1)
    expect(ipcMain.listenerCount('eventa-error')).toBe(1)
    settings.close()
  })
})
