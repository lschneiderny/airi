import type { CharacterEvent, CharacterReading, CharacterStateRecordV1, DailySummary, MoodAxes, MoodContribution, MoodSource } from '@proj-airi/stage-shared/character-state'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { CharacterEventSchema, currentWound, rawAt, remaining, renderCharacterContext } from '@proj-airi/stage-shared/character-state'
import { defineStore } from 'pinia'
import { safeParse } from 'valibot'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'
import { characterStateContext, useCharacterStateStore } from '../character-state'

/** How many of the newest daily history rows an inspection carries. */
export const CHARACTER_STATE_HISTORY_SHOWN = 30

/** One live mood contribution with its weight at the inspection instant. */
export interface CharacterContributionInspection {
  id: string
  source: MoodSource
  reason: string
  atMs: number
  halfLifeMs: number
  expiresAtMs: number
  delta: MoodAxes
  /** `2^(-(now - atMs) / halfLifeMs)` while live, 0 once expired. */
  remaining: number
}

/**
 * The character state as the leader sees it at its clock. `nowMs` already includes the devtools jump
 * (`clockOffsetMs`), so every age and the rendered text are read at the leader's clock, not the wall clock.
 */
export interface CharacterStateInspection {
  /** Whether the answering window leads; a window that never initialized the store does not. */
  leading: boolean
  /** The leader's clock: wall clock plus the devtools jump. */
  nowMs: number
  clockOffsetMs: number
  cardId: string | null
  reading: CharacterReading | null
  /** The `system:character` text at `nowMs`; `''` at rest. */
  renderedText: string
  /** The raw (pre-squash) mood sum per axis at `nowMs`. */
  raw: MoodAxes
  /** Live contributions, oldest first. */
  contributions: CharacterContributionInspection[]
  temperament: Pick<CharacterStateRecordV1['temperament'], 'axes' | 'throughHourMs'> | null
  /** `wound` is the decayed value at `nowMs`, the one that damps trust gains now. */
  relationship: Pick<CharacterStateRecordV1['relationship'], 'levels' | 'stages' | 'wound' | 'activeDays' | 'milestoneIds' | 'lastSeenAtMs' | 'pendingStageUps'> | null
  /** Newest first, at most {@link CHARACTER_STATE_HISTORY_SHOWN} rows. */
  history: DailySummary[]
  lastInteractionAtMs: number | null
  updatedAtMs: number | null
}

/** Result of a devtools jump: the total offset and the state after it. */
export interface CharacterStateJumpResult {
  clockOffsetMs: number
  inspection: CharacterStateInspection
}

/**
 * Result of applying a test event: `applied` when the state changed, `ignored` when the reducer refused it (a replay,
 * a daily cap, or an unknown card), `invalid` when the payload is not a character event.
 */
export type CharacterStateApplyResult
  = | { status: 'applied' | 'ignored', inspection: CharacterStateInspection }
    | { status: 'invalid', error: string }

/** The leader window answers it with {@link CharacterStateInspection} of the active card. */
export const characterStateInspectInvoke = defineInvokeEventa<CharacterStateInspection>('eventa:devtools:character-state:inspect')
/** The leader window moves its character clock forward by `ms` and answers with the state after the jump. */
export const characterStateJumpInvoke = defineInvokeEventa<CharacterStateJumpResult, { ms: number }>('eventa:devtools:character-state:jump')
/** The leader window applies `event` at its clock. The payload is validated there, so a bad event is reported, not applied. */
export const characterStateApplyInvoke = defineInvokeEventa<CharacterStateApplyResult, { event: unknown }>('eventa:devtools:character-state:apply')
/** The leader window forgets the active card's state and answers with the fresh state. */
export const characterStateResetInvoke = defineInvokeEventa<CharacterStateInspection>('eventa:devtools:character-state:reset')

const NO_RAW: MoodAxes = Object.freeze({ valence: 0, energy: 0, tension: 0 })

function contributionAt(contribution: MoodContribution, nowMs: number): CharacterContributionInspection {
  return {
    id: contribution.id,
    source: contribution.source,
    reason: contribution.reason,
    atMs: contribution.atMs,
    halfLifeMs: contribution.halfLifeMs,
    expiresAtMs: contribution.expiresAtMs,
    delta: { ...contribution.delta },
    remaining: remaining(contribution, nowMs),
  }
}

/**
 * Serves the devtools Character inspector: the leader's live record of the active card, its reading and rendered text
 * at the leader's clock, and the devtools actions (clock jump, test event, reset).
 *
 * Only the leader holds the record (`leaderRecord`), so a follower window (the Electron settings window, for example)
 * reads the leader through {@link inspectLeader} and the `*Leader` actions. While this window leads, it answers them
 * over the devtools inspector bus, an Eventa BroadcastChannel context. The store is not synced: synced actions would
 * keep every polled result in the shared domain state until their call timeout, and the inspector polls every second.
 *
 * Every age and the rendered text are read at the leader's clock (`Date.now() + clockOffsetMs`), so a jump shows the
 * state the leader itself computes. Elsewhere in the app the character context renders at the wall clock.
 */
export const useCharacterStateObservabilityStore = defineStore('devtools:character-state-observability', () => {
  let stopServing: (() => void) | undefined

  /**
   * Resolved here, not at setup: the situation store creates this store on every window, and the character store
   * pulls in the card store, whose setup needs an i18n context that only exists once the app is mounted.
   */
  function characterStore() {
    return useCharacterStateStore()
  }

  /** The leader's clock, jump included. */
  function now() {
    return Date.now() + characterStore().clockOffsetMs
  }

  /** Reads the leader's record of this window at its clock. */
  function inspect(): CharacterStateInspection {
    const characterState = characterStore()
    const nowMs = now()
    const record = characterState.leaderRecord
    const reading = characterState.reading
    const context = characterStateContext(nowMs)
    return {
      leading: characterState.leading,
      nowMs,
      clockOffsetMs: characterState.clockOffsetMs,
      cardId: characterState.cardId,
      reading,
      renderedText: reading ? renderCharacterContext(reading, context) : '',
      raw: record ? rawAt(record.mood.contributions, nowMs) : NO_RAW,
      contributions: record ? record.mood.contributions.filter(contribution => remaining(contribution, nowMs) > 0).map(contribution => contributionAt(contribution, nowMs)) : [],
      temperament: record ? { axes: { ...record.temperament.axes }, throughHourMs: record.temperament.throughHourMs } : null,
      relationship: record
        ? {
            levels: { ...record.relationship.levels },
            stages: { ...record.relationship.stages },
            wound: currentWound(record.relationship, nowMs),
            activeDays: record.relationship.activeDays,
            milestoneIds: [...record.relationship.milestoneIds],
            lastSeenAtMs: record.relationship.lastSeenAtMs,
            pendingStageUps: { ...record.relationship.pendingStageUps },
          }
        : null,
      history: record ? record.history.slice(-CHARACTER_STATE_HISTORY_SHOWN).reverse() : [],
      lastInteractionAtMs: record?.lastInteractionAtMs ?? null,
      updatedAtMs: record?.updatedAtMs ?? null,
    }
  }

  /** Moves this window's character clock forward by `ms` (ignored unless finite and positive) and reads the state after it. */
  async function jump(ms: number): Promise<CharacterStateJumpResult> {
    const clockOffsetMs = await characterStore().devtoolsJump(ms)
    return { clockOffsetMs, inspection: inspect() }
  }

  /** Validates `event` against the character event schema and applies it at this window's clock. */
  async function apply(event: unknown): Promise<CharacterStateApplyResult> {
    const parsed = safeParse(CharacterEventSchema, event)
    if (!parsed.success)
      return { status: 'invalid', error: parsed.issues.map(issue => `${issue.path?.map(segment => String(segment.key)).join('.') || 'event'}: ${issue.message}`).join('; ') }
    const applied = await characterStore().devtoolsApply(parsed.output as CharacterEvent)
    return { status: applied ? 'applied' : 'ignored', inspection: inspect() }
  }

  /** Forgets the active card's state in this window and reads the fresh one. Without an active card nothing changes. */
  async function reset(): Promise<CharacterStateInspection> {
    const characterState = characterStore()
    const cardId = characterState.cardId
    if (cardId !== null)
      await characterState.forget(cardId)
    return inspect()
  }

  /** Answers the inspector bus from this window. Only the leader serves, so a follower never answers. */
  function serve() {
    const context = getDevtoolsBusContext()
    const stops = [
      defineInvokeHandler(context, characterStateInspectInvoke, () => inspect()),
      defineInvokeHandler(context, characterStateJumpInvoke, ({ ms }) => jump(ms)),
      defineInvokeHandler(context, characterStateApplyInvoke, ({ event }) => apply(event)),
      defineInvokeHandler(context, characterStateResetInvoke, () => reset()),
    ]
    return () => stops.forEach(stop => stop())
  }

  /** Called beside the situation store's leadership publish, so the leader window answers the inspector. */
  function setLeading(leading: boolean) {
    if (leading) {
      stopServing ??= serve()
    }
    else {
      stopServing?.()
      stopServing = undefined
    }
  }

  function leaderSignal() {
    return { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) }
  }

  /** Returns {@link inspect} of the leader window. Rejects when no window answers in time. */
  async function inspectLeader(): Promise<CharacterStateInspection> {
    return defineInvoke(getDevtoolsBusContext(), characterStateInspectInvoke)(undefined, leaderSignal())
  }

  /** Asks the leader window for {@link jump}. Rejects when no window answers in time. */
  async function jumpLeader(ms: number): Promise<CharacterStateJumpResult> {
    return defineInvoke(getDevtoolsBusContext(), characterStateJumpInvoke)({ ms }, leaderSignal())
  }

  /** Asks the leader window for {@link apply}. Rejects when no window answers in time. */
  async function applyLeader(event: unknown): Promise<CharacterStateApplyResult> {
    return defineInvoke(getDevtoolsBusContext(), characterStateApplyInvoke)({ event }, leaderSignal())
  }

  /** Asks the leader window for {@link reset}. Rejects when no window answers in time. */
  async function resetLeader(): Promise<CharacterStateInspection> {
    return defineInvoke(getDevtoolsBusContext(), characterStateResetInvoke)(undefined, leaderSignal())
  }

  return {
    setLeading,
    inspect,
    jump,
    apply,
    reset,
    inspectLeader,
    jumpLeader,
    applyLeader,
    resetLeader,
  }
})

/** The message a devtools page shows for a failed leader call. */
export function leaderErrorMessage(error: unknown): string {
  return errorMessageFrom(error) ?? 'The leader window did not answer.'
}
