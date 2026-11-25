import { describe, expect, it } from 'vitest'

import { analyseClearanceMesh } from './analysis'
import { ClearanceMeasure } from './measure'
import { testMesh, testPose } from './test-mesh'

/** The left arm raised level to her side: no crossing, 90 degrees from vertical. */
const RAISED = { 4: [4, 14, 0], 5: [7, 14, 0] } as const

describe('clearanceMeasure', () => {
  it('reports where the hanging forearm crosses the coat, and how much of the arm lies beyond', () => {
    const measure = new ClearanceMeasure(analyseClearanceMesh(testMesh()), 2)
    const hits = measure.sample(0, testPose())
    expect(hits.map(({ side, segment, cls, triangle }) => ({ side, segment, cls, triangle }))).toEqual([{ side: 'left', segment: 1, cls: 0, triangle: 0 }])
    // Two thirds of the forearm (2) and the hand (0.9) of an arm 6.9 long.
    expect(hits[0].beyond).toBeCloseTo(2.9 / 6.9, 12)
    expect(measure.sample(2, testPose(RAISED))).toEqual([])
  })

  it('summarizes shares, episodes joined across one clear sample, depth and the upper-arm angle', () => {
    const measure = new ClearanceMeasure(analyseClearanceMesh(testMesh()), 2)
    const pierced = new Set([0, 2, 4, 8, 14])
    for (let frame = 0; frame < 16; frame += 2)
      measure.sample(frame, testPose(pierced.has(frame) ? {} : RAISED))
    const summary = measure.finish()
    expect(summary.sampledFrames).toBe(8)
    expect(summary.piercedShare).toBe(5 / 8)
    expect(summary.byClass['upper-rigid']).toBe(5 / 8)
    expect(summary.bySegment).toEqual({ upperArm: 0, forearm: 5 / 8, hand: 0 })
    expect(summary.topMaterials).toEqual([{ material: 'coat', share: 5 / 8 }])
    // Frames 0 to 8 join across the clear sample at 6; the episode ends with its last sample, at frame 10.
    expect(summary.episodes).toEqual({ count: 2, longestSeconds: 10 / 60 })
    expect(summary.depth.median).toBeCloseTo(2.9 / 6.9, 12)
    expect(summary.depth.deepShare).toBe(5 / 8)
    expect(summary.upperArmDeg.mean).toBeCloseTo(3 / 8 * 90, 9)
    expect(summary.upperArmDeg.p10).toBe(0)
    expect(summary.upperArmDeg.p90).toBeCloseTo(90, 9)
  })

  it('counts only deep crossings in the share of all sampled frames', () => {
    const measure = new ClearanceMeasure(analyseClearanceMesh(testMesh()), 2)
    measure.sample(0, testPose())
    measure.sample(2, testPose({ 1: [0, 10.5, 0] }))
    measure.sample(4, testPose(RAISED))

    const summary = measure.finish()
    expect(summary.piercedShare).toBe(2 / 3)
    expect(summary.depth.deepShare).toBe(1 / 3)
  })

  it.each([
    ['head-rigid', false],
    ['hair', true],
  ] as const)('reports a crossing of %s without counting it as pierced', (cls, simulated) => {
    const source = testMesh()
    const bones = source.bones.map((bone, i) => i === 2 ? { ...bone, simulated } : bone)
    const measure = new ClearanceMeasure(analyseClearanceMesh({ ...source, bones }), 2)
    // The forearm reaches forward through the head panel.
    measure.sample(0, testPose({ 4: [0, 15.4, -0.5], 5: [0, 15.4, 1.5] }))
    const summary = measure.finish()
    expect(summary.byClass[cls]).toBe(1)
    expect(summary.piercedShare).toBe(0)
    expect(summary.episodes.count).toBe(0)
  })

  it('reports a reversal as a share of cloth vertices when a second panel stays still', () => {
    const source = testMesh()
    // Move the head panel into upper cloth, on a simulated bone that stays still.
    const bones = source.bones.map((bone, i) => i === 2 ? { ...bone, simulated: true } : bone)
    const regionRoots = { ...source.regionRoots, head: [] }
    const measure = new ClearanceMeasure(analyseClearanceMesh({ ...source, bones, regionRoots }), 2)
    measure.sample(0, testPose(RAISED))
    measure.sample(2, testPose({ ...RAISED, 6: [0.1, 9, 0] }))
    measure.sample(4, testPose(RAISED))

    expect(measure.finish().cloth.reversalMean).toBeCloseTo(0.25, 12)
  })

  it('follows the cloth\'s travel apart from the hips, and counts vertices that reverse direction', () => {
    const run = (skirtX: number[], hipsX: number[]) => {
      const measure = new ClearanceMeasure(analyseClearanceMesh(testMesh()), 2)
      skirtX.forEach((x, i) => measure.sample(i * 2, testPose({ ...RAISED, 0: [hipsX[i], 10, 0], 6: [x, 9, 0] })))
      return measure.finish().cloth
    }
    const steady = run([0, 0.1, 0.2, 0.3], [0, 0, 0, 0])
    expect(steady.travelMedian).toBeCloseTo(0.1, 12)
    expect(steady.reversalMean).toBe(0)
    expect(run([0, 0.1, 0, 0.1], [0, 0, 0, 0]).reversalMean).toBeCloseTo(2 / 3, 12)
    const withHips = run([0, 0.1, 0, 0.1], [0, 0.1, 0, 0.1])
    expect(withHips.travelP99).toBeCloseTo(0, 12)
    expect(withHips.reversalMean).toBe(0)
  })
})
