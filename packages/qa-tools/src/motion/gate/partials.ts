import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { EmotionGateScore, EmotionTrialRecord, PlaceboRecord, SeedRange, TrialVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { LivelinessTrace, ParameterRanges } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/liveliness'

import process from 'node:process'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface EmotionCellPartial {
  kind: 'emotion-cell'
  emotion: PerformanceEmotion
  band: Band
  variant: TrialVariant
  seeds: SeedRange
  records: EmotionTrialRecord[]
}

export interface NullPartial {
  kind: 'null'
  seeds: SeedRange
  ranges: ParameterRanges
  records: PlaceboRecord[]
}

export interface LivelinessPartial {
  kind: 'liveliness-trace'
  seed: number
  trace: LivelinessTrace & { ranges: ParameterRanges }
}

/** Scorer validation: the records one generation unit measured (`validation/plan.ts`). */
export interface ValidationRecordsPartial {
  kind: 'validation-records'
  unit: string
  records: EmotionTrialRecord[]
  placebos: PlaceboRecord[]
  ranges: ParameterRanges | null
  /** Determinism units: trials re-measured with shuffled and reversed trace events, and whether every record was equal. */
  eventOrder: { trials: number, invariant: boolean } | null
}

/** Scorer validation: one gate scoring of an experiment. */
export interface ValidationScorePartial {
  kind: 'validation-score'
  job: string
  score: EmotionGateScore
  /** Determinism job: whether scoring the records in reverse order gave the same bytes. */
  recordOrderInvariant: boolean | null
}

export type GatePartial = EmotionCellPartial | NullPartial | LivelinessPartial | ValidationRecordsPartial | ValidationScorePartial

export function requireRunDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.QA_RUN_DIR
  if (!dir)
    throw new Error('[qa-tools] QA_RUN_DIR is not set; run gates through "qa:motion gate".')
  return dir
}

export function writePartial(runDir: string, name: string, partial: GatePartial): void {
  const file = join(runDir, 'partials', name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(partial))
}

export function readPartial<T extends GatePartial>(runDir: string, name: string, kind: T['kind']): T {
  const parsed = JSON.parse(readFileSync(join(runDir, 'partials', name), 'utf8')) as GatePartial
  if (parsed.kind !== kind)
    throw new Error(`[qa-tools] Partial ${name} has kind ${parsed.kind}, expected ${kind}`)
  return parsed as T
}
