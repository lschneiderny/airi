import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'

import type { I18n } from '../../libs/i18n'

/** The part of Electron's `dialog` the notice uses, so tests can answer it. */
export interface LeaveMmdNoticeDialog {
  showMessageBox: (window: BrowserWindow, options: MessageBoxOptions) => Promise<Pick<MessageBoxReturnValue, 'response'>>
}

/**
 * Why the notice offers the classic window: the stage model left MMD (`leave-mmd-notice`), or the desktop stage
 * cannot use click-through on this desktop (`click-through-notice`).
 */
export type ClassicWindowNotice = 'leave-mmd-notice' | 'click-through-notice'

const relaunchButton = 0
const keepButton = 1

/**
 * Tells the user that the desktop stage cannot serve them for the rest of this launch, and offers to relaunch into the
 * classic window.
 *
 * Use when:
 * - The desktop stage runs and its page reports a renderer that is not MMD. The host is fixed for this launch, so the
 *   new model only gets the classic window after a relaunch.
 * - The desktop stage runs but click-through is not usable, so it ignores the pointer (`click-through-notice`)
 *
 * Returns:
 * - Whether the user chose to relaunch; `relaunch` has been called then
 */
export async function offerClassicWindowRelaunch(params: {
  window: BrowserWindow
  dialog: LeaveMmdNoticeDialog
  i18n: Pick<I18n, 't'>
  relaunch: () => void
  notice: ClassicWindowNotice
}): Promise<boolean> {
  const { notice } = params
  // On macOS an unparented message box blocks main even through the promise API.
  const { response } = await params.dialog.showMessageBox(params.window, {
    type: 'info',
    title: params.i18n.t(`tamagotchi.electron.stage.${notice}.title`),
    message: params.i18n.t(`tamagotchi.electron.stage.${notice}.message`),
    detail: params.i18n.t(`tamagotchi.electron.stage.${notice}.detail`),
    buttons: [
      params.i18n.t(`tamagotchi.electron.stage.${notice}.relaunch`),
      params.i18n.t(`tamagotchi.electron.stage.${notice}.keep`),
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
