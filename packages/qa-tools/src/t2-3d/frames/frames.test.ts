import type { Quat } from '../metrics'
import type { FrameRig, FrameRigBone } from './pose'

import { describe, expect, it } from 'vitest'

import { analyticTrace } from '../metrics/test-trace'
import { drawText, GLYPH_HEIGHT, GLYPH_WIDTH } from './font'
import { selectWindows } from './frames'
import { FramePoseRefusal, poseFrame, skin, unposedBones } from './pose'
import { framingFor, rasterize } from './render'

const rotZ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]

/**
 * Synthetic rig, no asset: hips at the origin and a spine 1 unit above; a vertical 0.2 by 1 quad from the spine joint
 * upward is skinned to the spine, a small quad at the feet to the hips. Bone axes are the trace axes (identity basis).
 */
function rig(extra?: { readonly weighted: boolean }): FrameRig {
  const bones: FrameRigBone[] = [
    { name: 'hips', parent: -1, slot: 'hips', bindRotation: [0, 0, 0, 1], bindPosition: [0, 0, 0], physics: false },
    { name: 'spine', parent: 0, slot: 'spine', bindRotation: [0, 0, 0, 1], bindPosition: [0, 1, 0], physics: false },
  ]
  if (extra)
    bones.push({ name: 'twist', parent: 1, slot: null, bindRotation: [0, 0, 0, 1], bindPosition: [0, 1.5, 0], physics: false })
  const spineQuad = [-0.1, 1, 0, 0.1, 1, 0, 0.1, 2, 0, -0.1, 2, 0]
  const feetQuad = [-0.3, -0.1, 0, 0.3, -0.1, 0, 0.3, 0.1, 0, -0.3, 0.1, 0]
  const twistWeight = extra?.weighted ? 1 : 0
  return {
    bones,
    basis: [0, 0, 0, 1],
    positions: [...spineQuad, ...feetQuad],
    skinIndices: [1, 0, 0, 0, 1, 0, 0, 0, extra ? 2 : 1, 0, 0, 0, 1, 0, 0, 0, ...Array.from<number>({ length: 16 }).fill(0)],
    skinWeights: [1, 0, 0, 0, 1, 0, 0, 0, extra ? twistWeight || 1 : 1, 0, 0, 0, 1, 0, 0, 0, ...[0, 1, 2, 3].flatMap(() => [1, 0, 0, 0])],
    triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  }
}

/** Mean drawn x of the pixels above the hips row, in image pixels; the image centre is 50. */
function drawnX(spineTurn: number): number {
  const input = analyticTrace({ seconds: 0.1, bones: ['hips', 'spine'], world: (bone): Quat => bone === 'spine' ? rotZ(spineTurn) : [0, 0, 0, 1] })
  const r = rig()
  const bind = skin(r, { rotations: r.bones.map(b => b.bindRotation), positions: r.bones.map(b => b.bindPosition) })
  const framing = framingFor(bind, 100, 150)
  const rgb = rasterize(skin(r, poseFrame(r, input, 0)), r.triangles, 'front', framing, 0)
  let sum = 0
  let count = 0
  const hipsRow = Math.floor((framing.top - 0.3) * framing.scale)
  for (let y = 0; y < hipsRow; y++) {
    for (let x = 0; x < 100; x++) {
      if (rgb[(y * 100 + x) * 3 + 2] !== 244) {
        sum += x
        count++
      }
    }
  }
  return count ? sum / count : Number.NaN
}

describe('frames', () => {
  it('moves the drawn spine to the side its recorded turn predicts', () => {
    expect(Math.abs(drawnX(0) - 50)).toBeLessThan(1)
    // A turn about +z carries +y toward -x (her right); the front view draws +x (her left) on the image right.
    expect(drawnX(Math.PI / 4)).toBeLessThan(40)
    expect(drawnX(-Math.PI / 4)).toBeGreaterThan(60)
  })

  it('refuses a skinned bone the trace lacks when no re-run poses it, and naming it', () => {
    const input = analyticTrace({ seconds: 0.1, bones: ['hips', 'spine'] })
    expect(() => poseFrame(rig({ weighted: true }), input, 0)).toThrow(FramePoseRefusal)
    expect(() => poseFrame(rig({ weighted: true }), input, 0)).toThrow(/twist/)
    expect(() => poseFrame(rig({ weighted: true }), input, 0, () => ({ rotation: [0, 0, 0, 1], position: [0, 0.5, 0] }))).not.toThrow()
  })

  it('poses an untraced append child from the trace by its ratio of the append parent, and lists the bones it cannot pose', () => {
    const input = analyticTrace({ seconds: 0.1, bones: ['hips', 'spine'], world: (bone): Quat => bone === 'spine' ? rotZ(Math.PI / 2) : [0, 0, 0, 1] })
    const plain = rig({ weighted: true })
    const appended = { ...plain, bones: plain.bones.map((bone, i) => i === 2 ? { ...bone, append: { parent: 1, ratio: 0.5 } } : bone) }
    const twist = poseFrame(appended, input, 0, 'trace').rotations[2]
    const expected = rotZ(3 * Math.PI / 4)
    expect(Math.abs(twist[0] * expected[0] + twist[1] * expected[1] + twist[2] * expected[2] + twist[3] * expected[3])).toBeCloseTo(1, 9)
    expect(poseFrame(plain, input, 0, 'trace').rotations[2]).toEqual(poseFrame(plain, input, 0, 'trace').rotations[1])
    expect(unposedBones(appended, new Set(input.trace.rig.bones))).toEqual([])
    expect(unposedBones(plain, new Set(input.trace.rig.bones))).toEqual([2])
  })

  it('carries an untraced root bone with the trace\'s hips in trace posing, so a spine that hangs from it follows her root', () => {
    const bones: FrameRigBone[] = [
      { name: 'center', parent: -1, slot: null, bindRotation: [0, 0, 0, 1], bindPosition: [0, 0.5, 0], physics: false },
      { name: 'hips', parent: 0, slot: 'hips', bindRotation: [0, 0, 0, 1], bindPosition: [0, 0.5, 0], physics: false },
      { name: 'spine', parent: 0, slot: 'spine', bindRotation: [0, 0, 0, 1], bindPosition: [0, 1, 0], physics: false },
    ]
    const input = analyticTrace({ seconds: 0.1, bones: ['hips', 'spine'], position: () => [5, 0.5, 0] })
    const posed = poseFrame({ ...rig(), bones }, input, 0, 'trace')
    expect([posed.positions[1][0], posed.positions[2][0]]).toEqual([5, 5])
  })

  it('opens one window per matching marker or touch event', () => {
    const input = analyticTrace({ seconds: 4, bones: ['hips'], events: [{ t: 1, kind: 'marker', label: 'clip-claim' }, { t: 2, kind: 'touch', touch: 'poke', region: 'body' }, { t: 3, kind: 'marker', label: 'clip-release' }] })
    const around = (marker: string) => selectWindows(input, { kind: 'around', marker, before: 0.2, after: 0.5, hz: 10 })
    expect(around('clip-claim').map(w => [w.from, w.times.length])).toEqual([[0.8, 8]])
    expect(around('poke')).toHaveLength(1)
    expect(around('clip')).toHaveLength(2)
  })

  it('draws a glyph for every character of a caption', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789.,:;-+=/_()[]<>%#*?\''
    for (const char of text) {
      const rgb = new Uint8Array(GLYPH_WIDTH * GLYPH_HEIGHT * 3).fill(255)
      drawText(rgb, GLYPH_WIDTH, GLYPH_HEIGHT, 0, 0, char)
      expect(rgb.some(v => v !== 255), char).toBe(true)
    }
  })
})
