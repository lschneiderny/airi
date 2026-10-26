import { describe, expect, it } from 'vitest'

import { headScreenX } from './screen-placement'

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
