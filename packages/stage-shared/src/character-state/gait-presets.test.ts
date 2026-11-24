import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { GAIT_BASELINE_KEYS, GAIT_BASELINE_PRESET_NAMES, GAIT_BASELINE_PRESETS, gaitBaselinePresetOf, GaitBaselineSchema } from '.'

describe('gait baseline presets', () => {
  it('sets every value of each preset inside the schema and at most 0.8 from neutral', () => {
    for (const name of GAIT_BASELINE_PRESET_NAMES) {
      const preset = GAIT_BASELINE_PRESETS[name]
      expect(safeParse(GaitBaselineSchema, preset).success, name).toBe(true)
      expect(Object.keys(preset).sort(), name).toEqual([...GAIT_BASELINE_KEYS].sort())
      for (const key of GAIT_BASELINE_KEYS)
        expect(Math.abs(preset[key]), `${name}.${key}`).toBeLessThanOrEqual(0.8)
    }
  })

  it('names the preset a baseline holds, counts an omitted value as 0, and calls any other baseline custom', () => {
    expect(gaitBaselinePresetOf(undefined)).toBe('neutral')
    expect(gaitBaselinePresetOf({})).toBe('neutral')
    expect(gaitBaselinePresetOf({ ...GAIT_BASELINE_PRESETS.bold })).toBe('bold')
    expect(gaitBaselinePresetOf({ sway: 0.6, width: -0.6, bounce: -0.3, armSwing: -0.2, armCarry: 0.3, posture: 0.2 })).toBe('graceful')
    expect(gaitBaselinePresetOf({ ...GAIT_BASELINE_PRESETS.bold, width: 0.5 })).toBeNull()
  })
})
