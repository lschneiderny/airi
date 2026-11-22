import type { AttendIntent, RefractoryRemaining } from '@proj-airi/character-mind'
import type { BodyDirectorInput, BodyDirectorMemory, BodyDirectorReport, BodyRefractory } from '@proj-airi/motion-driver-humanoid/director'
import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import { decideBody, initialBodyDirectorMemory, NO_BODY_REFRACTORY, NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'

/** Imported VMD motion names assigned to one model's stances. */
export interface MMDStanceSlots {
  idle?: string
  sit?: string
  sleep?: string
}

export type MMDStance = BodyIntent['stance']

/** Intents, clip requests, the mind's refractories, and the held body; every host supplies them, with or without a stage world. */
export type MMDStanceInteraction = Pick<BodyDirectorInput, 'attend' | 'away' | 'actionRequest' | 'actionFeedback' | 'refractory' | 'dragging'>

/** The world half of the director input; `NO_WORLD_BODY_INPUT` is its inert value. */
export type MMDStanceWorld = Omit<BodyDirectorInput, 'nowMs' | 'performance' | 'slots' | 'idle' | keyof MMDStanceInteraction>

export interface MMDStanceDiagnostics {
  stance: MMDStance
  /** Director-clock time, in milliseconds, at which the current stance began; it moves only on a stance change. */
  sinceMs: number
  /** Director-clock time, in milliseconds, of the last frame the director decided; it advances every frame. */
  nowMs: number
  /** Why the stance holds (`idle-timeout`, `away`, ...). */
  stanceReason: string
  /** The locomotion reason: `approach-chat`, `approach-cursor`, `return-home`, `wander`, `tool`, `debug`, `enter-stage` or `stay`. */
  reason: BodyIntent['locomotion']['reason']
  goalX: number | null
  pace: BodyIntent['locomotion']['pace']
  pendingGoal: { x: number, reason: string } | null
  /** Director-clock times until which the movement tools and the look tool are refused, from the character mind's refractories. */
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
  /** The roam mode of the latest frame; `stay` without a stage world. */
  roamMode: BodyDirectorInput['roamMode']
  /** A wander Natural asked for that the director holds until she may walk it. */
  pendingWander: BodyDirectorMemory['pendingWander']
  /** The director's answer to the latest wander Natural asked for. */
  wanderAnswer: BodyDirectorMemory['wanderAnswer']
  /** The accepted wander she is on until she leaves where it took her; null otherwise. */
  wanderStay: BodyDirectorMemory['wanderStay']
}

/**
 * The realiser's answer to wander errand `seq`, or null while it runs: `refused` when the director refused it, and
 * `done` once the director accepted it and she has left where it took her, at the walk home or when another goal took
 * her away (CM9d, decision D12).
 */
export function wanderErrandAnswer(diagnostics: Pick<MMDStanceDiagnostics, 'wanderAnswer' | 'wanderStay'>, seq: number): 'done' | 'refused' | null {
  if (diagnostics.wanderAnswer?.seq !== seq)
    return null
  if (!diagnostics.wanderAnswer.accepted)
    return 'refused'
  return diagnostics.wanderStay?.seq === seq ? null : 'done'
}

/**
 * Her long idle states as the director takes them: settled in, as the character mind's last `settle` intent said, or
 * asleep while Natural's sleep is not released. Every host that drives the director from Natural uses this (the scene
 * and the headless QA runner).
 */
export function directorIdleStates(settled: boolean, behaviour: { readonly kind: string, readonly releasedAt: number | null } | null): BodyDirectorInput['idle'] {
  return { settled, asleep: behaviour?.kind === 'sleep' && behaviour.releasedAt === null }
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
 * The director's inbox for the mind's attend intents: clip-ending causes, chat approaches, and the cursor window.
 *
 * The character mind's `attend` intent arrives outside the frame loop, so the window opens on the director time of the
 * next frame that runs the director. The time of the last frame would be stale after the loop stalled (a paused stage,
 * a hidden window, a model still loading) and could close the window before any frame saw it.
 */
export class MMDAttendInbox {
  private requestedMs: number | null = null
  private attend: BodyDirectorInput['attend'] = { untilMs: null, touchSeq: 0, chatSeq: 0, chatOpenSeq: 0 }

  /** Counts every intent once at delivery; a cursor intent replaces the window at the next frame. */
  receive(intent: AttendIntent): void {
    if (intent.target === 'chat') {
      this.attend.chatSeq++
      this.attend.chatOpenSeq++
      return
    }
    this.requestedMs = intent.windowMs
    if (intent.attendCause === 'chat-send')
      this.attend.chatSeq++
    else
      this.attend.touchSeq++
  }

  /** A snapshot for this frame; windows start on its director clock, never on a stale event-time frame. */
  atFrame(directorMs: number): BodyDirectorInput['attend'] {
    if (this.requestedMs !== null) {
      this.attend.untilMs = directorMs + this.requestedMs
      this.requestedMs = null
    }
    return { ...this.attend }
  }
}

/**
 * The director's inbox for the mind's refractories (CM10): the durations its `refractory` intent left.
 *
 * The intent arrives outside the frame loop, so the durations start on the director time of the next frame, as the
 * attend window does. The inbox outlives a model reload, so a new director reads the same refractories.
 */
export class MMDRefractoryInbox {
  private requested: RefractoryRemaining | null = null
  private stamped: BodyRefractory = NO_BODY_REFRACTORY

  /** Keeps the latest durations; the next frame stamps them. */
  receive(remaining: RefractoryRemaining): void {
    this.requested = remaining
  }

  /** The refractories for this frame, stamped on its director clock when new durations arrived. */
  atFrame(directorMs: number): BodyRefractory {
    const remaining = this.requested
    if (remaining !== null) {
      this.stamped = {
        actionUntilMs: directorMs + remaining.actionMs,
        danceUntilMs: directorMs + remaining.danceMs,
        gesture: remaining.gesture && { clipId: remaining.gesture.clipId, untilMs: directorMs + remaining.gesture.remainingMs },
        moveToolUntilMs: directorMs + remaining.moveToolMs,
        lookToolUntilMs: directorMs + remaining.lookToolMs,
      }
      this.requested = null
    }
    return this.stamped
  }
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
  private roamMode: BodyDirectorInput['roamMode'] = 'stay'
  private refractory: BodyRefractory = NO_BODY_REFRACTORY

  /**
   * @returns The base motion for this frame (`null` for the rest pose), whether it differs from the base motion
   * returned by the previous call, and what the director stamped, for the character mind.
   */
  update(input: {
    nowMs: number
    performance: Pick<PerformanceState, 'mode'>
    slots: MMDStanceSlots
    idleMotionName: string
    isRegistered: (name: string) => boolean
    /** Rejects a clip as a standing base; absent accepts every clip. */
    baseEligible?: (name: string) => boolean
    /** Omitted without a stage world: no ground, so no goal is ever issued. */
    world?: MMDStanceWorld
    /** Attend intents under Natural, clip requests under every driver, and whether the body is held. */
    interaction: MMDStanceInteraction
    /** Her long idle states (`directorIdleStates`); absent under another driver, when she neither settles nor sleeps. */
    idle?: BodyDirectorInput['idle']
  }): { motion: string | null, changed: boolean, reports: BodyDirectorReport[] } {
    const ready = (name: string | undefined) => name !== undefined && name !== '' && input.isRegistered(name)
    const available = { sit: ready(input.slots.sit), sleep: ready(input.slots.sleep) }
    const world = input.world ?? NO_WORLD_BODY_INPUT
    if (this.memory === initialBodyDirectorMemory) {
      // Requests that predate this model's load belong to an earlier director; only newer ones count.
      this.memory = {
        ...this.memory,
        lastChatOpenSeq: input.interaction.attend.chatOpenSeq,
        lastTouchSeq: input.interaction.attend.touchSeq,
        lastChatSeq: input.interaction.attend.chatSeq,
        lastActionSeq: input.interaction.actionRequest?.seq ?? 0,
        lastToolSeq: world.toolRequest?.seq ?? 0,
        lastDebugSeq: world.debugGoal?.seq ?? 0,
      }
    }
    const { intent, memory, reports } = decideBody({
      nowMs: input.nowMs,
      performance: input.performance,
      slots: available,
      ...world,
      ...input.interaction,
      idle: input.idle ?? { settled: false, asleep: false },
    }, this.memory)
    this.memory = memory
    this.lastIntent = intent
    this.roamMode = world.roamMode
    this.refractory = input.interaction.refractory
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
    else if (intent.rest === 'rest')
      this.reason = 'rest-fallback'
    else if (intent.rest === 'doze')
      this.reason = 'doze-fallback'
    else if (input.interaction.away)
      this.reason = available.sleep ? 'dwell' : 'no-sleep-slot'
    else if (input.performance.mode === 'idle')
      this.reason = available.sit ? 'idle' : 'no-sit-slot'
    else
      this.reason = 'active'

    const changed = motion !== this.applied
    this.applied = motion
    return { motion, changed, reports }
  }

  /** The latest body directives; null before the first frame. */
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
      moveRefractoryUntilMs: this.refractory.moveToolUntilMs,
      lookRefractoryUntilMs: this.refractory.lookToolUntilMs,
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
      roamMode: this.roamMode,
      pendingWander: this.memory.pendingWander,
      wanderAnswer: this.memory.wanderAnswer,
      wanderStay: this.memory.wanderStay,
    }
  }
}
