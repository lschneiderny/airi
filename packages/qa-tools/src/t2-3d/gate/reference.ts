import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { ReferenceManifest } from '../reference/manifest'
import type { StylePosture } from './reference-context'
import type { ReferenceInput } from './reference-measure'
import type { ClassBands, MotionBandsFile } from './types'

import { prepareTrace } from '../metrics'
import { parseTrace } from '../read-trace'
import { ingestClip } from '../reference/ingest'
import { emotionContext, idleLoopContext, stylePosture } from './reference-context'
import { fitClass } from './reference-fit'
import { amplitudeRange, measureReference, referenceDetectors, referenceInput } from './reference-measure'
import { checkKinematics } from './refusals'

export interface ReferenceBuild {
  readonly directory: string
  readonly manifest: ReferenceManifest
  readonly gitSha: string
  readonly signal: AbortSignal
}

/** Manifest order is preserved for both fitting and held-out episode groups. */
export async function buildReference(options: ReferenceBuild): Promise<MotionBandsFile> {
  const inputs: ReferenceInput[] = []
  const styles = new Map<string, StylePosture>()
  const longIdle: { clipSha256: string, seconds: number, loopPeak: Readonly<Record<string, number | null>> }[] = []
  for (const entry of options.manifest.clips) {
    options.signal.throwIfAborted()
    const input = parseTrace(await ingestClip(options.directory, entry))
    checkKinematics(input, entry.role === 'episode-only' ? 0 : undefined)
    const c = referenceInput(entry, input)
    inputs.push(c)
    console.info(`INGEST ${input.trace.source.scenario.id} ${entry.split} ${entry.role} ${c.seconds.toFixed(6)}s ACCEPTED`)
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
    classes[scenario] = fitClass(measured, scenario, detectors[scenario], context.lower)
  }
  for (const scenario of ['gaze', 'emotion', 'react'] as const)
    classes[scenario] = fitClass(measured, scenario, poolDetectors, context.lower)
  if (missing.length)
    console.error(missing.join('\n'))
  return {
    kind: 'mmd-motion-bands',
    gate: { id: 'mmd-motion-quality', version: 1 },
    fixture: false,
    builtAt: new Date().toISOString(),
    tool: { gitSha: options.gitSha, rule: 'P5-P50-P95-one-tail-margin' },
    datasets: options.manifest.datasets.map(dataset => ({ ...dataset, clips: options.manifest.clips.filter(c => c.dataset === dataset.id).length })),
    classes,
    context: {
      emotionStyles: context,
      longIdle,
      longIdleCoverage: { expected: 4, available: longIdle.length, detail: longIdle.length < 4 ? 'The fixed manifest does not contain four idle ranges of at least 20 s; no clips added or ranges extended.' : '' },
      deskHead: { loopPeak: [0.041, 0.023], top10PathShare: [0.43, 0.57], basis: 'context only, two seated desk sessions' },
      missingClasses: missing,
      limits: ['short reference clips', 'one dominant talk actor', 'episode bootstrap mixes dependent trials and actors', 'declared rules have no fitted human distribution'],
    },
  }
}
