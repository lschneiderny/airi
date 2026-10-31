import type { BodyDirectorMemory } from '@proj-airi/motion-driver-humanoid/director'
import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import { decideBody, initialBodyDirectorMemory, NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'

/** Imported VMD motion names assigned to one model's stances. */
export interface MMDStanceSlots {
  idle?: string
  sit?: string
  sleep?: string
}

export type MMDStance = BodyIntent['stance']

export interface MMDStanceDiagnostics {
  stance: MMDStance
  /** Director-clock time, in milliseconds, at which the current stance began. */
  sinceMs: number
  reason: string
}

/**
 * Splits one frame timestamp into the Natural clock and the director clock.
 *
 * The debug offset from `advanceDirectorClock` shifts the director input only.
 * Natural motion and physics keep real time, so skipping ahead to a stance
 * change never fast-forwards breathing, blinks, or rigid bodies.
 */
export function frameClocks(nowMs: number, directorOffsetMs: number): { naturalSeconds: number, directorMs: number } {
  return { naturalSeconds: nowMs / 1000, directorMs: nowMs + directorOffsetMs }
}

/**
 * Resolves the looping base clip while standing.
 *
 * The per-model idle slot wins over the global idle selection. A motion in
 * this model's sit or sleep slot never plays while standing, even when it is
 * also the idle slot or the global idle (the import handler auto-selects the
 * first imported VMD). Such a candidate is skipped; with none left the model
 * stands in its rest pose.
 */
export function standingBaseMotion(idleMotionName: string, slots: MMDStanceSlots): string | null {
  const standable = (name: string | undefined) => !!name && name !== slots.sit && name !== slots.sleep
  if (standable(slots.idle))
    return slots.idle ?? null
  if (standable(idleMotionName))
    return idleMotionName
  return null
}

/**
 * Runs the body director once per frame and maps its stance to a base clip.
 *
 * The director memory is renderer-neutral; this class only adds slot lookup,
 * the base clip that should loop for the chosen stance, and diagnostics.
 */
export class MMDStanceDirector {
  private memory: BodyDirectorMemory = initialBodyDirectorMemory
  private startMs: number | null = null
  private applied: string | null | undefined
  private reason = 'initial'
  private candidates = new Set<string>()

  /**
   * @returns The base motion for this frame (`null` for the rest pose) and
   * whether it differs from the base motion returned by the previous call.
   */
  update(input: {
    nowMs: number
    performance: Pick<PerformanceState, 'mode' | 'attention' | 'away'>
    slots: MMDStanceSlots
    idleMotionName: string
    isRegistered: (name: string) => boolean
  }): { motion: string | null, changed: boolean } {
    const ready = (name: string | undefined) => name !== undefined && name !== '' && input.isRegistered(name)
    const available = { sit: ready(input.slots.sit), sleep: ready(input.slots.sleep) }
    const { intent, memory } = decideBody({
      nowMs: input.nowMs,
      performance: input.performance,
      cursorPoint: null,
      chatPoint: null,
      cameraPoint: null,
      slots: available,
      ...NO_WORLD_BODY_INPUT,
    }, this.memory)
    this.memory = memory
    this.startMs ??= memory.nowMs

    const standing = standingBaseMotion(input.idleMotionName, input.slots)
    this.candidates = new Set([standing, input.slots.sit, input.slots.sleep].filter((name): name is string => !!name))
    const wanted = intent.stance === 'sit'
      ? input.slots.sit
      : intent.stance === 'sleep'
        ? input.slots.sleep
        : standing ?? undefined
    const motion = ready(wanted) ? wanted ?? null : null

    if (intent.stance === 'sit')
      this.reason = 'idle-timeout'
    else if (intent.stance === 'sleep')
      this.reason = 'away'
    else if (input.performance.away)
      this.reason = available.sleep ? 'dwell' : 'no-sleep-slot'
    else if (input.performance.mode === 'idle')
      this.reason = available.sit ? 'idle' : 'no-sit-slot'
    else
      this.reason = 'active'

    const changed = motion !== this.applied
    this.applied = motion
    return { motion, changed }
  }

  /** Every clip that can loop on the base layer for this model. */
  get baseClips(): ReadonlySet<string> {
    return this.candidates
  }

  get diagnostics(): MMDStanceDiagnostics {
    return {
      stance: this.memory.stance,
      sinceMs: this.memory.stanceSinceMs ?? this.startMs ?? 0,
      reason: this.reason,
    }
  }
}
