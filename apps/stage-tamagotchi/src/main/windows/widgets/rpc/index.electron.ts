import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { WidgetsWindowManager } from '../../widgets'

import { createWindowContext } from '../../../libs/electron/window-context'
import { createWidgetsService } from '../../../services/airi/widgets'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

/**
 * Registers Eventa invokes for one widget window on the window's context. The handlers go with the window.
 *
 * Call stack:
 *
 * setupWidgetsWindowInvokes (./index.electron)
 *   -> {@link setupBaseWindowElectronInvokes}
 *   -> {@link createWidgetsService}
 */
export async function setupWidgetsWindowInvokes(params: {
  widgetWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  i18n: I18n
  serverChannel: ServerChannel
}) {
  const { context } = createWindowContext(params.widgetWindow)

  setupBaseWindowElectronInvokes({ context, window: params.widgetWindow, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.widgetWindow })
}
