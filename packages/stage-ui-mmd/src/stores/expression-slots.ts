import type { SlotCommand } from '@proj-airi/stage-shared/expression-performance'

// Lease lifetimes follow the Live2D slot rules in
// `stage-ui-live2d/src/composables/live2d/expression/slots.ts`; stage-ui-mmd must not import stage-ui-live2d.

export type SlotName = SlotCommand['slot']
export type SpeechEvent = 'clip-start' | 'clip-end' | 'clip-stopped' | 'turn-end'

export const slotNames: readonly SlotName[] = ['face', 'effect', 'prop']
export const speechEvents: readonly SpeechEvent[] = ['clip-start', 'clip-end', 'clip-stopped', 'turn-end']

/** The `settings.slots` members that bound a lease lifetime, in seconds. */
export interface SlotLeaseSettings {
  speechGrace: number
  unstartedExpiry: number
  holdCap: number
}

/** A transient activation owned by one slot; times share the caller's monotonic clock in seconds. */
export interface SlotLease {
  expressionId: string
  claimSequence: number
  turnId: string | null
  activatedAt: number
  holdSeconds: number
  until: 'speech' | 'hold'
  lastClipEndAt: number | null
  sawClipStart: boolean
  turnEndedAt: number | null
}

export type SlotLeases = Record<SlotName, SlotLease | null>

export function emptyLeases(): SlotLeases {
  return { face: null, effect: null, prop: null }
}

export function createLease(expressionId: string, command: Pick<SlotCommand, 'turnId' | 'holdSeconds' | 'until'>, now: number, claimSequence: number): SlotLease {
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

export function leaseReleaseAt(lease: SlotLease, muted: boolean, settings: SlotLeaseSettings): number {
  const holdAt = lease.activatedAt + lease.holdSeconds
  let at: number
  if (lease.until === 'hold' || lease.turnId === null || muted)
    at = holdAt
  else if (!lease.sawClipStart)
    at = lease.turnEndedAt !== null ? holdAt : Math.max(holdAt, lease.activatedAt + settings.unstartedExpiry)
  else if (lease.turnEndedAt === null)
    at = Number.POSITIVE_INFINITY
  else
    at = Math.max(holdAt, (lease.lastClipEndAt ?? lease.turnEndedAt) + settings.speechGrace)
  return Math.min(at, lease.activatedAt + settings.holdCap)
}

/** Null releases the lease; an expired lease is released before a late event can extend it. */
export function applySpeechEvent(lease: SlotLease, event: SpeechEvent, now: number, muted: boolean, settings: SlotLeaseSettings): SlotLease | null {
  if (now >= leaseReleaseAt(lease, muted, settings) || event === 'clip-stopped')
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

interface Transition {
  fromWeight: number
  targetWeight: number
  transitionAt: number
  duration: number
}

/** Cosine-eased weights per catalog entry on an explicit clock; a release is retired once it reaches zero. */
export class ExpressionFader {
  private transitions = new Map<string, Transition>()
  fadeSeconds = 1

  setTargets(targets: readonly { id: string, weight: number }[], now: number): void {
    const desired = new Map(targets.map(target => [target.id, target.weight]))
    for (const id of this.transitions.keys()) {
      if (!desired.has(id))
        this.setTarget(id, 0, now)
    }
    for (const [id, weight] of desired)
      this.setTarget(id, weight, now)
  }

  private setTarget(id: string, target: number, now: number): void {
    target = Number.isNaN(target) ? 0 : Math.max(0, Math.min(1, target))
    const previous = this.transitions.get(id)
    if (previous?.targetWeight === target || (!previous && target === 0))
      return
    this.transitions.set(id, { fromWeight: this.weightOf(id, now), targetWeight: target, transitionAt: now, duration: this.fadeSeconds })
  }

  weightOf(id: string, now: number): number {
    const transition = this.transitions.get(id)
    if (!transition)
      return 0
    const u = transition.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - transition.transitionAt) / transition.duration))
    const weight = transition.fromWeight + (transition.targetWeight - transition.fromWeight) * (1 - Math.cos(Math.PI * u)) / 2
    if (transition.targetWeight === 0 && weight === 0)
      this.transitions.delete(id)
    return weight
  }

  /** Samples every transition, including releases still fading out. */
  sample(now: number): Map<string, number> {
    const weights = new Map<string, number>()
    for (const id of this.transitions.keys())
      weights.set(id, this.weightOf(id, now))
    return weights
  }

  clear(): void {
    this.transitions.clear()
  }
}
