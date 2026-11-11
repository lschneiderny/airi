import type { MetricResult } from '../metrics'
import type { MeasuredReference } from './reference-measure'

import { describe, expect, it } from 'vitest'

import { CORE } from '../metrics/bones'
import { median } from '../metrics/math'
import { result } from '../metrics/result'
import { detectors } from '../metrics/test-trace'
import { fitBand, percentile } from './bands'
import { fitDetectors } from './detectors'
import { heldoutFailureUnits } from './holdouts'
import { metricPolicies } from './policy'
import { fitClass } from './reference-fit'

const LEFT = 'chain.leftUpperArm-leftLowerArm.zeroLagCorr'
const RIGHT = 'chain.rightUpperArm-rightLowerArm.zeroLagCorr'

function talkClip(split: 'fit' | 'holdout', index: number, metrics: readonly MetricResult[]): MeasuredReference {
  return {
    entry: { file: `${split}-${index}.bvh`, dataset: 'analytic', class: 'talk', profile: 'cmu', subject: `${index}`, split, role: 'window' },
    clipSha256: `${split}-${index}`,
    seconds: 10,
    hasFingers: false,
    metrics: metrics.filter(m => m.basis !== 'episode'),
    pools: { talk: metrics.filter(m => m.basis === 'episode') },
  }
}

function correlations(left: number, right: number, spine = 0.3): MetricResult[] {
  return [result(LEFT, 'correlation', 'window', left), result(RIGHT, 'correlation', 'window', right), result('chain.spine-chest.zeroLagCorr', 'correlation', 'window', spine)]
}

// One performer's handedness: the left arm chain correlates far less than the right.
const lopsided = Array.from({ length: 10 }, (_, i) => talkClip('fit', i, correlations(0.2 + 0.02 * i, 0.85 + 0.01 * i, 0.2 + 0.04 * i)))

describe('version 2 side pooling', () => {
  it('fits one band from both sides of a lopsided reference and applies it to both mirrored ids', () => {
    const heldOut = Array.from({ length: 3 }, (_, i) => talkClip('holdout', i, correlations(0.4, 0.9)))
    const actual = fitClass([...lopsided, ...heldOut], 'talk', detectors(CORE), null)
    const rule = metricPolicies('talk').find(p => p.id === LEFT)
    const pooled = fitBand([...lopsided.map((_, i) => 0.2 + 0.02 * i), ...lopsided.map((_, i) => 0.85 + 0.01 * i)], rule ?? { side: 'upper', domain: [0, 1], transform: 'fisher-z', unit: 'clip' })
    expect(actual.metrics[LEFT]).toEqual(pooled)
    expect(actual.metrics[RIGHT]).toEqual(actual.metrics[LEFT])
    expect(actual.metrics[LEFT]).toMatchObject({ n: 20, status: 'GATED' })
  })

  it('pools the episodes of both arms so each side alone below the minimum still fits one band', () => {
    const ldlj = (split: 'fit' | 'holdout', i: number, left: number, right: number) => {
      const samples = (base: number) => Array.from({ length: 3 }, (_, t) => ({ start: t, end: t + 1, value: base + t }))
      const l = samples(left)
      const r = samples(right)
      return talkClip(split, i, [
        result('smooth.armL.ldlj', 'log-ratio', 'episode', median(l.map(s => s.value)), 'ok', '', l),
        result('smooth.armR.ldlj', 'log-ratio', 'episode', median(r.map(s => s.value)), 'ok', '', r),
      ])
    }
    // 30 fitting and 9 held-out episodes per side; only the pooled 60 and 18 reach 40 and 16.
    const clips = [...Array.from({ length: 10 }, (_, i) => ldlj('fit', i, 10 + i, 20 + i)), ...Array.from({ length: 3 }, (_, i) => ldlj('holdout', i, 14, 24))]
    const actual = fitClass(clips, 'talk', detectors(CORE), null)
    expect(actual.metrics['smooth.armL.ldlj']).toMatchObject({ status: 'GATED', n: 60, heldoutEpisodes: 18 })
    expect(actual.metrics['smooth.armR.ldlj']).toEqual(actual.metrics['smooth.armL.ldlj'])
    expect(actual.holdout.filter(h => h.metric?.startsWith('smooth.arm'))).toHaveLength(2)
  })

  it('counts a held-out failure on either side against the one pooled band', () => {
    const heldOut = [talkClip('holdout', 0, correlations(0.9999, 0.9)), talkClip('holdout', 1, correlations(0.4, 0.9999)), talkClip('holdout', 2, correlations(0.4, 0.9))]
    const actual = fitClass([...lopsided, ...heldOut], 'talk', detectors(CORE), null)
    expect(heldoutFailureUnits(actual, LEFT)).toHaveLength(2)
    expect(actual.metrics[LEFT]).toMatchObject({ status: 'REPORT', detail: 'holdout-failures: 2' })
    expect(actual.metrics[RIGHT]).toEqual(actual.metrics[LEFT])
  })

  it('fits one activity floor and one arm move speed from both sides of lopsided fitting clips', () => {
    const clips = Array.from({ length: 10 }, (_, i) => ({
      activity: { hips: 0.01 * (i + 1), leftHand: 0.002 * (i + 1), rightHand: 0.02 * (i + 1) },
      medianSpeed: { body: 0.1 * (i + 1), head: 0.1, trunk: 0.1, armL: 0.01 * (i + 1), armR: 0.2 * (i + 1), legs: 0.1 },
      windows: [],
    }))
    const hands = clips.flatMap(c => [c.activity.leftHand, c.activity.rightHand])
    const actual = fitDetectors(clips)
    expect(actual.floors.leftHand).toBe(0.5 * percentile(hands, 0.1))
    expect(actual.floors.rightHand).toBe(actual.floors.leftHand)
    expect(actual.floors.hips).toBe(0.5 * percentile(clips.map(c => c.activity.hips), 0.1))
    expect(actual.moveSpeed.armL).toBe(median(clips.flatMap(c => [c.medianSpeed.armL, c.medianSpeed.armR])))
    expect(actual.moveSpeed.armR).toBe(actual.moveSpeed.armL)
    expect(actual.moveSpeed.body).toBe(median(clips.map(c => c.medianSpeed.body)))
  })

  it('leaves a band without a mirror exactly as fitted from its own values', () => {
    const withoutSides = lopsided.map(c => ({ ...c, metrics: c.metrics.filter(m => m.id === 'chain.spine-chest.zeroLagCorr') }))
    const pooled = fitClass(lopsided, 'talk', detectors(CORE), null)
    const alone = fitClass(withoutSides, 'talk', detectors(CORE), null)
    expect(pooled.metrics['chain.spine-chest.zeroLagCorr']).toEqual(alone.metrics['chain.spine-chest.zeroLagCorr'])
    expect(pooled.metrics['chain.spine-chest.zeroLagCorr']).toMatchObject({ n: 10, status: 'GATED' })
  })
})
