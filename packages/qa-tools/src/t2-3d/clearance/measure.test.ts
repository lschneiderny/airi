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
    expect(summary.episodes).toEqual({ count: 2, longestSeconds: 4 * 2 / 60 })
    expect(summary.depth.median).toBeCloseTo(2.9 / 6.9, 12)
    expect(summary.depth.deepShare).toBe(5 / 8)
    expect(summary.upperArmDeg.mean).toBeCloseTo(3 / 8 * 90, 9)
    expect(summary.upperArmDeg.p10).toBe(0)
    expect(summary.upperArmDeg.p90).toBeCloseTo(90, 9)
  })

  it('does not count a crossing of her head as pierced', () => {
    const measure = new ClearanceMeasure(analyseClearanceMesh(testMesh()), 2)
    // The forearm reaches forward through the head panel.
    measure.sample(0, testPose({ 4: [0, 15.4, -0.5], 5: [0, 15.4, 1.5] }))
    const summary = measure.finish()
    expect(summary.byClass['head-rigid']).toBe(1)
    expect(summary.piercedShare).toBe(0)
    expect(summary.episodes.count).toBe(0)
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
