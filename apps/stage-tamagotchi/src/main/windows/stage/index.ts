import type { BrowserWindow } from 'electron'

import type { StageHostMode } from '../../../shared/eventa'
import type { setupMainWindow } from '../main'
import type { StageConfigStore, StageWindowInvokes } from './rpc/index.electron'
import type { StageStateBroadcast } from './state-broadcast'

import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { app, BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { hideOnClose } from '../main/hide-on-close'
import { mainWindowQuery } from '../main/query'
import { setupMainWindowElectronInvokes } from '../main/rpc/index.electron'
import { protectPrivilegedWindowNavigation } from '../shared'
import { defaultStageConfig, resolveHomeDisplay } from './config'
import { bindStageWindowToHomeDisplay, readStageDisplays } from './displays'
import { markStageWindow } from './identity'
import { setupStageWindowInvokes } from './rpc/index.electron'
import { applyStageInputIsolation, createStageWindowOptions } from './window-contract'

export { createStageConfig, defaultStageConfig } from './config'
export { centerUserFacingWindow, isStageWindow, showUserFacingWindow } from './identity'
export { selectHostMode } from './mode'
export { createStageStateBroadcast } from './state-broadcast'

export interface StageWindowHost extends Pick<StageWindowInvokes, 'getCharacterPlacement' | 'onCharacterPlacementChange'> {
  window: BrowserWindow
  /** Moves the window to the home display's work area after the saved home display changed. */
  applyHomeDisplay: () => void
}

export function relaunchApp(): void {
  app.relaunch()
  app.exit()
}

/**
 * Registers the stage contracts on a window other than the desktop stage: the classic main window, so its page can
 * report the active renderer, and the settings window, so its page can edit the mode and the home display.
 */
export function setupWindowStageInvokes(params: {
  window: BrowserWindow
  config: StageConfigStore
  running: StageHostMode
  broadcast: StageStateBroadcast
  applyHomeDisplay?: () => void
}): StageWindowInvokes {
  return setupStageWindowInvokes({
    window: params.window,
    config: params.config,
    defaultConfig: defaultStageConfig,
    screen,
    running: params.running,
    relaunch: relaunchApp,
    broadcast: params.broadcast,
    applyHomeDisplay: params.applyHomeDisplay,
  })
}

/**
 * Builds the full-screen desktop stage in place of the classic main window.
 *
 * Use when:
 * - `selectHostMode` chose `'desktop'` for this launch
 *
 * Expects:
 * - The same dependencies as {@link setupMainWindow}, because the stage page keeps the main-window invokes, plus the
 *   stage config that was already set up
 *
 * Returns:
 * - One transparent, click-through, always-on-top window over the home display's work area, shown without focus, and
 *   the placement the renderer publishes
 */
export async function setupStageWindow(
  params: Parameters<typeof setupMainWindow>[0] & { config: StageConfigStore, broadcast: StageStateBroadcast },
): Promise<StageWindowHost> {
  const getConfig = () => params.config.get() ?? defaultStageConfig
  const home = resolveHomeDisplay(readStageDisplays(screen), getConfig())

  const window = new ElectronBrowserWindow({
    ...createStageWindowOptions({
      workArea: home.workArea,
      preloadPath: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
    }),
    icon,
  })
  markStageWindow(window)
  params.onWindowCreated?.(window)

  applyStageInputIsolation(window)
  hideOnClose(window)
  window.on('ready-to-show', () => window.showInactive())
  protectPrivilegedWindowNavigation(window)

  // The stage page replaces the classic page, so it keeps every main-window invoke (controls, chat, inlay, settings).
  await setupMainWindowElectronInvokes({
    window,
    editorWindow: params.editorWindow,
    settingsWindow: params.settingsWindow,
    chatWindow: params.chatWindow,
    widgetsManager: params.widgetsManager,
    noticeWindow: params.noticeWindow,
    autoUpdater: params.autoUpdater,
    serverChannel: params.serverChannel,
    godotStageManager: params.godotStageManager,
    mcpManager: params.mcpManager,
    i18n: params.i18n,
    onboardingWindowManager: params.onboardingWindowManager,
    ioTraceRecording: params.ioTraceRecording,
    inlayWindow: params.inlayWindow,
    globalShortcut: params.globalShortcut,
  })

  const invokes = setupStageWindowInvokes({
    window,
    config: params.config,
    defaultConfig: defaultStageConfig,
    screen,
    running: 'desktop',
    relaunch: relaunchApp,
    broadcast: params.broadcast,
  })
  const { applyHomeBounds } = bindStageWindowToHomeDisplay({ screen, window, getConfig, onDisplaysChanged: params.broadcast.emitAll })

  await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/stage', {
    query: mainWindowQuery(is.dev, env),
  }))

  // The inlay loads once and stays shown, as with the classic window; showing it inactive keeps focus where it is.
  void params.inlayWindow().then((inlay) => {
    if (!inlay.isDestroyed())
      inlay.showInactive()
  }).catch(error => console.error('Failed to prepare the inlay window', error))

  initScreenCaptureForWindow(window)

  return {
    window,
    applyHomeDisplay: applyHomeBounds,
    getCharacterPlacement: invokes.getCharacterPlacement,
    onCharacterPlacementChange: invokes.onCharacterPlacementChange,
  }
}
