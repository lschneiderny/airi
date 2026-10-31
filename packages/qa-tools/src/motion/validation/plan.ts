import type { HeldSpec } from '@proj-airi/motion-driver-natural/emotions'
import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { EmotionGate, SeedRange, TrialVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { gateBands, gateEmotions, longHoldBands, seedRange, variantsFor } from '../gate/options'

/**
 * The scorer validation protocol (qa-tooling todo 13): which runs to simulate and which gate scorings to compute.
 * Every mutation goes through a seam (`emotionTable`, or scenario `settings.performance`), never a source edit.
 */

export const validationSections = ['aa', 'zero', 'mutations', 'unmutated', 'determinism'] as const
export type ValidationSection = typeof validationSections[number]

export const mutationIds = ['x0', 'sign-flip', 'ignore-side', 'ignore-side-neg', 'x0.5', 'x2', 'release-tau-x3', 'blink-interval-1'] as const
export type MutationId = typeof mutationIds[number]
export type TableId = 'natural' | 'zero' | Exclude<MutationId, 'release-tau-x3'>

export interface ValidationOptions {
  sections: readonly ValidationSection[]
  /** Upper bound on seeds per range (`--seeds N`), a reduced run that `validation.json` records. */
  seedsLimit: number | null
}

/** Independent A/A seed sets, and the number of reseeded unmutated gate runs. */
export const aaSetCount = 20
export const unmutatedSetCount = 5
/** Mutations and the zero-recipe run use the seeds of unmutated set 1, which is also their baseline. */
export const mutationSeedSet = 1
const determinismSeedCap = 10

export interface CellSpec {
  emotion: PerformanceEmotion
  band: Band
  variant: TrialVariant
}

export interface SeedSet {
  full: SeedRange
  heldOnly: SeedRange
  longHold: SeedRange
}

export type Experiment
  = | { id: string, kind: 'aa', set: number, seeds: SeedRange, nullPool: string }
    | { id: string, kind: 'gate', table: TableId, held: Record<string, number> | null, cells: CellSpec[], seeds: SeedSet, nullPool: string, mutation: MutationId | null }

export type GenerationUnit
  = | { name: string, kind: 'null', pool: string, seeds: SeedRange }
    | { name: string, kind: 'aa', experiment: string, seeds: SeedRange }
    | { name: string, kind: 'cell', experiment: string, cell: CellSpec, seeds: SeedRange, checkEventOrder: boolean }

export interface ScoringJob {
  name: string
  experiment: string
  /** Also score the records in reverse order and compare the bytes. */
  checkRecordOrder: boolean
}

export interface ValidationPlan {
  experiments: Experiment[]
  nullPools: Record<string, SeedRange>
  units: GenerationUnit[]
  jobs: ScoringJob[]
}

function allCells(variants?: readonly TrialVariant[], emotions: readonly PerformanceEmotion[] = gateEmotions): CellSpec[] {
  return emotions.flatMap(emotion => gateBands.flatMap(band => variantsFor(band).filter(variant => !variants || variants.includes(variant)).map(variant => ({ emotion, band, variant }))))
}

const heldOf = (emotion: PerformanceEmotion): HeldSpec => naturalEmotions[emotion].held!
const sidedEmotions = gateEmotions.filter(emotion => heldOf(emotion).sided.length > 0)
const blinkEmotions = gateEmotions.filter(emotion => heldOf(emotion).modulation.blinkInterval !== 1)

/** Seed ranges of reseeded set `k` (k >= 1): start `1000 k + 1`, the committed counts. */
function seedSet(gate: EmotionGate, set: number, limit: number | null): SeedSet {
  const start = 1000 * set + 1
  return {
    full: seedRange({ start, count: gate.seeds.full.count }, limit),
    heldOnly: seedRange({ start, count: gate.seeds.heldOnly.count }, limit),
    longHold: seedRange({ start, count: gate.seeds.longHold.count }, limit),
  }
}

const seedsFor = (seeds: SeedSet, variant: TrialVariant) => variant === 'full' ? seeds.full : variant === 'held-only' ? seeds.heldOnly : seeds.longHold

/** Splits a seed range into chunks of at most `size`, so long ranges spread over shards. */
function chunks(range: SeedRange, size: number): SeedRange[] {
  const result: SeedRange[] = []
  for (let offset = 0; offset < range.count; offset += size)
    result.push({ start: range.start + offset, count: Math.min(size, range.count - offset) })
  return result
}

function mutationCells(mutation: MutationId): CellSpec[] {
  switch (mutation) {
    case 'x0':
      return allCells(['full', 'held-only', 'long-hold'])
    case 'sign-flip':
      return allCells(['full', 'long-hold'])
    case 'ignore-side':
    case 'ignore-side-neg':
      return allCells(['full'], sidedEmotions)
    case 'x0.5':
    case 'x2':
    case 'release-tau-x3':
      return allCells(['held-only'])
    case 'blink-interval-1':
      return blinkEmotions.flatMap(emotion => longHoldBands.map(band => ({ emotion, band, variant: 'long-hold' as const })))
  }
}

export function buildValidationPlan(gate: EmotionGate, options: ValidationOptions): ValidationPlan {
  const { sections, seedsLimit } = options
  const experiments: Experiment[] = []
  const nullPools: Record<string, SeedRange> = {}
  const setNull = (set: number) => {
    const id = `null-set${set}`
    nullPools[id] = seedSet(gate, set, seedsLimit).full
    return id
  }

  if (sections.includes('aa')) {
    nullPools['null-committed'] = seedRange(gate.seeds.full, seedsLimit)
    for (let set = 0; set < aaSetCount; set++)
      experiments.push({ id: `aa-${set}`, kind: 'aa', set, seeds: seedRange({ start: 100_001 + 1000 * set, count: gate.seeds.full.count }, seedsLimit), nullPool: 'null-committed' })
  }
  if (sections.includes('unmutated')) {
    for (let set = 1; set <= unmutatedSetCount; set++)
      experiments.push({ id: `unmutated-${set}`, kind: 'gate', table: 'natural', held: null, cells: allCells(), seeds: seedSet(gate, set, seedsLimit), nullPool: setNull(set), mutation: null })
  }
  const mutationSeeds = seedSet(gate, mutationSeedSet, seedsLimit)
  if (sections.includes('zero'))
    experiments.push({ id: 'zero', kind: 'gate', table: 'zero', held: null, cells: allCells(['full', 'long-hold']), seeds: mutationSeeds, nullPool: setNull(mutationSeedSet), mutation: null })
  if (sections.includes('mutations')) {
    for (const mutation of mutationIds) {
      experiments.push({
        id: `mutation-${mutation}`,
        kind: 'gate',
        table: mutation === 'release-tau-x3' ? 'natural' : mutation,
        held: mutation === 'release-tau-x3' ? { releaseTau: 3 * defaultExpressionPerformanceSettings.held.releaseTau } : null,
        cells: mutationCells(mutation),
        seeds: mutationSeeds,
        nullPool: setNull(mutationSeedSet),
        mutation,
      })
    }
  }
  if (sections.includes('determinism')) {
    const limit = Math.min(seedsLimit ?? determinismSeedCap, determinismSeedCap)
    for (const copy of ['a', 'b']) {
      const cells = variantsFor('strong').map(variant => ({ emotion: 'angry' as const, band: 'strong' as const, variant }))
      experiments.push({ id: `determinism-${copy}`, kind: 'gate', table: 'natural', held: null, cells, seeds: seedSet(gate, mutationSeedSet, limit), nullPool: setNull(mutationSeedSet), mutation: null })
    }
  }

  const units: GenerationUnit[] = Object.entries(nullPools).flatMap(([pool, range]) =>
    chunks(range, 25).map((seeds, index) => ({ name: `null-${pool}-${index}`, kind: 'null' as const, pool, seeds })))
  for (const experiment of experiments) {
    if (experiment.kind === 'aa') {
      chunks(experiment.seeds, 25).forEach((seeds, index) => units.push({ name: `aa-${experiment.id}-${index}`, kind: 'aa', experiment: experiment.id, seeds }))
      continue
    }
    for (const cell of experiment.cells) {
      units.push({
        name: `cell-${experiment.id}-${cell.emotion}-${cell.band}-${cell.variant}`,
        kind: 'cell',
        experiment: experiment.id,
        cell,
        seeds: seedsFor(experiment.seeds, cell.variant),
        checkEventOrder: experiment.id === 'determinism-a',
      })
    }
  }
  const jobs = experiments.map(experiment => ({ name: `score-${experiment.id}`, experiment: experiment.id, checkRecordOrder: experiment.id === 'determinism-a' }))
  return { experiments, nullPools, units, jobs }
}

/** Relative simulation cost of a unit (simulated seconds), for balancing shards. */
export function unitCost(unit: GenerationUnit, gate: EmotionGate): number {
  const { warmup, hold, post, longHoldSeconds, longHoldPost, placeboSpacing } = gate.scenario
  if (unit.kind === 'null')
    return unit.seeds.count * (warmup + gate.placeboPerNullRun * placeboSpacing)
  if (unit.kind === 'aa')
    return unit.seeds.count * (warmup + hold + post)
  return unit.seeds.count * 2 * (unit.cell.variant === 'long-hold' ? warmup + longHoldSeconds + longHoldPost : warmup + hold + post)
}

/** Longest-processing-time assignment: deterministic, and close to balanced for many small items. */
export function assignShards<T>(items: readonly T[], shards: number, cost: (item: T) => number): T[][] {
  const result = Array.from({ length: shards }, () => [] as T[])
  const load = Array.from<number>({ length: shards }).fill(0)
  const order = items.map((item, index) => ({ item, index, cost: cost(item) })).sort((a, b) => b.cost - a.cost || a.index - b.index)
  for (const { item, cost: itemCost } of order) {
    const target = load.indexOf(Math.min(...load))
    result[target].push(item)
    load[target] += itemCost
  }
  return result
}

const multiplierKeys = ['blinkInterval', 'breathPeriod', 'amplitude', 'nodSize'] as const
const additiveModulationKeys = ['cameraFixation', 'deskWeight', 'nodAcceptance'] as const
const additiveFaceKeys = ['browY', 'browAngle', 'oneSidedBrow', 'eyeSmile', 'mouthForm', 'eyeOpenHint', 'cheek', 'mouthOpen'] as const

/** Scales every held amount about its rest value: additive entries by `factor`, multipliers as `1 + (m - 1) factor`. */
function scaleHeld(held: HeldSpec, factor: number): void {
  for (const key of additiveFaceKeys) {
    if (held.face[key] !== undefined)
      held.face[key] = held.face[key]! * factor
  }
  held.face.eyeOpenMultiplier = 1 + (held.face.eyeOpenMultiplier - 1) * factor
  held.posture = [held.posture[0] * factor, held.posture[1] * factor, held.posture[2] * factor]
  for (const key of multiplierKeys)
    held.modulation[key] = 1 + (held.modulation[key] - 1) * factor
  for (const key of additiveModulationKeys)
    held.modulation[key] *= factor
}

/** Flips every held direction: additive entries negate, multipliers invert, so each log ratio changes sign. */
function flipHeld(held: HeldSpec): void {
  for (const key of additiveFaceKeys) {
    if (held.face[key] !== undefined)
      held.face[key] = -held.face[key]!
  }
  held.face.eyeOpenMultiplier = 1 / held.face.eyeOpenMultiplier
  held.posture = [-held.posture[0], -held.posture[1], -held.posture[2]]
  for (const key of multiplierKeys)
    held.modulation[key] = 1 / held.modulation[key]
  for (const key of additiveModulationKeys)
    held.modulation[key] = -held.modulation[key]
}

/** The emotion table a run uses: the committed table, every value zeroed, or one mutation of the held recipes. */
export function emotionTableFor(table: TableId): typeof naturalEmotions {
  if (table === 'natural')
    return naturalEmotions
  const result = structuredClone(naturalEmotions)
  for (const spec of Object.values(result)) {
    const held = spec.held
    if (table === 'zero') {
      spec.mood = [0, 0, 0]
      delete spec.gesture
      // No impulse at all, as for neutral: a zero head direction has no unit vector for the body lean.
      delete spec.impulse
      if (held)
        scaleHeld(held, 0)
      continue
    }
    if (!held)
      continue
    switch (table) {
      case 'x0':
        scaleHeld(held, 0)
        break
      case 'x0.5':
        scaleHeld(held, 0.5)
        break
      case 'x2':
        scaleHeld(held, 2)
        break
      case 'sign-flip':
        flipHeld(held)
        break
      case 'ignore-side':
        held.sided = []
        break
      case 'ignore-side-neg':
        for (const axis of held.sided)
          held.posture[axis] = -held.posture[axis]
        held.sided = []
        break
      case 'blink-interval-1':
        held.modulation.blinkInterval = 1
        break
    }
  }
  return result
}
