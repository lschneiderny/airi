import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

import type { BoundsVec3, MeshBounds } from './camera-bounds'

import { describe, expect, it } from 'vitest'

import { resolveFrameBounds } from './camera-bounds'

const BONE_NAMES: Partial<Record<HumanoidBoneName, string>> = {
  head: '頭',
  neck: '首',
  leftFoot: '左足首',
  rightFoot: '右足首',
  leftToes: '左つま先',
  rightToes: '右つま先',
  leftUpperArm: '左腕',
  rightUpperArm: '右腕',
}

// Long-skirt Elysia: foot, toe and mesh Y from the PMX audit (report.md section 6.2). Head, neck
// and arm positions are Ellen-scale values, since the audit lists them only for Ellen.
const elysiaPositions: Record<string, BoundsVec3> = {
  頭: [0, 16.3, -0.25],
  首: [0, 15.5, -0.29],
  左足首: [1.45, 1.644688, 0.1],
  右足首: [-1.45, 1.64496, 0.1],
  左つま先: [1.25, 0.304814, 1.4],
  右つま先: [-1.25, 0.303244, 1.4],
  左腕: [1.14, 14.9, -0.35],
  右腕: [-1.14, 14.9, -0.35],
}
const elysiaMesh: MeshBounds = { min: [-18.737547, -17.76638, -9.504885], max: [18.737541, 21.397125, 3.207993] }

function frame(positions: Record<string, BoundsVec3>, mesh: MeshBounds | null = elysiaMesh) {
  return resolveFrameBounds(BONE_NAMES, name => positions[name] ?? null, mesh)
}

function without(...names: string[]): Record<string, BoundsVec3> {
  return Object.fromEntries(Object.entries(elysiaPositions).filter(([name]) => !names.includes(name)))
}

describe('resolveFrameBounds', () => {
  it('takes the bottom from the feet although the mesh hangs 18 units below them (Elysia-like)', () => {
    const bounds = frame(elysiaPositions)!

    const bottom = 0.303244
    const top = 21.397125
    expect(bounds.source).toBe('skeleton')
    expect(bounds.size[1]).toBeCloseTo(top - bottom, 6)
    expect(bounds.center[1]).toBeCloseTo((top + bottom) / 2, 6)
    expect(bounds.size[1]).toBeLessThan(22)
  })

  it('takes the top from the skeleton estimate (head + 1.5 x neck length) when the mesh top is lower', () => {
    const bounds = frame(elysiaPositions, { min: elysiaMesh.min, max: [18, 15, 3] })!

    const bottom = 0.303244
    const top = 16.3 + 1.5 * Math.hypot(0, 0.8, 0.04)
    expect(bounds.size[1]).toBeCloseTo(top - bottom, 6)
    expect(bounds.center[1]).toBeCloseTo((top + bottom) / 2, 6)
  })

  it('takes the top from the mesh when the skeleton estimate undershoots the crown (Ellen-like)', () => {
    const ellen: Record<string, BoundsVec3> = {
      ...elysiaPositions,
      頭: [0.000008, 16.29199, -0.247852],
      首: [0.000007, 15.513482, -0.289193],
    }
    const skeletonTop = 16.29199 + 1.5 * Math.hypot(0.000001, 0.778508, 0.041341)
    const bounds = frame(ellen, { min: [-6.5, -0.167079, -2.7], max: [6.5, 19.234358, 15.5] })!

    expect(skeletonTop).toBeLessThan(17.5)
    expect(bounds.center[1] + bounds.size[1] / 2).toBeCloseTo(19.234358, 6)
    expect(bounds.center[1] - bounds.size[1] / 2).toBeCloseTo(0.303244, 6)
  })

  it('uses the lowest of the ankle and toe bones for the bottom', () => {
    const toeLow = { ...elysiaPositions, 左つま先: [1.25, -0.5, 1.4] as const }
    const ankleLow = { ...elysiaPositions, 左足首: [1.45, -0.9, 0.1] as const }

    const fromToe = frame(toeLow)!
    const fromAnkle = frame(ankleLow)!

    expect(fromToe.center[1] - fromToe.size[1] / 2).toBeCloseTo(-0.5, 6)
    expect(fromAnkle.center[1] - fromAnkle.size[1] / 2).toBeCloseTo(-0.9, 6)
  })

  it('sets the width from the upper arm span times 2.2', () => {
    const bounds = frame(elysiaPositions)!

    expect(bounds.size[0]).toBeCloseTo(2.28 * 2.2, 6)
    expect(bounds.center[0]).toBeCloseTo(0, 6)
  })

  it('falls back to the mesh bounds when the head bone is missing', () => {
    const bounds = frame(without('頭'))!

    expect(bounds.source).toBe('mesh')
    expect(bounds.size[1]).toBeCloseTo(21.397125 + 17.76638, 6)
    expect(bounds.center[1]).toBeCloseTo((21.397125 - 17.76638) / 2, 6)
  })

  it('falls back to the mesh bounds when both ankles are missing, even if toes exist', () => {
    const bounds = frame(without('左足首', '右足首'))!

    expect(bounds.source).toBe('mesh')
  })

  it('falls back to the mesh bounds when the neck is missing', () => {
    expect(frame(without('首'))!.source).toBe('mesh')
  })

  it('frames from one ankle when the other is missing', () => {
    const bounds = frame(without('右足首', '右つま先'))!

    expect(bounds.source).toBe('skeleton')
    expect(bounds.center[1] - bounds.size[1] / 2).toBeCloseTo(0.304814, 6)
  })

  it('returns null when the skeleton is incomplete and there is no mesh', () => {
    expect(frame(without('頭'), null)).toBeNull()
  })

  it('keeps the skeleton frame with zero width for a zero shoulder span or missing arms', () => {
    const zeroSpan = frame({ ...elysiaPositions, 右腕: elysiaPositions['左腕'] })!
    const noArms = frame(without('左腕', '右腕'))!

    expect(zeroSpan.source).toBe('skeleton')
    expect(zeroSpan.size[0]).toBe(0)
    expect(noArms.source).toBe('skeleton')
    expect(noArms.size[0]).toBe(0)
    expect(Number.isFinite(noArms.center[0])).toBe(true)
  })
})
