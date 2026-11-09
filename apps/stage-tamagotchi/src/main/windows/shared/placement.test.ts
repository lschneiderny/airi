import { beforeEach, describe, expect, it, vi } from 'vitest'

import { placeWindow } from './placement'

const coordinates = vi.hoisted(() => ({ placeOwnWindow: vi.fn<(window: object, rect: unknown) => boolean>() }))

vi.mock('../../services/electron/coordinates', () => coordinates)

function window() {
  return { setBounds: vi.fn(), setPosition: vi.fn(), getBounds: vi.fn(() => ({ x: 1, y: 2, width: 300, height: 400 })) }
}

describe('placeWindow', () => {
  beforeEach(() => {
    coordinates.placeOwnWindow.mockReset()
  })

  it('leaves a complete rectangle to KWin when the actuator takes it', () => {
    coordinates.placeOwnWindow.mockReturnValue(true)
    const target = window()
    placeWindow(target, { x: 200, y: 200, width: 320, height: 240 })
    expect(coordinates.placeOwnWindow).toHaveBeenCalledWith(target, { x: 200, y: 200, width: 320, height: 240 })
    expect(target.setBounds).not.toHaveBeenCalled()
  })

  it('places through Electron exactly as before when the actuator declines', () => {
    coordinates.placeOwnWindow.mockReturnValue(false)
    const target = window()
    placeWindow(target, { x: 200, y: 200, width: 320, height: 240 })
    expect(target.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 200, y: 200, width: 320, height: 240 })
  })

  it('resizes a partial rectangle through Electron without asking KWin', () => {
    const target = window()
    placeWindow(target, { width: 320, height: 240 })
    expect(coordinates.placeOwnWindow).not.toHaveBeenCalled()
    expect(target.setBounds).toHaveBeenCalledExactlyOnceWith({ width: 320, height: 240 })
  })

  it('moves to a point at the current size, keeping setPosition off KWin', () => {
    coordinates.placeOwnWindow.mockReturnValue(false)
    const target = window()
    placeWindow(target, { x: 10, y: 20 })
    expect(coordinates.placeOwnWindow).toHaveBeenCalledWith(target, { x: 10, y: 20, width: 300, height: 400 })
    expect(target.setPosition).toHaveBeenCalledExactlyOnceWith(10, 20)
    expect(target.setBounds).not.toHaveBeenCalled()
  })

  it('moves to a point through KWin when the actuator takes it', () => {
    coordinates.placeOwnWindow.mockReturnValue(true)
    const target = window()
    placeWindow(target, { x: 10, y: 20 })
    expect(target.setPosition).not.toHaveBeenCalled()
  })
})
