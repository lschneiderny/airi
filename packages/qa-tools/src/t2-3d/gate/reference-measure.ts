import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters, MetricResult, PreparedTrace } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { ReferenceClip } from '../reference/manifest'
import type { DetectorQuantities } from './detectors'

import { coreMetrics, detectorQuantities, gaitMetrics, gazeMetrics, gestureMetrics, intermittencyMetrics, onsetMetrics, periodMetrics, prepareTrace, smoothMetrics } from '../metrics'
import { integratedEpisode } from '../metrics/gaze'
import { DEG, norm } from '../metrics/math'
import { headSignal } from '../metrics/period'
import { episodes } from '../metrics/segments'
import { percentile } from './bands'
import { fitDetectors, headOnly } from './detectors'

export interface ReferenceInput {
  readonly entry: ReferenceClip
  readonly input: DecodedMotionTrace
  readonly quantities: DetectorQuantities
  readonly seconds: number
}
export interface MeasuredReference {
  readonly entry: ReferenceClip
  readonly clipSha256: string
  readonly seconds: number
  readonly hasFingers: boolean
  readonly metrics: readonly MetricResult[]
  readonly pools: Readonly<Partial<Record<MotionScenarioClass, readonly MetricResult[]>>>
}

export function referenceInput(entry: ReferenceClip, input: DecodedMotionTrace): ReferenceInput {
  const prepared = prepareTrace(input)
  return { entry, input, quantities: detectorQuantities(prepared), seconds: (input.trace.frames - 1) / input.trace.hz }
}

export function referenceDetectors(inputs: readonly ReferenceInput[], classes: readonly MotionScenarioClass[]): DetectorParameters {
  return fitDetectors(inputs.filter(c => c.entry.split === 'fit' && c.entry.role === 'window' && classes.includes(c.entry.class)).map(c => c.quantities))
}

export function headAmplitudes(p: PreparedTrace): number[] {
  const head = headSignal(p)
  return head
    ? episodes(head.map(norm), 0.5).flatMap((e) => {
        const turn = integratedEpisode(head, e)
        return turn && turn.angle * DEG >= 10 ? [turn.angle * DEG] : []
      })
    : []
}

export function amplitudeRange(inputs: readonly ReferenceInput[]): readonly [number, number] | undefined {
  const angles = inputs.filter(c => c.entry.split === 'fit' && ['idle', 'talk'].includes(c.entry.class)).flatMap(c => headAmplitudes(prepareTrace(c.input)))
  return angles.length ? [percentile(angles, 0.05), percentile(angles, 0.95)] : undefined
}

/** Recompute after fitting detector scales. Diagnostic-only spectral work cannot affect a band. */
export function measureReference(c: ReferenceInput, params: DetectorParameters, scales: Readonly<Record<'idle' | 'talk' | 'shared', DetectorParameters>>): MeasuredReference {
  const p = prepareTrace(c.input)
  const metrics = [...coreMetrics(p, params), ...intermittencyMetrics(p, params.moveSpeed.body), ...smoothMetrics(p, params)]
  if (c.entry.class === 'idle')
    metrics.push(...periodMetrics(p))
  if (c.entry.class === 'talk')
    metrics.push(...gestureMetrics(p, params))
  if (c.entry.class === 'walk')
    metrics.push(...gaitMetrics(p))
  const pooledClass = ['idle', 'talk'].includes(c.entry.class)
  const gazeParams = c.entry.split === 'fit' ? { ...scales.shared, acceptedHeadRotationDeg: undefined } : scales.shared
  return {
    entry: c.entry,
    clipSha256: c.input.trace.rig.assetSha256 ?? '',
    seconds: c.seconds,
    hasFingers: c.input.trace.rig.hasFingers,
    metrics,
    // Every fitting episode uses the detector scales of the class it will
    // judge, even when the source clip belongs to another class.
    pools: {
      idle: pooledClass ? smoothMetrics(p, scales.idle).filter(m => m.id === 'smooth.head.ldlj') : [],
      talk: pooledClass ? [...smoothMetrics(p, scales.talk), ...onsetMetrics(p, scales.talk)] : [],
      gaze: pooledClass ? [...gazeMetrics(p, gazeParams), ...onsetMetrics(headOnly(p), scales.shared)] : [],
      emotion: pooledClass ? onsetMetrics(p, scales.shared) : [],
      walk: c.entry.class === 'walk' ? metrics : [],
    },
  }
}
