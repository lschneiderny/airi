import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { EmotionTrialRecord, PlaceboRecord, SeedRange, TrialVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
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

export type GatePartial = EmotionCellPartial | NullPartial | LivelinessPartial

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
