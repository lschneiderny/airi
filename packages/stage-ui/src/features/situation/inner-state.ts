import type { RitualDay, SavedGateMemory, Thread } from '@proj-airi/stage-shared/situation'

import { errorMessageFrom } from '@moeru/std'
import { logicalDayKey, THREAD_CUE_MAX_CHARS, THREAD_SUMMARY_MAX_CHARS } from '@proj-airi/stage-shared/situation'
import { isPlainObject } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, check, custom, finite, integer, literal, maxLength, maxValue, minValue, nullable, number, optional, parse, picklist, pipe, safeParse, strictObject, string, unknown } from 'valibot'

const time = pipe(number(), finite())
const nullableTime = nullable(time)
const count = pipe(number(), integer(), minValue(0))

const ThreadSchema = strictObject({
  id: string(),
  topicKey: custom<`thread:${string}`>(value => typeof value === 'string' && value.startsWith('thread:'), 'Expected a thread topic key'),
  sessionId: string(),
  kind: picklist(['question', 'event', 'later', 'topic']),
  summary: pipe(string(), maxLength(THREAD_SUMMARY_MAX_CHARS)),
  cue: pipe(string(), maxLength(THREAD_CUE_MAX_CHARS)),
  bornAtMs: time,
  dueAtMs: nullableTime,
  raisedCount: count,
  lastRaisedAtMs: nullableTime,
  expiresAtMs: time,
})

const ritualState = picklist(['open', 'done', 'expired'])

const RitualDaySchema = strictObject({
  dayKey: string(),
  firstPresentAtMs: nullableTime,
  lastAwayEndedAtMs: nullableTime,
  states: strictObject({ 'greeting': ritualState, 'sign-off': ritualState, 'welcome-back': ritualState }),
  windowOpenedAtMs: strictObject({ 'greeting': nullableTime, 'sign-off': nullableTime, 'welcome-back': nullableTime }),
})

const SavedGateMemorySchema = strictObject({
  lastFireAtMs: nullableTime,
  lastSpokenAtMs: nullableTime,
  unanswered: count,
  awaitingSinceMs: nullableTime,
  damp: nullable(strictObject({ depth: pipe(number(), minValue(0), maxValue(1)), sinceMs: time })),
  day: nullable(RitualDaySchema),
  lastOwnDayAtMs: nullableTime,
  /** Mulberry32 checkpoint, a uint32. */
  rngState: pipe(number(), integer(), minValue(0), maxValue(0xFFFFFFFF)),
})

const innerStateEntries = {
  v: optional(literal(1), 1),
  /** Open threads of every chat session; the gate filters them by session. */
  threads: optional(array(ThreadSchema), () => []),
  /** The ritual day the reason collector reads. */
  rituals: optional(nullable(RitualDaySchema), null),
  /** The gate's social memory; everything else in the gate memory restarts at promotion. */
  gate: optional(nullable(SavedGateMemorySchema), null),
  /** Per chat session, the newest message that thread extraction read, so the next extraction starts after it. */
  extractedThrough: optional(array(strictObject({ sessionId: string(), messageId: string() })), () => []),
  /** Epoch milliseconds of the last write; 0 when nothing was saved. */
  savedAtMs: optional(time, 0),
}

// Valibot objects accept arrays; the stored document must be a record.
const SavedInnerStateSchema = pipe(unknown(), check(isPlainObject, 'Expected an inner state object'), strictObject(innerStateEntries))

/** Durable inner state of the unprompted gate, as stored. The schema's output must stay assignable to it. */
export interface SavedInnerState {
  readonly v: 1
  readonly threads: readonly Thread[]
  readonly rituals: RitualDay | null
  readonly gate: SavedGateMemory | null
  readonly extractedThrough: readonly ExtractionReadPosition[]
  readonly savedAtMs: number
}

/** The id of the newest message of one chat session that thread extraction read. */
export interface ExtractionReadPosition {
  readonly sessionId: string
  readonly messageId: string
}

export type SavedInnerStatePatch = Partial<Pick<SavedInnerState, 'threads' | 'rituals' | 'gate' | 'extractedThrough'>>

export function defaultSavedInnerState(): SavedInnerState {
  return parse(SavedInnerStateSchema, {})
}

/**
 * localStorage is outside the app's control, so each stored field is validated on its own: an invalid field falls
 * back to its default while valid siblings survive, and unknown fields are dropped.
 */
function readStoredInnerState(raw: string): SavedInnerState {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    stored = undefined
  }
  if (!isPlainObject(stored)) {
    console.warn('[situation-inner] Stored inner state is not an object; using defaults')
    return defaultSavedInnerState()
  }

  const document: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const [field, schema] of Object.entries(innerStateEntries)) {
    const result = safeParse(schema, stored[field])
    if (result.success)
      document[field] = result.output
    else
      invalid.push(field)
  }
  if (invalid.length > 0)
    console.warn('[situation-inner] Invalid stored fields reset to defaults:', invalid.join(', '))
  return parse(SavedInnerStateSchema, document)
}

/** The logical day (04:00 rollover) of `nowMs` in the host's local time zone. */
export function localLogicalDayKey(nowMs: number): string {
  const date = new Date(nowMs)
  return logicalDayKey({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours() })
}

const storageKey = 'settings/situation-inner'

/** `savedAtMs` of the stored document, or 0 when there is none or it is unreadable. */
function storedSavedAtMs(): number {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    const result = isPlainObject(stored) ? safeParse(time, stored.savedAtMs) : undefined
    return result?.success ? result.output : 0
  }
  catch {
    return 0
  }
}

/**
 * Persists the unprompted gate's durable inner state (open threads, the ritual day, the gate's social memory, and how
 * far thread extraction read each chat session) so a leader reload or a promoted window does not start her from day
 * one or extract a conversation twice.
 *
 * The store is deliberately not replicated across windows: only the leader's situation store reads and writes it,
 * and replicated state would grow with every save (see `stores/devtools/situation-observability.ts`). Every Electron
 * window loads the same renderer origin in the default session, so all windows share this localStorage key.
 *
 * Persistence uses explicit commands on localStorage rather than a storage-backed ref. A ref that ignores storage
 * events keeps the value it read at creation, so a window promoted hours later would restore a stale document. A ref
 * that listens receives the event of its own write and pauses writing until the next tick, which drops a second write
 * in the same tick.
 *
 * Writes are guarded twice. A write is ignored unless its token matches the token the current leader passed to
 * {@link claim}, so a demoted window cannot overwrite its successor. A write is also ignored, with a warning, when the
 * stored save is newer than this window's last {@link read} or write, so a window never overwrites a save it has not
 * seen.
 */
export const useSituationInnerState = defineStore('situation-inner-state', () => {
  let leadershipToken: number | null = null
  /** The document this window last read or wrote; `null` before the first read. */
  let lastSeen: SavedInnerState | null = null

  /** Makes `token` the only token {@link write} accepts. Call it when this window becomes the leader. */
  function claim(token: number) {
    leadershipToken = token
  }

  /**
   * Reads the stored state from localStorage, leaving out stale items: threads whose `expiresAtMs <= nowMs` and a
   * ritual day that is not the logical day of `nowMs`. Storage keeps them until the next write.
   */
  function read(nowMs: number = Date.now()): SavedInnerState {
    const raw = localStorage.getItem(storageKey)
    const saved = raw === null ? defaultSavedInnerState() : readStoredInnerState(raw)
    lastSeen = saved
    return {
      ...saved,
      threads: saved.threads.filter(thread => thread.expiresAtMs > nowMs),
      rituals: saved.rituals !== null && saved.rituals.dayKey === localLogicalDayKey(nowMs) ? saved.rituals : null,
    }
  }

  /** Saves `patch` over the last document this window saw and returns whether it was saved; see the store's guards. */
  function write(patch: SavedInnerStatePatch, token: number): boolean {
    if (leadershipToken === null || token !== leadershipToken)
      return false
    const storedAtMs = storedSavedAtMs()
    // Before the first read, only an empty store (savedAtMs 0) may be written.
    if (storedAtMs > (lastSeen?.savedAtMs ?? 0)) {
      console.warn('[situation-inner] Ignored a write over a newer save:', storedAtMs)
      return false
    }

    const base = lastSeen ?? defaultSavedInnerState()
    const next: SavedInnerState = {
      v: 1,
      threads: patch.threads ?? base.threads,
      rituals: patch.rituals === undefined ? base.rituals : patch.rituals,
      gate: patch.gate === undefined ? base.gate : patch.gate,
      extractedThrough: patch.extractedThrough ?? base.extractedThrough,
      savedAtMs: Date.now(),
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    }
    catch (error) {
      console.warn('[situation-inner] Failed to save:', errorMessageFrom(error) ?? 'unknown error')
      return false
    }
    lastSeen = next
    return true
  }

  /** Clears the stored state for every window. */
  function reset() {
    localStorage.removeItem(storageKey)
    lastSeen = defaultSavedInnerState()
  }

  return { claim, read, write, reset }
})
