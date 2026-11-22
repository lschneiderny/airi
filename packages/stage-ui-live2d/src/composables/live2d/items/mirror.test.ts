import { describe, expect, it } from 'vitest'

import { Live2DParameterMirror } from './mirror'
import { canvasAlignedPlacement } from './pose'

function parameterModel(values: number[]) {
  return {
    values,
    getParameterValueByIndex: (index: number) => values[index],
    setParameterValueByIndex: (index: number, value: number) => {
      values[index] = value
    },
  }
}

describe('live2DParameterMirror', () => {
  const herIds = ['ParamAngleX', 'ParamHairFront', 'ParamOnlyHers', 'ParamBodyAngleX']
  const itemIds = ['ParamBodyAngleX', 'ParamOnlyItem', 'ParamHairFront', 'ParamAngleX']

  it('copies shared ids by index and skips ids one model lacks and the item physics outputs', () => {
    const mirror = new Live2DParameterMirror(herIds, itemIds, new Set(['ParamHairFront']))
    const her = parameterModel([30, 0.5, 7, -10])
    const item = parameterModel([0, 1, 0.25, 0])

    mirror.capture(her)
    mirror.apply(item)

    expect(item.values).toEqual([-10, 1, 0.25, 30])
  })

  it('writes nothing before its first capture, then the latest captured values', () => {
    const mirror = new Live2DParameterMirror(herIds, itemIds, new Set())
    const her = parameterModel([30, 0.5, 7, -10])
    const item = parameterModel([1, 2, 3, 4])

    mirror.apply(item)
    expect(item.values).toEqual([1, 2, 3, 4])

    mirror.capture(her)
    her.values[0] = -30
    mirror.apply(item)
    expect(item.values[3]).toBe(30)
    mirror.capture(her)
    mirror.apply(item)
    expect(item.values[3]).toBe(-30)
  })
})

describe('canvasAlignedPlacement', () => {
  it('centers the item canvas on hers and scales it to her canvas width', () => {
    expect(canvasAlignedPlacement({ originalWidth: 2000, originalHeight: 3000 }, { originalWidth: 1000 })).toEqual({
      x: 1000,
      y: 1500,
      rotation: 0,
      scale: 2,
      flipX: false,
      anchor: { x: 0.5, y: 0.5 },
    })
  })

  it('reads the canvas sizes, never a size a model3 Layout scaled', () => {
    // Internal models whose Layout scales the drawn box: hers by 2, the item's by 0.5.
    const her = { originalWidth: 2000, originalHeight: 3000, width: 4000, height: 6000 }
    const item = { originalWidth: 1000, originalHeight: 1500, width: 500, height: 750 }
    expect(canvasAlignedPlacement(her, item)).toMatchObject({ x: 1000, y: 1500, scale: 2 })
  })
})
