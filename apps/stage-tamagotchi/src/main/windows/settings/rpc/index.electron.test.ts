import { BrowserWindow, ipcMain } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronCenterMainWindow, electronOpenDevtoolsWindow } from '../../../../shared/eventa'
import { WindowClosedDuringCreationError } from '../../../libs/electron/window-closed'
import { centerWindowOnDisplay } from '../../shared/display'
import { markStageWindow } from '../../stage/identity'
import { setupSettingsWindowInvokes } from './index.electron'

const invokeHandlers = vi.hoisted(() => new Map<unknown, (payload?: unknown) => unknown>())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const original = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...original,
    defineInvokeHandler: ((context, definition, handler) => {
      invokeHandlers.set(definition, handler as (payload?: unknown) => unknown)
      return original.defineInvokeHandler(context, definition, handler)
    }) as typeof original.defineInvokeHandler,
  }
})

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { isReady: () => true, commandLine: { getSwitchValue: () => '' } },
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
vi.mock('../../../services/airi/godot-stage', () => ({ createGodotStageService: vi.fn() }))
vi.mock('../../../services/airi/mcp-servers', () => ({ createMcpServersService: vi.fn() }))
vi.mock('../../../services/airi/widgets', () => ({ createWidgetsService: vi.fn() }))
vi.mock('../../../services/electron', () => ({ createAutoUpdaterService: vi.fn() }))
vi.mock('../../../services/airi/io-trace-recording/register', () => ({
  registerIOTraceRecording: vi.fn(() => vi.fn()),
}))

async function setup(window: BrowserWindow, getMainWindow?: () => BrowserWindow | undefined, openDevtoolsWindow = vi.fn(async () => new BrowserWindow())) {
  type Params = Parameters<typeof setupSettingsWindowInvokes>[0]
  return setupSettingsWindowInvokes({
    settingsWindow: window,
    getMainWindow,
    globalShortcut: {
      registerWindow: vi.fn(),
      registerMainShortcut: vi.fn(),
      dispose: vi.fn(),
    },
    widgetsManager: {} as Params['widgetsManager'],
    autoUpdater: {} as Params['autoUpdater'],
    devtoolsWindow: { openWindow: openDevtoolsWindow },
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

  it('resolves an open command when the devtools window closes during creation', async () => {
    const settings = new BrowserWindow()
    await setup(settings, undefined, vi.fn().mockRejectedValue(new WindowClosedDuringCreationError()))

    await expect(invokeHandlers.get(electronOpenDevtoolsWindow)?.({ key: 'motion' })).resolves.toBeUndefined()
    settings.close()
  })

  it('preserves real failures from the devtools open command', async () => {
    const failure = new Error('renderer failed')
    const settings = new BrowserWindow()
    await setup(settings, undefined, vi.fn().mockRejectedValue(failure))

    await expect(invokeHandlers.get(electronOpenDevtoolsWindow)?.({ key: 'motion' })).rejects.toBe(failure)
    settings.close()
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

describe('settings electronCenterMainWindow', () => {
  afterEach(() => {
    ipcMain.removeAllListeners()
    vi.mocked(centerWindowOnDisplay).mockClear()
  })

  it('returns the desktop stage bounds without moving it', async () => {
    const bounds = { x: 0, y: 25, width: 1440, height: 875 }
    const stage = Object.assign(new BrowserWindow(), { getBounds: vi.fn(() => bounds), setBounds: vi.fn() })
    markStageWindow(stage)
    const settings = new BrowserWindow()
    await setup(settings, () => stage)

    expect(invokeHandlers.get(electronCenterMainWindow)?.()).toEqual(bounds)
    expect(centerWindowOnDisplay).not.toHaveBeenCalled()
    expect(stage.setBounds).not.toHaveBeenCalled()
    settings.close()
  })

  it('still centers the classic main window', async () => {
    const main = new BrowserWindow()
    const settings = new BrowserWindow()
    await setup(settings, () => main)

    invokeHandlers.get(electronCenterMainWindow)?.()

    expect(centerWindowOnDisplay).toHaveBeenCalledWith(main)
    settings.close()
  })
})
