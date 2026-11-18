import type { BrowserWindow } from 'electron'

import type { ControlsMenuAction } from '../../../../shared/eventa'
import type { createWindowContext } from '../../../libs/electron/window-context'
import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { NoticeWindowManager } from '../../notice'
import type { SettingsWindowManager } from '../../settings'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronControlsMenuClosed,
  electronControlsMenuPageMounted,
  electronOpenSettings,
  noticeWindowEventa,
} from '../../../../shared/eventa'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

/** Serves the requests of the menu page: its own lifecycle, and the items of the menu that the window does itself. */
export async function setupControlsMenuWindowInvokes(params: {
  context: ReturnType<typeof createWindowContext>['context']
  window: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
  settingsWindow: SettingsWindowManager
  noticeWindow: NoticeWindowManager
  onPageMounted: () => void
  onClosed: (action: ControlsMenuAction | undefined) => void
}) {
  const { context } = params

  await setupBaseWindowElectronInvokes({
    context,
    window: params.window,
    serverChannel: params.serverChannel,
    i18n: params.i18n,
  })

  defineInvokeHandler(context, electronControlsMenuPageMounted, () => params.onPageMounted())
  defineInvokeHandler(context, electronControlsMenuClosed, action => params.onClosed(action))
  defineInvokeHandler(context, electronOpenSettings, payload => params.settingsWindow.openWindow(payload?.route))
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))
}
