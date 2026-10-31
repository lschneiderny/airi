import { calibrateCamera } from '@proj-airi/stage-shared/stage-world'
import { Group, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'

import { bodyFixture } from './body/fixture'
import { resolveFrameBounds } from './camera-bounds'
import { applyStageCamera, applyStageRoot, measureStageExtent, projectCharacterPlacement, stagePixelRatio } from './stage-world'

const workArea = { width: 1280, height: 720 }
const toeMargin = 8
const armPositions: Record<string, [number, number, number]> = { 左腕: [-2, 14, 0], 右腕: [2, 14, 0] }

function stageFixture(characterHeightDip: number, options: { arms?: boolean, classicTransform?: boolean } = {}) {
  const { mesh, rig, bone } = bodyFixture()
  const group = new Group()
  group.add(mesh)
  if (options.classicTransform) {
    group.scale.setScalar(0.1)
    group.rotation.y = 1.2
    group.position.set(5, 7, 0)
  }
  applyStageRoot(group, 0, 0)
  group.updateMatrixWorld(true)
  const bones = options.arms ? { ...rig.bones, leftUpperArm: '左腕', rightUpperArm: '右腕' } : rig.bones
  const bounds = resolveFrameBounds(bones, (name) => {
    if (armPositions[name])
      return armPositions[name]
    const found = mesh.skeleton.bones.find(candidate => candidate.name === name)
    return found ? found.getWorldPosition(new Vector3()).toArray() : null
  }, null)
  if (!bounds)
    throw new TypeError('The fixture rig has no skeleton bounds')
  const { extent, footBaselineY } = measureStageExtent(bounds)
  const floorRowDip = workArea.height - toeMargin
  const calibration = calibrateCamera({ workArea, modelHeight: extent.height, characterHeightDip, floorRowDip })
  const camera = new PerspectiveCamera()
  applyStageCamera(camera, calibration)
  const homeX = calibration.position.x
  applyStageRoot(group, homeX, footBaselineY)
  group.updateMatrixWorld(true)
  const row = (point: Vector3) => (1 - point.project(camera).y) / 2 * workArea.height
  const feetRow = Math.max(...['左足首', '右足首'].map(name => row(bone(name).getWorldPosition(new Vector3()))))
  const head = bone('頭').getWorldPosition(new Vector3())
  const crownRow = row(new Vector3(head.x, extent.height, head.z))
  return { group, calibration, extent, footBaselineY, homeX, floorRowDip, feetRow, height: feetRow - crownRow }
}

describe('stage-world camera on the fixture rig', () => {
  it('stands the 300 DIP character on the floor row of a 1280x720 work area', () => {
    const { calibration, extent, homeX, floorRowDip, feetRow, height } = stageFixture(300)
    const placement = projectCharacterPlacement(calibration, extent, homeX)
    console.info(JSON.stringify({ floorRowDip, feetRow, height, characterPlacement: placement }))
    expect(Math.abs(feetRow - floorRowDip)).toBeLessThanOrEqual(2)
    expect(Math.abs(height - 300) / 300).toBeLessThanOrEqual(0.02)
    expect(Math.abs(placement.y + placement.height - feetRow)).toBeLessThanOrEqual(2)
    expect(Math.abs(placement.height - height) / height).toBeLessThanOrEqual(0.02)
  })

  it('clamps a character taller than the work area to stay on screen', () => {
    const { calibration, extent, homeX, floorRowDip, height } = stageFixture(2000)
    const placement = projectCharacterPlacement(calibration, extent, homeX)
    console.info(JSON.stringify({ floorRowDip, height, characterPlacement: placement }))
    expect(placement.y).toBeGreaterThanOrEqual(0)
    expect(placement.y + placement.height).toBeLessThanOrEqual(floorRowDip + 2)
    expect(height).toBeLessThan(2000)
  })

  it('projects a nonzero width when the skeleton has an upper-arm span', () => {
    const { calibration, extent, homeX } = stageFixture(300, { arms: true })
    const placement = projectCharacterPlacement(calibration, extent, homeX)
    console.info(JSON.stringify({ armSpanPlacement: placement }))
    expect(extent.maxX - extent.minX).toBeGreaterThan(0)
    expect(placement.width).toBeGreaterThan(0)
  })

  it('ignores the classic scale, rotation and position settings', () => {
    const plain = stageFixture(300)
    const classic = stageFixture(300, { classicTransform: true })
    expect(classic.footBaselineY).toBeCloseTo(plain.footBaselineY, 9)
    expect(classic.extent).toEqual(plain.extent)
    expect(classic.feetRow).toBeCloseTo(plain.feetRow, 6)

    const { group, calibration, extent, footBaselineY, homeX } = classic
    const before = projectCharacterPlacement(calibration, extent, homeX)
    group.scale.setScalar(0.37)
    group.rotation.y = -0.8
    group.position.set(-9, 4, 0)
    applyStageRoot(group, homeX, footBaselineY)
    expect(group.scale.toArray()).toEqual([1, 1, 1])
    expect(group.rotation.y).toBe(0)
    expect(group.position.toArray()).toEqual([homeX, -footBaselineY, 0])
    expect(projectCharacterPlacement(calibration, extent, homeX)).toEqual(before)
  })
})

describe('stage DPR cap', () => {
  it('keeps the drawing buffer at the work-area width on a 2x display', () => {
    const canvas = document.createElement('canvas')
    const renderer = new WebGLRenderer({ canvas })
    try {
      renderer.setPixelRatio(stagePixelRatio(2, 1))
      renderer.setSize(workArea.width, workArea.height, false)
      console.info(JSON.stringify({ drawingBufferWidth: canvas.width, drawingBufferHeight: canvas.height }))
      expect(canvas.width).toBe(workArea.width)
      expect(canvas.height).toBe(workArea.height)
      renderer.setPixelRatio(Math.min(2, 2) * 1)
      renderer.setSize(workArea.width, workArea.height, false)
      expect(canvas.width).toBe(2 * workArea.width)
    }
    finally {
      renderer.dispose()
    }
  })
})
