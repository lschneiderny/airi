import { describe, expect, it } from 'vitest'

import { live2DTouchRegionAt, live2DVisibleBounds, scaleLive2DRect } from './touch-regions'

function source(drawables: { x: number, y: number, width: number, height: number, visible?: boolean, opacity?: number }[]) {
  return {
    coreModel: {
      getDrawableCount: () => drawables.length,
      getDrawableDynamicFlagIsVisible: (index: number) => drawables[index].visible ?? true,
      getDrawableOpacity: (index: number) => drawables[index].opacity ?? 1,
    },
    getDrawableBounds: (index: number) => ({ ...drawables[index] }),
  }
}

describe('live2d touch regions', () => {
  it('bounds only the drawables the renderer draws', () => {
    expect(live2DVisibleBounds(source([
      { x: 100, y: 100, width: 50, height: 50 },
      { x: 200, y: 300, width: 20, height: 10 },
      { x: 0, y: 0, width: 1000, height: 1000, visible: false },
      { x: 0, y: 0, width: 1000, height: 1000, opacity: 0 },
    ]))).toEqual({ x: 100, y: 100, width: 120, height: 210 })
  })

  it('reports no bounds when nothing is drawn', () => {
    expect(live2DVisibleBounds(source([{ x: 0, y: 0, width: 10, height: 10, visible: false }]))).toBeUndefined()
  })

  it('scales a head box around its center', () => {
    expect(scaleLive2DRect({ x: 100, y: 50, width: 40, height: 20 }, 1.5)).toEqual({ x: 90, y: 45, width: 60, height: 30 })
    expect(scaleLive2DRect({ x: 100, y: 50, width: 40, height: 20 }, 1)).toEqual({ x: 100, y: 50, width: 40, height: 20 })
  })

  it('prefers the head where it overlaps the body', () => {
    const regions = {
      head: { x: 40, y: 0, width: 20, height: 20 },
      body: { x: 0, y: 0, width: 100, height: 200 },
    }
    expect(live2DTouchRegionAt({ x: 50, y: 10 }, regions)).toBe('head')
    expect(live2DTouchRegionAt({ x: 10, y: 150 }, regions)).toBe('body')
    expect(live2DTouchRegionAt({ x: 150, y: 150 }, regions)).toBeNull()
    expect(live2DTouchRegionAt({ x: 50, y: 10 }, { head: undefined, body: regions.body })).toBe('body')
  })
})
