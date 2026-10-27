import { describe, expect, it } from 'vitest'

import { chatTargetOffset, headScreenX, ScreenPlacement } from './screen-placement'

describe('screen placement', () => {
  it('holds the last placement through a one-frame missing measurement', () => {
    const placement = new ScreenPlacement()
    expect(placement.update(true, -0.8)).toBe(-0.8)
    expect(placement.update(true, null)).toBe(-0.8)
    expect(placement.update(true, 0.6)).toBe(0.6)
  })

  it.each(['setting off', 'prop removed', 'non-Natural driver'])('clears immediately for %s and does not revive stale state', () => {
    const placement = new ScreenPlacement()
    placement.update(true, -0.8)
    expect(placement.update(false, null)).toBeNull()
    expect(placement.update(true, null)).toBeNull()
    expect(placement.update(true, 0.6)).toBe(0.6)
  })

  it('has no signal before the first valid measurement', () => {
    const placement = new ScreenPlacement()
    expect(placement.update(true, null)).toBeNull()
    expect(placement.update(true, Number.NaN)).toBeNull()
  })

  it('accepts centered zero and ignores non-finite measurements', () => {
    const placement = new ScreenPlacement()
    expect(placement.update(true, 0)).toBe(0)
    expect(placement.update(true, Number.NaN)).toBe(0)
    expect(placement.update(true, Number.POSITIVE_INFINITY)).toBe(0)
    expect(placement.update(false, 0.7)).toBeNull()
  })

  it.each([0, Number.NaN])('holds placement when client width becomes %s for one frame', (width) => {
    const placement = new ScreenPlacement()
    placement.update(true, -0.8)
    const missing = headScreenX({ x: 1470, y: 432, width: 450, height: 600 }, width, { x: 150, width: 150 })
    expect(missing).toBeNull()
    expect(placement.update(true, missing)).toBe(-0.8)
    expect(placement.update(false, missing)).toBeNull()
  })
})

describe('headScreenX', () => {
  const windowBounds = { x: 1000, y: 200, width: 600, height: 800 }
  const head = { x: 200, width: 100 }

  it('maps the head center 1:1 at zoom 1', () => {
    expect(headScreenX(windowBounds, 600, head)).toBe(1250)
  })

  it('scales CSS pixels to DIP at zoom 1.25', () => {
    // At 125% zoom a 600 DIP window is 480 CSS px wide, so one CSS px is 1.25 DIP.
    expect(headScreenX(windowBounds, 480, head)).toBe(1000 + 250 * 1.25)
  })

  it.each([0, Number.NaN, -1])('returns null for client width %s', (clientWidth) => {
    expect(headScreenX(windowBounds, clientWidth, head)).toBeNull()
  })

  it('returns null before the window reports its bounds', () => {
    expect(headScreenX({ x: 0, y: 0, width: 0, height: 0 }, 600, head)).toBeNull()
  })

  it('returns null for a non-finite head rectangle', () => {
    expect(headScreenX(windowBounds, 600, { x: Number.NaN, width: 100 })).toBeNull()
  })
})

describe('chatTargetOffset', () => {
  const windowBounds = { x: 1000, y: 200, width: 600, height: 800 }
  // Model canvas px equal viewport CSS px here, with the eye at (300, 300) and a 100 px head.
  const identity = (client: { x: number, y: number }) => client
  const eye = { anchorX: 300, anchorY: 300, unit: 100 }

  it('puts a chat left of the window at negative x', () => {
    const offset = chatTargetOffset({ x: 500, y: 300, width: 300, height: 400 }, windowBounds, 600, identity, eye)
    // Center (650, 500) DIP is (-350, 300) in the viewport: 6.5 head widths left of the eye, level with it.
    expect(offset).toEqual({ x: -6.5, y: 0 })
  })

  it('converts DIP to CSS px through the zoom before mapping, with y up', () => {
    // At 125% zoom the 600 DIP window is 480 CSS px wide; the center (1600, 450) DIP is (480, 200) CSS px.
    const offset = chatTargetOffset({ x: 1500, y: 350, width: 200, height: 200 }, windowBounds, 480, identity, eye)
    expect(offset).toEqual({ x: 1.8, y: 1 })
  })

  it('measures in the space toModel maps into', () => {
    const doubled = (client: { x: number, y: number }) => ({ x: client.x * 2, y: client.y * 2 })
    expect(chatTargetOffset({ x: 1000, y: 200, width: 0, height: 0 }, windowBounds, 600, doubled, eye)).toEqual({ x: -3, y: 3 })
  })

  it.each([
    ['a zero client width', 0, windowBounds, eye],
    ['a non-finite client width', Number.NaN, windowBounds, eye],
    ['an unreported window', 600, { x: 0, y: 0, width: 0, height: 0 }, eye],
    ['a zero head unit', 600, windowBounds, { ...eye, unit: 0 }],
    ['a non-finite eye anchor', 600, windowBounds, { ...eye, anchorX: Number.NaN }],
  ])('returns null for %s', (_, clientWidth, bounds, anchor) => {
    expect(chatTargetOffset({ x: 500, y: 300, width: 300, height: 400 }, bounds, clientWidth, identity, anchor)).toBeNull()
  })
})
