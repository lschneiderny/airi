import type { CatalogEntry, ExpressionPerformanceSettings, HoldCommand, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { SlotLease, SlotLeaseSettings, SpeechEvent } from './slots'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { applySpeechEvent, createLease, isLeaseExpired } from './slots'

/** One performed emotion: what the Natural layer should currently hold and how strongly. */
export interface EmotionHold {
  readonly emotion: PerformanceEmotion
  readonly strength: number
}

const speechEvents: readonly SpeechEvent[] = ['clip-start', 'clip-end', 'clip-stopped', 'turn-end']

/**
 * Performs the current emotion hold from two sources: a decider-driven lease and a manual override.
 *
 * Time shares the caller's monotonic clock. The manual source wins while set and the lease
 * resumes unchanged once it clears. Speech facts are remembered per turn so a hold created or
 * replaced after a clip already started is seeded with those facts instead of expiring as
 * unstarted. The expression store does not replay them, so this class must not rely on it.
 */
export class EmotionHoldPerformer {
  private lease: SlotLease | null = null
  private held: EmotionHold | null = null
  private manual: EmotionHold | null = null
  private muted = false
  private settings: SlotLeaseSettings = { ...defaultExpressionPerformanceSettings.slots }
  /** Only started, unfinished turns are retained; terminal events own their cleanup. */
  private readonly activeSpeech = new Map<string, { lastClipEndAt: number | null }>()

  applyHolds(commands: HoldCommand[], now: number): void {
    if (!Number.isFinite(now))
      return
    for (const command of commands) {
      if (command.emotion === null) {
        this.release()
        continue
      }
      if (!Number.isFinite(command.holdSeconds) || command.holdSeconds < 0 || !Number.isFinite(command.strength) || (command.until !== 'speech' && command.until !== 'hold')) {
        console.warn('[emotion-hold] Hold command with invalid lifetime dropped:', command.emotion)
        continue
      }
      this.lease = this.seedLease(createLease(`emotion:${command.emotion}`, command, now))
      this.held = { emotion: command.emotion, strength: command.strength }
    }
  }

  /** Only a lease of the same turn reacts; leases without a turn follow their hold rule. */
  onSpeech(event: SpeechEvent, turnId: string, now: number): void {
    if (!Number.isFinite(now) || !speechEvents.includes(event))
      return
    switch (event) {
      case 'clip-start':
        if (!this.activeSpeech.has(turnId))
          this.activeSpeech.set(turnId, { lastClipEndAt: null })
        break
      case 'clip-end':
        if (this.activeSpeech.has(turnId))
          this.activeSpeech.set(turnId, { lastClipEndAt: now })
        break
      case 'clip-stopped':
      case 'turn-end':
        this.activeSpeech.delete(turnId)
        break
    }
    const lease = this.lease
    if (!lease || lease.turnId === null || lease.turnId !== turnId)
      return
    const next = applySpeechEvent(lease, event, now, this.muted, this.settings)
    if (next === null)
      this.release()
    else
      this.lease = next
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  setSlotSettings(settings: SlotLeaseSettings): void {
    this.settings = { speechGrace: settings.speechGrace, unstartedExpiry: settings.unstartedExpiry, holdCap: settings.holdCap }
  }

  setManual(hold: EmotionHold | null): void {
    this.manual = hold
  }

  /** An expired lease is released here, so reading is the only place lifetimes are enforced between events. */
  current(now: number): EmotionHold | null {
    if (this.manual)
      return this.manual
    if (this.lease && isLeaseExpired(this.lease, now, this.muted, this.settings))
      this.release()
    return this.held
  }

  private release(): void {
    this.lease = null
    this.held = null
  }

  /** Adopts ongoing speech only; a completed turn leaves a new lease's helper policy unchanged. */
  private seedLease(lease: SlotLease): SlotLease {
    if (lease.turnId === null)
      return lease
    const speech = this.activeSpeech.get(lease.turnId)
    return speech ? { ...lease, sawClipStart: true, lastClipEndAt: speech.lastClipEndAt } : lease
  }
}

/**
 * The preview hold for the most recent manual toggle that shows an emotion: ids in the rest set
 * are saved defaults, not toggles, so they never preview. The primary mapping is the heaviest,
 * earliest on ties, as in the decider's explicit-expression reaction. Its strength is the band
 * intensity of the mapping's minimum band, or `null` when the settings carry none.
 */
export function selectManualHold(input: {
  manualActive: readonly string[]
  restSet: readonly string[]
  catalog: readonly CatalogEntry[]
  intensity: ExpressionPerformanceSettings['intensity']
}): EmotionHold | null {
  for (let index = input.manualActive.length - 1; index >= 0; index--) {
    const id = input.manualActive[index]
    if (input.restSet.includes(id))
      continue
    const mappings = input.catalog.find(entry => entry.id === id)?.mappings ?? []
    const primary = mappings.reduce<CatalogEntry['mappings'][number] | null>((best, mapping) => best && best.weight >= mapping.weight ? best : mapping, null)
    if (!primary)
      continue
    const strength = input.intensity[primary.minBand]
    return Number.isFinite(strength) ? { emotion: primary.emotion, strength } : null
  }
  return null
}
