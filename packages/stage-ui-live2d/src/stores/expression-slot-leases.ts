import type { CatalogEntry, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { ComputedRef, Ref } from 'vue'

import type { ExpressionComposer } from '../composables/live2d/expression/compose'
import type { SlotLease, SlotLeaseSettings, SlotName, SpeechEvent } from '../composables/live2d/expression/slots'

import { entrySlots, expandEntry, resolveAlias } from '@proj-airi/stage-shared/expression-performance'

import { applySpeechEvent, createLease, isLeaseExpired, slotNames } from '../composables/live2d/expression/slots'

export type SlotLeases = Record<SlotName, SlotLease | null>

export function emptyLeases(): SlotLeases {
  return { face: null, effect: null, prop: null }
}

const speechEvents: readonly SpeechEvent[] = ['clip-start', 'clip-end', 'clip-stopped', 'turn-end']

export interface SlotLeaseContext {
  catalog: ComputedRef<CatalogEntry[]>
  manualActive: Ref<string[]>
  leases: Ref<SlotLeases>
  muted: Ref<boolean>
  slotSettings: Ref<SlotLeaseSettings>
  composer: ExpressionComposer
  nextClaimSequence: () => number
  reconcile: (now: number) => void
}

export function createSlotLeases(context: SlotLeaseContext) {
  const { catalog, manualActive, leases, muted, slotSettings, composer, nextClaimSequence, reconcile } = context

  /** Checks every conflicting owner before replacing the previous lease. */
  function admit(slot: SlotName, command: SlotCommand, now: number, batch: Map<string, SlotLease>): boolean {
    const id = resolveAlias(command.expressionId!, catalog.value)
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry || !entrySlots(entry, catalog.value).includes(slot))
      return false
    if (entry.kind !== 'combo' && entry.group !== null) {
      const baseMembers = manualActive.value.flatMap((id) => {
        const base = catalog.value.find(entry => entry.id === id)!
        return expandEntry(base, catalog.value).map(member => catalog.value.find(entry => entry.id === member.expressionId)!)
      })
      const conflicts = baseMembers.filter(other => other.id !== id && other.group === entry.group)
      const conflictingSlots = slotNames.filter((otherSlot) => {
        const lease = leases.value[otherSlot]
        const owner = catalog.value.find(entry => entry.id === lease?.expressionId)
        return owner && expandEntry(owner, catalog.value).some((member) => {
          const other = catalog.value.find(entry => entry.id === member.expressionId)!
          return other.id !== id && other.group === entry.group
        })
      })
      if (conflicts.length || conflictingSlots.some((otherSlot) => {
        const owner = catalog.value.find(entry => entry.id === leases.value[otherSlot]!.expressionId)!
        return expandEntry(owner, catalog.value).some((member) => {
          const other = catalog.value.find(entry => entry.id === member.expressionId)!
          return other.id !== id && other.group === entry.group && other.kind !== slot
        })
      })) {
        console.warn('[expression-store] Slot activation skipped for protected group:', id)
        return false
      }
      for (const otherSlot of conflictingSlots)
        releaseSlot(otherSlot, now, false)
    }
    const refresh = leases.value[slot]?.expressionId === id
    if (!refresh)
      releaseSlot(slot, now, false)
    let lease = batch.get(id)
    if (!lease) {
      lease = createLease(id, command, now, nextClaimSequence())
      batch.set(id, lease)
    }
    leases.value = { ...leases.value, [slot]: { ...lease } }
    return true
  }

  function activateFromSlot(slot: SlotName, command: SlotCommand, now = performance.now() / 1000): boolean {
    const admitted = admit(slot, command, now, new Map())
    reconcile(now)
    return admitted
  }

  /** A trigger owns every spanned slot until any of its leases releases. */
  function releaseSlot(slot: SlotName, now: number, reconcileNow = true) {
    const lease = leases.value[slot]
    if (!lease)
      return
    for (const other of slotNames) {
      if (leases.value[other]?.expressionId === lease.expressionId)
        leases.value = { ...leases.value, [other]: null }
    }
    if (reconcileNow)
      reconcile(now)
  }

  /** Executes decider output; invalid commands are dropped, never partially applied. */
  function applySlots(commands: SlotCommand[], now: number) {
    if (!Number.isFinite(now))
      return
    const batch = new Map<string, SlotLease>()
    for (const command of commands) {
      const slot = command.slot
      if (!slotNames.includes(slot)) {
        console.warn('[expression-store] Unknown slot dropped:', slot)
        continue
      }
      if (command.expressionId === null) {
        releaseSlot(slot, now, false)
        continue
      }
      if (!Number.isFinite(command.holdSeconds) || command.holdSeconds < 0 || (command.until !== 'speech' && command.until !== 'hold')) {
        console.warn('[expression-store] Slot command with invalid lifetime dropped:', command.expressionId)
        continue
      }
      admit(slot, command, now, batch)
    }
    reconcile(now)
  }

  /** Releases every lease whose lifetime ended; called from the final plugin before compose. */
  function expireLeases(now: number) {
    for (const slot of slotNames) {
      const lease = leases.value[slot]
      if (lease && isLeaseExpired(lease, now, muted.value, slotSettings.value))
        releaseSlot(slot, now, false)
    }
  }

  function tickLeases(now: number) {
    if (!Number.isFinite(now))
      return
    expireLeases(now)
    reconcile(now)
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
        releaseSlot(slot, now, false)
      else
        leases.value = { ...leases.value, [slot]: next }
    }
    expireLeases(now)
    reconcile(now)
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
