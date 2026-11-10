import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { AutoUpdater } from '../../../services/electron/auto-updater'

import { createWindowContext } from '../../../libs/electron/window-context'
import { createAutoUpdaterService } from '../../../services/electron'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupAboutWindowElectronInvokes(params: {
  window: BrowserWindow
  autoUpdater: AutoUpdater
  i18n: I18n
  serverChannel: ServerChannel
}) {
  const { context } = createWindowContext(params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, i18n: params.i18n, serverChannel: params.serverChannel })

  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
}
