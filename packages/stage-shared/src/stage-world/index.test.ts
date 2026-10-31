import type { CameraCalibrationInput } from './index'

import { describe, expect, it } from 'vitest'

import {
  calibrateCamera,
  defaultHomeDipX,
  dipToPlane,
  groundLineOf,
  homeDipToWorldX,
  worldToDip,
  worldToHomeDipX,
} from './index'

const workArea = { width: 2560, height: 1400 }

const base: CameraCalibrationInput = {
  workArea,
  modelHeight: 20,
  characterHeightDip: 600,
  floorRowDip: 1400,
}

const offAxis = calibrateCamera(base)
const symmetric = calibrateCamera({ ...base, eyeHeightInModelHeights: null })

function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('calibrateCamera worked example (W=2560, H=1400, Hm=20, P=600, r_f=1400)', () => {
  it('derives scale, distance and the eye position', () => {
    expect(offAxis.unitsPerDip).toBeCloseTo(1 / 30, 12)
    expect(offAxis.position.z).toBeCloseTo(100, 9)
    expect(offAxis.position.x).toBeCloseTo(42.667, 3)
    expect(offAxis.position.y).toBeCloseTo(10, 9)
    expect(symmetric.position.y).toBeCloseTo(23.333, 3)
    expect(offAxis.aspect).toBeCloseTo(2560 / 1400, 9)
  })

  it('projects head and feet of the symmetric camera onto rows 800 and 1400', () => {
    expect(worldToDip(symmetric, { x: 0, y: 20, z: 0 }).y).toBeCloseTo(800, 6)
    expect(worldToDip(symmetric, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1400, 6)
  })

  it('has the off-axis near-plane bounds', () => {
    expect(offAxis.frustum.near).toBeCloseTo(10, 9)
    expect(offAxis.frustum.far).toBeCloseTo(200, 9)
    expect(offAxis.frustum.left).toBeCloseTo(-4.267, 3)
    expect(offAxis.frustum.right).toBeCloseTo(4.267, 3)
    expect(offAxis.frustum.bottom).toBeCloseTo(-1.0, 6)
    expect(offAxis.frustum.top).toBeCloseTo(3.667, 3)
  })

  it('reduces the symmetric frustum to one vertical field of view', () => {
    expect(symmetric.frustum.top).toBeCloseTo(-symmetric.frustum.bottom, 9)
    expect(symmetric.verticalFov).toBeCloseTo(2 * Math.atan((1400 / 30) / 200), 9)
    expect(symmetric.verticalFov * 180 / Math.PI).toBeCloseTo(26.27, 2)
  })

  it('unprojects the cursor (1280, 400) onto z = 0', () => {
    const p = dipToPlane(offAxis, { x: 1280, y: 400 }, 0)
    expect(p.x).toBeCloseTo(42.667, 3)
    expect(p.y).toBeCloseTo(33.333, 3)
    expect(p.z).toBe(0)
  })

  it('unprojects onto z = 5 for both cameras', () => {
    expect(dipToPlane(offAxis, { x: 1280, y: 400 }, 5).y).toBeCloseTo(32.167, 3)
    expect(dipToPlane(symmetric, { x: 1280, y: 400 }, 5).y).toBeCloseTo(32.833, 3)
    expect(dipToPlane(offAxis, { x: 0, y: 400 }, 5).x).toBeCloseTo(2.133, 3)
  })
})

describe('camera round trips and invariants', () => {
  it('round-trips worldToDip(dipToPlane(p, z)) for 20 random points', () => {
    const random = seededRandom(7)
    for (const camera of [offAxis, symmetric]) {
      for (let i = 0; i < 20; i++) {
        const point = { x: random() * 2560, y: random() * 1400 }
        const z = random() * 20 - 10
        const back = worldToDip(camera, dipToPlane(camera, point, z))
        expect(back.x).toBeCloseTo(point.x, 9)
        expect(back.y).toBeCloseTo(point.y, 9)
      }
    }
  })

  it('keeps the z = 0 column independent of the work-area width', () => {
    const narrow = calibrateCamera({ ...base, workArea: { width: 1280, height: 1400 } })
    const wide = calibrateCamera({ ...base, workArea: { width: 3840, height: 1400 } })
    for (const x of [0, 3, 17.5]) {
      const a = worldToDip(narrow, { x, y: 0, z: 0 }).x
      const b = worldToDip(wide, { x, y: 0, z: 0 }).x
      expect(a).toBeCloseTo(b, 9)
      expect(a).toBeCloseTo(x * 30, 9)
    }
  })

  it('clamps the scale so a too-tall character fits 90% of the floor row', () => {
    const tall = calibrateCamera({ ...base, characterHeightDip: 3000, topMarginDip: 40 })
    const minimum = 20 / (0.9 * (1400 - 40))
    expect(tall.unitsPerDip).toBeCloseTo(minimum, 12)
    expect(20 / tall.unitsPerDip).toBeLessThanOrEqual(0.9 * (1400 - 40) + 1e-9)
  })

  it('honours custom distance and eye height', () => {
    const custom = calibrateCamera({ ...base, distanceInModelHeights: 8, eyeHeightInModelHeights: 0.25 })
    expect(custom.position.z).toBeCloseTo(160, 9)
    expect(custom.position.y).toBeCloseTo(5, 9)
  })
})

describe('ground line and home', () => {
  it('insets the ground line by the half width', () => {
    const ground = groundLineOf(workArea, offAxis, 1.5)
    expect(ground.minX).toBeCloseTo(1.5, 9)
    expect(ground.maxX).toBeCloseTo(2560 / 30 - 1.5, 9)
  })

  it('collapses the ground line to the center when the work area is narrower than the character', () => {
    const ground = groundLineOf({ width: 30, height: 1400 }, calibrateCamera({ ...base, workArea: { width: 30, height: 1400 } }), 5)
    expect(ground.minX).toBeCloseTo(0.5, 9)
    expect(ground.maxX).toBeCloseTo(0.5, 9)
  })

  it('places the default home beside the chat on both sides', () => {
    expect(defaultHomeDipX(workArea, 'left', 400, 150)).toBe(550)
    expect(defaultHomeDipX(workArea, 'right', 400, 150)).toBe(2010)
  })

  it('round-trips the home between DIP and world x', () => {
    const x = homeDipToWorldX(offAxis, 550, 1400)
    expect(x).toBeCloseTo(550 / 30, 9)
    expect(worldToHomeDipX(offAxis, x)).toBeCloseTo(550, 9)
  })

  it('maps the same DIP home to different world x for two character heights', () => {
    const small = calibrateCamera({ ...base, characterHeightDip: 400 })
    const large = calibrateCamera({ ...base, characterHeightDip: 800 })
    expect(homeDipToWorldX(small, 550, 1400)).not.toBeCloseTo(homeDipToWorldX(large, 550, 1400), 3)
    expect(worldToHomeDipX(small, homeDipToWorldX(small, 550, 1400))).toBeCloseTo(550, 9)
    expect(worldToHomeDipX(large, homeDipToWorldX(large, 550, 1400))).toBeCloseTo(550, 9)
  })
})
