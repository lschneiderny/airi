import type { CatalogEntry } from './catalog'
import type { Occasion } from './occasions'

import { OCCASIONS } from './occasions'

/** Shortest time in milliseconds before the same pastime is picked again while another one is available. */
export const IDLE_PROP_REPEAT_MS = 900_000

/** An entry the user allowed as a pastime. */
export interface IdlePropCandidate {
  id: string
  label: string
  /** The occasions the entry is tagged with; absent when it suits any time. */
  occasions?: readonly Occasion[]
}

/** The pastimes she held before, which keep her from repeating one. */
export interface PastimeHistory {
  readonly lastId: string | null
  /** When each pastime last started, in milliseconds. */
  readonly heldAtMs: Readonly<Record<string, number>>
}

/**
 * Which of the offered pastimes she picks up when Natural's idle draw starts one; `pick` is the draw's uniform in
 * [0, 1) and `occasions` are the occasions that hold now.
 *
 * - An entry tagged with occasions is offered only while one of them holds. An untagged entry is always offered.
 * - The same pastime is not picked twice in a row, nor within `IDLE_PROP_REPEAT_MS`, while another one is offered.
 * - An entry whose occasion holds goes first: she picks among those that pass the repeat rule before any other.
 *
 * Null when nothing is offered. Natural decides when a pastime starts and how long she keeps it.
 */
export function choosePastime(offered: readonly IdlePropCandidate[], history: PastimeHistory, draw: { nowMs: number, pick: number, occasions?: readonly Occasion[] }): IdlePropCandidate | null {
  const fits = (candidate: IdlePropCandidate) => candidate.occasions?.some(occasion => draw.occasions?.includes(occasion)) === true
  const eligible = offered.filter(candidate => candidate.occasions === undefined || fits(candidate))
  if (eligible.length === 0)
    return null
  const rested = eligible.filter((candidate) => {
    const heldAt = history.heldAtMs[candidate.id]
    return candidate.id !== history.lastId && (heldAt === undefined || draw.nowMs - heldAt >= IDLE_PROP_REPEAT_MS)
  })
  const fitting = rested.filter(fits)
  const others = eligible.filter(candidate => candidate.id !== history.lastId)
  const pool = fitting.length > 0 ? fitting : rested.length > 0 ? rested : others.length > 0 ? others : eligible
  return pool[Math.min(pool.length - 1, Math.floor(draw.pick * pool.length))]
}

/** Whether she may use `entry` on her own in the way `use` names. A reversed switch and a hidden duplicate never qualify. */
function usableOnHerOwn(entry: CatalogEntry, use: 'activity' | 'sleep'): boolean {
  return entry.idleUse === use && entry.inverted !== true && entry.duplicateOf === undefined && entry.kind !== 'system'
}

/** The catalog entries the user allowed as pastimes, in catalog order. */
export function idleActivityEntries(catalog: readonly CatalogEntry[]): IdlePropCandidate[] {
  return catalog.filter(entry => usableOnHerOwn(entry, 'activity')).map(entry => ({
    id: entry.id,
    label: entry.label,
    ...entry.occasions?.length ? { occasions: entry.occasions } : {},
  }))
}

/** The labels of the pastime entries tagged with each occasion, for a view of what a rig can show when. */
export function occasionCoverage(catalog: readonly CatalogEntry[]): Record<Occasion, string[]> {
  const coverage = Object.fromEntries(OCCASIONS.map(occasion => [occasion, [] as string[]])) as Record<Occasion, string[]>
  for (const candidate of idleActivityEntries(catalog)) {
    for (const occasion of candidate.occasions ?? [])
      coverage[occasion].push(candidate.label)
  }
  return coverage
}

/** The ids of the catalog entries that are on while she sleeps. */
export function idleSleepEntryIds(catalog: readonly CatalogEntry[]): string[] {
  return catalog.filter(entry => usableOnHerOwn(entry, 'sleep')).map(entry => entry.id)
}
