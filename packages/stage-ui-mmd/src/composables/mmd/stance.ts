import type { BodyDirectorInput, BodyDirectorMemory } from '@proj-airi/motion-driver-humanoid/director'
import type { BodyIntent, Vec3 } from '@proj-airi/motion-driver-humanoid/types'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import { decideBody, initialBodyDirectorMemory, NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'

/** Imported VMD motion names assigned to one model's stances. */
export interface MMDStanceSlots {
  idle?: string
  sit?: string
  sleep?: string
}

export type MMDStance = BodyIntent['stance']

/** The user-interaction and action half of the director input; every host supplies it, with or without a stage world. */
export type MMDStanceInteraction = Pick<BodyDirectorInput, 'interactionSeq' | 'chatSendSeq' | 'interactionAtMs' | 'actionRequest' | 'actionFeedback' | 'dragging'>

/** The world half of the director input; `NO_WORLD_BODY_INPUT` is its inert value. */
export type MMDStanceWorld = Omit<BodyDirectorInput, 'nowMs' | 'performance' | 'cursorPoint' | 'chatPoint' | 'cameraPoint' | 'slots' | keyof MMDStanceInteraction>

export interface MMDStanceDiagnostics {
  stance: MMDStance
  /** Director-clock time, in milliseconds, at which the current stance began; it moves only on a stance change. */
  sinceMs: number
  /** Director-clock time, in milliseconds, of the last frame the director decided; it advances every frame. */
  nowMs: number
  /** Why the stance holds (`idle-timeout`, `away`, ...). */
  stanceReason: string
  /** The locomotion reason: `approach-chat`, `approach-cursor`, `return-home`, `wander`, `tool`, `debug` or `stay`. */
  reason: BodyIntent['locomotion']['reason']
  goalX: number | null
  pace: BodyIntent['locomotion']['pace']
  pendingGoal: { x: number, reason: string } | null
  nextWanderAtMs: number | null
  moveRefractoryUntilMs: number
  lookRefractoryUntilMs: number
  lastToolSeq: number
  toolRefused: boolean
  toolRetryAfterMs: number | null
  /**
   * The accepted clip performance, or null when none runs. `sinceMs` is the director-clock start of the phase and
   * `durationMs` the clip length, so a reader can tell when a non-looping clip ends.
   */
  performing: { seq: number, clipId: string, layer: 'full' | 'upper', loop: boolean, phase: 'settling' | 'playing', sinceMs: number, durationMs: number } | null
  lastActionSeq: number
  actionRefusal: BodyDirectorMemory['actionRefusal']
  actionRetryAfterMs: number | null
  toolRefusalReason: BodyDirectorMemory['toolRefusalReason']
}

/** Gap, in leg lengths, between her body and the chat window's near edge when she stops beside it. */
export const CHAT_STAND_GAP_LEGS = 0.25

/**
 * The `chatX` the director should see so that she stops beside the chat, not over it.
 *
 * Her stand spot is the chat's near edge (the edge facing her root) pushed out by half her body width plus
 * `CHAT_STAND_GAP_LEGS`. When that spot is off the ground line (`ground`, root x) she uses the other side. The director then offsets `chatX` by one leg length toward home, whichever side of the chat
 * home is on, so this subtracts that leg toward home and she arrives exactly at the stand spot. All values are ground
 * x in model units.
 */
export function chatStandX(chat: { minX: number, maxX: number }, rootX: number, homeX: number, halfWidth: number, legLength: number, ground: { minX: number, maxX: number }): number {
  const centre = (chat.minX + chat.maxX) / 2
  const towardHome = homeX >= centre ? 1 : -1
  const standOn = (side: number) => (side > 0 ? chat.maxX : chat.minX) + side * (halfWidth + CHAT_STAND_GAP_LEGS * legLength)
  const onGround = (x: number) => x >= ground.minX && x <= ground.maxX
  let side = rootX >= centre ? 1 : -1
  // A chat near the work-area edge can leave no ground beside it on her side; standing there would put her over it.
  if (!onGround(standOn(side)) && onGround(standOn(-side)))
    side = -side
  return standOn(side) - towardHome * legLength
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
 * stands in its rest pose. `baseEligible` rejects clips that must never loop as a base, such as an exposed action.
 */
export function standingBaseMotion(idleMotionName: string, slots: MMDStanceSlots, baseEligible: (name: string) => boolean = () => true): string | null {
  const standable = (name: string | undefined) => !!name && name !== slots.sit && name !== slots.sleep && baseEligible(name)
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
  private lastIntent: BodyIntent | null = null

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
    /** Rejects a clip as a standing base; absent accepts every clip. */
    baseEligible?: (name: string) => boolean
    /** Target points in model units; absent points leave the matching attention without a target. */
    points?: { cursor: Vec3 | null, chat: Vec3 | null, camera: Vec3 | null }
    /** Omitted in classic mode: no ground, so no goal is ever issued. */
    world?: MMDStanceWorld
    /** Pokes, drags and clip requests; classic mode has them too. */
    interaction: MMDStanceInteraction
  }): { motion: string | null, changed: boolean } {
    const ready = (name: string | undefined) => name !== undefined && name !== '' && input.isRegistered(name)
    const available = { sit: ready(input.slots.sit), sleep: ready(input.slots.sleep) }
    const world = input.world ?? NO_WORLD_BODY_INPUT
    if (this.memory === initialBodyDirectorMemory) {
      // Requests that predate this model's load belong to an earlier director; only newer ones count.
      this.memory = {
        ...this.memory,
        lastUnfoldSeq: world.chatUnfoldSeq,
        lastInteractionSeq: input.interaction.interactionSeq,
        lastSendSeq: input.interaction.chatSendSeq,
        lastActionSeq: input.interaction.actionRequest?.seq ?? 0,
        lastToolSeq: world.toolRequest?.seq ?? 0,
        lastDebugSeq: world.debugGoal?.seq ?? 0,
      }
    }
    const { intent, memory } = decideBody({
      nowMs: input.nowMs,
      performance: input.performance,
      cursorPoint: input.points?.cursor ?? null,
      chatPoint: input.points?.chat ?? null,
      cameraPoint: input.points?.camera ?? null,
      slots: available,
      ...world,
      ...input.interaction,
    }, this.memory)
    this.memory = memory
    this.lastIntent = intent
    this.startMs ??= memory.nowMs

    const standing = standingBaseMotion(input.idleMotionName, input.slots, input.baseEligible)
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

  /** The latest intent, which the body reads for its attention target; null before the first frame. */
  get intent(): BodyIntent | null {
    return this.lastIntent
  }

  /**
   * The host moved her (a drag or a teleport): drop the goal in progress and any held goal, and restart the return-home
   * delay, so the next frame never walks her back.
   */
  clearGoal(): void {
    this.memory = {
      ...this.memory,
      goalX: null,
      goalSinceMs: null,
      reason: 'stay',
      pendingGoal: null,
      lastReasonMs: this.memory.nowMs ?? this.memory.lastReasonMs,
    }
  }

  /** Every clip that can loop on the base layer for this model. */
  get baseClips(): ReadonlySet<string> {
    return this.candidates
  }

  get diagnostics(): MMDStanceDiagnostics {
    return {
      stance: this.memory.stance,
      sinceMs: this.memory.stanceSinceMs ?? this.startMs ?? 0,
      nowMs: this.memory.nowMs ?? 0,
      stanceReason: this.reason,
      reason: this.memory.reason,
      goalX: this.memory.goalX,
      pace: this.memory.goalPace,
      pendingGoal: this.memory.pendingGoal && { x: this.memory.pendingGoal.x, reason: this.memory.pendingGoal.reason },
      nextWanderAtMs: this.memory.nextWanderAtMs,
      moveRefractoryUntilMs: this.memory.moveRefractoryUntilMs,
      lookRefractoryUntilMs: this.memory.lookRefractoryUntilMs,
      lastToolSeq: this.memory.lastToolSeq,
      toolRefused: this.memory.toolRefused,
      toolRetryAfterMs: this.memory.toolRetryAfterMs,
      performing: this.memory.performing && {
        seq: this.memory.performing.request.seq,
        clipId: this.memory.performing.request.clipId,
        layer: this.memory.performing.request.layer,
        loop: this.memory.performing.request.loop,
        phase: this.memory.performing.phase,
        sinceMs: this.memory.performing.sinceMs,
        durationMs: this.memory.performing.request.durationMs,
      },
      lastActionSeq: this.memory.lastActionSeq,
      actionRefusal: this.memory.actionRefusal,
      actionRetryAfterMs: this.memory.actionRetryAfterMs,
      toolRefusalReason: this.memory.toolRefusalReason,
    }
  }
}
