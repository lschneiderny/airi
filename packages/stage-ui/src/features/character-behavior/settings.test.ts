import { safeParse, strictObject } from 'valibot'
import { describe, expect, it } from 'vitest'

import { importCharacterBehaviorSettings } from './import'
import { characterBehaviorEntries, defaultCharacterBehaviorSettings } from './schema'

function importProfile(values: Record<string, unknown>) {
  return importCharacterBehaviorSettings(key => key in values ? JSON.stringify(values[key]) : null)
}

describe('character behavior import', () => {
  it.each(['emotion', 'speaking'])('rejects an array as the %s settings group', (field) => {
    expect(safeParse(strictObject(characterBehaviorEntries), { [field]: [] }).success).toBe(false)
  })
  it('leaves an empty profile unwritten', () => {
    expect(importProfile({})).toBeUndefined()
    expect(defaultCharacterBehaviorSettings()).toMatchObject({
      idleActivities: true,
      touchReactions: true,
      cursorAttention: true,
      chatAttention: true,
      speaking: { unpromptedEnabled: true, chattiness: 0.5 },
    })
  })

  it.each(['live2d', 'mmd'])('keeps either renderer off: %s', (renderer) => {
    const profile = {
      'settings/live2d/natural': { idleActivities: true, touch: true },
      'settings/mmd/natural': { idleActivities: true, touch: true },
      [`settings/${renderer}/natural`]: { idleActivities: false, touch: false },
    }
    expect(importProfile(profile)).toEqual({ idleActivities: false, touchReactions: false })
  })

  it('copies Live2D attention independently and ignores invalid fields', () => {
    expect(importProfile({
      'settings/live2d/natural': { cursorAttention: false, screenAwareness: false, touch: 'false' },
      'settings/mmd/natural': { touch: true },
    })).toEqual({ cursorAttention: false, chatAttention: false, touchReactions: true })
  })

  it('imports pre-document keys only while their document is absent', () => {
    expect(importProfile({
      'settings/live2d/natural-touch': false,
      'settings/live2d/natural-cursor-attention': false,
      'settings/live2d/natural-screen-awareness': false,
      'settings/mmd/natural-touch': true,
    })).toEqual({ touchReactions: false, cursorAttention: false, chatAttention: false })
    expect(importProfile({
      'settings/live2d/natural': {},
      'settings/live2d/natural-touch': false,
    })).toBeUndefined()
  })

  it('validates emotion and speaking fields separately without losing valid siblings', () => {
    expect(importProfile({
      'settings/expression-performance': { bands: false, mood: 'no', intensity: { clear: 0.7 }, autoExpressions: false },
      'settings/situation': { chattiness: 0, dontDisturb: true, quietApps: [' game ', 'game', ''], shareWindowTitles: false },
    })).toMatchObject({
      emotion: { bands: false, intensity: { clear: 0.7 } },
      speaking: { chattiness: 0, dontDisturb: true, quietApps: ['game'] },
    })
    expect(importProfile({ 'settings/expression-performance': { mood: 'no' } })).toBeUndefined()
  })

  it('never imports over an existing behavior document', () => {
    expect(importProfile({
      'settings/character-behavior': {},
      'settings/mmd/natural': { touch: false },
    })).toBeUndefined()
  })

  it('ignores malformed JSON and non-object documents', () => {
    expect(importCharacterBehaviorSettings(() => null)).toBeUndefined()
    expect(importCharacterBehaviorSettings(key => key === 'settings/situation' ? '{' : null)).toBeUndefined()
    expect(importProfile({ 'settings/situation': [], 'settings/expression-performance': null })).toBeUndefined()
  })
})
