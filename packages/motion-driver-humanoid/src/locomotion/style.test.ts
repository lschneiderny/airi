import { describe, expect, it } from 'vitest'

import { boundGaitStyle, GAIT_STYLE_BOUNDS, GAIT_STYLE_KEYS, NEUTRAL_GAIT_STYLE, walkStyleFrom } from './style'

const calm = { valence: 0, arousal: 0, tension: 0 }

function style(mood: Partial<typeof calm> = {}, energy = 0.5, baseline = {}) {
  return walkStyleFrom({ mood: { ...calm, ...mood }, energy, baseline })
}

describe('walkStyleFrom', () => {
  it('gives the neutral walk for a calm mood at resting energy and tension, with no baseline', () => {
    expect(style()).toEqual(NEUTRAL_GAIT_STYLE)
    expect(style({ tension: 0.15 })).toEqual(NEUTRAL_GAIT_STYLE)
  })

  it('keeps every value inside its bounds at every corner of the factors', () => {
    for (const valence of [-1, 1]) {
      for (const arousal of [-1, 1]) {
        for (const tension of [0, 1]) {
          for (const energy of [0, 1]) {
            const result = style({ valence, arousal, tension }, energy, { stride: 1, sway: 1, width: -1, bounce: 1, armSwing: 1, armCarry: 1, posture: -1 })
            for (const key of GAIT_STYLE_KEYS) {
              expect(result[key]).toBeGreaterThanOrEqual(GAIT_STYLE_BOUNDS[key][0])
              expect(result[key]).toBeLessThanOrEqual(GAIT_STYLE_BOUNDS[key][1])
            }
          }
        }
      }
    }
  })

  it('arousal speeds the walk and raises its bounce, arm swing, lift and twist', () => {
    const low = style({ arousal: -0.8 })
    const high = style({ arousal: 0.8 })
    for (const key of ['speed', 'bounce', 'armSwing', 'lift', 'pelvisTwist', 'torsoTwist'] as const)
      expect(high[key]).toBeGreaterThan(low[key])
  })

  it('low valence carries the head and trunk forward and quiets the arms', () => {
    const sad = style({ valence: -0.8 })
    const glad = style({ valence: 0.8 })
    expect(sad.head).toBeGreaterThan(glad.head)
    expect(sad.lean).toBeGreaterThan(glad.lean)
    expect(sad.armSwing).toBeLessThan(glad.armSwing)
  })

  it('tension bends the elbows and shrinks the swing, the roll and the lift', () => {
    const tense = style({ tension: 0.9 })
    expect(tense.elbowCarry).toBeGreaterThan(20 * Math.PI / 180)
    for (const key of ['armSwing', 'roll', 'lift'] as const)
      expect(tense[key]).toBeLessThan(1)
  })

  it('low energy reads as fatigue: shorter, wider steps, head and trunk forward, less arm swing', () => {
    const tired = style({}, 0.05)
    expect(tired.stride).toBeLessThan(1)
    expect(tired.width).toBeGreaterThan(1)
    expect(tired.head).toBeGreaterThan(0)
    expect(tired.lean).toBeGreaterThan(0)
    expect(tired.armSwing).toBeLessThan(1)
  })

  it('a baseline moves its own values: sway the pelvis, width the stance, posture the trunk and head', () => {
    expect(style({}, 0.5, { sway: 1 }).pelvisList).toBeGreaterThan(1.5)
    expect(style({}, 0.5, { width: -1 }).width).toBeLessThan(0.6)
    const upright = style({}, 0.5, { posture: 1 })
    expect(upright.lean).toBeLessThan(0)
    expect(upright.head).toBeLessThan(0)
  })

  it('writes into the given object and bounds a style handed in from outside', () => {
    const out = { ...NEUTRAL_GAIT_STYLE }
    expect(walkStyleFrom({ mood: { valence: 0, arousal: 1, tension: 0 }, energy: 0.5 }, out)).toBe(out)
    expect(boundGaitStyle({ ...NEUTRAL_GAIT_STYLE, armSwing: 9, speed: Number.NaN })).toMatchObject({ armSwing: GAIT_STYLE_BOUNDS.armSwing[1], speed: 1 })
  })
})
