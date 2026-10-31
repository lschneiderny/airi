import { BrowserWindow, ipcMain } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronCenterMainWindow } from '../../../../shared/eventa'
import { centerWindowOnDisplay } from '../../shared/display'
import { markStageWindow } from '../../stage/identity'
import { setupMainWindowElectronInvokes } from './index.electron'

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
    ipcMain: Object.assign(new EventEmitter(), { setMaxListeners: vi.fn() }),
    BrowserWindow: class extends EventEmitter {
      private destroyed = false
      private contents = { isDestroyed: () => this.destroyed, send: vi.fn(), openDevTools: vi.fn() }
      bounds = { x: 0, y: 25, width: 1440, height: 875 }

      isDestroyed() {
        return this.destroyed
      }

      get webContents() {
        return this.contents
      }

      getBounds = vi.fn(() => ({ ...this.bounds }))
      setBounds = vi.fn()

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
vi.mock('../../../services/airi/onboarding', () => ({ createOnboardingService: vi.fn() }))
vi.mock('../../../services/airi/widgets', () => ({ createWidgetsService: vi.fn() }))
vi.mock('../../../services/electron', () => ({ createAutoUpdaterService: vi.fn() }))
vi.mock('../../../services/airi/io-trace-recording/register', () => ({
  registerIOTraceRecording: vi.fn(() => vi.fn()),
}))

async function setup(window: BrowserWindow) {
  type Params = Parameters<typeof setupMainWindowElectronInvokes>[0]
  return setupMainWindowElectronInvokes({
    window,
    editorWindow: {} as Params['editorWindow'],
    settingsWindow: {} as Params['settingsWindow'],
    chatWindow: {
      open: vi.fn(),
      toggle: vi.fn(),
      getButtonState: vi.fn(),
      onButtonStateChange: vi.fn(() => vi.fn()),
      getAttentionTarget: vi.fn(),
      onAttentionTargetChange: vi.fn(() => vi.fn()),
    },
    widgetsManager: {} as Params['widgetsManager'],
    noticeWindow: {} as Params['noticeWindow'],
    autoUpdater: {} as Params['autoUpdater'],
    serverChannel: {} as Params['serverChannel'],
    godotStageManager: {} as Params['godotStageManager'],
    mcpManager: {} as Params['mcpManager'],
    i18n: {} as Params['i18n'],
    onboardingWindowManager: {} as Params['onboardingWindowManager'],
    ioTraceRecording: {} as Params['ioTraceRecording'],
    inlayWindow: vi.fn(),
    globalShortcut: { registerWindow: vi.fn(), registerMainShortcut: vi.fn(), dispose: vi.fn() },
  })
}

describe('main window electronCenterMainWindow', () => {
  afterEach(() => {
    ipcMain.removeAllListeners()
    invokeHandlers.clear()
    vi.mocked(centerWindowOnDisplay).mockClear()
  })

  it('returns the desktop stage bounds without moving it', async () => {
    const stage = new BrowserWindow()
    markStageWindow(stage)
    await setup(stage)

    expect(invokeHandlers.get(electronCenterMainWindow)?.()).toEqual({ x: 0, y: 25, width: 1440, height: 875 })
    expect(centerWindowOnDisplay).not.toHaveBeenCalled()
    expect(stage.setBounds).not.toHaveBeenCalled()
    stage.close()
  })

  it('still centers the classic main window', async () => {
    const main = new BrowserWindow()
    await setup(main)

    invokeHandlers.get(electronCenterMainWindow)?.()

    expect(centerWindowOnDisplay).toHaveBeenCalledWith(main)
    main.close()
  })
})
