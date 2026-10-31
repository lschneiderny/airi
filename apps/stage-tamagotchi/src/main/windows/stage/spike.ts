import type { setupMainWindow } from '../main'

import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createDesktopOverlayWindowOptions } from '../desktop-overlay/window-contract'
import { mainWindowQuery } from '../main/query'
import { setupMainWindowElectronInvokes } from '../main/rpc/index.electron'
import { protectPrivilegedWindowNavigation, setWindowAlwaysOnTop } from '../shared'

/**
 * Whether the throwaway full-screen stage spike replaces the main window.
 *
 * Set `AIRI_STAGE_SPIKE=1` to measure a transparent stage that covers the primary display's work area.
 */
export function isStageSpikeEnabled(): boolean {
  return env.AIRI_STAGE_SPIKE === '1'
}

/**
 * Builds the feasibility-spike stage window in place of the main window.
 *
 * Use when:
 * - `AIRI_STAGE_SPIKE=1` is set and the full-screen transparent stage must be measured
 *
 * Expects:
 * - The same dependencies as {@link setupMainWindow}, so the `/` page keeps its main-window invokes
 *
 * Returns:
 * - A transparent, click-through, always-on-top window over the primary work area, loading `/` with `stage-spike=1`
 *
 * NOTICE:
 * This window is a measurement spike, not the product host.
 * The desktop-stage host in `windows/stage` replaces it (plan fullscreen-stage-locomotion, todo 6).
 * Source: `.omo/plans/fullscreen-stage-locomotion.md`, todo 1.
 * Removal condition: delete this file when todo 6 lands the desktop-stage host.
 */
export async function setupStageSpikeWindow(params: Parameters<typeof setupMainWindow>[0]): Promise<BrowserWindow> {
  const preloadPath = join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs')
  const window = new BrowserWindow({
    ...createDesktopOverlayWindowOptions({ bounds: screen.getPrimaryDisplay().workArea, preloadPath }),
    title: 'AIRI',
    focusable: true,
  })

  params.onWindowCreated?.(window)

  window.setIgnoreMouseEvents(true, { forward: true })
  setWindowAlwaysOnTop(window, true)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('ready-to-show', () => window.showInactive())
  protectPrivilegedWindowNavigation(window)

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

  await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/', {
    query: { ...mainWindowQuery(is.dev, env), 'stage-spike': '1' },
  }))

  return window
}
