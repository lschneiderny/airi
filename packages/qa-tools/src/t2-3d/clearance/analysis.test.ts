import { describe, expect, it } from 'vitest'

import { analyseClearanceMesh, requireMeasurable, withoutStructural } from './analysis'
import { testMesh } from './test-mesh'

describe('analyseClearanceMesh', () => {
  const source = testMesh()
  const analysis = analyseClearanceMesh(source)

  it('keeps body and clothing, classed by region and by simulated corners', () => {
    expect([...analysis.original]).toEqual([0, 1, 2, 6])
    expect([...analysis.classes]).toEqual([0, 3, 4, 0])
    expect(analysis.counts.byClass).toEqual({ 'upper-rigid': 2, 'upper-cloth': 0, 'lower-rigid': 0, 'lower-cloth': 1, 'head-rigid': 1, 'hair': 0 })
  })

  it('leaves out what the arm wears and bones outside the body, counting only worn triangles', () => {
    // The sleeve has a corner on the elbow bone, the cuff a corner beside the forearm, the prop no body region.
    expect(analysis.original).not.toContain(3)
    expect(analysis.original).not.toContain(4)
    expect(analysis.original).not.toContain(5)
    expect(analysis.counts.worn).toBe(1)
  })

  it('excludes a triangle with secondary arm weight on a corner outside the sleeve radius', () => {
    const source = testMesh()
    const corner = source.triangles[0]
    const skinIndex = Array.from(source.skinIndex)
    const skinWeight = Array.from(source.skinWeight)
    skinIndex[corner * 4 + 1] = 4
    skinWeight.splice(corner * 4, 2, 0.75, 0.25)

    const weighted = analyseClearanceMesh({ ...source, skinIndex, skinWeight })

    expect(weighted.original).not.toContain(0)
    expect(weighted.counts.worn).toBe(analysis.counts.worn + 1)
  })

  it('measures the sleeve from the arm\'s own vertices, and assumes the guard\'s radius where it has none', () => {
    expect(analysis.sleeve.upper).toBeCloseTo(0.1, 6)
    expect(analysis.sleeve.fore).toBe(0.12)
  })

  it('keeps only the tested triangles\' vertices, in bind space with normalized weights', () => {
    expect(analysis.bind.length).toBe(4 * 3 * 3)
    expect([...analysis.bind.subarray(0, 3)]).toEqual([0.4, 10, -0.6])
    expect([...analysis.skinWeight.subarray(0, 4)]).toEqual([1, 0, 0, 0])
  })
})

describe('withoutStructural', () => {
  it('drops the triangle the bind-pose arm crosses, and no other', () => {
    const source = testMesh()
    const before = analyseClearanceMesh(source)
    const analysis = withoutStructural(before, new Set([0]))
    expect([...analysis.original]).toEqual([...before.original].filter(triangle => triangle !== 0))
    expect(analysis.counts.structural).toBe(1)
  })

  it('changes nothing without crossings', () => {
    const analysis = analyseClearanceMesh(testMesh())
    expect(withoutStructural(analysis, new Set())).toBe(analysis)
  })
})

describe('requireMeasurable', () => {
  it('refuses a model without an arm chain, and one without a body triangle to test', () => {
    const analysis = analyseClearanceMesh(testMesh())
    expect(requireMeasurable(analysis)).toBe(analysis)
    expect(() => requireMeasurable({ ...analysis, arms: { left: null, right: null } })).toThrow('no arm')
    expect(() => requireMeasurable(withoutStructural(analysis, new Set(analysis.original)))).toThrow('no body triangle')
    // Head and hair alone are no measure: their crossings never count as pierced.
    expect(() => requireMeasurable({ ...analysis, classes: analysis.classes.map(() => 5) })).toThrow('no body triangle')
  })
})
