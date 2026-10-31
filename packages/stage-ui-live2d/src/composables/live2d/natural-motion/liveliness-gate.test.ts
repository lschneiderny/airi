import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { LivelinessTrace } from './liveliness'

import process from 'node:process'

import { writeFileSync } from 'node:fs'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { NaturalSpeechEmphasis } from '@proj-airi/motion-driver-natural/speech-emphasis'
import { describe, expect, it } from 'vitest'

import { naturalIdleLivelinessGate, naturalTalkingGate } from './gates'
import { generatedBlinkBands, generatedMouthOpenBand, scoreLiveliness, scoreTalkingRelative } from './liveliness'
import { referenceStats } from './reference-stats'
import { syllableFixture } from './speech-fixture'

// The gated metric list before it moved into `naturalIdleLivelinessGate`; the gate must keep exactly this meaning.
const previousGatedMetrics = [
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
  // Shift-amplitude dispersion: spread rejects constant sizes; log asymmetry rejects the uniform sizes
  // [0.1, 0.5] and [0.15, 0.45] but not every tail-less spread.
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
const gatedMetrics = naturalIdleLivelinessGate.metrics

const simulationRate = 120
const traceRate = 30
const { warmUpSeconds, scoredSeconds } = naturalIdleLivelinessGate

/**
 * Simulates the desk fixture at 120 Hz and samples at 30 Hz in reference units: head normalized x 30,
 * eyes normalized, and face channels in ForBOOTH ranges (brow and mouth form +/-1, eyelids 0..1).
 */
function simulate(seed: number): LivelinessTrace {
  const motion = new NaturalMotion({ seed, home: 'desk' })
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

const talkingSeconds = naturalTalkingGate.scoredSeconds
const talkingWarmUpSeconds = naturalTalkingGate.warmUpSeconds
const idleState: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }

/** Head-only desk trace in reference units; `talking` drives the talking state and the syllable fixture after warm-up. */
function simulateVoice(seed: number, talking: boolean) {
  const motion = new NaturalMotion({ seed, home: 'desk' })
  const fixture = syllableFixture(talkingSeconds, seed + 100)
  motion.advance(0)
  if (talking)
    motion.setPerformance({ ...idleState, mode: 'talking' }, 0.5, 0)
  const t: number[] = []
  const channels: Record<string, number[]> = { ParamAngleX: [], ParamAngleY: [], ParamAngleZ: [] }
  const warmUp = talkingWarmUpSeconds * simulationRate
  for (let frame = 1; frame <= warmUp + talkingSeconds * simulationRate; frame++) {
    const scored = frame - warmUp
    if (talking && scored >= 0)
      motion.setVoice({ speaking: true, speechActiveOrRecent: true, level: fixture.level[scored] })
    const { pose } = motion.advance(frame / simulationRate)
    if (scored < 0 || frame % (simulationRate / traceRate) !== 0)
      continue
    t.push(scored / simulationRate)
    channels.ParamAngleX.push(pose.headX * 30)
    channels.ParamAngleY.push(pose.headY * 30)
    channels.ParamAngleZ.push(pose.headZ * 30)
  }
  return { trace: { t, channels }, onsets: fixture.onsets }
}

describe('natural motion liveliness gate', () => {
  it('reads the gated metrics, seeds, and timings from the committed gates', () => {
    expect(naturalIdleLivelinessGate.metrics).toEqual(previousGatedMetrics)
    expect(naturalIdleLivelinessGate.seeds).toEqual([1, 2, 3])
    expect([naturalIdleLivelinessGate.warmUpSeconds, naturalIdleLivelinessGate.scoredSeconds]).toEqual([180, 1800])
    expect(naturalIdleLivelinessGate.bands).toEqual({ ...referenceStats.bands, ...generatedBlinkBands, ...generatedMouthOpenBand })
    expect(naturalTalkingGate.seeds).toEqual([1, 2, 3])
  })

  it.each([...naturalTalkingGate.seeds])('moves more while talking, locked to speech onsets, for seed %i', (seed) => {
    const talking = simulateVoice(seed, true)
    const silence = simulateVoice(seed, false)
    const report = scoreTalkingRelative(talking.trace, silence.trace, talking.onsets)
    console.info(`talking seed ${seed}: speedRatio=${report.speedRatio.value} onsetEnrichment=${report.onsetEnrichment.value}`)
    expect(report.speedRatio.pass).toBe(true)
    expect(report.onsetEnrichment.pass).toBe(true)
    // The committed thresholds are the ones scoreTalkingRelative applies.
    expect(report.speedRatio.pass).toBe(report.speedRatio.value! >= naturalTalkingGate.speedRatio[0] && report.speedRatio.value! <= naturalTalkingGate.speedRatio[1])
    expect(report.onsetEnrichment.pass).toBe(report.onsetEnrichment.value! > naturalTalkingGate.onsetEnrichmentAbove)
  }, 20_000)

  it('emphasizes constant loud audio at most once in 10 s', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const emphasis = new NaturalSpeechEmphasis(createRandomStream(seed))
      // Silence, then 10 s of constant loud audio; every detected onset is accepted.
      for (let frame = 1; frame <= 10.5 * simulationRate; frame++)
        emphasis.step(1 / simulationRate, frame < 0.5 * simulationRate ? 0 : 0.9, 1)
      expect(emphasis.emphasisCount).toBeLessThanOrEqual(1)
    }
  })

  it.each([...naturalIdleLivelinessGate.seeds])('passes every gated metric for seed %i', (seed) => {
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
