import { describe, expect, it } from 'vitest'

import { defaultExpressionPerformanceSettings, parseExpressionPerformanceSettings } from '.'

describe('performance settings', () => {
  it('fills every default from an empty document', () => {
    const expected = {
      bands: true,
      mood: true,
      autoExpressions: true,
      stateFeedback: false,
      heldEmotions: true,
      decider: 'picker',
      intensity: { slight: 0.25, clear: 0.6, strong: 0.9, clearFrom: 0.5, strongFrom: 0.8, jitter: 0.04, habituationWindow: 15, habituationBase: 0.8, habituationFloor: 0.35, escalationWindow: 2 },
      naturalBands: {
        slight: { faceOnsetTau: 0.14, headTau: null, overshoot: 0, faceHold: 0.6, faceReleaseTau: 0.35 },
        clear: { faceOnsetTau: 0.1, headTau: 0.38, overshoot: 0.08, faceHold: 1.2, faceReleaseTau: 0.5 },
        strong: { faceOnsetTau: 0.07, headTau: 0.24, overshoot: 0.16, faceHold: 1.8, faceReleaseTau: 0.7 },
        headGain: 0.12,
        bodyGain: 0.06,
      },
      moodDynamics: { valenceTau: 45, arousalTau: 20, tensionTau: 30, slightGain: 0.15, clearGain: 0.25, strongGain: 0.4, amplitude: 0.2, shiftRate: 0.3, cameraValence: 0.1, cameraTension: 0.15, emphasis: 0.1, mouthForm: 0.08 },
      picker: { recencyDepth: 0.8, recencyTau: 8, effectGateFrom: 0.5, effectGateTo: 0.8 },
      slots: { defaultFadeSeconds: 1, speechGrace: 0.25, unstartedExpiry: 10, holdCap: 15 },
      timing: { pauseSeconds: 0.18, emphasisRefractory: 1.2 },
      held: { turnlessSeconds: 4, onsetTau: 0.25, releaseTau: 0.6, accentScale: 0.5, postureTau: 0.6 },
      planner: { minGap: 0.8, window: 5, windowMax: 3, scheduleExpiry: 6 },
    }
    expect(parseExpressionPerformanceSettings({})).toEqual({ success: true, value: expected })
    expect(defaultExpressionPerformanceSettings).toEqual(expected)
  })

  it('fills nested defaults while preserving explicit neutral values', () => {
    const result = parseExpressionPerformanceSettings({ intensity: { jitter: 0 }, naturalBands: { clear: { headTau: null } }, bands: false })
    expect(result.success).toBe(true)
    expect(result.value.intensity.jitter).toBe(0)
    expect(result.value.intensity.clear).toBe(0.6)
    expect(result.value.naturalBands.clear.headTau).toBeNull()
    expect(result.value.bands).toBe(false)
  })

  it('parses a stored document without held fields and keeps held defaults', () => {
    const result = parseExpressionPerformanceSettings({ bands: false, decider: 'planner', planner: { minGap: 1 }, timing: { pauseSeconds: 0.3 } })
    expect(result.success).toBe(true)
    expect(result.value.heldEmotions).toBe(true)
    expect(result.value.held).toEqual({ turnlessSeconds: 4, onsetTau: 0.25, releaseTau: 0.6, accentScale: 0.5, postureTau: 0.6 })
    expect(result.value.bands).toBe(false)
  })

  it('accepts partial held tunables and heldEmotions false', () => {
    const result = parseExpressionPerformanceSettings({ heldEmotions: false, held: { turnlessSeconds: 0, accentScale: 1 } })
    expect(result.success).toBe(true)
    expect(result.value.heldEmotions).toBe(false)
    expect(result.value.held).toEqual({ turnlessSeconds: 0, onsetTau: 0.25, releaseTau: 0.6, accentScale: 1, postureTau: 0.6 })
  })

  it('rejects a negative turnlessSeconds with success false and the default document', () => {
    const result = parseExpressionPerformanceSettings({ held: { turnlessSeconds: -1 } })
    expect(result.success).toBe(false)
    expect(result.value).toEqual(defaultExpressionPerformanceSettings)
    expect(result.value.held.turnlessSeconds).toBe(4)
  })

  it('accepts the planner decider with partial planner tunables', () => {
    const result = parseExpressionPerformanceSettings({ decider: 'planner', planner: { minGap: 0, scheduleExpiry: 0 } })
    expect(result.success).toBe(true)
    expect(result.value.decider).toBe('planner')
    expect(result.value.planner).toEqual({ minGap: 0, window: 5, windowMax: 3, scheduleExpiry: 0 })
  })

  it.each([
    null,
    [],
    'settings',
    { bands: 'true' },
    { intensity: { clear: 2 } },
    { intensity: [] },
    { naturalBands: { slight: [] } },
    { intensity: { clear: Number.NaN } },
    { slots: { holdCap: Number.POSITIVE_INFINITY } },
    { timing: { pauseSeconds: -1 } },
    { extra: true },
    { intensity: { extra: 1 } },
    { decider: 'other' },
    { planner: { windowMax: 0 } },
    { planner: { windowMax: 1.5 } },
    { planner: { extra: 1 } },
  ].map(input => [input]))('returns defaults and issues for malformed input %j', (input) => {
    const result = parseExpressionPerformanceSettings(input)
    expect(result.success).toBe(false)
    expect(result.value).toEqual(defaultExpressionPerformanceSettings)
    if (!result.success)
      expect(result.issues.length).toBeGreaterThan(0)
  })

  it('does not share mutable defaults between parses', () => {
    const first = parseExpressionPerformanceSettings(null)
    first.value.intensity.clear = 0
    expect(parseExpressionPerformanceSettings({}).value.intensity.clear).toBe(0.6)
    expect(defaultExpressionPerformanceSettings.intensity.clear).toBe(0.6)
  })
})
