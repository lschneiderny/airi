import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { ReferenceManifest } from '../reference/manifest'
import type { StylePosture } from './reference-context'
import type { ClassBands, MotionBandsFile } from './types'

import { prepareTrace } from '../metrics'
import { admitReferences } from './admissions'
import { HOLDOUT_VALIDATION } from './holdouts'
import { CLEAR_OF_NEUTRAL, metricPolicies, reportStandingSpeaker, sideGroup, STANDING_SPEAKER } from './policy'
import { emotionContext, idleLoopContext, stylePosture } from './reference-context'
import { fitClass } from './reference-fit'
import { amplitudeRange, measureReference, referenceDetectors } from './reference-measure'
import { GateRefusal } from './refusals'

export interface ReferenceBuild {
  readonly directory: string
  readonly manifest: ReferenceManifest
  readonly gitSha: string
  readonly signal: AbortSignal
}

export const SIDE_POOLING = {
  rule: 'A fitted metric that names a left or right bone or region and has a fitted mirror is fitted once from both sides pooled, under the unchanged fitting and held-out rules; the one band applies to both ids, and held-out units are judged on both sides against it. Each left or right bone activity floor and the armL/armR move speed are likewise fitted once from both sides pooled under their unchanged rules and applied to both sides.',
  source: 'User decision, 2026-11-11: "Arm bands: Gate v2, pooled sides (Recommended)".',
  timing: 'Decided after a tuned character failed left-side arm metrics only; no character data entered the fit.',
} as const

function pooledPairs(scenario: MotionScenarioClass): readonly (readonly string[])[] {
  const policies = metricPolicies(scenario).filter(p => p.fit)
  return policies.map(p => sideGroup(p, policies)).filter((ids, i) => ids.length === 2 && ids[0] === policies[i].id)
}

/** Manifest order is preserved for both fitting and held-out episode groups. */
export async function buildReference(options: ReferenceBuild): Promise<MotionBandsFile> {
  const { inputs, refusals } = await admitReferences(options.directory, options.manifest, options.signal)
  const refusedHoldouts = refusals.filter(r => r.entry.split === 'holdout')
  if (refusedHoldouts.length)
    throw new GateRefusal('reference-holdout-refused', refusedHoldouts.map(r => `${r.clipSha256}: ${r.name}: ${r.detail}`).join('; '))
  const styles = new Map<string, StylePosture>()
  const longIdle: { clipSha256: string, seconds: number, loopPeak: Readonly<Record<string, number | null>> }[] = []
  for (const c of inputs) {
    options.signal.throwIfAborted()
    const { entry, input } = c
    if (entry.profile === '100style' && entry.class === 'idle') {
      const name = /\/([^/]+)_ID\.bvh$/.exec(entry.file)?.[1]
      if (name && ['Neutral', 'Angry', 'Depressed', 'Elated', 'Proud'].includes(name))
        styles.set(name, stylePosture(prepareTrace(input)))
      if (c.seconds >= 20)
        longIdle.push({ clipSha256: input.trace.rig.assetSha256 ?? '', seconds: c.seconds, loopPeak: idleLoopContext(prepareTrace(input)) })
    }
  }
  const detectors = {
    idle: referenceDetectors(inputs, ['idle']),
    talk: referenceDetectors(inputs, ['talk']),
    walk: referenceDetectors(inputs, ['walk']),
  }
  const poolDetectors = { ...referenceDetectors(inputs, ['idle', 'talk']), acceptedHeadRotationDeg: amplitudeRange(inputs) }
  const context = emotionContext(styles)
  const measured = inputs.map((c) => {
    options.signal.throwIfAborted()
    const params = c.entry.class === 'idle' ? detectors.idle : c.entry.class === 'talk' ? detectors.talk : detectors.walk
    console.info(`MEASURE ${c.input.trace.source.scenario.id}`)
    return measureReference(c, params, { idle: detectors.idle, talk: detectors.talk, shared: poolDetectors })
  })
  const classes: Partial<Record<MotionScenarioClass, ClassBands>> = {}
  const missing: string[] = []
  for (const scenario of ['idle', 'talk', 'walk'] as const) {
    const eligible = inputs.filter(c => c.entry.class === scenario && c.entry.role === 'window' && c.quantities.windows.length > 0)
    const fit = eligible.filter(c => c.entry.split === 'fit').length
    const holdout = eligible.filter(c => c.entry.split === 'holdout').length
    if (fit < 10 || holdout < 3) {
      missing.push(`${scenario}: ${fit} fitting and ${holdout} held-out window clips; need 10 and 3`)
      continue
    }
    classes[scenario] = reportStandingSpeaker(scenario, fitClass(measured, scenario, detectors[scenario], context.lower))
  }
  for (const scenario of ['gaze', 'emotion', 'react'] as const)
    classes[scenario] = fitClass(measured, scenario, poolDetectors, context.lower)
  if (missing.length)
    console.error(missing.join('\n'))
  return {
    kind: 'mmd-motion-bands',
    gate: { id: 'mmd-motion-quality', version: 5 },
    fixture: false,
    builtAt: new Date().toISOString(),
    tool: { gitSha: options.gitSha, rule: 'P5-P50-P95-one-tail-margin' },
    datasets: options.manifest.datasets.map(dataset => ({ ...dataset, clips: options.manifest.clips.filter(c => c.dataset === dataset.id).length })),
    classes,
    context: {
      holdoutValidation: HOLDOUT_VALIDATION,
      standingSpeaker: STANDING_SPEAKER,
      clearOfNeutral: CLEAR_OF_NEUTRAL,
      sidePooling: { ...SIDE_POOLING, pairs: Object.fromEntries((['idle', 'talk', 'walk', 'gaze', 'emotion', 'react'] as const).map(scenario => [scenario, pooledPairs(scenario)])) },
      admission: {
        fixed: options.manifest.clips.length,
        admitted: inputs.length,
        refusals: refusals.map(({ entry, ...refusal }) => ({
          ...refusal,
          dataset: entry.dataset,
          subject: entry.subject,
          class: entry.class,
          split: entry.split,
          role: entry.role,
        })),
      },
      emotionStyles: context,
      longIdle,
      longIdleCoverage: { expected: 4, available: longIdle.length, detail: longIdle.length < 4 ? 'The fixed manifest does not contain four idle ranges of at least 20 s; no clips added or ranges extended.' : '' },
      deskHead: { loopPeak: [0.041, 0.023], top10PathShare: [0.43, 0.57], basis: 'context only, two seated desk sessions' },
      missingClasses: missing,
      limits: ['short reference clips', 'one dominant talk actor', 'episode bootstrap mixes dependent trials and actors', 'declared rules have no fitted human distribution'],
    },
  }
}
