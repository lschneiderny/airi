import type { MetricReference } from './liveliness'

import { generatedBlinkBands, generatedHeadReportOnlyBands, generatedMouthOpenBand } from './liveliness'
import { referenceStats } from './reference-stats'

/**
 * The gates of the T0 liveliness test (`liveliness-gate.test.ts`), which scores generated Natural motion in the test
 * suite. Each gate is code with an `id` and an integer `version`: change a metric, threshold, window, trial count, or
 * seed rule only by editing this file, and bump `version` when you do.
 */

export interface LivelinessGate {
  id: string
  version: number
  limitation: string
  /** Metrics that must pass; every other metric is reported only. */
  metrics: readonly string[]
  seeds: readonly number[]
  warmUpSeconds: number
  scoredSeconds: number
  /** The bands `scoreLiveliness` uses in generated mode. */
  bands: Readonly<Record<string, MetricReference>>
}

export interface TalkingGate {
  id: string
  version: number
  limitation: string
  seeds: readonly number[]
  warmUpSeconds: number
  scoredSeconds: number
  /** Inclusive band of talking over silent mean head speed. Onset enrichment is reported, not gated. */
  speedRatio: readonly [min: number, max: number]
}

const livelinessLimitation = 'Liveliness scores compare idle motion statistics with the desk VTS reference bands. They do not prove naturalness, which stays a visual review, and the desk recordings are valid for idle liveliness only.'

/**
 * The idle liveliness gate: the desk fixture simulated at 120 Hz, scored in generated mode.
 *
 * Version 2 (2026-11-07) stops gating `jitter` and `speedPeakLogAsymmetry`: generated scoring reports them without a
 * band (`generatedHeadReportOnlyBands`). Every other version 1 metric keeps its band.
 */
export const naturalIdleLivelinessGate = {
  id: 'natural-idle-liveliness',
  version: 2,
  limitation: livelinessLimitation,
  metrics: [
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
    'nearLimitOccupancy',
    // Shift-amplitude dispersion: spread rejects constant sizes. Log asymmetry is report-only since version 2.
    'speedPeakP90P50',
    // Gaze layer: independent fixations with partial head counter-rotation.
    'sd:ParamEyeBallX',
    'sd:ParamEyeBallY',
    'eyeHeadCorrelation',
    // Face, blink, and breath layers. The loop detector scores head channels only, so ParamBreath stays periodic.
    // Generated scoring judges blink on `generatedBlinkBands`, not the recording bands.
    'blinkRate',
    'blinkCv',
    'sd:ParamBrowLY',
    'sd:ParamMouthForm',
  ],
  seeds: [1, 2, 3],
  warmUpSeconds: 3 * 60,
  scoredSeconds: 30 * 60,
  bands: { ...referenceStats.bands, ...generatedBlinkBands, ...generatedMouthOpenBand, ...generatedHeadReportOnlyBands },
} as const satisfies LivelinessGate

/**
 * Talking relative to silence on the same seed; the thresholds are the ones `scoreTalkingRelative` applies.
 * Version 2 (2026-11-07) drops the onset-enrichment floor of 1.2: enrichment is reported without a verdict.
 */
export const naturalTalkingGate = {
  id: 'natural-talking',
  version: 2,
  limitation: livelinessLimitation,
  seeds: [1, 2, 3],
  warmUpSeconds: 60,
  scoredSeconds: 10 * 60,
  speedRatio: [1.15, 1.7],
} as const satisfies TalkingGate
