import type { LivelinessTrace } from './liveliness'

import process from 'node:process'

import { writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotion } from '../natural-motion'
import { scoreLiveliness } from './liveliness'
import { referenceStats } from './reference-stats'

// Metrics owned by the motion layers. Later layers append their metrics here.
// Generated scoring judges blink on `generatedBlinkBands` (liveliness.ts), not the recording bands.
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
  // Gaze layer: independent fixations with partial head counter-rotation.
  'sd:ParamEyeBallX',
  'sd:ParamEyeBallY',
  'eyeHeadCorrelation',
  // Face, blink, and breath layers. The loop detector scores head channels only, so ParamBreath stays periodic.
  'blinkRate',
  'blinkCv',
  'sd:ParamBrowLY',
  'sd:ParamMouthForm',
]

const simulationRate = 120
const traceRate = 30
const warmUpSeconds = 3 * 60
const scoredSeconds = 30 * 60

/**
 * Simulates the desk fixture at 120 Hz and samples at 30 Hz in reference units: head normalized x 30,
 * eyes normalized, and face channels in ForBOOTH ranges (brow and mouth form +/-1, eyelids 0..1).
 */
function simulate(seed: number): LivelinessTrace {
  const motion = new Live2DNaturalMotion({ seed, home: 'desk' })
  const t: number[] = []
  const channels: Record<string, number[]> = { ParamAngleX: [], ParamAngleY: [], ParamAngleZ: [], ParamEyeBallX: [], ParamEyeBallY: [], ParamEyeLOpen: [], ParamBrowLY: [], ParamMouthForm: [], ParamBreath: [] }
  const decimation = simulationRate / traceRate
  const total = (warmUpSeconds + scoredSeconds) * simulationRate
  const warmUp = warmUpSeconds * simulationRate
  for (let frame = 0; frame <= total; frame++) {
    const { pose, face, blink, breath } = motion.advance(frame / simulationRate)
    if (frame < warmUp || frame % decimation !== 0)
      continue
    t.push((frame - warmUp) / simulationRate)
    channels.ParamAngleX.push(pose.headX * 30)
    channels.ParamAngleY.push(pose.headY * 30)
    channels.ParamAngleZ.push(pose.headZ * 30)
    channels.ParamEyeBallX.push(pose.eyeX)
    channels.ParamEyeBallY.push(pose.eyeY)
    // Rig default 1 times the face multiplier and blink closure; the adapter's eyelid floor is not applied here.
    channels.ParamEyeLOpen.push(face.eyeOpenMultiplier * blink.blinkFactor)
    channels.ParamBrowLY.push(face.browLY)
    channels.ParamMouthForm.push(face.mouthForm)
    channels.ParamBreath.push(breath.value)
  }
  return { t, channels }
}

describe('natural motion liveliness gate', () => {
  it.each([1, 2, 3])('passes every gated metric for seed %i', (seed) => {
    const trace = simulate(seed)
    const traceOut = process.env.NATURAL_TRACE_OUT
    const traceSeed = Number(process.env.NATURAL_TRACE_SEED ?? 1)
    if (seed === traceSeed && traceOut)
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
