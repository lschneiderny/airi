import type { BrowserWindow, Rectangle } from 'electron'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentHostCapabilities } from '../../services/electron/host-capabilities'
import { Animator } from './animator'

vi.mock('electron', () => ({
  app: { isReady: () => true, commandLine: { getSwitchValue: () => 'x11' } },
  screen: {},
}))

function createWindow(initialBounds: Rectangle) {
  const bounds = { ...initialBounds }

  return {
    getBounds: vi.fn(() => ({ ...bounds })),
    isDestroyed: vi.fn(() => false),
    setPosition: vi.fn((x: number, y: number) => {
      bounds.x = x
      bounds.y = y
    }),
    setSize: vi.fn((width: number, height: number) => {
      bounds.width = width
      bounds.height = height
    }),
  } satisfies Pick<BrowserWindow, 'getBounds' | 'isDestroyed' | 'setPosition' | 'setSize'>
}

function waitForAnimation(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 30))
}

describe('window bounds animator', () => {
  beforeEach(() => Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('windows')))

  it('applies only size on Wayland without reading or animating the origin', () => {
    const window = createWindow({ x: 10, y: 20, width: 300, height: 400 })
    const animator = new Animator(window)
    Object.assign(getCurrentHostCapabilities(), capabilitiesForHost('linux-wayland'))

    animator.windowBoundsAnimateTo({ x: 100, y: 200, width: 450, height: 600 })

    expect(window.setSize).toHaveBeenCalledWith(450, 600)
    expect(window.getBounds).not.toHaveBeenCalled()
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('animates position after it applies the target size', async () => {
    const window = createWindow({ x: 10, y: 20, width: 300, height: 400 })
    const animator = new Animator(window)

    animator.windowBoundsAnimateTo(
      { x: 100, y: 200, width: 450, height: 600 },
      { duration: 1 },
    )
    await waitForAnimation()

    expect(window.setSize).toHaveBeenCalledWith(450, 600)
    expect(window.setPosition).toHaveBeenLastCalledWith(100, 200)
  })

  it('stops the previous animation before it starts a new animation', async () => {
    const window = createWindow({ x: 10, y: 20, width: 300, height: 400 })
    const animator = new Animator(window)

    animator.windowBoundsAnimateTo(
      { x: 100, y: 100, width: 300, height: 400 },
      { duration: 100 },
    )
    animator.windowBoundsAnimateTo(
      { x: 200, y: 200, width: 300, height: 400 },
      { duration: 1 },
    )
    await waitForAnimation()

    expect(window.setPosition).toHaveBeenLastCalledWith(200, 200)
  })

  it('does not start an animation for a destroyed window', () => {
    const window = createWindow({ x: 10, y: 20, width: 300, height: 400 })
    window.isDestroyed.mockReturnValue(true)
    const animator = new Animator(window)

    animator.windowBoundsAnimateTo({ x: 100, y: 200, width: 300, height: 400 })

    expect(window.setPosition).not.toHaveBeenCalled()
    expect(window.setSize).not.toHaveBeenCalled()
  })
})
