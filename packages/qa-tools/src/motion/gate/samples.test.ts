import type { EmotionTrialRecord, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import type { EmotionCellPartial } from './partials'
import type { TrialSamples } from './samples'

import { buildEmotionTrial, stripEmotions } from '@proj-airi/stage-shared/motion-scenario'
import { measureEmotionTrial } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks, emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, expect, it } from 'vitest'

import { runT1 } from '../t1/runner'
import { reviewFieldsFor } from './review-fields'
import { measureTrialSamples, trajectoryGrid, trajectoryTimes } from './samples'

const checks = buildEmotionChecks()
function check(key: string) {
  const found = checks.find(entry => entry.key === key)
  if (!found)
    throw new Error(`no check ${key}`)
  return found
}

/** `happy:strong:angleZ` is sided (the recipe sign flips with the hold side); `angry:strong:browMean` is not. */
const sidedKey = 'happy:strong:angleZ'
const unsidedKey = 'angry:strong:browMean'

function record(trialId: string, side: -1 | 1 | null, rejected: string | null = null): EmotionTrialRecord {
  return { trialId, emotion: 'happy', band: 'strong', variant: 'full', side, rejected, releaseStart: 4, faceResidue: 1, channels: {}, missing: {} }
}

function samples(trialId: string, trajectory: number[], peak: number): TrialSamples {
  return {
    trialId,
    channels: {
      angleZ: { trajectory, levels: [{ id: 'ParamAngleZ', baseline: 0, peak, min: -30, max: 30 }] },
      browMean: { trajectory, levels: [{ id: 'ParamBrowLY', baseline: 0, peak, min: -1, max: 1 }, { id: 'ParamBrowRY', baseline: 0, peak: -peak, min: -1, max: 1 }] },
    },
  }
}

describe('measureTrialSamples', () => {
  it('measures a paired trajectory on the fixed grid and absolute levels from a real T1 trial pair', () => {
    const scenario = buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1, warmup: 2, hold: 4, post: 6 })
    const trialId = 'angry-strong-full-1'
    const run = runT1(scenario)
    const paired = runT1(stripEmotions(scenario))

    const measured = measureTrialSamples(run, paired, { trialId, gate: emotionGate })

    expect(measured).not.toBeNull()
    expect(trajectoryTimes).toHaveLength(trajectoryGrid.points)
    expect(trajectoryTimes[0]).toBe(-1)
    expect(trajectoryTimes[trajectoryTimes.length - 1]).toBe(10)
    const brow = measured?.channels.browMean
    expect(brow?.trajectory).toHaveLength(trajectoryGrid.points)
    expect(brow?.trajectory.every(Number.isFinite)).toBe(true)
    expect(brow?.levels.map(level => level.id)).toEqual(['ParamBrowLY', 'ParamBrowRY'])
    for (const level of brow?.levels ?? []) {
      expect(level.min).toBeLessThan(level.max)
      expect(level.peak).toBeGreaterThanOrEqual(level.min)
      expect(level.peak).toBeLessThanOrEqual(level.max)
    }
    expect(measured?.channels.eyelid?.levels.map(level => level.id)).toEqual(['ParamEyeLOpen', 'ParamEyeROpen'])
    expect(measured?.channels.blinkRate).toBeUndefined()
  })

  it('returns null when the trial has no scenario event in the traces', () => {
    const scenario = buildEmotionTrial({ emotion: 'sad', band: 'clear', variant: 'full', seed: 2, warmup: 2, hold: 4, post: 6 })
    expect(measureTrialSamples(runT1(scenario), runT1(stripEmotions(scenario)), { trialId: 'absent', gate: emotionGate })).toBeNull()
  })
})

/** A 30 Hz trace where every listed parameter holds `base` and steps to `base + step` at the pulse (2 s); the stripped twin never steps. */
function stepTrace(steps: Record<string, { base: number, step: number }>, pulse: number, withEmotion: boolean, trialId: string): NaturalTrace {
  const t = Array.from({ length: 30 * 13 + 1 }, (_, index) => index / 30)
  const ranges = {
    ParamAngleX: { min: -30, max: 30, default: 0 },
    ParamBodyAngleX: { min: -10, max: 10, default: 0 },
    ParamBrowLY: { min: -1, max: 1, default: 0 },
    ParamBrowRY: { min: -1, max: 1, default: 0 },
    ParamMouthForm: { min: -1, max: 1, default: 0 },
    ParamCheek: { min: 0, max: 1, default: 0 },
    ParamEyeLSmile: { min: 0, max: 1, default: 0 },
    ParamEyeRSmile: { min: 0, max: 1, default: 0 },
    ParamEyeLOpen: { min: 0, max: 1, default: 1 },
    ParamEyeROpen: { min: 0, max: 1, default: 1 },
  }
  const channels = Object.fromEntries(Object.keys(ranges).map((id) => {
    const { base, step } = steps[id] ?? { base: ranges[id as keyof typeof ranges].default, step: 0 }
    return [id, t.map(time => (withEmotion && time > pulse ? base + step : base))]
  }))
  const event: NaturalTrace['events'][number] = withEmotion
    ? { t: pulse, source: 'scenario', event: { kind: 'emotion', at: pulse, emotion: 'angry', band: 'strong', source: 'devtools', trialId } }
    : { t: pulse, source: 'scenario', event: { kind: 'noop', at: pulse, replaced: 'emotion', trialId } }
  return {
    version: 2,
    t,
    channels,
    ranges,
    events: [event],
    meta: { model: null, driver: 'natural', energy: 0, home: 'desk', adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 }, capturedAt: '2026-10-20T00:00:00.000Z', durationSeconds: 13 },
  }
}

describe('trajectory units', () => {
  it('plateaus at the scored E of every channel kind: half-range face and posture, log-ratio eyelid', () => {
    const steps = {
      ParamAngleX: { base: 3, step: 6 },
      ParamBodyAngleX: { base: 0, step: -2 },
      ParamBrowLY: { base: 0.1, step: 0.3 },
      ParamBrowRY: { base: -0.1, step: 0.5 },
      ParamMouthForm: { base: 0, step: -0.4 },
      ParamCheek: { base: 0.2, step: 0.6 },
      ParamEyeLSmile: { base: 0, step: 0.25 },
      ParamEyeRSmile: { base: 0, step: 0.25 },
      ParamEyeLOpen: { base: 1, step: -0.5 },
      ParamEyeROpen: { base: 1, step: -0.5 },
    }
    const trialId = 'angry-strong-full-1'
    const run = stepTrace(steps, 2, true, trialId)
    const paired = stepTrace(steps, 2, false, trialId)

    const record = measureEmotionTrial(run, paired, { trialId, variant: 'full', gate: emotionGate })
    const samples = measureTrialSamples(run, paired, { trialId, gate: emotionGate })
    expect(samples).not.toBeNull()

    const checked: ScoredChannel[] = ['angleX', 'bodyAngleX', 'browMean', 'browAsym', 'mouthForm', 'cheek', 'eyeSmile', 'eyelid']
    for (const channel of checked) {
      const measure = record.channels[channel]
      const trajectory = samples?.channels[channel]?.trajectory
      expect(measure, channel).toBeDefined()
      expect(trajectory, channel).toBeDefined()
      const scored = measure!.value - (measure!.paired ?? 0)
      const window = emotionGate.windows[channel === 'eyelid' ? 'eyelid' : channel === 'angleX' || channel === 'bodyAngleX' ? 'posture' : 'face']
      const plateau = trajectoryTimes.flatMap((time, index) => time >= window[0] && time <= window[1] ? [trajectory![index]] : [])
      const plateauMean = plateau.reduce((sum, value) => sum + value, 0) / plateau.length
      expect(plateauMean, channel).toBeCloseTo(scored, 9)
      expect(Math.max(...plateau) - Math.min(...plateau), channel).toBeLessThan(1e-9)
    }
    // The eyelid case the review reproduced: openness 1 -> 0.5 must read log(0.5), not -0.5.
    expect(samples?.channels.eyelid?.trajectory[trajectoryTimes.indexOf(2)]).toBeCloseTo(Math.log(0.5), 9)
    expect(record.channels.eyelid?.value).toBeCloseTo(Math.log(0.5), 9)
  })
})

describe('reviewFieldsFor', () => {
  const cell = (records: EmotionTrialRecord[], trialSamples: TrialSamples[], emotion: 'happy' | 'angry' = 'happy'): EmotionCellPartial =>
    ({ kind: 'emotion-cell', emotion, band: 'strong', variant: 'full', seeds: { start: 1, count: records.length }, records: records.map(entry => ({ ...entry, emotion })), samples: trialSamples })

  it('folds sided trajectories by the hold side so mirrored trials agree, and pools levels', () => {
    const left = Array.from({ length: trajectoryGrid.points }, (_, index) => 0.2 - index * 0.001)
    const right = left.map(value => -value)
    const partial = cell(
      [record('t-left', 1), record('t-right', -1)],
      [samples('t-left', left, 0.4), samples('t-right', right, 0.4)],
    )

    const fields = reviewFieldsFor(check(sidedKey), [partial], emotionGate)

    expect(fields.trajectory?.n).toBe(2)
    expect(fields.trajectory?.start).toBe(trajectoryGrid.start)
    expect(fields.trajectory?.step).toBe(trajectoryGrid.step)
    expect(fields.trajectory?.mean[0]).toBeCloseTo(0.2 * check(sidedKey).sign, 6)
    expect(fields.trajectory?.low[0]).toBeCloseTo(fields.trajectory?.mean[0] ?? Number.NaN, 6)
    expect(fields.levels).toEqual([{ id: 'ParamAngleZ', baseline: 0, peak: 0.4, extreme: 0.4, min: -30, max: 30 }])
  })

  it('leaves out rejected trials and sided trials without a side, and reports null when nothing remains', () => {
    const flat = Array.from<number>({ length: trajectoryGrid.points }).fill(0.1)
    const partial = cell(
      [record('ok', 1), record('rejected', 1, 'overlap'), record('no-side', null)],
      [samples('ok', flat, 0.4), samples('rejected', flat.map(() => 5), 0.9), samples('no-side', flat.map(() => 5), 0.9)],
    )

    const sided = reviewFieldsFor(check(sidedKey), [partial], emotionGate)
    expect(sided.trajectory?.n).toBe(1)
    expect(sided.levels?.[0].peak).toBe(0.4)

    const unsided = reviewFieldsFor(check(unsidedKey), [cell(partial.records, partial.samples ?? [], 'angry')], emotionGate)
    expect(unsided.trajectory?.n).toBe(2)

    expect(reviewFieldsFor(check(sidedKey), [cell([record('rejected', 1, 'overlap')], [samples('rejected', flat, 0.4)])], emotionGate)).toEqual({ trajectory: null, levels: null })
  })

  it('gives the same band for the same samples on every call', () => {
    const rows = [0.3, 0.1, 0.2, 0.25].map((amplitude, index) => ({ id: `t${index}`, values: Array.from<number>({ length: trajectoryGrid.points }).fill(amplitude) }))
    const partial = cell(rows.map(row => record(row.id, 1)), rows.map(row => samples(row.id, row.values, 0.4)), 'angry')

    const first = reviewFieldsFor(check(unsidedKey), [partial], emotionGate)
    const second = reviewFieldsFor(check(unsidedKey), [partial], emotionGate)

    expect(second).toEqual(first)
    expect(first.trajectory?.low[0]).toBeLessThanOrEqual(first.trajectory?.mean[0] ?? Number.NaN)
    expect(first.trajectory?.high[0]).toBeGreaterThanOrEqual(first.trajectory?.mean[0] ?? Number.NaN)
  })
})
