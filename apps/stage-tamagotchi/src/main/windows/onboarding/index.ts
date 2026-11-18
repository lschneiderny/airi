import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { GlobalShortcutService } from '../../services/electron/global-shortcut'

import { defineInvokeHandler } from '@moeru/eventa'
import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { safeClose } from '@proj-airi/electron-vueuse/main'
import { BrowserWindow } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { electronOnboardingClose } from '../../../shared/eventa'
import { showWindow } from '../../libs/electron/focus'
import { baseUrl, getPreloadPath, getRendererRoot, load, withHashRoute } from '../../libs/electron/location'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { createWindowContext } from '../../libs/electron/window-context'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { customTitleBarWindowConfig, protectPrivilegedWindowNavigation, toggleWindowShow } from '../shared'
import { setupBaseWindowElectronInvokes } from '../shared/window'

export interface OnboardingWindowManager {
  getWindow: () => Promise<BrowserWindow>
  getAndToggleWindow: () => Promise<BrowserWindow>
  onClosed: (callback: () => void) => () => void
}

export function setupOnboardingWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
  /** The permissions step tries the Push to Talk shortcut in this window. */
  globalShortcut: GlobalShortcutService
}): OnboardingWindowManager {
  const closeCallbacks = new Set<() => void>()

  async function getOnboardingWindow(getWindow: () => Promise<BrowserWindow>) {
    const window = await getWindow()
    await toggleWindowShow(window)

    return window
  }

  const reusableWindow = createReusableWindow(async () => {
    const newWindow = new BrowserWindow({
      title: 'Welcome to AIRI',
      width: 1000,
      height: 650,
      minWidth: 400,
      minHeight: 500,
      show: false,
      icon,
      resizable: true,
      ...customTitleBarWindowConfig(),
      transparent: false,
      backgroundColor: '#0f0f0f',
      webPreferences: {
        preload: getPreloadPath(),
        sandbox: false,
      },
    })

    newWindow.on('ready-to-show', () => showWindow(newWindow))
    protectPrivilegedWindowNavigation(newWindow)

    const { context } = createWindowContext(newWindow)

    defineInvokeHandler(context, electronOnboardingClose, async () => {
      safeClose(newWindow)
    })

    await setupBaseWindowElectronInvokes({ context, window: newWindow, i18n: params.i18n, serverChannel: params.serverChannel })
    params.globalShortcut.registerWindow({ context, window: newWindow })
    // The permissions step previews the screen after the user allows Screen Recording.
    initScreenCaptureForWindow(newWindow, context)

    await load(newWindow, withHashRoute(baseUrl(getRendererRoot()), '/onboarding', {
      query: { 'synced-leader': 'false' },
    }))

    onWindowClosed(newWindow, () => {
      for (const cb of closeCallbacks) {
        try {
          cb()
        }
        catch { /* noop */ }
      }
    })

    return newWindow
  })

  return {
    getWindow: async () => reusableWindow.getWindow(),
    getAndToggleWindow: async () => await getOnboardingWindow(reusableWindow.getWindow),
    onClosed: (callback: () => void) => {
      closeCallbacks.add(callback)
      return () => {
        closeCallbacks.delete(callback)
      }
    },
  }
}
