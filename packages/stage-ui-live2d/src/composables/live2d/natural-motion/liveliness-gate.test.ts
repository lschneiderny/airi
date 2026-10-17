import type { LivelinessTrace } from './liveliness'

import process from 'node:process'

import { writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotion } from '../natural-motion'
import { scoreLiveliness } from './liveliness'
import { referenceStats } from './reference-stats'

// Metrics owned by the posture layers. Later layers append their metrics here.
const gatedMetrics = [
  'sd:ParamAngleX',
  'sd:ParamAngleY',
  'sd:ParamAngleZ',
  'still05',
  'still2',
  'top10PathShare',
  'velocityAcfCrossing',
  'loopPeak',
  'meanAngleY',
  'minuteAngleYRange',
  'angleXp5',
  'angleXp95',
  'jitter',
  'nearLimitOccupancy',
  // Shift-amplitude dispersion: spread rejects constant sizes, log asymmetry rejects tail-less spreads.
  'speedPeakP90P50',
  'speedPeakLogAsymmetry',
]

const simulationRate = 120
const traceRate = 30
const warmUpSeconds = 3 * 60
const scoredSeconds = 30 * 60

/** Simulates the desk fixture at 120 Hz and samples the head at 30 Hz in reference units (normalized x 30). */
function simulate(seed: number): LivelinessTrace {
  const motion = new Live2DNaturalMotion({ seed, home: 'desk' })
  const t: number[] = []
  const channels: Record<string, number[]> = { ParamAngleX: [], ParamAngleY: [], ParamAngleZ: [] }
  const decimation = simulationRate / traceRate
  const total = (warmUpSeconds + scoredSeconds) * simulationRate
  const warmUp = warmUpSeconds * simulationRate
  for (let frame = 0; frame <= total; frame++) {
    const { pose } = motion.advance(frame / simulationRate)
    if (frame < warmUp || frame % decimation !== 0)
      continue
    t.push((frame - warmUp) / simulationRate)
    channels.ParamAngleX.push(pose.headX * 30)
    channels.ParamAngleY.push(pose.headY * 30)
    channels.ParamAngleZ.push(pose.headZ * 30)
  }
  return { t, channels }
}

describe('natural motion liveliness gate', () => {
  it.each([1, 2, 3])('passes every posture metric for seed %i', (seed) => {
    const trace = simulate(seed)
    const traceOut = process.env.NATURAL_TRACE_OUT
    if (seed === 1 && traceOut)
      writeFileSync(traceOut, JSON.stringify({ ...trace, ranges: referenceStats.ranges }))
    const report = scoreLiveliness(trace, referenceStats.ranges, { mode: 'generated' })
    // One assertion lists every hard failure and every gated metric outside its band.
    const failures = [
      ...report.hardFailures.map(failure => `hard:${failure}`),
      ...gatedMetrics
        .filter(id => report.metrics[id]?.pass !== true)
        .map(id => `${id}=${report.metrics[id]?.value} band=${JSON.stringify(report.metrics[id]?.band)}`),
    ]
    expect(failures).toEqual([])
  }, 20_000)
})
