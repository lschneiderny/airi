import type { MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { ReferenceClip, ReferenceManifest } from '../reference/manifest'
import type { ReferenceInput } from './reference-measure'

import { basename } from 'node:path'

import { MotionTraceRefusal, parseTrace } from '../read-trace'
import { ReferenceRefusal } from '../reference/bvh'
import { ingestClip } from '../reference/ingest'
import { referenceInput } from './reference-measure'
import { checkKinematics, GateRefusal } from './refusals'

export interface SourceRefusal {
  readonly entry: ReferenceClip
  readonly clipSha256: string | null
  readonly name: string
  readonly detail: string
}

/** Named source refusals are preserved; the fixed manifest is never rewritten. */
export async function admitReferences(directory: string, manifest: ReferenceManifest, signal: AbortSignal): Promise<{
  readonly inputs: readonly ReferenceInput[]
  readonly refusals: readonly SourceRefusal[]
}> {
  const inputs: ReferenceInput[] = []
  const refusals: SourceRefusal[] = []
  for (const entry of manifest.clips) {
    signal.throwIfAborted()
    let converted: MotionTraceV1 | undefined
    try {
      converted = await ingestClip(directory, entry)
      const input = parseTrace(converted)
      checkKinematics(input, entry.role === 'episode-only' ? 0 : undefined)
      const c = referenceInput(entry, input)
      inputs.push(c)
      console.info(`INGEST ${input.trace.source.scenario.id} ${entry.split} ${entry.role} ${c.seconds.toFixed(6)}s ACCEPTED`)
    }
    catch (error) {
      if (!(error instanceof ReferenceRefusal) && !(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
        throw error
      refusals.push({ entry, clipSha256: converted?.rig.assetSha256 ?? null, name: error.name, detail: error.detail })
      console.info(`INGEST ${entry.dataset}:${basename(entry.file, '.bvh')} ${entry.split} ${entry.role} REFUSED ${error.name}: ${error.detail}`)
    }
  }
  return { inputs, refusals }
}
