import type { CatalogEntry } from './catalog'

/** Shortest time in milliseconds before the same pastime is picked again while another one is available. */
export const IDLE_PROP_REPEAT_MS = 900_000

/** An entry the user allowed as a pastime. */
export interface IdlePropCandidate {
  id: string
  label: string
}

/** The pastimes she held before, which keep her from repeating one. */
export interface PastimeHistory {
  readonly lastId: string | null
  /** When each pastime last started, in milliseconds. */
  readonly heldAtMs: Readonly<Record<string, number>>
}

/**
 * Which of the offered pastimes she picks up when Natural's idle draw starts one; `pick` is the draw's uniform in
 * [0, 1). The same pastime is not picked twice in a row, nor within `IDLE_PROP_REPEAT_MS`, while another one is offered.
 * Null when nothing is offered. Natural decides when a pastime starts and how long she keeps it.
 */
export function choosePastime(offered: readonly IdlePropCandidate[], history: PastimeHistory, draw: { nowMs: number, pick: number }): IdlePropCandidate | null {
  if (offered.length === 0)
    return null
  const rested = offered.filter((candidate) => {
    const heldAt = history.heldAtMs[candidate.id]
    return candidate.id !== history.lastId && (heldAt === undefined || draw.nowMs - heldAt >= IDLE_PROP_REPEAT_MS)
  })
  const others = offered.filter(candidate => candidate.id !== history.lastId)
  const pool = rested.length > 0 ? rested : others.length > 0 ? others : offered
  return pool[Math.min(pool.length - 1, Math.floor(draw.pick * pool.length))]
}

/** Whether she may use `entry` on her own in the way `use` names. A reversed switch and a hidden duplicate never qualify. */
function usableOnHerOwn(entry: CatalogEntry, use: 'activity' | 'sleep'): boolean {
  return entry.idleUse === use && entry.inverted !== true && entry.duplicateOf === undefined && entry.kind !== 'system'
}

/** The catalog entries the user allowed as pastimes, in catalog order. */
export function idleActivityEntries(catalog: readonly CatalogEntry[]): IdlePropCandidate[] {
  return catalog.filter(entry => usableOnHerOwn(entry, 'activity')).map(entry => ({ id: entry.id, label: entry.label }))
}

/** The ids of the catalog entries that are on while she sleeps. */
export function idleSleepEntryIds(catalog: readonly CatalogEntry[]): string[] {
  return catalog.filter(entry => usableOnHerOwn(entry, 'sleep')).map(entry => entry.id)
}
