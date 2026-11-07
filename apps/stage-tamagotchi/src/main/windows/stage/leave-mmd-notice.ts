import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'

import type { I18n } from '../../libs/i18n'

/** The part of Electron's `dialog` the notice uses, so tests can answer it. */
export interface LeaveMmdNoticeDialog {
  showMessageBox: (window: BrowserWindow, options: MessageBoxOptions) => Promise<Pick<MessageBoxReturnValue, 'response'>>
}

const relaunchButton = 0
const keepButton = 1

/**
 * Tells the user that the desktop stage keeps running after the stage model left MMD, and offers to relaunch into the
 * classic window.
 *
 * Use when:
 * - The desktop stage runs and its page reports a renderer that is not MMD. The host is fixed for this launch, so the
 *   new model only gets the classic window after a relaunch.
 *
 * Returns:
 * - Whether the user chose to relaunch; `relaunch` has been called then
 */
export async function offerClassicWindowRelaunch(params: {
  window: BrowserWindow
  dialog: LeaveMmdNoticeDialog
  i18n: Pick<I18n, 't'>
  relaunch: () => void
}): Promise<boolean> {
  // On macOS an unparented message box blocks main even through the promise API.
  const { response } = await params.dialog.showMessageBox(params.window, {
    type: 'info',
    title: params.i18n.t('tamagotchi.electron.stage.leave-mmd-notice.title'),
    message: params.i18n.t('tamagotchi.electron.stage.leave-mmd-notice.message'),
    detail: params.i18n.t('tamagotchi.electron.stage.leave-mmd-notice.detail'),
    buttons: [
      params.i18n.t('tamagotchi.electron.stage.leave-mmd-notice.relaunch'),
      params.i18n.t('tamagotchi.electron.stage.leave-mmd-notice.keep'),
    ],
    defaultId: relaunchButton,
    cancelId: keepButton,
    noLink: true,
  })

  if (response !== relaunchButton)
    return false

  params.relaunch()
  return true
}
