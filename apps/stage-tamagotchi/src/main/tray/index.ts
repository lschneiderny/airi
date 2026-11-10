import type { LocaleDetector } from '@intlify/core'
import type { BrowserWindow, Rectangle } from 'electron'

import type { globalAppConfigSchema } from '../configs/global'
import type { Config } from '../libs/electron/persistence'
import type { I18n } from '../libs/i18n'
import type { ServerChannel } from '../services/airi/channel-server'
import type { setupBeatSync } from '../windows/beat-sync'
import type { setupCaptionWindowManager } from '../windows/caption'
import type { SettingsWindowManager } from '../windows/settings'
import type { WidgetsWindowManager } from '../windows/widgets'

import { env } from 'node:process'

import { is } from '@electron-toolkit/utils'
import { defineInvokeHandler } from '@moeru/eventa'
import { isRendererUnavailable } from '@proj-airi/electron-vueuse/main'
import { effect } from 'alien-signals'
import { app, Menu, nativeImage, Tray } from 'electron'
import { debounce, once } from 'es-toolkit'
import { isMacOS } from 'std-env'

import icon from '../../../resources/icon.png?asset'
import macOSTrayIcon from '../../../resources/tray-icon-macos.png?asset'

import { electronAppIconGet, electronAppIconSet } from '../../shared/eventa'
import { findDominantDisplayArea } from '../../shared/utils/electron/display'
import { onAppBeforeQuit } from '../libs/bootkit/lifecycle'
import { createAppContext } from '../libs/electron/window-context'
import { displayMatching, readDisplays, readPrimaryDisplay, readWindowRect } from '../services/electron/coordinates'
import { Animator } from '../windows/shared/animator'
import { AppIconVisibility } from '../windows/shared/app-icon'
import { computeResizedBoundsAnchoredToDominantDisplay } from '../windows/shared/display'
import { placeWindow } from '../windows/shared/placement'
import { toggleWindowShow } from '../windows/shared/window'
import { isStageWindow, showUserFacingWindow } from '../windows/stage/identity'
import { resolveAlignedWindowBounds, windowLayoutMenuItems } from './window-layout'

function applyWindowSize(window: BrowserWindow, width: number, height: number, x?: number, y?: number): void {
  if (isRendererUnavailable(window)) {
    return
  }

  window.setResizable(true)

  const currentBounds = readWindowRect(window)
  if (!currentBounds) {
    window.setSize(Math.round(width), Math.round(height))
    window.show()
    return
  }

  const bounds = x !== undefined && y !== undefined
    ? {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      }
    : computeResizedBoundsAnchoredToDominantDisplay({
        currentBounds,
        targetSize: { width, height },
        displays: readDisplays(),
      })

  placeWindow(window, bounds)
  window.show()
}

interface SetupTrayParams {
  mainWindow: BrowserWindow
  settingsWindow: SettingsWindowManager
  captionWindow: ReturnType<typeof setupCaptionWindowManager>
  widgetsWindow: WidgetsWindowManager
  beatSyncBgWindow: Awaited<ReturnType<typeof setupBeatSync>>
  aboutWindow: () => Promise<BrowserWindow>
  inlayWindow: () => Promise<BrowserWindow>
  serverChannel: ServerChannel
  i18n: I18n
  appConfig: Config<typeof globalAppConfigSchema>
}

const setupTrayOnce = once((params: SetupTrayParams): void => {
  const mainWindowAnimator = new Animator(params.mainWindow)

  function animateMainWindowTo(workArea: Rectangle, position: Parameters<typeof resolveAlignedWindowBounds>[2]) {
    if (isStageWindow(params.mainWindow))
      return
    const bounds = resolveAlignedWindowBounds(params.mainWindow, workArea, position)
    mainWindowAnimator.windowBoundsAnimateTo(bounds)
    params.mainWindow.show()
  }

  function applyMainWindowSize(width: number, height: number, x?: number, y?: number) {
    if (isStageWindow(params.mainWindow))
      return
    mainWindowAnimator.stop()
    applyWindowSize(params.mainWindow, width, height, x, y)
  }

  const trayImage = nativeImage.createFromPath(isMacOS ? macOSTrayIcon : icon).resize({ width: 16 })
  trayImage.setTemplateImage(isMacOS)

  const appTray = new Tray(trayImage)

  const rebuildContextMenu = debounce((): void => {
    if (isRendererUnavailable(params.mainWindow)) {
      return
    }

    const mainWindowBounds = readWindowRect(params.mainWindow)
    const currentDisplay = mainWindowBounds
      ? findDominantDisplayArea(mainWindowBounds, readDisplays()) ?? displayMatching(mainWindowBounds)
      : readPrimaryDisplay()
    const contextMenu = Menu.buildFromTemplate([
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.show'), click: () => showUserFacingWindow(params.mainWindow) },
      ...windowLayoutMenuItems({
        window: params.mainWindow,
        workArea: currentDisplay.workArea,
        t: key => params.i18n.t(key),
        resize: applyMainWindowSize,
        align: position => animateMainWindowTo(currentDisplay.workArea, position),
      }),
      { type: 'separator' },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.settings'), click: () => void params.settingsWindow.openWindow('/settings') },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.about'), click: () => params.aboutWindow().then(window => toggleWindowShow(window)) },
      { type: 'separator' },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_inlay'), click: () => params.inlayWindow().then(window => toggleWindowShow(window)) },
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_widgets'), click: () => params.widgetsWindow.getWindow().then(window => toggleWindowShow(window)) },
      {
        label: params.i18n.t(params.captionWindow.isVisible()
          ? 'tamagotchi.electron.tray.menu.labels.label.close_caption'
          : 'tamagotchi.electron.tray.menu.labels.label.open_caption'),
        click: () => {
          void params.captionWindow.toggleVisibility().then(() => rebuildContextMenu())
        },
      },
      {
        type: 'submenu',
        label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.caption_overlay'),
        submenu: Menu.buildFromTemplate([
          { type: 'checkbox', label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.follow_window'), checked: params.captionWindow.getIsFollowingWindow(), click: async menuItem => await params.captionWindow.setFollowWindow(Boolean(menuItem.checked)) },
          { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.reset_position'), click: async () => await params.captionWindow.resetToSide() },
        ]),
      },
      { type: 'separator' },
      ...is.dev || env.MAIN_APP_DEBUG || env.APP_DEBUG
        ? [
            { type: 'header', label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.devtools') },
            { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.troubleshoot_beatsync'), click: () => params.beatSyncBgWindow.webContents.openDevTools({ mode: 'detach' }) },
            { type: 'separator' },
          ] as const
        : [],
      { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.quit'), click: () => app.quit() },
    ])

    appTray.setContextMenu(contextMenu)
  }, 50)

  params.mainWindow.on('resize', rebuildContextMenu)
  params.mainWindow.on('move', rebuildContextMenu)
  const visibilityChangeUnListener = params.captionWindow.onVisibilityChanged(rebuildContextMenu)

  rebuildContextMenu()

  const stopLocaleEffect = effect(() => {
    const locale = params.i18n.locale as (() => string | LocaleDetector<any[]> | undefined)
    locale()
    rebuildContextMenu()
  })

  const appIcon = new AppIconVisibility(params.appConfig)
  const { context } = createAppContext()
  defineInvokeHandler(context, electronAppIconGet, () => appIcon.hidden)
  defineInvokeHandler(context, electronAppIconSet, async (payload) => {
    await appIcon.setHidden(Boolean(payload))
    return appIcon.hidden
  })

  onAppBeforeQuit(() => {
    // Stop every menu rebuild source before canceling its pending trailing call.
    // The tray must remain alive until no callback can reach it.
    params.mainWindow.off('resize', rebuildContextMenu)
    params.mainWindow.off('move', rebuildContextMenu)

    visibilityChangeUnListener()
    stopLocaleEffect()

    rebuildContextMenu.cancel()
    mainWindowAnimator.stop()

    appTray.destroy()
  })

  appTray.setToolTip('Project AIRI')
  appTray.addListener('click', () => showUserFacingWindow(params.mainWindow))

  // On macOS, there's a special double-click event
  if (isMacOS) {
    appTray.addListener('double-click', () => showUserFacingWindow(params.mainWindow))
  }
})

export function setupTray(params: SetupTrayParams): void {
  setupTrayOnce(params)
}
