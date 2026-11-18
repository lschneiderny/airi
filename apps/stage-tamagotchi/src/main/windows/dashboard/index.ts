import type { InferOutput } from 'valibot'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { NoticeWindowManager } from '../notice'
import type { SettingsWindowManager } from '../settings'

import { defineInvokeHandler } from '@moeru/eventa'
import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { defu } from 'defu'
import { BrowserWindow } from 'electron'
import { isLinux } from 'std-env'
import { array, number, object, optional, string } from 'valibot'

import icon from '../../../../resources/icon.png?asset'

import { electronStartDraggingWindow } from '../../../shared/eventa'
import { shouldOpenDevTools } from '../../libs/electron/devtools'
import { baseUrl, getPreloadPath, getRendererRoot, load, withHashRoute } from '../../libs/electron/location'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { createConfig } from '../../libs/electron/persistence'
import { createWindowContext } from '../../libs/electron/window-context'
import { readWindowRect } from '../../services/electron/coordinates'
import { protectPrivilegedWindowNavigation } from '../shared'
import { setupDashboardWindowElectronInvokes } from './rpc/index.electron'

const appConfigSchema = object({
  windows: optional(array(object({
    title: optional(string()),
    tag: string(),
    x: optional(number()),
    y: optional(number()),
    width: optional(number()),
    height: optional(number()),
  }))),
})

type AppConfig = InferOutput<typeof appConfigSchema>

export async function setupDashboardWindow(params: {
  settingsWindow: SettingsWindowManager
  chatWindow: () => Promise<BrowserWindow>
  noticeWindow: NoticeWindowManager
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  i18n: I18n
}) {
  const {
    setup: setupConfig,
    get: getConfigRaw,
    update: updateConfig,
  } = createConfig('app', 'config.json', appConfigSchema, {
    default: { windows: [] },
    autoHeal: true,
  })
  const getConfig = (): AppConfig => getConfigRaw() ?? { windows: [] }

  setupConfig()

  const windowConfig = getConfig().windows?.find(w => w.title === 'AIRI Dashboard' && w.tag === 'dashboard')

  const window = new BrowserWindow({
    title: 'AIRI Dashboard',
    width: windowConfig?.width ?? 1200.0,
    height: windowConfig?.height ?? 600.0,
    x: windowConfig?.x,
    y: windowConfig?.y,
    show: false,
    icon,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
    },
  })

  if (params.onWindowCreated) {
    params.onWindowCreated(window)
  }

  if (shouldOpenDevTools()) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch (err) {
      console.error('failed to open devtools:', err)
    }
  }

  function handleNewBounds() {
    const origin = readWindowRect(window)
    const { width, height } = window.getBounds()
    const config = getConfig()
    if (!config.windows || !Array.isArray(config.windows)) {
      config.windows = []
    }

    const existingConfigIndex = config.windows.findIndex(w => w.title === 'AIRI Dashboard' && w.tag === 'dashboard')

    if (existingConfigIndex === -1) {
      config.windows.push({
        title: 'AIRI Dashboard',
        tag: 'dashboard',
        ...origin ? { x: origin.x, y: origin.y } : {},
        width,
        height,
      })
    }
    else {
      const windowConfig = defu(config.windows[existingConfigIndex], { title: 'AIRI Dashboard', tag: 'dashboard' })

      if (origin) {
        windowConfig.x = origin.x
        windowConfig.y = origin.y
      }
      windowConfig.width = width
      windowConfig.height = height

      config.windows[existingConfigIndex] = windowConfig
    }

    updateConfig(config)
  }

  window.on('resize', handleNewBounds)
  window.on('move', handleNewBounds)

  window.on('ready-to-show', () => window!.show())
  protectPrivilegedWindowNavigation(window)

  await setupDashboardWindowElectronInvokes({
    window,
    settingsWindow: params.settingsWindow,
    chatWindow: params.chatWindow,
    noticeWindow: params.noticeWindow,
    i18n: params.i18n,
    serverChannel: params.serverChannel,
  })

  await load(window, withHashRoute(baseUrl(getRendererRoot()), '/dashboard', {
    query: { 'synced-leader': 'false' },
  }))

  /**
   * This is a know issue (or expected behavior maybe) to Electron.
   * We don't use this approach on Linux because it's not working.
   *
   * Discussion: https://github.com/electron/electron/issues/37789
   * Workaround: https://github.com/noobfromph/electron-click-drag-plugin
   */
  if (!isLinux) {
    const { default: clickDragPlugin } = await import('electron-click-drag-plugin')

    function handleStartDraggingWindow() {
      try {
        const windowId = window.getNativeWindowHandle()
        clickDragPlugin.startDrag(windowId)
      }
      catch (error) {
        console.error(error)
      }
    }

    const { context } = createWindowContext(window)
    const cleanUpWindowDraggingInvokeHandler = defineInvokeHandler(context, electronStartDraggingWindow, handleStartDraggingWindow)

    onWindowClosed(window, () => {
      cleanUpWindowDraggingInvokeHandler()
    })
  }

  initScreenCaptureForWindow(window, createWindowContext(window).context)

  return window
}
