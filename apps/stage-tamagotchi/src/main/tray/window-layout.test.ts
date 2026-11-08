import type { MenuItemConstructorOptions, Rectangle } from 'electron'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentHostCapabilities } from '../services/electron/host-capabilities'
import { markStageWindow } from '../windows/stage/identity'
import { windowLayoutMenuItems } from './window-layout'

vi.mock('../windows/shared/window', () => ({ toggleWindowShow: vi.fn() }))
vi.mock('../windows/shared/display', () => ({ centerWindowOnDisplay: vi.fn() }))
vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
}))

const workArea: Rectangle = { x: 0, y: 25, width: 1440, height: 801 }

function fakeWindow(bounds: Rectangle) {
  return { getBounds: () => bounds }
}

function items(window: ReturnType<typeof fakeWindow>) {
  const resize = vi.fn()
  const align = vi.fn()
  const menu = windowLayoutMenuItems({ window, workArea, t: key => key.split('.').at(-1)!, resize, align })
  const submenu = (label: string) => (menu.find(item => item.label === label)?.submenu ?? []) as MenuItemConstructorOptions[]
  const click = (item: MenuItemConstructorOptions | undefined) => (item?.click as (() => void) | undefined)?.()
  return { menu, submenu, click, resize, align }
}

describe('windowLayoutMenuItems', () => {
  beforeEach(() => Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows')))

  it('omits Align and never reads the hidden x/y when matching sizes', () => {
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))
    const bounds = {
      get x(): number { throw new Error('Untrusted x read') },
      get y(): number { throw new Error('Untrusted y read') },
      width: 450,
      height: 600,
    }
    const { menu } = items(fakeWindow(bounds))
    expect(menu.map(item => item.type ?? item.label)).toEqual(['separator', 'adjust_sizes'])
  })

  it('offers sizes and alignment for the classic window and reports the current ones', () => {
    const { menu, submenu, click, resize, align } = items(fakeWindow({ x: 495, y: 125, width: 450, height: 600 }))

    expect(menu.map(item => item.type ?? item.label)).toEqual(['separator', 'adjust_sizes', 'align_to'])
    expect(submenu('adjust_sizes').map(item => [item.label, item.checked])).toEqual([
      ['recommended_size', true],
      ['full_height', false],
      ['half_height', false],
      ['full_screen', false],
    ])
    expect(submenu('align_to').find(item => item.label === 'center')?.checked).toBe(true)

    click(submenu('adjust_sizes').find(item => item.label === 'full_screen'))
    click(submenu('align_to').find(item => item.label === 'bottom_right'))
    expect(resize).toHaveBeenCalledWith(1440, 801, 0, 25)
    expect(align).toHaveBeenCalledWith('bottom-right')
  })

  it('offers nothing for the desktop stage, which must not be resized or moved', () => {
    const stage = fakeWindow(workArea)
    markStageWindow(stage)

    expect(items(stage).menu).toEqual([])
  })
})
