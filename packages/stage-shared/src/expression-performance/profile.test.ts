import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { applyMappingWeights, PerformanceProfileSchema, resolveEffectiveSettings } from './profile'
import { defaultExpressionPerformanceSettings } from './settings'

describe('performance profiles', () => {
  it('keeps empty profiles at identity without sharing settings objects', () => {
    const result = resolveEffectiveSettings(defaultExpressionPerformanceSettings, {})
    expect(result.settings).toEqual(defaultExpressionPerformanceSettings)
    expect(result.settings).not.toBe(defaultExpressionPerformanceSettings)
    expect(result.expressiveness).toBe(1)
  })

  it('scales mood gains and decay independently', () => {
    const result = resolveEffectiveSettings(defaultExpressionPerformanceSettings, { expressiveness: 1.3, moodGainScale: 0, moodDecayScale: 2 })
    expect(result.expressiveness).toBe(1.3)
    expect(result.settings.moodDynamics.slightGain).toBe(0)
    expect(result.settings.moodDynamics.clearGain).toBe(0)
    expect(result.settings.moodDynamics.strongGain).toBe(0)
    expect(result.settings.moodDynamics.valenceTau).toBe(defaultExpressionPerformanceSettings.moodDynamics.valenceTau * 2)
    expect(result.settings.moodDynamics.arousalTau).toBe(defaultExpressionPerformanceSettings.moodDynamics.arousalTau * 2)
    expect(result.settings.moodDynamics.tensionTau).toBe(defaultExpressionPerformanceSettings.moodDynamics.tensionTau * 2)
  })

  it.each([
    { expressiveness: 3 },
    { expressiveness: 0.4 },
    { expressiveness: Number.NaN },
    { moodGainScale: -1 },
    { moodGainScale: 3 },
    { moodDecayScale: 0.4 },
    { moodDecayScale: 3 },
    { expressiveness: null },
    { moodGainScale: null },
    { moodDecayScale: null },
    { mappingWeights: null },
    { mappingWeights: { model: { expression: 6 } } },
    { mappingWeights: { model: { expression: -1 } } },
  ])('rejects malformed profile %j', (input) => {
    expect(safeParse(PerformanceProfileSchema, input).success).toBe(false)
  })

  it('keeps unknown imported members', () => {
    expect(safeParse(PerformanceProfileSchema, { future: { enabled: true } }).output).toEqual({ future: { enabled: true } })
  })

  it('uses model ids and disables only mappings at zero weight', () => {
    const catalog = [{
      id: 'face.exp3.json',
      label: 'Face',
      kind: 'face' as const,
      group: null,
      confirmed: true,
      exposedToLlm: true,
      fileName: 'face.exp3.json',
      parameterIds: [],
      mappings: [{ emotion: 'happy' as const, weight: 2, minBand: 'clear' as const }],
    }]
    const profile = { mappingWeights: { rig: { 'face.exp3.json': 0 }, other: { 'face.exp3.json': 3 } } }
    expect(applyMappingWeights(catalog, 'rig', profile)[0].mappings).toEqual([])
    expect(applyMappingWeights(catalog, 'other', profile)[0].mappings[0].weight).toBe(6)
    expect(applyMappingWeights(catalog, 'missing', profile)).toEqual(catalog)
    expect(catalog[0].mappings[0].weight).toBe(2)
  })
})
