import { describe, expect, it } from 'vitest'

import { STROLL_URGENCY, WALK_URGENCY } from '../types'
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

  it('tension bends the elbows, leans the trunk as acted tense walks do, and shrinks the swing, the roll and the lift', () => {
    const tense = style({ tension: 0.9 })
    expect(tense.elbowCarry).toBeGreaterThan(20 * Math.PI / 180)
    expect(tense.lean).toBeGreaterThan(8 * Math.PI / 180)
    for (const key of ['armSwing', 'roll', 'lift'] as const)
      expect(tense[key]).toBeLessThan(1)
  })

  it('low energy reads as fatigue: shorter, wider steps, head and trunk forward, less arm swing', () => {
    const tired = style({}, 0.05)
    expect(tired.stride).toBeLessThan(1)
    expect(tired.width).toBeGreaterThan(1)
    expect(tired.head).toBeGreaterThan(0)
    // Acted tired walks lean 11 degrees more than a normal walk.
    expect(tired.lean).toBeGreaterThan(9 * Math.PI / 180)
    expect(tired.armSwing).toBeLessThan(1)
  })

  it('a baseline moves its own values: sway the pelvis, width the stance, posture the trunk and head', () => {
    expect(style({}, 0.5, { sway: 1 }).pelvisList).toBeGreaterThan(1.5)
    expect(style({}, 0.5, { width: -1 }).width).toBeLessThan(0.6)
    const upright = style({}, 0.5, { posture: 1 })
    expect(upright.lean).toBeLessThan(0)
    expect(upright.head).toBeLessThan(0)
  })

  it('valence, arousal and energy extend the wrist; sadness, fatigue and tension let it drop toward the forearm', () => {
    const carry = (mood: Partial<typeof calm>, energy = 0.5) => style(mood, energy).wristCarry
    const ends = [-1, -0.5, 0, 0.5, 1]
    for (const key of ['valence', 'arousal'] as const) {
      const values = ends.map(value => carry({ [key]: value }))
      for (let i = 1; i < values.length; i++)
        expect(values[i]).toBeGreaterThan(values[i - 1] as number)
    }
    const energies = [0, 0.25, 0.5, 0.75, 1].map(energy => carry({}, energy))
    for (let i = 1; i < energies.length; i++)
      expect(energies[i]).toBeGreaterThan(energies[i - 1] as number)
    expect(carry({ tension: 1 })).toBeLessThan(carry({ tension: 0.5 }))
    expect(carry({ tension: 0.5 })).toBeLessThan(0)
    // A sad walk carries the hand about in line with the forearm, the rest's 10 degrees taken back.
    expect(carry({ valence: -1, arousal: -0.6 }, 0.3)).toBeCloseTo(-10 * Math.PI / 180, 12)
  })

  it('tension closes the hand, most with arousal, and a calm positive walk opens it', () => {
    const curl = (mood: Partial<typeof calm>) => style(mood).handCurl
    const tensions = [0.15, 0.4, 0.7, 1].map(tension => curl({ tension }))
    for (let i = 1; i < tensions.length; i++)
      expect(tensions[i]).toBeGreaterThan(tensions[i - 1] as number)
    expect(curl({ tension: 0.7, arousal: 0.8 })).toBeGreaterThan(curl({ tension: 0.7 }))
    expect(curl({ valence: -0.6, arousal: 0.8, tension: 0.9 })).toBe(GAIT_STYLE_BOUNDS.handCurl[1])
    const valences = [0, 0.5, 1].map(valence => curl({ valence }))
    for (let i = 1; i < valences.length; i++)
      expect(valences[i]).toBeLessThan(valences[i - 1] as number)
    expect(curl({ valence: 1 })).toBeLessThan(0.5)
  })

  it('a carried arm extends the wrist and opens the hand, and a wide swing closes it a little', () => {
    const carried = style({}, 0.5, { armCarry: 0.6 })
    expect(carried.wristCarry).toBeGreaterThan(0)
    expect(carried.handCurl).toBeLessThan(1)
    expect(style({}, 0.5, { armSwing: 0.6 }).handCurl).toBeGreaterThan(1)
    expect(style({}, 0.5, { armSwing: -0.6 }).handCurl).toBe(1)
  })

  it('each mood shows in the legs and trunk: a springy happy step, a loaded angry one, a dragging tired one, a folded sad one', () => {
    const happy = style({ valence: 1, arousal: 0.6 })
    const angry = style({ valence: -0.5, arousal: 0.8, tension: 1 })
    const sad = style({ valence: -1, arousal: -0.5 })
    const tired = style({}, 0)
    // Happy pushes off hardest; tired and sad let the trailing foot go slowly.
    expect(happy.push).toBeGreaterThan(1.2)
    expect(tired.push).toBeLessThan(0.7)
    expect(sad.push).toBeLessThan(1)
    // Only tension loads the step, most with arousal.
    expect(angry.load).toBeGreaterThan(0.6)
    expect(happy.load).toBe(0)
    expect(style({ tension: 1 }).load).toBeLessThan(angry.load)
    // Sadness folds the chest and narrows and shortens the step; fatigue folds it a little; gladness opens it.
    expect(sad.fold).toBeGreaterThan(8 * Math.PI / 180)
    expect(tired.fold).toBeGreaterThan(0)
    expect(happy.fold).toBeLessThan(0)
    expect(angry.fold).toBeLessThan(1.5 * Math.PI / 180)
    expect(sad.width).toBeLessThan(1)
    expect(sad.stride).toBeLessThan(style({ arousal: -0.5 }).stride)
  })

  it('carries an angry elbow 30 degrees over neutral, less than arousal and tension added alone would', () => {
    const angry = style({ valence: -0.5, arousal: 0.8, tension: 1 }).elbowCarry * 180 / Math.PI
    expect(angry).toBeGreaterThan(28)
    expect(angry).toBeLessThan(36)
    expect(angry).toBeLessThan((style({ arousal: 0.8 }).elbowCarry + style({ tension: 1 }).elbowCarry) * 180 / Math.PI)
  })

  it('leaves every style alone at or below the walk urgency', () => {
    const sad = { mood: { valence: -0.7, arousal: -0.4, tension: 0.5 }, energy: 0.2, baseline: { posture: 0.5 } }
    for (const urgency of [0, STROLL_URGENCY, WALK_URGENCY]) {
      expect(walkStyleFrom({ mood: calm, energy: 0.5, urgency })).toEqual(NEUTRAL_GAIT_STYLE)
      expect(walkStyleFrom({ ...sad, urgency })).toEqual(walkStyleFrom(sad))
    }
  })

  it('leans a hurried walk forward, up to 6 degrees more at urgency 1, and changes nothing else', () => {
    const degrees = (urgency: number) => walkStyleFrom({ mood: calm, energy: 0.5, urgency }).lean * 180 / Math.PI
    expect(degrees(0.8)).toBeCloseTo(3, 12)
    expect(degrees(1)).toBeCloseTo(6, 12)
    expect(degrees(2)).toBeCloseTo(6, 12)
    expect({ ...walkStyleFrom({ mood: calm, energy: 0.5, urgency: 1 }), lean: 0 }).toEqual(NEUTRAL_GAIT_STYLE)
  })

  it('writes into the given object and bounds a style handed in from outside', () => {
    const out = { ...NEUTRAL_GAIT_STYLE }
    expect(walkStyleFrom({ mood: { valence: 0, arousal: 1, tension: 0 }, energy: 0.5 }, out)).toBe(out)
    expect(boundGaitStyle({ ...NEUTRAL_GAIT_STYLE, armSwing: 9, speed: Number.NaN })).toMatchObject({ armSwing: GAIT_STYLE_BOUNDS.armSwing[1], speed: 1 })
  })
})
