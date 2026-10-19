import type { CatalogEntry, ExpressionKind, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { ComputedRef, Ref } from 'vue'

import type { ExpressionComposer } from '../composables/live2d/expression/compose'
import type { SlotLease, SlotLeaseSettings, SlotName, SpeechEvent } from '../composables/live2d/expression/slots'

import { applySpeechEvent, createLease, isLeaseExpired, slotNames } from '../composables/live2d/expression/slots'

export type SlotLeases = Record<SlotName, SlotLease | null>

export function emptyLeases(): SlotLeases {
  return { face: null, effect: null, prop: null }
}

const speechEvents: readonly SpeechEvent[] = ['clip-start', 'clip-end', 'clip-stopped', 'turn-end']

export interface SlotLeaseContext {
  catalog: ComputedRef<CatalogEntry[]>
  slotActive: Ref<string[]>
  leases: Ref<SlotLeases>
  muted: Ref<boolean>
  slotSettings: Ref<SlotLeaseSettings>
  composer: ExpressionComposer
  ownersOf: (id: string) => { rest: boolean, manual: boolean, slot: boolean }
  isActive: (id: string) => boolean
  deactivate: (id: string, now?: number) => void
}

export function createSlotLeases(context: SlotLeaseContext) {
  const { catalog, slotActive, leases, muted, slotSettings, composer, ownersOf, isActive, deactivate } = context

  /** Checks every conflicting owner before changing any target; leases are owned by the performer. */
  function activateFromSlot(id: string, kind: ExpressionKind, now = performance.now() / 1000): boolean {
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry || entry.kind !== kind || !['face', 'effect', 'prop'].includes(kind))
      return false
    const conflicts = catalog.value.filter(other => other.id !== id && entry.group !== null && other.group === entry.group
      && isActive(other.id))
    if (conflicts.some((other) => {
      const owners = ownersOf(other.id)
      return other.kind !== kind || owners.rest || owners.manual
    })) {
      console.warn('[expression-store] Slot activation skipped for protected group:', id)
      return false
    }
    for (const other of conflicts)
      deactivate(other.id, now)
    if (!slotActive.value.includes(id))
      slotActive.value = [...slotActive.value, id]
    composer.activate(id, now)
    return true
  }

  /** Ends a lease; the expression stays active while an unsuppressed rest entry or a manual toggle also owns it. */
  function releaseSlot(slot: SlotName, now: number) {
    const lease = leases.value[slot]
    if (!lease)
      return
    leases.value = { ...leases.value, [slot]: null }
    slotActive.value = slotActive.value.filter(id => id !== lease.expressionId)
    if (!isActive(lease.expressionId))
      composer.deactivate(lease.expressionId, now)
  }

  /** Executes decider output; invalid commands are dropped, never partially applied. */
  function applySlots(commands: SlotCommand[], now: number) {
    if (!Number.isFinite(now))
      return
    for (const command of commands) {
      const slot = command.slot
      if (!slotNames.includes(slot)) {
        console.warn('[expression-store] Unknown slot dropped:', slot)
        continue
      }
      if (command.expressionId === null) {
        releaseSlot(slot, now)
        continue
      }
      if (!Number.isFinite(command.holdSeconds) || command.holdSeconds < 0 || (command.until !== 'speech' && command.until !== 'hold')) {
        console.warn('[expression-store] Slot command with invalid lifetime dropped:', command.expressionId)
        continue
      }
      const previous = leases.value[slot]
      if (previous?.expressionId !== command.expressionId && !activateFromSlot(command.expressionId, slot, now))
        continue
      if (previous?.expressionId === command.expressionId)
        slotActive.value = slotActive.value.includes(command.expressionId) ? slotActive.value : [...slotActive.value, command.expressionId]
      else
        releaseSlot(slot, now)
      leases.value = { ...leases.value, [slot]: createLease(command.expressionId, command, now) }
    }
  }

  /** Releases every lease whose lifetime ended; called from the final plugin before compose. */
  function tickLeases(now: number) {
    if (!Number.isFinite(now))
      return
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (lease && isLeaseExpired(lease, now, muted.value, slotSettings.value))
        releaseSlot(slot, now)
    }
  }

  /** Only leases of the same turn react; leases without a turn follow their hold rule. */
  function onSpeech(event: SpeechEvent, turnId: string, now: number) {
    if (!Number.isFinite(now) || !speechEvents.includes(event))
      return
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (!lease || lease.turnId === null || lease.turnId !== turnId)
        continue
      const next = applySpeechEvent(lease, event, now, muted.value, slotSettings.value)
      if (next === null)
        releaseSlot(slot, now)
      else
        leases.value = { ...leases.value, [slot]: next }
    }
    tickLeases(now)
  }

  function setMuted(value: boolean) {
    muted.value = value
  }

  function setSlotSettings(settings: SlotLeaseSettings & { defaultFadeSeconds: number }) {
    slotSettings.value = { speechGrace: settings.speechGrace, unstartedExpiry: settings.unstartedExpiry, holdCap: settings.holdCap }
    composer.setDefaultFadeSeconds(settings.defaultFadeSeconds)
  }

  return { activateFromSlot, releaseSlot, applySlots, tickLeases, onSpeech, setMuted, setSlotSettings }
}
