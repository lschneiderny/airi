import { naturalEmotions } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotions'
import { buildEmotionChecks, emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, expect, it } from 'vitest'

import { parseValidateArgs } from './cli'
import { killState } from './evaluate'
import { aaSetCount, assignShards, buildValidationPlan, emotionTableFor, validationSections } from './plan'

describe('parseValidateArgs', () => {
  it('defaults to every section and the committed seed counts', () => {
    expect(parseValidateArgs(['--level', 't1'], 3)).toEqual({ ok: true, command: { options: { sections: [...validationSections], seedsLimit: null }, workers: 3, timeoutMinutes: 180 } })
  })

  it.each([
    [['--level', 't2'], 'Valid levels: t1'],
    [[], '--level is required'],
    [['--level', 't1', '--sections', 'aa,nope'], 'Valid sections'],
    [['--level', 't1', '--seeds', '0'], '--seeds'],
    [['--level', 't1', 'extra'], 'extra'],
  ])('rejects %j', (args, message) => {
    const result = parseValidateArgs(args, 3)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain(message)
  })
})

describe('validation plan', () => {
  it('builds 20 disjoint A/A seed sets against the committed null seeds', () => {
    const plan = buildValidationPlan(emotionGate, { sections: ['aa'], seedsLimit: null })
    const sets = plan.experiments.flatMap(experiment => experiment.kind === 'aa' ? [experiment.seeds] : [])
    expect(sets).toHaveLength(aaSetCount)
    expect(new Set(sets.map(range => range.start)).size).toBe(aaSetCount)
    expect(sets.every(range => range.count === emotionGate.seeds.full.count && range.start > emotionGate.seeds.full.start + emotionGate.seeds.full.count)).toBe(true)
    expect(plan.nullPools['null-committed']).toEqual(emotionGate.seeds.full)
  })

  it('assigns every unit to exactly one shard', () => {
    const plan = buildValidationPlan(emotionGate, { sections: [...validationSections], seedsLimit: 2 })
    const shards = assignShards(plan.units, 7, unit => unit.seeds.count)
    expect(shards.flat().map(unit => unit.name).sort()).toEqual(plan.units.map(unit => unit.name).sort())
    expect(new Set(plan.units.map(unit => unit.name)).size).toBe(plan.units.length)
  })
})

describe('mutation tables', () => {
  it('zeroes every held recipe and impulse in the zero table without touching the committed table', () => {
    const zero = emotionTableFor('zero')
    expect(buildEmotionChecks(zero)).toEqual([])
    expect(Object.values(zero).every(spec => spec.impulse === undefined && spec.mood.every(value => value === 0))).toBe(true)
    expect(naturalEmotions.angry.held?.face.browY).toBe(-0.7)
  })

  it('flips, scales, and unsides held recipes through the table seam', () => {
    expect(emotionTableFor('sign-flip').angry.held?.face.browY).toBe(0.7)
    expect(emotionTableFor('sign-flip').sad.held?.modulation.blinkInterval).toBeCloseTo(1 / 1.3, 12)
    expect(emotionTableFor('x0.5').sleepy.held?.face.eyeOpenMultiplier).toBeCloseTo(0.725, 12)
    expect(emotionTableFor('x2').happy.held?.posture).toEqual([0, 0.2, 0.12])
    expect(emotionTableFor('ignore-side').think.held?.sided).toEqual([])
    expect(emotionTableFor('blink-interval-1').surprised.held?.modulation.blinkInterval).toBe(1)
    expect(buildEmotionChecks(emotionTableFor('x0'))).toEqual([])
  })
})

describe('killState', () => {
  const outcomes = { significance: true, sign: true, visibility: true, size: true, release: true }
  it('kills on a failed detection criterion and leaves unevaluable checks out', () => {
    expect(killState({ ...outcomes, visibility: false }, 'detection')).toBe('killed')
    expect(killState({ ...outcomes, visibility: null }, 'detection')).toBe('survived')
    expect(killState({ ...outcomes, significance: null, visibility: null }, 'detection')).toBeNull()
    expect(killState({ ...outcomes, sign: false }, 'significance-or-sign')).toBe('killed')
    expect(killState({ ...outcomes, size: null }, 'size')).toBeNull()
  })
})
