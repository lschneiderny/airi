import type { EmotionTrial } from './emotion'

import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { judgeMetrics } from '../gate/judge'
import { loadBands } from '../gate/load'
import { emotionMetrics, emotionTrials } from './emotion'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX } from './test-trace'

/** Three trials per emotion and five placebo trials, each a head posture at its centre plus a small fixed spread. */
function headPool(centres: Readonly<Record<string, number>>): EmotionTrial[] {
  return Object.entries(centres).flatMap(([condition, x]) => {
    const placebo = condition === 'placebo'
    return (placebo ? [-0.02, -0.01, 0, 0.01, 0.02] : [-0.01, 0, 0.01]).map(noise => ({ condition, placebo, t: 0, frames: [], posture: { head: [x + noise, 0, 0] as const } }))
  })
}

function separations(trials: readonly EmotionTrial[]) {
  const m = emotionMetrics(trials)
  return { all: m.find(m => m.id === 'emotion.minSeparation')?.value, fromNeutral: m.find(m => m.id === 'emotion.minSeparationFromNeutral')?.value }
}

// Since gate version 5 separations read turn chords (2 sin(angle / 2)). A rotation-matrix centre differs from a
// rotation-vector one at second order: a three-trial copy of the five-trial placebo reads 0.006 SD from it, and a
// pool at 1.99 or 2.01 SD in rotation vectors reads 5e-5 SD off.
describe('pooled emotion postures', () => {
  it('scores an emotion that copies neutral or the placebo at zero separation from neutral', () => {
    expect(separations(headPool({ neutral: 0, placebo: 1, copy: 0, other: -1 })).fromNeutral).toBeCloseTo(0, 12)
    expect(separations(headPool({ neutral: 0, placebo: 1, copy: 1, other: -1 })).fromNeutral).toBeLessThan(0.01)
  })

  it('leaves neutral against placebo out of the separation from neutral', () => {
    const { all, fromNeutral } = separations(headPool({ neutral: 0, placebo: 0.005, a: 1, b: -1 }))
    expect(all).toBeLessThan(2)
    expect(fromNeutral).toBeGreaterThan(50)
  })

  it('includes every emotion versus placebo in the minimum separation', () => {
    const trials: EmotionTrial[] = [
      ...['a', 'b', 'copy'].flatMap((condition, c) => [-0.01, 0, 0.01].map(noise => ({ condition, placebo: false, t: 0, frames: [], posture: { head: [c === 0 ? 0.8 + noise : c === 1 ? -0.8 + noise : noise, 0, 0] as const, leftUpperArm: [c === 0 ? 1 : c === 1 ? -1 : 0, 0, 0] as const } }))),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => ({ condition: 'placebo', placebo: true, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const } })),
    ]
    const m = emotionMetrics(trials)
    expect(m.find(m => m.id === 'emotion.minSeparation')?.value).toBeLessThan(0.01)
    expect(m.find(m => m.id === 'emotion.medianSeparation')?.value).toBeGreaterThan(50)
    expect(m.find(m => m.id === 'emotion.armShare')?.value).toBeCloseTo(1 / 1.64, 10)
  })

  // Offsets of +/-0.01 (emotions) and +/-0.01, +/-0.02 (placebo) give sigma = 0.01 sqrt(14 / 11) over 11 trials. With the
  // placebo far away, the metric is a's centre over sigma: 1.99 must FAIL and 2.01 PASS the frozen bands.
  it.each([[1.99, 'FAIL'], [2.01, 'PASS']] as const)('judges a pool at %s SD from neutral as %s through the gate', async (separation, status) => {
    const sigma = 0.01 * Math.sqrt(14 / 11)
    const pool = headPool({ neutral: 0, placebo: 1, a: separation * sigma })
    const bands = await loadBands(fileURLToPath(new URL('../../../../..', import.meta.url)))
    const judged = judgeMetrics(emotionMetrics(pool), bands.classes.emotion).find(m => m.id === 'emotion.minSeparationFromNeutral')
    expect(judged?.value).toBeCloseTo(separation, 3)
    expect(judged?.status).toBe(status)
  })

  // Version 5 (E/g3/s/rules.md 12.5): an arm form on either arm is one emotion, as the design puts it on a random side.
  // Signed vectors read a, posed L, R, L, and b, posed R, L, R, at 1.71 SD from neutral.
  it('reads a pose and its mirror image as one emotion', () => {
    const arm = (side: 'L' | 'R', noise: number) => ({ head: [noise, 0, 0] as const, leftUpperArm: [0, 0, side === 'L' ? 1 : 0] as const, rightUpperArm: [0, 0, side === 'R' ? -1 : 0] as const })
    const trials: EmotionTrial[] = [
      ...(['L', 'R', 'L'] as const).map((side, i) => ({ condition: 'a', placebo: false, t: 0, frames: [], posture: arm(side, 0.01 * (i - 1)) })),
      ...(['R', 'L', 'R'] as const).map((side, i) => ({ condition: 'b', placebo: false, t: 0, frames: [], posture: { ...arm(side, 0.01 * (i - 1)), head: [0.5 + 0.01 * (i - 1), 0, 0] as const } })),
      ...[-0.01, 0, 0.01].map(noise => ({ condition: 'neutral', placebo: false, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const, rightUpperArm: [0, 0, 0] as const } })),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => ({ condition: 'placebo', placebo: true, t: 0, frames: [], posture: { head: [1 + noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const, rightUpperArm: [0, 0, 0] as const } })),
    ]
    expect(separations(trials).fromNeutral).toBeGreaterThan(20)
  })

  // A lean toward a random side is all antisymmetric: its mirror-symmetric part is second order in the angle.
  it('keeps a lean toward a random side clear of neutral', () => {
    const roll = (condition: string, z: number, noise: number, placebo = false): EmotionTrial => ({ condition, placebo, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, spine: [0, 0, z] as const } })
    const trials: EmotionTrial[] = [
      ...[0.3, -0.3, 0.3].map((z, i) => roll('a', z, 0.01 * (i - 1))),
      ...[-0.01, 0, 0.01].map(noise => roll('neutral', 0, noise)),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => roll('placebo', 0, noise, true)),
    ]
    expect(separations(trials).fromNeutral).toBeGreaterThan(10)
  })

  // Two emotions whose poses differ only by side are one pose: the all-pairs minimum is their pair.
  it('does not separate two emotions that differ only by side', () => {
    const pool = (condition: string, side: 1 | -1): EmotionTrial[] => [-0.01, 0, 0.01].map(noise => ({ condition, placebo: false, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftUpperArm: [0, 0, side > 0 ? 1 : 0] as const, rightUpperArm: [0, 0, side < 0 ? -1 : 0] as const } }))
    const trials: EmotionTrial[] = [
      ...pool('a', 1),
      ...pool('b', -1),
      ...[-0.01, 0, 0.01].map(noise => ({ condition: 'neutral', placebo: false, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const, rightUpperArm: [0, 0, 0] as const } })),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => ({ condition: 'placebo', placebo: true, t: 0, frames: [], posture: { head: [1 + noise, 0, 0] as const, leftUpperArm: [0, 0, 0] as const, rightUpperArm: [0, 0, 0] as const } })),
    ]
    expect(separations(trials).all).toBeLessThan(0.01)
  })

  // A hand turned 179 deg and one turned 181 deg are 2 deg apart; their rotation vectors point in opposite directions.
  it('reads a bone turned past 180 degrees next to one just short of it', () => {
    const turn = (degrees: number) => [((degrees + 180) % 360 - 180) * Math.PI / 180, 0, 0] as const
    const trials: EmotionTrial[] = [
      ...[179, 181, 179].map((degrees, i) => ({ condition: 'a', placebo: false, t: 0, frames: [], posture: { head: [0.01 * (i - 1), 0, 0] as const, leftHand: turn(degrees), rightHand: [0, 0, 0] as const } })),
      ...[-0.01, 0, 0.01].map(noise => ({ condition: 'neutral', placebo: false, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftHand: [0, 0, 0] as const, rightHand: [0, 0, 0] as const } })),
      ...[-0.02, -0.01, 0, 0.01, 0.02].map(noise => ({ condition: 'placebo', placebo: true, t: 0, frames: [], posture: { head: [noise, 0, 0] as const, leftHand: [0, 0, 0] as const, rightHand: [0, 0, 0] as const } })),
    ]
    expect(separations(trials).fromNeutral).toBeGreaterThan(20)
  })

  it('extracts a baseline-relative quaternion posture once for a labelled held trial', () => {
    const p = prepareTrace(analyticTrace({
      seconds: 8,
      bones: ['hips', 'head'],
      scenario: 'emotion',
      events: [{ kind: 'emotion', t: 2, emotion: 'a', band: 'clear', phase: 'pulse', trialId: 'a' }, { kind: 'emotion', t: 3, emotion: 'a', band: 'clear', phase: 'hold-start', trialId: 'a' }],
      world: (b, t) => angleX(b === 'head' && t > 2 ? 0.5 : 0),
    }))
    const trials = emotionTrials(p)
    expect(trials.length).toBe(1)
    expect(trials[0].posture.head?.[0]).toBeCloseTo(0.5, 6)
  })
})
