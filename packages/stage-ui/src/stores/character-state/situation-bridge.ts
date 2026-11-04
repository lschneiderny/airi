import type { ChatHistoryItem } from '@proj-airi/core-agent'
import type { CharacterEvent } from '@proj-airi/stage-shared/character-state'
import type { SituationEvent, SituationState, UrgeGateMemory } from '@proj-airi/stage-shared/situation'

import type { ExtractedEvent } from '../../features/situation/thread-extraction'

import { errorMessageFrom } from '@moeru/std'
import { CHARACTER_STATE_SETTINGS } from '@proj-airi/stage-shared/character-state'
import { TOUCH_POKE_BURST_COUNT } from '@proj-airi/stage-shared/situation'
import { watch } from 'vue'

import { localLogicalDayKey } from '../../features/situation/inner-state'
import { localLogicalDayStart, useCharacterStateStore } from '../character-state'
import { useMemoryStore } from '../memory'

/**
 * A reach-out with no user reply this long after it was spoken counts as unanswered (plan Appendix A2).
 *
 * Tuning: lengthen it if she reads ordinary pauses as being ignored.
 */
export const REACH_OUT_UNANSWERED_AFTER_MS = 90 * 60_000

const { reachOutReplyWindowMs, firstRealExchangeTurn } = CHARACTER_STATE_SETTINGS.relationship

/** What the situation store hands the bridge. Every getter reads the leader's current value. */
export interface SituationBridgeSources {
  situation: () => SituationState
  /** The urge gate's memory; its initial value while the gate does not run, so no reach-out is ever seen. */
  gate: () => UrgeGateMemory
  /** The newest message that the last extraction of a chat session read, or `undefined` before the first. */
  extractedThrough: (sessionId: string) => string | undefined
  /** The loaded messages of a chat session, oldest first. */
  messages: (sessionId: string) => readonly ChatHistoryItem[]
}

export interface SituationBridge {
  /** Feeds the relationship events of one thread extraction (`ThreadExtractorDeps.onEvents`). */
  onExtractedEvents: (events: readonly ExtractedEvent[], sessionId: string) => Promise<void>
  /** Drops what the bridge remembers and forgets the character state of every card. */
  forgetEverything: () => Promise<void>
  stop: () => void
}

interface ReachOut {
  readonly atMs: number
  readonly ritual: boolean
  unanswered: boolean
}

/**
 * Turns what the situation store observes into character-state events, in the leader window.
 *
 * - A new touch event: a pet is a pleasant touch; the poke that turns the count into a burst is one unwelcome touch;
 *   any other poke is nothing.
 * - A `returned` event: a return with the away gap, from which the reducer derives the mood push and the absence.
 * - A reach-out (a spoken gate opening, not a double text or urgent notify): 90 min without a user turn makes it
 *   unanswered, the first and then the second in a row. The next user turn is a late reply when one went
 *   unanswered, a reach-out reply within 2 h of the latest one, and a reciprocated ritual within 2 h of a ritual one.
 * - A user turn: the third of the logical day is its first real exchange, the two before it are early, later ones
 *   are later turns. A character turn is character speech.
 * - Extraction events keep their kind and validated reason; a milestone is written as a memory of the active card
 *   first, and its event carries the memory id. Nothing else reaches a reason: the bridge never copies user, model,
 *   or situation text.
 *
 * Every event id derives from its source (situation event id, turn time, reach-out time, extraction read position
 * and index), so a replay is a no-op in the reducer. Every event is stamped no earlier than the start of the current
 * logical day, because the reducer drops events of an earlier day, and an extraction can finish after the rollover.
 */
export function bridgeSituationToCharacter(sources: SituationBridgeSources): SituationBridge {
  const characterState = useCharacterStateStore()
  let reachOuts: ReachOut[] = []
  let consecutiveUnanswered = 0
  let lastReachOutAtMs = Number.NEGATIVE_INFINITY
  let lastUserAtMs = Number.NEGATIVE_INFINITY
  let lastCharacterAtMs = Number.NEGATIVE_INFINITY
  let userTurnDay: string | null = null
  let userTurnsToday = 0
  /** Milestone event ids whose memory was written, so a replay writes no second memory. */
  const writtenMilestones = new Set<string>()

  function send(event: CharacterEvent) {
    const dayStartMs = localLogicalDayStart(Date.now() + characterState.clockOffsetMs)
    const stamped = event.atMs < dayStartMs ? { ...event, atMs: dayStartMs } : event
    void characterState.apply(stamped).catch((error) => {
      console.warn('[character-state] Failed to apply a situation event:', errorMessageFrom(error) ?? 'unknown error')
    })
  }

  /** Records the reach-out the gate spoke, read from its reply clock. */
  function pollGate() {
    const memory = sources.gate()
    const atMs = memory.awaitingSinceMs
    if (atMs === null || atMs <= lastReachOutAtMs || atMs !== memory.lastSpokenAtMs)
      return
    lastReachOutAtMs = atMs
    // A restored memory has no pending fire; its unanswered count tells whether the last line was an opening.
    const pending = memory.pending?.spokenAtMs === atMs ? memory.pending : null
    const counts = pending ? pending.category !== 'double-text' && pending.category !== 'urgent' : memory.unanswered > 0
    if (counts)
      reachOuts.push({ atMs, ritual: pending?.reasonKind.startsWith('ritual-') ?? false, unanswered: false })
  }

  function markUnanswered(nowMs: number) {
    for (const reachOut of reachOuts) {
      const dueAtMs = reachOut.atMs + REACH_OUT_UNANSWERED_AFTER_MS
      if (reachOut.unanswered || nowMs < dueAtMs)
        continue
      reachOut.unanswered = true
      // The reducer knows a first and a second unanswered reach-out; a third and later ones weigh like the second.
      consecutiveUnanswered = Math.min(2, consecutiveUnanswered + 1)
      send({ kind: 'reach-out-unanswered', id: `reach-out-unanswered:${reachOut.atMs}`, atMs: dueAtMs, consecutive: consecutiveUnanswered === 1 ? 1 : 2 })
    }
  }

  function userTurn(atMs: number) {
    markUnanswered(atMs)
    const latest = reachOuts.at(-1)
    const unanswered = reachOuts.findLast(reachOut => reachOut.unanswered)
    if (unanswered)
      send({ kind: 'late-reply', id: `late-reply:${unanswered.atMs}`, atMs })
    if (latest && atMs - latest.atMs <= reachOutReplyWindowMs)
      send({ kind: 'reach-out-reply', id: `reach-out-reply:${latest.atMs}`, atMs })
    const ritual = reachOuts.findLast(reachOut => reachOut.ritual && atMs - reachOut.atMs <= reachOutReplyWindowMs)
    if (ritual)
      send({ kind: 'ritual-reciprocated', id: `ritual-reciprocated:${ritual.atMs}`, atMs })
    reachOuts = []
    consecutiveUnanswered = 0

    const day = localLogicalDayKey(atMs)
    if (day !== userTurnDay) {
      userTurnDay = day
      userTurnsToday = 0
    }
    userTurnsToday += 1
    if (userTurnsToday === firstRealExchangeTurn)
      // Keyed by the day, so a reloaded leader that counts again cannot earn a second first real exchange.
      send({ kind: 'user-turn', id: `user-turn:first-real:${day}`, atMs, exchange: 'first-real' })
    else
      send({ kind: 'user-turn', id: `user-turn:${atMs}`, atMs, exchange: userTurnsToday < firstRealExchangeTurn ? 'early' : 'later' })
  }

  function situationEvent(event: SituationEvent, state: SituationState) {
    const { tracking } = state
    if (event.kind === 'returned') {
      send({ kind: 'return', id: `return:${event.id}`, atMs: event.atMs, gapMs: Math.max(0, tracking.lastAwayMs ?? 0) })
      return
    }
    if (event.kind !== 'touch')
      return
    if (tracking.lastPet?.endedAtMs === event.atMs)
      send({ kind: 'touch-pleasant', id: `touch:${event.id}`, atMs: event.atMs })
    else if (tracking.pokeTimes.at(-1) === event.atMs && tracking.pokeTimes.length === TOUCH_POKE_BURST_COUNT)
      send({ kind: 'touch-unwelcome', id: `touch:${event.id}`, atMs: event.atMs })
  }

  const stopWatch = watch(sources.situation, (next, previous) => {
    pollGate()
    const before = new Set(previous.events.map(event => event.id))
    for (const event of next.events) {
      if (!before.has(event.id))
        situationEvent(event, next)
    }
    const { lastUserAtMs: userAtMs, lastCharacterAtMs: characterAtMs } = next.conversation
    if (userAtMs !== null && userAtMs > lastUserAtMs) {
      lastUserAtMs = userAtMs
      userTurn(userAtMs)
    }
    if (characterAtMs !== null && characterAtMs > lastCharacterAtMs) {
      lastCharacterAtMs = characterAtMs
      send({ kind: 'character-spoke', id: `character-spoke:${characterAtMs}`, atMs: characterAtMs })
    }
    if (next.nowMs !== null)
      markUnanswered(next.nowMs)
  }, { flush: 'sync' })

  async function milestone(id: string, atMs: number, event: ExtractedEvent) {
    await characterState.ready()
    const record = characterState.leaderRecord
    const memory = useMemoryStore()
    // A milestone needs its memory; with memory off, nothing is written and the milestone is not counted.
    if (!record || !memory.enabled || writtenMilestones.has(id) || record.appliedEvents.recent.some(applied => applied.id === id))
      return
    writtenMilestones.add(id)
    const entry = await memory.write({ description: event.reason, body: event.memory ?? event.reason }, record.cardId)
    if (entry)
      send({ kind: 'milestone', id, atMs, reason: event.reason, memoryId: entry.id })
  }

  async function onExtractedEvents(events: readonly ExtractedEvent[], sessionId: string) {
    const messageId = sources.extractedThrough(sessionId)
    // Without a read position the events have no stable id, so a replay could not be told apart.
    if (messageId === undefined)
      return
    const atMs = sources.messages(sessionId).find(item => item.id === messageId)?.createdAt ?? Date.now()
    for (const [index, event] of events.entries()) {
      const id = `extraction:${sessionId}:${messageId}:${index}`
      try {
        if (event.kind === 'milestone')
          await milestone(id, atMs, event)
        else
          send({ kind: event.kind, id, atMs, reason: event.reason })
      }
      catch (error) {
        console.warn('[character-state] Failed to apply an extraction event:', errorMessageFrom(error) ?? 'unknown error')
      }
    }
  }

  async function forgetEverything() {
    reachOuts = []
    consecutiveUnanswered = 0
    userTurnDay = null
    userTurnsToday = 0
    writtenMilestones.clear()
    await characterState.forget('everything').catch((error) => {
      console.warn('[character-state] Failed to forget the character state:', errorMessageFrom(error) ?? 'unknown error')
    })
  }

  return { onExtractedEvents, forgetEverything, stop: stopWatch }
}
