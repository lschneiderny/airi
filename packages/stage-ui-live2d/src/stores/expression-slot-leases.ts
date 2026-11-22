import type { CatalogEntry, ExpressionRefusal, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
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
  /** Whether a lease on `expressionId` that replaces the slot's lease on `replacedId` would show too many stage items. */
  exceedsItemLimit: (expressionId: string, replacedId: string | undefined) => boolean
}

export function createSlotLeases(context: SlotLeaseContext) {
  const { catalog, manualActive, leases, muted, slotSettings, composer, nextClaimSequence, reconcile, exceedsItemLimit } = context

  /** Checks every conflicting owner before replacing the previous lease. */
  function admit(slot: SlotName, command: SlotCommand, now: number, batch: Map<string, SlotLease>): ExpressionRefusal['reason'] | null {
    const id = resolveAlias(command.expressionId!, catalog.value)
    const entry = catalog.value.find(entry => entry.id === id)
    if (!entry || !entrySlots(entry, catalog.value).includes(slot))
      return 'missing-asset'
    if (exceedsItemLimit(id, leases.value[slot]?.expressionId))
      return 'item-limit'
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
        return conflicts.length ? 'masked-by-manual' : 'masked-by-expression'
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
    return null
  }

  function activateFromSlot(slot: SlotName, command: SlotCommand, now = performance.now() / 1000): boolean {
    const admitted = admit(slot, command, now, new Map())
    reconcile(now)
    return admitted === null
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
  function applySlots(commands: SlotCommand[], now: number): ExpressionRefusal[] {
    if (!Number.isFinite(now))
      return []
    const batch = new Map<string, SlotLease>()
    const refusals = new Map<string, ExpressionRefusal>()
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
      const reason = admit(slot, command, now, batch)
      if (reason) {
        const entryId = resolveAlias(command.expressionId, catalog.value)
        refusals.set(entryId, { entryId, reason })
      }
    }
    reconcile(now)
    return [...refusals.values()]
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

  function setSlotSettings(settings: SlotLeaseSettings & { fadeInSeconds: number, fadeOutSeconds: number }) {
    slotSettings.value = { afterSpeechShare: settings.afterSpeechShare, unstartedExpiry: settings.unstartedExpiry, holdCap: settings.holdCap }
    composer.setDefaultFades(settings.fadeInSeconds, settings.fadeOutSeconds)
  }

  return { activateFromSlot, releaseSlot, applySlots, tickLeases, onSpeech, setMuted, setSlotSettings }
}
