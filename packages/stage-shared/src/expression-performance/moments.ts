import type { InferOutput } from 'valibot'

import type { CatalogEntry } from './catalog'

import { picklist } from 'valibot'

/**
 * A moment that something in the app already marks and that lasts seconds: the user comes back, she looks over, a
 * touch, a yawn. She may mark it with one of her own expressions for as long as it lasts, such as a wink when she
 * looks over or puffed cheeks after a poke. The list is fixed and knows no rig; the user tags a rig's entries with
 * the moments they suit.
 *
 * An occasion (`./occasions`) is the counterpart for stretches of minutes, and gates pastimes.
 */
export const MomentSchema = picklist(['welcome-back', 'check-in', 'held-back', 'waking', 'petted', 'poked', 'yawning', 'zoning-out', 'peering'])
export type Moment = InferOutput<typeof MomentSchema>
export const MOMENTS: readonly Moment[] = MomentSchema.options

export const MOMENT_SETTINGS = Object.freeze({
  /** Share of moments she marks, so an expression stays an occasional touch and not a reflex. */
  chance: 0.6,
  /** Shortest time in milliseconds before the same entry marks a moment again. */
  entryRestMs: 60_000,
  /** Longest time in milliseconds an entry stays on for a moment that lasts as long as its act. */
  actCapMs: 20_000,
})

/**
 * How long she keeps the expression, in milliseconds. `act` moments belong to an idle act of the Natural driver and
 * last until the act ends; the others are over as they happen, so the expression lingers for a fixed time.
 */
export const MOMENT_HOLD_MS: Readonly<Record<Moment, number | 'act'>> = Object.freeze({
  'welcome-back': 5000,
  'check-in': 'act',
  'held-back': 4000,
  'waking': 6000,
  'petted': 5000,
  'poked': 3000,
  'yawning': 'act',
  'zoning-out': 'act',
  'peering': 'act',
})

/** An entry the user allowed for moments. */
export interface MomentCandidate {
  id: string
  label: string
  moments: readonly Moment[]
}

/** When each entry last marked a moment, in milliseconds. */
export type MomentHistory = Readonly<Record<string, number>>

/**
 * The catalog entries tagged with at least one moment, in catalog order. A reversed switch, a hidden duplicate and a
 * system entry never qualify, as for a pastime.
 */
export function momentEntries(catalog: readonly CatalogEntry[]): MomentCandidate[] {
  return catalog
    .filter(entry => (entry.moments?.length ?? 0) > 0 && entry.inverted !== true && entry.duplicateOf === undefined && entry.kind !== 'system')
    .map(entry => ({ id: entry.id, label: entry.label, moments: entry.moments! }))
}

/**
 * The entry she marks `moment` with, or null when she lets it pass. `chance` and `pick` are uniforms in [0, 1).
 *
 * - She marks a moment when `chance` falls under `MOMENT_SETTINGS.chance`; `force` skips that and the rest below,
 *   for a preview.
 * - An entry that marked a moment within `entryRestMs` is not offered, so the same wink does not follow every look.
 * - Among the rest the pick is uniform.
 */
export function chooseMomentEntry(offered: readonly MomentCandidate[], moment: Moment, history: MomentHistory, draw: { nowMs: number, chance: number, pick: number, force?: boolean }): MomentCandidate | null {
  const fitting = offered.filter(candidate => candidate.moments.includes(moment))
  if (!draw.force && draw.chance >= MOMENT_SETTINGS.chance)
    return null
  const pool = draw.force
    ? fitting
    : fitting.filter(candidate => history[candidate.id] === undefined || draw.nowMs - history[candidate.id] >= MOMENT_SETTINGS.entryRestMs)
  if (pool.length === 0)
    return null
  return pool[Math.min(pool.length - 1, Math.floor(draw.pick * pool.length))]
}

/** The labels of the entries tagged with each moment, for a view of what a rig can show when. */
export function momentCoverage(catalog: readonly CatalogEntry[]): Record<Moment, string[]> {
  const coverage = Object.fromEntries(MOMENTS.map(moment => [moment, [] as string[]])) as Record<Moment, string[]>
  for (const candidate of momentEntries(catalog)) {
    for (const moment of candidate.moments)
      coverage[moment].push(candidate.label)
  }
  return coverage
}
