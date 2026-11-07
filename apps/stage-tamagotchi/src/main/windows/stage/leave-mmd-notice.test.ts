import type { BrowserWindow, MessageBoxOptions } from 'electron'

import { describe, expect, it, vi } from 'vitest'

import { offerClassicWindowRelaunch } from './leave-mmd-notice'

const i18n = { t: (key: string) => key }
const window = {} as BrowserWindow

function dialogAnswering(response: number) {
  const shown: MessageBoxOptions[] = []
  return {
    shown,
    dialog: {
      showMessageBox: vi.fn(async (_window: BrowserWindow, options: MessageBoxOptions) => {
        shown.push(options)
        return { response }
      }),
    },
  }
}

describe('offerClassicWindowRelaunch', () => {
  it('parents the asynchronous message box so macOS does not block the main process', async () => {
    const showMessageBox = vi.fn(async (..._args: unknown[]) => ({ response: 1 }))
    const params = { window, dialog: { showMessageBox }, i18n, relaunch: vi.fn() }

    await offerClassicWindowRelaunch(params)

    expect(showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ type: 'info' }))
  })

  it('relaunches when the user picks the relaunch button', async () => {
    const { dialog, shown } = dialogAnswering(0)
    const relaunch = vi.fn()

    await expect(offerClassicWindowRelaunch({ window, dialog, i18n, relaunch })).resolves.toBe(true)

    expect(relaunch).toHaveBeenCalledOnce()
    expect(shown[0]?.buttons).toEqual([
      'tamagotchi.electron.stage.leave-mmd-notice.relaunch',
      'tamagotchi.electron.stage.leave-mmd-notice.keep',
    ])
    expect(shown[0]).toMatchObject({ defaultId: 0, cancelId: 1 })
  })

  it('keeps the desktop stage running when the user dismisses the notice', async () => {
    const { dialog } = dialogAnswering(1)
    const relaunch = vi.fn()

    await expect(offerClassicWindowRelaunch({ window, dialog, i18n, relaunch })).resolves.toBe(false)

    expect(relaunch).not.toHaveBeenCalled()
  })
})
