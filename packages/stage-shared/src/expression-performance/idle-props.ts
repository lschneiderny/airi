import type { CatalogEntry } from './catalog'

import { nextRandom, seedRng } from '../situation/rng'

/** Mean free time in milliseconds between two pastimes, at a pace of 1. */
export const IDLE_PROP_MEAN_GAP_MS = 360_000

/** Shortest time in milliseconds from the end of one pastime, or from the first free moment, to the next start. */
export const IDLE_PROP_REST_MS = 120_000

/** How long she keeps a pastime, in milliseconds: the bounds of the uniform draw. */
export const IDLE_PROP_HOLD_MS = Object.freeze({ min: 90_000, max: 300_000 })

/** Shortest time in milliseconds before the same pastime is picked again while another one is available. */
export const IDLE_PROP_REPEAT_MS = 900_000

/** Longest step in milliseconds that counts toward the urge, so a paused stage starts nothing the moment it resumes. */
const MAX_STEP_MS = 1_000

/** An entry the user allowed as a pastime. */
export interface IdlePropCandidate {
  id: string
  label: string
}

export interface IdlePropInput {
  /** Milliseconds supplied by the caller; this module never reads a clock. */
  nowMs: number
  /** The pastimes she can hold now: allowed by the user, present on the model, and not already switched on. */
  activities: readonly IdlePropCandidate[]
  /**
   * She is free for a pastime: idle or watching, the user present, nobody speaking. A pastime in progress ends as
   * soon as this is false, so she puts it away to talk and before she sleeps.
   */
  free: boolean
  /** Multiplies how often pastimes start; 0 starts none and lets a running one finish. */
  pace: number
  seed: number
}

/** The pastime in progress. */
export interface IdlePropCurrent extends IdlePropCandidate {
  sinceMs: number
  untilMs: number
}

/** State supplied to the next call. */
export interface IdlePropMemory {
  readonly nowMs: number | null
  /** Hazard accumulated over free time since the last pastime. */
  readonly urge: number
  /** The `Exp(1)` draw the urge must cross, or null until the next free step draws it. */
  readonly threshold: number | null
  readonly restUntilMs: number
  readonly current: IdlePropCurrent | null
  readonly lastId: string | null
  /** When each pastime last started. */
  readonly heldAtMs: Readonly<Record<string, number>>
  /** Mulberry32 checkpoint advanced after every draw; null until seeded from the input. */
  readonly rngState: number | null
}

export const initialIdlePropMemory: IdlePropMemory = Object.freeze({
  nowMs: null,
  urge: 0,
  threshold: null,
  restUntilMs: 0,
  current: null,
  lastId: null,
  heldAtMs: Object.freeze({}),
  rngState: null,
})

export interface IdlePropDecision {
  memory: IdlePropMemory
  /** She picked this pastime up in this call. */
  started: IdlePropCandidate | null
  /** She put this pastime away in this call: its time was up, or something claimed her. */
  ended: (IdlePropCandidate & { reason: 'done' | 'interrupted' }) | null
}

/**
 * Decides when the character picks up one of her own props as a pastime and when she puts it away.
 *
 * - Starts follow a hazard over free time: the urge grows by `pace / IDLE_PROP_MEAN_GAP_MS` per free millisecond and a
 *   pastime starts when it crosses an `Exp(1)` draw. Time that is not free does not count.
 * - A pastime lasts 90 to 300 s. It ends early when she stops being free or when its entry is no longer offered.
 * - After every pastime, and after the first call, she rests for `IDLE_PROP_REST_MS` before the urge grows again.
 * - The same pastime is not picked twice in a row, nor within `IDLE_PROP_REPEAT_MS`, while another one is offered.
 * - A call never ends one pastime and starts another.
 *
 * Call it about once a second with the returned memory. Same memory and input give the same decision.
 */
export function decideIdleProp(memory: IdlePropMemory, input: IdlePropInput): IdlePropDecision {
  const { nowMs } = input
  if (!Number.isFinite(nowMs))
    return { memory, started: null, ended: null }
  const step = memory.nowMs === null ? 0 : Math.max(0, Math.min(MAX_STEP_MS, nowMs - memory.nowMs))
  let rngState = memory.rngState ?? seedRng(input.seed)
  const draw = () => {
    const [value, next] = nextRandom(rngState)
    rngState = next
    return value
  }
  // The first call starts the rest, so she does not pick something up the moment the stage opens.
  const base = { ...memory, nowMs, restUntilMs: memory.nowMs === null ? nowMs + IDLE_PROP_REST_MS : memory.restUntilMs }

  const { current } = memory
  if (current !== null) {
    const offered = input.activities.some(candidate => candidate.id === current.id)
    const done = nowMs >= current.untilMs
    if (!done && input.free && offered)
      return { memory: { ...base, rngState }, started: null, ended: null }
    return {
      memory: { ...base, current: null, urge: 0, threshold: null, restUntilMs: nowMs + IDLE_PROP_REST_MS, rngState },
      started: null,
      ended: { id: current.id, label: current.label, reason: done ? 'done' : 'interrupted' },
    }
  }

  const pace = Number.isFinite(input.pace) ? Math.max(0, input.pace) : 0
  if (!input.free || pace === 0 || input.activities.length === 0 || nowMs < base.restUntilMs)
    return { memory: { ...base, rngState }, started: null, ended: null }

  const threshold = memory.threshold ?? -Math.log(1 - draw())
  const urge = memory.urge + pace * step / IDLE_PROP_MEAN_GAP_MS
  if (urge < threshold)
    return { memory: { ...base, urge, threshold, rngState }, started: null, ended: null }

  const rested = input.activities.filter((candidate) => {
    const heldAt = memory.heldAtMs[candidate.id]
    return candidate.id !== memory.lastId && (heldAt === undefined || nowMs - heldAt >= IDLE_PROP_REPEAT_MS)
  })
  const others = input.activities.filter(candidate => candidate.id !== memory.lastId)
  const pool = rested.length > 0 ? rested : others.length > 0 ? others : input.activities
  const picked = pool[Math.min(pool.length - 1, Math.floor(draw() * pool.length))]
  const untilMs = nowMs + IDLE_PROP_HOLD_MS.min + (IDLE_PROP_HOLD_MS.max - IDLE_PROP_HOLD_MS.min) * draw()
  return {
    memory: {
      ...base,
      urge: 0,
      threshold: null,
      current: { id: picked.id, label: picked.label, sinceMs: nowMs, untilMs },
      lastId: picked.id,
      heldAtMs: { ...memory.heldAtMs, [picked.id]: nowMs },
      rngState,
    },
    started: { id: picked.id, label: picked.label },
    ended: null,
  }
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
