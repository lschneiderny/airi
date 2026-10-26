import { describe, expect, it } from 'vitest'

import { bottomLayerDisplays, placementReference, screenInwardness } from './index'

describe('stage placement', () => {
  const landscape = { x: 0, y: 0, width: 1920, height: 1080 }

  it('points inward from the left of a single display', () => {
    expect(screenInwardness([landscape], 100)).toBeCloseTo(860 / 960, 12)
  })

  it('uses the union of two side-by-side displays', () => {
    const displays = [landscape, { ...landscape, x: 1920 }]
    expect(bottomLayerDisplays(displays)).toEqual(displays)
    expect(placementReference(displays)).toEqual({ center: 1920, halfSpan: 1920 })
    expect(screenInwardness(displays, 3700)).toBeCloseTo(-1780 / 1920, 12)
  })

  it('excludes an upper stacked display', () => {
    const upper = { ...landscape, x: 960, y: -1080 }
    expect(bottomLayerDisplays([upper, landscape])).toEqual([landscape])
    expect(placementReference([upper, landscape])).toEqual({ center: 960, halfSpan: 960 })
  })

  it('keeps staggered displays with a sliver overlap below twenty percent', () => {
    const displays = [landscape, { ...landscape, x: 1800, y: -200 }]
    expect(bottomLayerDisplays(displays)).toEqual(displays)
    expect(placementReference(displays)).toEqual({ center: 1860, halfSpan: 1860 })
  })

  it('excludes an upper display at exactly twenty percent overlap', () => {
    const upper = { ...landscape, x: 1536, y: -200 }
    expect(bottomLayerDisplays([upper, landscape])).toEqual([landscape])
  })

  it('keeps a portrait display beside a landscape display', () => {
    const portrait = { x: -1080, y: -840, width: 1080, height: 1920 }
    const displays = [portrait, landscape]
    expect(bottomLayerDisplays(displays)).toEqual(displays)
    expect(placementReference(displays)).toEqual({ center: 420, halfSpan: 1500 })
    expect(screenInwardness(displays, 420)).toBe(0)
  })

  it('clamps a head left of all displays to positive one', () => {
    expect(screenInwardness([landscape], -100)).toBe(1)
  })

  it('clamps a head right of all displays to negative one', () => {
    expect(screenInwardness([landscape], 2000)).toBe(-1)
  })

  it('returns no reference or inwardness for an empty display list', () => {
    expect(bottomLayerDisplays([])).toEqual([])
    expect(placementReference([])).toBeNull()
    expect(screenInwardness([], 100)).toBeNull()
  })

  it('returns no inwardness for a NaN head coordinate', () => {
    expect(screenInwardness([landscape], Number.NaN)).toBeNull()
  })

  it('returns no inwardness for infinite head coordinates', () => {
    expect(screenInwardness([landscape], Number.POSITIVE_INFINITY)).toBeNull()
    expect(screenInwardness([landscape], Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('returns no reference or inwardness for a zero-width display', () => {
    const displays = [{ ...landscape, width: 0 }]
    expect(placementReference(displays)).toBeNull()
    expect(screenInwardness(displays, 100)).toBeNull()
  })

  it('returns no reference or inwardness for a zero-span display union', () => {
    const displays = [{ ...landscape, x: 100, width: 0 }, { ...landscape, x: 100, y: -1080, width: 0 }]
    expect(placementReference(displays)).toBeNull()
    expect(screenInwardness(displays, 100)).toBeNull()
  })
})
