import { calibrateCamera, layoutStageRow, worldToDip } from '@proj-airi/stage-shared/stage-world'
import { Matrix4, PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'

import { applyCalibrationToCamera, applyStageCamera, clampToGround, projectCharacterPlacement, rowInputs, stagePixelRatio } from './stage-world'

const workedExample = calibrateCamera({
  workArea: { width: 2560, height: 1400 },
  modelHeight: 20,
  characterHeightDip: 600,
  floorRowDip: 1400,
})

describe('applyCalibrationToCamera worked example (W=2560, H=1400, Hm=20, P=600, r_f=1400)', () => {
  const camera = applyCalibrationToCamera(workedExample)

  it('places the eye and clips at the calibration frustum', () => {
    expect(camera.position.x).toBeCloseTo(42.667, 3)
    expect(camera.position.y).toBeCloseTo(10, 9)
    expect(camera.position.z).toBeCloseTo(100, 9)
    expect(camera.near).toBeCloseTo(10, 9)
    expect(camera.far).toBeCloseTo(200, 9)
    expect(camera.aspect).toBeCloseTo(2560 / 1400, 9)
  })

  it('writes the off-axis projection elements', () => {
    const e = camera.projection
    expect(e[0]).toBeCloseTo(2.34375, 5)
    expect(e[5]).toBeCloseTo(4.285714, 5)
    expect(e[8]).toBeCloseTo(0, 9)
    expect(e[9]).toBeCloseTo(0.571429, 5)
    expect(e[10]).toBeCloseTo(-210 / 190, 9)
    expect(e[11]).toBe(-1)
    expect(e[14]).toBeCloseTo(-4000 / 190, 9)
    expect(e[15]).toBe(0)
  })

  it('matches Matrix4.makePerspective for the same frustum', () => {
    const { left, right, top, bottom, near, far } = workedExample.frustum
    const reference = new Matrix4().makePerspective(left, right, top, bottom, near, far)
    camera.projection.forEach((value, index) => expect(value).toBeCloseTo(reference.elements[index], 9))
  })

  it('applies to a three camera without a symmetric rebuild', () => {
    const three = new PerspectiveCamera()
    applyStageCamera(three, workedExample)
    expect(three.position.toArray()).toEqual([workedExample.position.x, workedExample.position.y, workedExample.position.z])
    camera.projection.forEach((value, index) => expect(three.projectionMatrix.elements[index]).toBeCloseTo(value, 9))
    const identity = three.projectionMatrix.clone().multiply(three.projectionMatrixInverse)
    new Matrix4().identity().elements.forEach((value, index) => expect(identity.elements[index]).toBeCloseTo(value, 9))
  })
})

describe('projectCharacterPlacement', () => {
  it('spans the floor row to the crown row of the calibration', () => {
    const rect = projectCharacterPlacement(workedExample, { minX: -4, maxX: 4, minZ: 0, maxZ: 0, height: 20 }, 42.667)
    expect(rect.y + rect.height).toBeCloseTo(1400, 6)
    expect(rect.height).toBeCloseTo(600, 6)
    expect(rect.width).toBeCloseTo(8 * 30, 6)
    expect(rect.x).toBeCloseTo(worldToDip(workedExample, { x: 38.667, y: 0, z: 0 }).x, 6)
  })
})

describe('stagePixelRatio', () => {
  it('never exceeds one pixel per DIP', () => {
    expect(stagePixelRatio(2, 1)).toBe(1)
    expect(stagePixelRatio(3, 1.5)).toBe(1)
  })

  it('lets the render scale lower it', () => {
    expect(stagePixelRatio(2, 0.5)).toBe(1)
    expect(stagePixelRatio(1, 0.5)).toBe(0.5)
  })
})

describe('clampToGround', () => {
  it('stops a goal beyond either ground edge at that edge and keeps one inside', () => {
    const ground = { minX: -5, maxX: 5 }
    expect(clampToGround(ground, 9)).toBe(5)
    expect(clampToGround(ground, -9)).toBe(-5)
    expect(clampToGround(ground, 2)).toBe(2)
  })
})

describe('rowInputs', () => {
  const row = layoutStageRow({
    displays: [
      { id: 'laptop', workArea: { x: 0, y: 25, width: 1440, height: 875 } },
      { id: 'monitor', workArea: { x: 1440, y: 0, width: 2560, height: 1400 } },
    ],
    modelHeight: 20,
    characterHeightDip: 560,
    toeMarginDip: 8,
    halfWidthDip: 168,
  })
  const [laptop, monitor] = row.slots

  it('reaches every display\'s ground line', () => {
    expect(rowInputs(row, { cursor: null, chat: null })).toEqual({ reach: [laptop!.ground, monitor!.ground], cursorX: null, cursorOnStage: false, chat: null })
  })

  it('puts a cursor on the other display on that display\'s stretch of the row', () => {
    const { cursorX, cursorOnStage } = rowInputs(row, { cursor: { x: 1440 + 300, y: 600 }, chat: null })

    expect(cursorOnStage).toBe(true)
    expect(cursorX).toBeCloseTo(monitor!.calibration.originX + 300 * monitor!.calibration.unitsPerDip, 9)
  })

  it('takes a cursor in dead space off the stage', () => {
    expect(rowInputs(row, { cursor: { x: 700, y: 1200 }, chat: null })).toMatchObject({ cursorX: null, cursorOnStage: false })
  })

  it('measures the chat on the display it is on, even when it hangs off the work area', () => {
    const { chat } = rowInputs(row, { cursor: null, chat: { x: 1440 - 100, y: 700, width: 400, height: 600 } })

    expect(chat?.ground).toBe(monitor!.ground)
    expect(chat?.minX).toBeCloseTo(monitor!.calibration.originX - 100 * monitor!.calibration.unitsPerDip, 9)
    expect(chat?.maxX).toBeCloseTo(monitor!.calibration.originX + 300 * monitor!.calibration.unitsPerDip, 9)
  })
})
