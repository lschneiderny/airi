import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, shell } from 'electron'
import { isLinux, isMacOS, isWindows } from 'std-env'

import { electron, electronAppGetVersion, electronAppOpenUserDataFolder, electronAppQuit } from '../../../shared/eventa'
import { createWindowContext } from '../../libs/electron/window-context'

export function createAppService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  defineInvokeHandler(params.context, electron.app.isMacOS, () => isMacOS)
  defineInvokeHandler(params.context, electron.app.isWindows, () => isWindows)
  defineInvokeHandler(params.context, electron.app.isLinux, () => isLinux)
  defineInvokeHandler(params.context, electronAppOpenUserDataFolder, async () => {
    const path = app.getPath('userData')
    const openResult = await shell.openPath(path)
    if (openResult) {
      throw new Error(openResult)
    }
    return { path }
  })
  defineInvokeHandler(params.context, electronAppQuit, () => app.quit())
}

/**
 * Serves the app version to the renderer of one window.
 *
 * The handler lives on the window's own context, which hears only IPC from this window, so one request runs one
 * handler. The context, and with it the handler, goes when the window closes.
 */
export function createAppVersionService(params: { window: BrowserWindow }) {
  const { context } = createWindowContext(params.window)
  defineInvokeHandler(context, electronAppGetVersion, () => app.getVersion())
}
