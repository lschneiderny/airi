import type { Display, Rectangle } from 'electron'

import type { StageConfig } from './config'

import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultStageConfig } from './config'
import { bindStageWindowToDisplay, stageMoveTimeoutMs } from './displays'

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
  /** `false` models a compositor that has not applied the placement yet. */
  applies = true
  constructor(bounds: Rectangle) {
    super()
    this.bounds = { ...bounds }
  }

  setBounds = vi.fn((bounds: Rectangle) => {
    if (!this.applies)
      return
    this.bounds = { ...bounds }
    this.emit('move')
  })

  isDestroyed = () => false
}

function bind(options: { window: FakeWindow, screen?: FakeScreen, config?: () => StageConfig }) {
  const screen = options.screen ?? new FakeScreen()
  const { window } = options
  const onDisplaysChanged = vi.fn()
  const onMoved = vi.fn()
  const binding = bindStageWindowToDisplay({
    screen,
    displays: screen,
    window,
    readRect: () => ({ ...window.bounds }),
    place: bounds => window.setBounds(bounds),
    onRectChange(listener) {
      window.on('move', listener)
      return () => window.off('move', listener)
    },
    getConfig: options.config ?? (() => defaultStageConfig),
    onDisplaysChanged,
    onMoved,
  })
  return { binding, screen, window, onDisplaysChanged, onMoved }
}

afterEach(() => vi.useRealTimers())

describe('bindStageWindowToDisplay', () => {
  it('moves the stage to the primary work area when its home display is removed', () => {
    const { screen, window, onDisplaysChanged, binding } = bind({ window: new FakeWindow(external.workArea), config: () => ({ ...defaultStageConfig, homeDisplayId: '7' }) })
    expect(binding.stageDisplayId()).toBe('7')

    screen.displays = [builtIn]
    screen.emit('display-removed')

    expect(window.setBounds).toHaveBeenCalledWith(builtIn.workArea)
    expect(binding.stageDisplayId()).toBe('1')
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
  })

  it('moves the stage to the new home display when asked after a config change', () => {
    let homeDisplayId: string | null = null
    const { window, onDisplaysChanged, binding } = bind({ window: new FakeWindow(builtIn.workArea), config: () => ({ ...defaultStageConfig, homeDisplayId }) })

    homeDisplayId = '7'
    binding.applyHomeBounds()

    expect(window.setBounds).toHaveBeenCalledWith(external.workArea)
    expect(binding.stageDisplayId()).toBe('7')
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
  })

  it('keeps the bounds when the home display is unchanged, and stops listening once the window closes', () => {
    const { screen, window, onDisplaysChanged } = bind({ window: new FakeWindow(builtIn.workArea) })

    screen.emit('display-metrics-changed')
    window.emit('closed')
    screen.emit('display-added')

    expect(window.setBounds).not.toHaveBeenCalled()
    expect(onDisplaysChanged).toHaveBeenCalledOnce()
    expect(screen.listenerCount('display-added')).toBe(0)
  })
})

describe('moveToDisplay', () => {
  it('makes a display the stage display once the window is read back on its work area', async () => {
    const { window, binding, onMoved } = bind({ window: new FakeWindow(builtIn.workArea) })

    await expect(binding.moveToDisplay('7')).resolves.toBe(true)

    expect(window.bounds).toEqual(external.workArea)
    expect(binding.stageDisplayId()).toBe('7')
    expect(onMoved).toHaveBeenCalledOnce()
    expect(window.listenerCount('move')).toBe(0)
  })

  it('waits for a compositor that applies the placement later', async () => {
    vi.useFakeTimers()
    const { window, binding } = bind({ window: new FakeWindow(builtIn.workArea) })
    window.applies = false

    const moved = binding.moveToDisplay('7')
    expect(binding.stageDisplayId()).toBe('1')
    vi.advanceTimersByTime(stageMoveTimeoutMs - 1)
    // One pixel off after rounding to the other display's scale still counts as arrived.
    window.bounds = { ...external.workArea, width: external.workArea.width - 1 }
    window.emit('move')

    await expect(moved).resolves.toBe(true)
    expect(binding.stageDisplayId()).toBe('7')
  })

  it('puts the window back and keeps the stage display when the rectangle never arrives', async () => {
    vi.useFakeTimers()
    const { window, binding, onMoved } = bind({ window: new FakeWindow(builtIn.workArea) })
    window.applies = false

    const moved = binding.moveToDisplay('7')
    vi.advanceTimersByTime(stageMoveTimeoutMs)

    await expect(moved).resolves.toBe(false)
    expect(window.setBounds.mock.calls).toEqual([[external.workArea], [builtIn.workArea]])
    expect(binding.stageDisplayId()).toBe('1')
    expect(onMoved).not.toHaveBeenCalled()
    expect(window.listenerCount('move')).toBe(0)
  })

  it('ends the move and goes home when the target display is removed on the way', async () => {
    vi.useFakeTimers()
    const { screen, window, binding } = bind({ window: new FakeWindow(builtIn.workArea) })
    window.applies = false

    const moved = binding.moveToDisplay('7')
    screen.displays = [builtIn]
    screen.emit('display-removed')

    await expect(moved).resolves.toBe(false)
    expect(binding.stageDisplayId()).toBe('1')
    // The timeout of the ended move must not place the window again.
    window.setBounds.mockClear()
    vi.advanceTimersByTime(stageMoveTimeoutMs)
    expect(window.setBounds).not.toHaveBeenCalled()
  })

  it('rejects a display that is not connected and leaves the window alone', async () => {
    const { window, binding } = bind({ window: new FakeWindow(builtIn.workArea) })

    await expect(binding.moveToDisplay('99')).rejects.toThrow('not connected')
    expect(window.setBounds).not.toHaveBeenCalled()
    expect(binding.stageDisplayId()).toBe('1')
  })

  it('brings the window home on a display change after a move, and back to the stage display on a recheck', async () => {
    const { screen, window, binding } = bind({ window: new FakeWindow(builtIn.workArea) })
    await binding.moveToDisplay('7')

    // Something else moved the window, as a compositor can across a suspend.
    window.bounds = { ...builtIn.workArea }
    binding.recheck()
    expect(window.bounds).toEqual(external.workArea)
    expect(binding.stageDisplayId()).toBe('7')

    screen.emit('display-metrics-changed')
    expect(window.bounds).toEqual(builtIn.workArea)
    expect(binding.stageDisplayId()).toBe('1')
  })
})
