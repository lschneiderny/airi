import type { Display, Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { defaultStageConfig } from './config'
import { bindStageWindowToHomeDisplay } from './displays'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/airi-test' } }))

function electronDisplay(id: number, workArea: Rectangle): Display {
  return { id, bounds: workArea, workArea, scaleFactor: 2 } as Display
}

const builtIn = electronDisplay(1, { x: 0, y: 25, width: 1440, height: 875 })
const external = electronDisplay(7, { x: 1440, y: 0, width: 2560, height: 1415 })

class FakeScreen extends EventEmitter {
  displays: Display[] = [builtIn, external]
  getAllDisplays = () => this.displays
  getPrimaryDisplay = () => builtIn
}

class FakeWindow extends EventEmitter {
  bounds: Rectangle
  constructor(bounds: Rectangle) {
    super()
    this.bounds = { ...bounds }
  }

  setBounds = vi.fn((bounds: Rectangle) => {
    this.bounds = { ...bounds }
  })

  isDestroyed = () => false
}

describe('bindStageWindowToHomeDisplay', () => {
  it('moves the stage to the primary work area when its home display is removed', () => {
    const screen = new FakeScreen()
    const window = new FakeWindow(external.workArea)
    const onDisplaysChanged = vi.fn()
    bindStageWindowToHomeDisplay({ screen, displays: screen, window, readRect: () => ({ ...window.bounds }), getConfig: () => ({ ...defaultStageConfig, homeDisplayId: '7' }), onDisplaysChanged })

    screen.displays = [builtIn]
    screen.emit('display-removed')

    expect(window.setBounds).toHaveBeenCalledWith(builtIn.workArea)
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
  })

  it('moves the stage to the new home display when asked after a config change', () => {
    const screen = new FakeScreen()
    const window = new FakeWindow(builtIn.workArea)
    const onDisplaysChanged = vi.fn()
    let homeDisplayId: string | null = null
    const { applyHomeBounds } = bindStageWindowToHomeDisplay({ screen, displays: screen, window, readRect: () => ({ ...window.bounds }), getConfig: () => ({ ...defaultStageConfig, homeDisplayId }), onDisplaysChanged })

    homeDisplayId = '7'
    applyHomeBounds()

    expect(window.setBounds).toHaveBeenCalledWith(external.workArea)
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
  })

  it('keeps the bounds when the home display is unchanged, and stops listening once the window closes', () => {
    const screen = new FakeScreen()
    const window = new FakeWindow(builtIn.workArea)
    const onDisplaysChanged = vi.fn()
    bindStageWindowToHomeDisplay({ screen, displays: screen, window, readRect: () => ({ ...window.bounds }), getConfig: () => defaultStageConfig, onDisplaysChanged })

    screen.emit('display-metrics-changed')
    window.emit('closed')
    screen.emit('display-added')

    expect(window.setBounds).not.toHaveBeenCalled()
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
    expect(screen.listenerCount('display-added')).toBe(0)
  })
})
