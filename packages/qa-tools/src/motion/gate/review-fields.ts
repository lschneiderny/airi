import type { ChannelCheck, EmotionGate, EmotionTrialRecord } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { EmotionCellPartial } from './partials'
import type { ResultLevel, ResultTrajectory } from './report'
import type { ParameterLevel, TrialSamples } from './samples'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { hashSeed, quantile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import { trajectoryGrid } from './samples'

/**
 * Pools the per-trial review samples of a cell into the report's `trajectory` and `levels` fields. The
 * trajectory is direction-folded exactly as the scorer folds `E` (`check.sign`, times the hold side for sided
 * checks), so a positive value is motion in the recipe's direction. Trials the scorer rejects, and trials
 * without a known side on a sided check, are left out. Nothing here changes a verdict.
 */

export interface ReviewFields {
  trajectory: ResultTrajectory | null
  levels: ResultLevel[] | null
}

const bootstrapResamples = 200
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
/** Four significant digits keep report.json compact; the plots cannot show finer differences. */
const compact = (value: number) => Number(value.toPrecision(4))

function signOf(check: ChannelCheck, record: EmotionTrialRecord): number | null {
  if (!check.sided)
    return check.sign
  return record.side === null ? null : check.sign * record.side
}

export function reviewFieldsFor(check: ChannelCheck, cells: readonly EmotionCellPartial[], gate: EmotionGate): ReviewFields {
  const matching = cells.filter(cell => cell.emotion === check.emotion && cell.band === check.band && cell.variant === 'full')
  const samplesById = new Map<string, TrialSamples>()
  for (const cell of matching) {
    for (const samples of cell.samples ?? [])
      samplesById.set(samples.trialId, samples)
  }
  const folded: number[][] = []
  const levelsPerTrial: ParameterLevel[][] = []
  for (const record of matching.flatMap(cell => cell.records)) {
    const samples = samplesById.get(record.trialId)?.channels[check.channel]
    const sign = signOf(check, record)
    if (!samples || record.rejected !== null || sign === null)
      continue
    folded.push(samples.trajectory.map(value => sign * value))
    levelsPerTrial.push(samples.levels)
  }
  if (folded.length === 0)
    return { trajectory: null, levels: null }
  return { trajectory: pooledTrajectory(folded, `${gate.id}@${gate.version}:${check.key}:trajectory`), levels: pooledLevels(levelsPerTrial) }
}

function pooledTrajectory(rows: readonly number[][], seedKey: string): ResultTrajectory {
  const points = Math.min(trajectoryGrid.points, ...rows.map(row => row.length))
  const meanAt = (picked: readonly number[][], index: number) => mean(picked.map(row => row[index]))
  const random = createRandomStream(hashSeed(seedKey))
  const resampled: number[][] = []
  for (let draw = 0; draw < bootstrapResamples; draw++) {
    const picked = rows.map(() => rows[Math.floor(random() * rows.length)])
    resampled.push(Array.from({ length: points }, (_, index) => meanAt(picked, index)))
  }
  const column = (index: number) => resampled.map(row => row[index])
  return {
    start: trajectoryGrid.start,
    step: trajectoryGrid.step,
    mean: Array.from({ length: points }, (_, index) => compact(meanAt(rows, index))),
    low: Array.from({ length: points }, (_, index) => compact(quantile(column(index), 0.025))),
    high: Array.from({ length: points }, (_, index) => compact(quantile(column(index), 0.975))),
    n: rows.length,
  }
}

function pooledLevels(perTrial: readonly ParameterLevel[][]): ResultLevel[] {
  const byId = new Map<string, ParameterLevel[]>()
  for (const levels of perTrial) {
    for (const level of levels)
      byId.set(level.id, [...(byId.get(level.id) ?? []), level])
  }
  return [...byId.entries()].map(([id, levels]) => {
    const baseline = mean(levels.map(level => level.baseline))
    const extreme = levels.reduce((furthest, level) => (Math.abs(level.peak - baseline) > Math.abs(furthest - baseline) ? level.peak : furthest), levels[0].peak)
    return {
      id,
      baseline: compact(baseline),
      peak: compact(mean(levels.map(level => level.peak))),
      extreme: compact(extreme),
      min: levels[0].min,
      max: levels[0].max,
    }
  })
}
