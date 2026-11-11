import type { MotionBandsFile } from './types'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { MOTION_TRACE_BONES } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

import { motionQualityGate } from './definition'
import { GateRefusal } from './refusals'

const finite = v.pipe(v.number(), v.finite())
const nullable = v.nullable(finite)
const bandSchema = v.object({
  side: v.picklist(['two', 'lower', 'upper']),
  domain: v.strictTuple([nullable, nullable]),
  transform: v.picklist(['none', 'fisher-z']),
  unit: v.picklist(['clip', 'episode']),
  basis: v.picklist(['fitted', 'declared']),
  status: v.picklist(['GATED', 'REPORT']),
  detail: v.string(),
  n: finite,
  p5: nullable,
  p50: nullable,
  p95: nullable,
  lo: nullable,
  hi: nullable,
  exclusiveHi: v.optional(v.boolean()),
  rule: v.optional(v.string()),
  source: v.optional(v.string()),
  episodeCounts: v.optional(v.record(v.string(), finite)),
  heldoutEpisodeCounts: v.optional(v.record(v.string(), finite)),
  heldoutEpisodes: v.optional(finite),
})
const classSchema = v.object({
  floors: v.record(v.picklist(MOTION_TRACE_BONES), finite),
  moveSpeed: v.object({ body: finite, head: finite, trunk: finite, armL: finite, armR: finite, legs: finite }),
  acceptedHeadRotationDeg: v.optional(v.strictTuple([finite, finite])),
  window: v.object({ seconds: finite, hopSeconds: finite }),
  fit: v.array(v.object({ clipSha256: v.string(), dataset: v.string(), subject: v.string(), seconds: finite, hasFingers: v.boolean() })),
  holdout: v.array(v.object({ clipSha256: v.optional(v.string()), dataset: v.optional(v.string()), subject: v.optional(v.string()), group: v.optional(finite), metric: v.optional(v.string()), value: v.optional(finite), verdict: v.picklist(['PASS', 'FAIL']), failed: v.array(v.string()), values: v.optional(v.record(v.string(), nullable)) })),
  metrics: v.record(v.string(), bandSchema),
})
const bandsSchema = v.object({
  kind: v.literal('mmd-motion-bands'),
  gate: v.object({ id: v.literal('mmd-motion-quality'), version: finite }),
  fixture: v.boolean(),
  builtAt: v.string(),
  tool: v.object({ gitSha: v.string(), rule: v.literal('P5-P50-P95-one-tail-margin') }),
  datasets: v.array(v.object({ id: v.string(), licence: v.string(), url: v.string(), clips: finite })),
  classes: v.partial(v.object({ idle: classSchema, talk: classSchema, walk: classSchema, gaze: classSchema, emotion: classSchema, react: classSchema })),
  context: v.record(v.string(), v.unknown()),
}) satisfies v.GenericSchema<MotionBandsFile>

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const definitionSha256 = sha256(readFileSync(new URL('./definition.ts', import.meta.url)))

export function parseBands(input: unknown): MotionBandsFile {
  return v.parse(bandsSchema, input)
}

export async function loadBands(repoRoot: string): Promise<MotionBandsFile> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(resolve(repoRoot, motionQualityGate.bandsFile))
  }
  catch (error) {
    if (error instanceof Error)
      throw new GateRefusal('bands-hash-mismatch', `Cannot read the committed bands: ${error.message}`)
    throw error
  }
  if (sha256(bytes) !== motionQualityGate.bandsSha256)
    throw new GateRefusal('bands-hash-mismatch', 'Bands bytes differ from the committed gate definition')
  const bands = parseBands(JSON.parse(new TextDecoder().decode(bytes)))
  if (bands.gate.version !== motionQualityGate.version)
    throw new GateRefusal('bands-hash-mismatch', 'Bands version differs from the committed gate definition')
  return bands
}
