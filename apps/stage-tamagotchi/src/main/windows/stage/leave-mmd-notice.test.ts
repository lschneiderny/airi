import type { MessageBoxOptions } from 'electron'

import { describe, expect, it, vi } from 'vitest'

import { offerClassicWindowRelaunch } from './leave-mmd-notice'

const i18n = { t: (key: string) => key }

function dialogAnswering(response: number) {
  const shown: MessageBoxOptions[] = []
  return {
    shown,
    dialog: {
      showMessageBox: vi.fn(async (options: MessageBoxOptions) => {
        shown.push(options)
        return { response }
      }),
    },
  }
}

describe('offerClassicWindowRelaunch', () => {
  it('relaunches when the user picks the relaunch button', async () => {
    const { dialog, shown } = dialogAnswering(0)
    const relaunch = vi.fn()

    await expect(offerClassicWindowRelaunch({ dialog, i18n, relaunch })).resolves.toBe(true)

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

    await expect(offerClassicWindowRelaunch({ dialog, i18n, relaunch })).resolves.toBe(false)

    expect(relaunch).not.toHaveBeenCalled()
  })
})
