import type { SlotCommand } from '@proj-airi/stage-shared/expression-performance'

export type SlotName = SlotCommand['slot']
export type SpeechEvent = 'clip-start' | 'clip-end' | 'clip-stopped' | 'turn-end'

export const slotNames: readonly SlotName[] = ['face', 'effect', 'prop']

/** The `settings.slots` members that bound a lease lifetime, in seconds. */
export interface SlotLeaseSettings {
  speechGrace: number
  unstartedExpiry: number
  holdCap: number
}

/** A transient activation owned by one slot; times share the caller's monotonic clock. */
export interface SlotLease {
  expressionId: string
  claimSequence: number
  turnId: string | null
  activatedAt: number
  holdSeconds: number
  until: 'speech' | 'hold'
  lastClipEndAt: number | null
  sawClipStart: boolean
  /** First turn-end time; later turn-ends never move it. */
  turnEndedAt: number | null
}

export function createLease(expressionId: string, command: Pick<SlotCommand, 'turnId' | 'holdSeconds' | 'until'>, now: number, claimSequence = 0): SlotLease {
  return {
    expressionId,
    claimSequence,
    turnId: command.turnId ?? null,
    activatedAt: now,
    holdSeconds: command.holdSeconds,
    until: command.until,
    lastClipEndAt: null,
    sawClipStart: false,
    turnEndedAt: null,
  }
}

/** Returns the time the lease ends given its current facts; Infinity never occurs because the cap bounds it. */
export function leaseReleaseAt(lease: SlotLease, muted: boolean, settings: SlotLeaseSettings): number {
  const holdAt = lease.activatedAt + lease.holdSeconds
  let at: number
  if (lease.until === 'hold' || lease.turnId === null || muted)
    at = holdAt
  else if (!lease.sawClipStart)
    // An unmuted speech lease with no clip start
    // waits for speech until activatedAt + max(holdSeconds, unstartedExpiry); a muted lease uses holdSeconds.
    at = lease.turnEndedAt !== null ? holdAt : Math.max(holdAt, lease.activatedAt + settings.unstartedExpiry)
  else if (lease.turnEndedAt === null)
    at = Number.POSITIVE_INFINITY
  else
    at = Math.max(holdAt, (lease.lastClipEndAt ?? lease.turnEndedAt) + settings.speechGrace)
  return Math.min(at, lease.activatedAt + settings.holdCap)
}

export function isLeaseExpired(lease: SlotLease, now: number, muted: boolean, settings: SlotLeaseSettings): boolean {
  return now >= leaseReleaseAt(lease, muted, settings)
}

/**
 * Applies a speech event to a lease of the same turn; null means the lease is released.
 * An already expired lease is released first, so a late event can never extend it.
 * Terminal events are idempotent and clip-end without a seen clip-start is unrelated.
 */
export function applySpeechEvent(lease: SlotLease, event: SpeechEvent, now: number, muted: boolean, settings: SlotLeaseSettings): SlotLease | null {
  if (isLeaseExpired(lease, now, muted, settings) || event === 'clip-stopped')
    return null
  const ended = lease.turnEndedAt !== null
  switch (event) {
    case 'turn-end':
      return ended ? lease : { ...lease, turnEndedAt: now }
    case 'clip-start':
      return ended ? lease : { ...lease, sawClipStart: true }
    case 'clip-end':
      return ended || !lease.sawClipStart ? lease : { ...lease, lastClipEndAt: now }
  }
}
