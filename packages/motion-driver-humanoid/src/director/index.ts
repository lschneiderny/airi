import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { LocomotionFrame } from '../locomotion'
import type { BodyIntent, BodyLocomotionReason, BodyLookTarget } from '../types'

import { createRandomStream } from '../random'
import { STROLL_URGENCY, WALK_URGENCY } from '../types'

export type { BodyLookTarget } from '../types'

/**
 * Continuous idle time in milliseconds after which she settles in: the character mind's idle policy times it
 * (`SETTLE_SECONDS`), and the director realises the settle it orders (`BodyDirectorInput.idle`). Reports read it as
 * the rest onset.
 */
export const IDLE_TO_SIT_MS = 120_000

/** Minimum time in milliseconds between stance changes. */
export const STANCE_MIN_DWELL_MS = 3_000

/** Distance, in leg lengths, at which a chase stops short of the cursor, and within which a cursor can end a chase. */
export const CHASE_STOP_LEGS = 1.0

/**
 * Minimum rest offset in leg lengths for one corrective step onto the cursor after a chase.
 * Tuning value from the owner's D16 ruling of 2026-11-21: correct the final offset after the chase.
 */
export const STEP_ONTO_CURSOR_MIN_LEGS = 0.15

/** Milliseconds with no goal reason before the character walks home. */
export const RETURN_HOME_DELAY_MS = 20_000

/**
 * How urgently she walks for each reason (plan `walk-style` 2.5), so a chase, a walk to the chat, a wander and the walk
 * home each ask for their own pace. Every reason keeps its former pace (stroll 0.3, walk 0.6) except three: a wander
 * ambles below a stroll, a chat that unfolds draws her a little slower than a walk, and a chase of the cursor hurries.
 * The chase and the corrective step onto the cursor share a reason; the director tells them apart by these values.
 */
export const GOAL_URGENCY = Object.freeze({
  wander: 0.2,
  visit: STROLL_URGENCY,
  returnHome: STROLL_URGENCY,
  cursorStep: STROLL_URGENCY,
  approachChat: 0.5,
  tool: WALK_URGENCY,
  enterStage: WALK_URGENCY,
  chase: 0.75,
})

/** Share of due wanders that walk over to where the user is working, when the cursor shows where that is. */
export const VISIT_SHARE = 0.6

/** Distance, in leg lengths, at which a visit stops short of the cursor: near enough to watch, not on top of it. */
export const VISIT_STOP_LEGS = 1.5

/** Minimum time in milliseconds a goal in progress is kept before it is replaced. */
export const GOAL_MIN_DWELL_MS = 3_000

/** Duration in milliseconds a look-at tool overrides the attention target. */
export const LOOK_OVERRIDE_MS = 8_000

/** Time in milliseconds a goal blocked by a gate is held before it is dropped. */
export const PENDING_GOAL_TTL_MS = 30_000

/** Time in milliseconds a character must have stood after standing up before a full-body clip starts. */
export const STAND_SETTLE_MS = 800

/** Longest wait in milliseconds for the body to stand and stop walking before a full-body clip starts anyway. */
export const SETTLE_TIMEOUT_MS = 2_000

/** A one-shot playing longer than its duration plus this many milliseconds without feedback ends. */
export const PERFORM_WATCHDOG_MS = 2_000

/** Distance, in world units, within which the root counts as at a point. */
const ARRIVAL_TOLERANCE = 0.1

/** Preferred minimum wander distance in leg lengths. */
const WANDER_MIN_LEGS = 3

/**
 * Smallest wander distance in leg lengths. When three legs fit on neither side, as for a tall character on a narrow
 * work area, the minimum shrinks to half the longer free side, but never below this.
 */
const WANDER_FLOOR_LEGS = 1

/** A tool request from the model; a new `seq` marks a new request. */
export interface BodyToolRequest {
  seq: number
  kind: 'come-here' | 'go-home' | 'look-at'
  target?: BodyLookTarget
}

/** What a clip is for; it decides the refractory and the refusal rules. */
export type BodyActionKind = 'gesture' | 'action' | 'dance'

/** `full` owns the whole body; `upper` plays over the base and the walk. */
export type BodyActionLayer = 'full' | 'upper'

/** Why an action request was refused. */
export type BodyActionRefusal = 'refractory' | 'busy' | 'asleep' | 'dragging'

/**
 * An action request; a new `seq` marks a new request. An empty `clipId` from the `tool` or `debug` source stops the
 * running performance.
 *
 * The `idle` source is a clip she plays unasked while nothing else claims her. It is the weakest request: it is
 * refused while anything performs, while she walks, and while she talks, listens or thinks; the character mind arms no
 * refractory and no gesture cooldown for it, so it never makes the model's own request wait; a request from any other source replaces it;
 * and it ends when the user touches her, drags her, opens the chat, sends a message, or when she starts to talk.
 */
export interface BodyActionRequest {
  seq: number
  clipId: string
  kind: BodyActionKind
  layer: BodyActionLayer
  loop: boolean
  durationMs: number
  source: 'act' | 'tool' | 'debug' | 'idle'
}

/**
 * The character mind's refractories on the director clock (CM10): the host stamps the durations the mind's `refractory`
 * intent left at its next director frame. A clip or tool request inside one is refused `refractory`; 0 is none.
 */
export interface BodyRefractory {
  /** Until when another action is refused, after an action ended. */
  actionUntilMs: number
  /** Until when another dance is refused, after a dance ended. */
  danceUntilMs: number
  /** The gesture clip that may not repeat yet. */
  gesture: { clipId: string, untilMs: number } | null
  /** Until when the come-here and go-home tools are refused. */
  moveToolUntilMs: number
  /** Until when the look-at tool is refused. */
  lookToolUntilMs: number
}

/** No refractory runs: for a host without a character mind, and before the first `refractory` intent. */
export const NO_BODY_REFRACTORY: BodyRefractory = Object.freeze({ actionUntilMs: 0, danceUntilMs: 0, gesture: null, moveToolUntilMs: 0, lookToolUntilMs: 0 })

/**
 * What one director call stamped, in order, for the character mind, which keeps the refractories once per character.
 * The director reports every counted clip end and every accepted gesture clip, whatever its source; the mind decides
 * which of them arm a refractory.
 */
export type BodyDirectorReport
  /** A performance ended and counts: it finished, the watchdog ended it, or a user intent or a stop ended it. A failed or replaced clip is not reported. */
  = | { kind: 'clip-ended', clip: BodyActionKind, source: BodyActionRequest['source'] }
  /** A gesture clip was accepted. */
    | { kind: 'gesture-clip', clipId: string, source: BodyActionRequest['source'] }
  /** A tool request was accepted. */
    | { kind: 'tool-accepted', tool: BodyToolRequest['kind'] }

/** The adapter's report on the clip the director last accepted. */
export interface BodyActionFeedback {
  seq: number
  state: 'playing' | 'finished' | 'failed'
}

/** A locomotion goal request before the gates are applied. */
export interface BodyGoalRequest {
  x: number
  /** In [0, 1]; see `BodyLocomotionIntent.urgency`. */
  urgency: number
  reason: BodyLocomotionReason
}

/** Inputs required to produce a renderer-neutral body intent for one frame. */
export interface BodyDirectorInput {
  /** Epoch milliseconds supplied by the caller; this module never reads a clock. */
  nowMs: number
  /** The resolved performance mode remains continuous world state. */
  performance: Pick<PerformanceState, 'mode'>
  /** The character mind's presence answer; false under drivers that receive no intents. */
  away: boolean
  /** Imported stance clips available for this model. */
  slots: {
    sit: boolean
    sleep: boolean
  }
  /** Walkable ground line; null means no world (legacy window mode). */
  ground: { minX: number, maxX: number } | null
  /**
   * Every ground line she may walk to, as on a row of displays; `ground` is the one she stands on. Goals with a
   * destination (the chat, the cursor, home, a tool, the debug goal) clamp to the nearest zone, so they can cross from
   * one zone to another. A wander stays on `ground`. The stretch between two zones is a wing: there a clip that
   * stops her is refused as busy, and a root at rest walks to the nearest zone.
   * Omitted: `ground` is the only zone, and no wing rule applies.
   */
  reach?: readonly { minX: number, maxX: number }[]
  rootX: number
  /**
   * The gait's predicted rest point (`LocomotionFrame.restX`): where the root comes to rest if the goal ends now. Null
   * without a gait frame, when she stands at `rootX`.
   */
  restX: number | null
  homeX: number
  locomotionMode: LocomotionFrame['mode']
  /** True while a clip owns the root. */
  clipOwnsRoot: boolean
  speaking: boolean
  roamMode: 'stay' | 'roam'
  chatX: number | null
  /** Fed only by the character mind's `attend` intents; counters are monotonic within one scene. */
  attend: {
    /** Director time until which she may walk toward the cursor, or null. */
    untilMs: number | null
    /** Touch and drag attends: a new value ends a broad clip. */
    touchSeq: number
    /** Chat-send and chat-unfold attends: a new value ends a looping or unasked clip. */
    chatSeq: number
    /** Chat-unfold attends: a new value asks for the walk to the chat. */
    chatOpenSeq: number
  }
  actionRequest: BodyActionRequest | null
  actionFeedback: BodyActionFeedback | null
  /** The character mind's refractories; `NO_BODY_REFRACTORY` without a mind. */
  refractory: BodyRefractory
  /** True while the user drags the character. */
  dragging: boolean
  cursorX: number | null
  cursorOnStage: boolean
  toolRequest: BodyToolRequest | null
  /** Lab "Walk here" goal; same gates as every other reason, no refractory. */
  debugGoal: { seq: number, x: number, urgency: number } | null
  /** Leg length in model units; every distance rule scales by it. */
  legLength: number
  seed: number
  /**
   * Natural's long idle states, which the one idle scheduler decides (idle agency ADR, amendment of 2026-11-13): she has
   * settled in after a long idle, or she is asleep. The director realises them, as a stance clip when the model has
   * one for it and as a procedural rest or doze (`BodyIntent.rest`) when it has none, or refuses them while she must
   * stand. Both false while no idle drive runs: she then neither settles nor sleeps.
   */
  idle: { settled: boolean, asleep: boolean }
  /**
   * A wander Natural's idle draw started (its errand `seq`; idle agency ADR, amendment of 2026-11-14), or null. A new
   * `seq` is a new request. The mind's `pick` decides the visit share, and `lingerSeconds` is how long she stays where
   * the wander or visit took her, which the mind drew with the errand. The director walks it in roam mode as a wander or a visit, holds it while she cannot walk
   * yet, and refuses it without ground, outside roam mode, on arrival from another goal, without room to wander, or
   * when it could not be walked within `PENDING_GOAL_TTL_MS`. `BodyDirectorMemory.wanderAnswer` carries the answer.
   */
  wander: { seq: number, pick: number, lingerSeconds: number } | null
}

/**
 * Inert geometry for hosts without a stage world: every goal rule stays inactive.
 * Every host still supplies mode, slots, attend and away, clip requests, dragging, and idle states.
 */
export const NO_WORLD_BODY_INPUT: Omit<BodyDirectorInput, 'nowMs' | 'performance' | 'slots' | 'away' | 'attend' | 'actionRequest' | 'actionFeedback' | 'refractory' | 'dragging' | 'idle'> = Object.freeze({
  ground: null,
  rootX: 0,
  restX: null,
  homeX: 0,
  locomotionMode: 'idle',
  clipOwnsRoot: false,
  speaking: false,
  roamMode: 'stay',
  chatX: null,
  cursorX: null,
  cursorOnStage: false,
  toolRequest: null,
  debugGoal: null,
  legLength: 1,
  seed: 0,
  wander: null,
})

/** Hysteresis state supplied to the next director call. */
export interface BodyDirectorMemory {
  /** Latest finite, non-decreasing epoch time in milliseconds. */
  readonly nowMs: number | null
  /** Start of the current uninterrupted idle period, in epoch milliseconds. */
  readonly idleSinceMs: number | null
  /** Last stance returned by the director. */
  readonly stance: BodyIntent['stance']
  /** Time the last stance change was returned, or null before one occurs. */
  readonly stanceSinceMs: number | null
  readonly goalX: number | null
  readonly goalSinceMs: number | null
  readonly goalUrgency: number
  readonly reason: BodyLocomotionReason
  /** A chase ended within reach; once at rest she may take one step onto the cursor. */
  readonly cursorStepPending: boolean
  /** A goal a gate blocked, held until the gate opens or the time to live passes. */
  readonly pendingGoal: (BodyGoalRequest & { requestedAtMs: number }) | null
  readonly lastChatOpenSeq: number
  readonly lastTouchSeq: number
  readonly lastChatSeq: number
  readonly lastToolSeq: number
  readonly lastDebugSeq: number
  readonly toolRefused: boolean
  /** Milliseconds until a refused tool may be retried, or null when none was refused. */
  readonly toolRetryAfterMs: number | null
  /** Why the latest refused tool was refused, or null after an accepted one. */
  readonly toolRefusalReason: 'refractory' | 'no-world' | 'chat-closed' | null
  /** The accepted clip performance; `settling` until the body is clear, then `playing`. */
  readonly performing: { request: BodyActionRequest, phase: 'settling' | 'playing', sinceMs: number } | null
  readonly lastActionSeq: number
  readonly actionRefusal: BodyActionRefusal | null
  /** Milliseconds until a refused action may be retried; null when none applies. */
  readonly actionRetryAfterMs: number | null
  /** Latest time a goal reason held, used for the return-home delay. */
  readonly lastReasonMs: number | null
  /** The latest wander request read; a request with a higher `seq` is new. */
  readonly lastWanderSeq: number
  /** A wander asked for and not walked yet, and since when. */
  readonly pendingWander: { seq: number, pick: number, lingerSeconds: number, sinceMs: number } | null
  /** The answer to the latest wander request: walked (`accepted`) or refused; null before the first. */
  readonly wanderAnswer: { seq: number, accepted: boolean } | null
  /** Until when she stays where a wander or a visit took her before walking home; 0 when no stay applies. */
  readonly lingerUntilMs: number
  /**
   * The accepted wander errand she is on, from its acceptance until she leaves where it took her: at the walk home, at
   * home once its linger passed, or when another goal takes her away. Its realiser ends the errand when it clears.
   */
  readonly wanderStay: { seq: number, lingerSeconds: number } | null
  /** Mulberry32 seed advanced after every wander position draw; null until seeded from the input. */
  readonly rngState: number | null
  readonly lookOverride: { seq: number, target: BodyLookTarget, untilMs: number } | null
}

/** Initial pure director state for a newly loaded rig. */
export const initialBodyDirectorMemory: BodyDirectorMemory = Object.freeze({
  nowMs: null,
  idleSinceMs: null,
  stance: 'stand',
  stanceSinceMs: null,
  goalX: null,
  goalSinceMs: null,
  goalUrgency: WALK_URGENCY,
  reason: 'stay',
  cursorStepPending: false,
  pendingGoal: null,
  lastChatOpenSeq: 0,
  lastTouchSeq: 0,
  lastChatSeq: 0,
  lastToolSeq: 0,
  lastDebugSeq: 0,
  toolRefused: false,
  toolRetryAfterMs: null,
  toolRefusalReason: null,
  performing: null,
  lastActionSeq: 0,
  actionRefusal: null,
  actionRetryAfterMs: null,
  lastReasonMs: null,
  lastWanderSeq: 0,
  pendingWander: null,
  wanderAnswer: null,
  lingerUntilMs: 0,
  wanderStay: null,
  rngState: null,
  lookOverride: null,
})

function clampToGround(x: number, ground: { minX: number, maxX: number }): number {
  return Math.min(Math.max(x, ground.minX), ground.maxX)
}

/** The point of the zones nearest to `x`: `x` itself inside a zone, otherwise the closest zone edge. */
function clampToZones(x: number, zones: readonly { minX: number, maxX: number }[]): number {
  let nearest = x
  let distance = Infinity
  for (const zone of zones) {
    const clamped = clampToGround(x, zone)
    if (Math.abs(clamped - x) < distance) {
      nearest = clamped
      distance = Math.abs(clamped - x)
    }
  }
  return nearest
}

/**
 * Where she stops for the chat anchor `chatX`: one leg length short of it, on the side of home.
 * The approach-chat reason and the come-here tool share this rule.
 */
function chatStandGoal(chatX: number, homeX: number, leg: number, zones: readonly { minX: number, maxX: number }[]): number {
  const anchor = clampToZones(chatX, zones)
  return clampToZones(anchor + Math.sign(homeX - anchor) * leg, zones)
}

/** Draws one uniform value and returns the advanced seed; no hidden state. */
/**
 * True once her rest point has reached `x` in the direction she walks: the rest point's side of her root while she
 * moves, the goal's side while she has not set off.
 */
function restReaches(x: number, rootX: number, restX: number, goalX: number): boolean {
  const heading = Math.sign(restX - rootX) || Math.sign(goalX - rootX) || 1
  return (restX - x) * heading >= 0
}

function drawRandom(state: number): { value: number, state: number } {
  const stream = createRandomStream(state)
  const value = stream()
  return { value, state: Math.floor(stream() * 2 ** 32) >>> 0 }
}

/**
 * Produces body directives without side effects.
 *
 * Time is supplied in milliseconds and clamped against the latest finite
 * timestamp in memory. Idle duration and stance dwell are retained only in the
 * returned memory, which callers pass into the next frame.
 */
export function decideBody(
  input: BodyDirectorInput,
  previous: BodyDirectorMemory,
): { intent: BodyIntent, memory: BodyDirectorMemory, reports: BodyDirectorReport[] } {
  const finiteNowMs = Number.isFinite(input.nowMs) ? input.nowMs : previous.nowMs ?? 0
  const nowMs = previous.nowMs === null ? finiteNowMs : Math.max(previous.nowMs, finiteNowMs)
  const { ground } = input
  // Goals with a destination clamp to these; without `reach` they are the ground line alone.
  const zones = ground === null ? [] : input.reach ?? [ground]
  const inWing = input.reach !== undefined
    && ground !== null
    && Math.abs(clampToZones(input.rootX, input.reach) - input.rootX) > ARRIVAL_TOLERANCE
  const atHome = Math.abs(input.rootX - input.homeX) <= ARRIVAL_TOLERANCE

  const leg = input.legLength
  const { refractory } = input
  const reports: BodyDirectorReport[] = []
  let rngState = previous.rngState ?? input.seed >>> 0
  let goalX = ground === null ? null : previous.goalX
  let goalSinceMs = previous.goalSinceMs
  let goalUrgency = previous.goalUrgency
  let reason = ground === null ? 'stay' : previous.reason
  let cursorStepPending = previous.cursorStepPending
  let pending = previous.pendingGoal
  let lastReasonMs = previous.lastReasonMs ?? nowMs
  let pendingWander = previous.pendingWander
  let wanderAnswer = previous.wanderAnswer
  let lastWanderSeq = previous.lastWanderSeq
  const refuseWander = () => {
    if (pendingWander !== null)
      wanderAnswer = { seq: pendingWander.seq, accepted: false }
    pendingWander = null
  }
  let lingerUntilMs = previous.lingerUntilMs
  let wanderStay = ground === null ? null : previous.wanderStay
  let toolRefused = previous.toolRefused
  let toolRetryAfterMs = previous.toolRetryAfterMs
  let toolRefusalReason = previous.toolRefusalReason
  let lookOverride = previous.lookOverride !== null && nowMs < previous.lookOverride.untilMs
    ? previous.lookOverride
    : null

  // Distance from the root to the cursor while it is on the stage, or null.
  const cursorDistance = input.cursorOnStage && input.cursorX !== null ? Math.abs(input.cursorX - input.rootX) : null
  const attendingCursor = ground !== null
    && input.attend.untilMs !== null
    && nowMs <= input.attend.untilMs
    && input.cursorOnStage
    && input.cursorX !== null
  // Within the stop distance a chase waits for its predicted rest point to reach the cursor, so braking carries her
  // onto it; a cursor behind her ends it at once. A visit stops short and lingers as on arrival.
  const reachedCursor = goalX !== null && cursorDistance !== null && input.cursorX !== null && (
    reason === 'approach-cursor'
      ? cursorDistance <= CHASE_STOP_LEGS * leg && restReaches(input.cursorX, input.rootX, input.restX ?? input.rootX, goalX)
      : reason === 'visit' && cursorDistance <= VISIT_STOP_LEGS * leg
  )
  const arrived = goalX !== null
    && (reachedCursor || (input.locomotionMode === 'idle' && Math.abs(input.rootX - goalX) <= ARRIVAL_TOLERANCE))
  if (arrived) {
    // Chases hurry; the corrective approach strolls, so its own arrival never arms a second step.
    if (reachedCursor && reason === 'approach-cursor' && goalUrgency === GOAL_URGENCY.chase)
      cursorStepPending = true
    // A walk of her own choosing has a destination worth staying at: she does not turn around after 20 seconds, but
    // stays as long as the mind drew with the errand.
    if ((reason === 'wander' || reason === 'visit') && wanderStay !== null)
      lingerUntilMs = nowMs + wanderStay.lingerSeconds * 1000
    goalX = null
    reason = 'stay'
  }
  if (
    !attendingCursor
    || cursorDistance === null
    || cursorDistance > CHASE_STOP_LEGS * leg
    || (input.locomotionMode === 'idle' && cursorDistance <= STEP_ONTO_CURSOR_MIN_LEGS * leg)
  ) {
    cursorStepPending = false
  }

  // A wander Natural asks for waits until she can walk it; she never sets off again the moment another walk arrives.
  if (input.wander !== null && input.wander.seq > lastWanderSeq) {
    lastWanderSeq = input.wander.seq
    refuseWander()
    pendingWander = { seq: input.wander.seq, pick: input.wander.pick, lingerSeconds: input.wander.lingerSeconds, sinceMs: nowMs }
  }
  if (ground === null || input.roamMode !== 'roam' || arrived)
    refuseWander()

  // Performance bookkeeping. The director never starts or names clips: it accepts a request, echoes its `clipId` and
  // ends the performance on feedback, a watchdog, or a user intent.
  let performing = previous.performing
  let lastActionSeq = previous.lastActionSeq
  let actionRefusal = previous.actionRefusal
  let actionRetryAfterMs = previous.actionRetryAfterMs
  let fullEnded = false
  // A counted end is reported; the mind arms the refractory and leaves an unasked clip's end unarmed. The report
  // reaches the director again from the next frame on, so a request in this very call still passes.
  const endPerformance = (counts: boolean) => {
    if (performing === null)
      return
    const { kind, layer, source } = performing.request
    if (layer === 'full')
      fullEnded = true
    if (counts)
      reports.push({ kind: 'clip-ended', clip: kind, source })
    performing = null
  }
  const remainingMs = () => {
    if (performing === null || performing.request.loop)
      return 0
    return performing.phase === 'playing'
      ? Math.max(0, performing.request.durationMs - (nowMs - performing.sinceMs))
      : performing.request.durationMs
  }

  const feedback = input.actionFeedback
  if (performing !== null && feedback !== null && feedback.seq === performing.request.seq) {
    if (feedback.state === 'finished')
      endPerformance(true)
    else if (feedback.state === 'failed')
      endPerformance(false)
  }
  if (performing !== null && performing.phase === 'playing' && !performing.request.loop && nowMs - performing.sinceMs >= performing.request.durationMs + PERFORM_WATCHDOG_MS)
    endPerformance(true)
  const claimed = input.speaking || (input.performance.mode !== 'idle' && input.performance.mode !== 'watching')
  if (performing !== null) {
    const unasked = performing.request.source === 'idle'
    const broad = performing.request.layer === 'full' || performing.request.loop || unasked
    if (input.away)
      endPerformance(true)
    else if (broad && (input.dragging || input.attend.touchSeq > previous.lastTouchSeq))
      endPerformance(true)
    else if ((performing.request.loop || unasked) && input.attend.chatSeq > previous.lastChatSeq)
      endPerformance(true)
    else if (unasked && claimed)
      endPerformance(true)
  }

  const requested = input.actionRequest
  if (requested !== null && requested.seq > lastActionSeq) {
    lastActionSeq = requested.seq
    const isGesture = requested.kind === 'gesture'
    const refractoryUntilMs = requested.kind === 'dance' ? refractory.danceUntilMs : refractory.actionUntilMs
    const refuse = (reason: BodyActionRefusal, retryAfterMs: number | null) => {
      actionRefusal = reason
      actionRetryAfterMs = retryAfterMs
    }
    const unasked = requested.source === 'idle'
    // Any other request replaces a clip she plays unasked, before the busy rule can refuse it.
    if (!unasked && requested.clipId !== '' && performing?.request.source === 'idle')
      endPerformance(false)
    if (requested.clipId === '') {
      if (requested.source !== 'act' && !unasked)
        endPerformance(true)
    }
    else if (unasked && (performing !== null || claimed || goalX !== null || pending !== null)) {
      // Unasked clips wait for a quiet body: nothing performing, not walking, not talking, listening or thinking.
      refuse('busy', null)
    }
    else if (input.away || previous.stance === 'sleep') {
      refuse('asleep', null)
    }
    else if (input.dragging) {
      refuse('dragging', null)
    }
    // A looping debug request (the lab, QA gates) repeats a gesture on demand; it still meets the busy rule below.
    else if (isGesture && (requested.source !== 'debug' || !requested.loop) && refractory.gesture !== null && refractory.gesture.clipId === requested.clipId && nowMs < refractory.gesture.untilMs) {
      // ACT has no answer channel: the gesture is dropped without a retry time.
      refuse('refractory', null)
    }
    else if (!isGesture && nowMs < refractoryUntilMs) {
      refuse('refractory', refractoryUntilMs - nowMs)
    }
    else if (performing !== null && (performing.request.layer === 'full' || isGesture)) {
      refuse('busy', remainingMs())
    }
    else if (inWing && !isGesture) {
      // A clip that stops her would play where no display shows her; she is busy until she reaches a zone.
      refuse('busy', null)
    }
    else {
      // An upper performance gives way to an action or a dance.
      performing = null
      actionRefusal = null
      actionRetryAfterMs = null
      if (isGesture) {
        reports.push({ kind: 'gesture-clip', clipId: requested.clipId, source: requested.source })
        performing = { request: requested, phase: 'playing', sinceMs: nowMs }
      }
      else {
        // The walk resumes after the clip: the goal in progress waits as a pending goal (a newer pending goal wins).
        if (goalX !== null) {
          pending ??= { x: goalX, urgency: goalUrgency, reason, requestedAtMs: nowMs }
          goalX = null
          goalSinceMs = null
          reason = 'stay'
        }
        performing = { request: requested, phase: 'settling', sinceMs: nowMs }
      }
    }
  }

  // A full-body clip waits for the body to be clear: standing, not walking, not speaking.
  if (performing !== null && performing.phase === 'settling') {
    if (input.speaking || input.performance.mode === 'talking') {
      // Held without a timeout; the stand and idle timeouts count from the moment she stops.
      performing = { ...performing, sinceMs: nowMs }
    }
    else {
      const standOk = previous.stance === 'stand' && (previous.stanceSinceMs === null || nowMs - previous.stanceSinceMs >= STAND_SETTLE_MS)
      const idleOk = input.locomotionMode === 'idle'
      if ((standOk && idleOk) || nowMs - performing.sinceMs >= SETTLE_TIMEOUT_MS)
        performing = { ...performing, phase: 'playing', sinceMs: nowMs }
    }
  }
  const forceStand = performing !== null && performing.request.kind !== 'gesture'

  // A full-body clip also holds the idle clock, so the idle-to-sit timer cannot run under a dance.
  const idleSinceMs = performing?.request.layer === 'full'
    ? nowMs
    : input.performance.mode === 'idle'
      ? previous.idleSinceMs ?? nowMs
      : null

  const mayRest = ground === null || (input.locomotionMode === 'idle' && atHome)
  // A held goal or an asked wander stands the character up so the goal can be issued.
  const wakeForGoal = ground !== null
    && !input.away
    && (previous.pendingGoal !== null || (pendingWander !== null && input.performance.mode === 'idle'))

  // Natural decides that she settles in or sleeps; the director realises it with the stance clip, or with the
  // procedural rest or doze when the slot is empty, and refuses it while a performance, a goal or a walk needs her up.
  let desiredStance: BodyIntent['stance'] = 'stand'
  let rest: BodyIntent['rest'] = 'none'
  if (forceStand) {
    // A performance stands her up and holds the stand.
  }
  else if (input.idle.asleep) {
    if (mayRest && input.slots.sleep)
      desiredStance = 'sleep'
    else if (mayRest)
      rest = 'doze'
  }
  else if (input.idle.settled && !wakeForGoal && mayRest && input.performance.mode === 'idle') {
    if (input.slots.sit)
      desiredStance = 'sit'
    else
      rest = 'rest'
  }

  let stance = previous.stance
  let stanceSinceMs = previous.stanceSinceMs
  if (desiredStance !== stance) {
    const currentStanceSlotMissing = (stance === 'sit' && !input.slots.sit)
      || (stance === 'sleep' && !input.slots.sleep)
    const dwellElapsed = stanceSinceMs === null || nowMs - stanceSinceMs >= STANCE_MIN_DWELL_MS
    // A performance is not held back by the stance dwell.
    if (currentStanceSlotMissing || dwellElapsed || forceStand) {
      stance = desiredStance
      stanceSinceMs = nowMs
    }
  }

  // Event requests: later sources win (debug over tool over chat).
  let request: BodyGoalRequest | null = null
  if (input.attend.chatOpenSeq > previous.lastChatOpenSeq && ground !== null && input.chatX !== null) {
    request = {
      x: chatStandGoal(input.chatX, input.homeX, leg, zones),
      urgency: GOAL_URGENCY.approachChat,
      reason: 'approach-chat',
    }
  }

  const tool = input.toolRequest
  if (tool !== null && tool.seq > previous.lastToolSeq) {
    const isLook = tool.kind === 'look-at'
    const untilMs = isLook ? refractory.lookToolUntilMs : refractory.moveToolUntilMs
    const unavailable = !isLook && (ground === null || (tool.kind === 'come-here' && input.chatX === null))
    if (nowMs < untilMs) {
      toolRefused = true
      toolRetryAfterMs = untilMs - nowMs
      toolRefusalReason = 'refractory'
    }
    else if (unavailable) {
      toolRefused = true
      toolRetryAfterMs = 0
      toolRefusalReason = ground === null ? 'no-world' : 'chat-closed'
    }
    else {
      toolRefused = false
      toolRetryAfterMs = null
      toolRefusalReason = null
      if (isLook) {
        reports.push({ kind: 'tool-accepted', tool: tool.kind })
        lookOverride = { seq: tool.seq, target: tool.target ?? 'camera', untilMs: nowMs + LOOK_OVERRIDE_MS }
      }
      else if (ground !== null) {
        // A move tool is a user intent: it ends a looping clip. A one-shot plays on with the goal pending.
        if (performing?.request.loop)
          endPerformance(true)
        reports.push({ kind: 'tool-accepted', tool: tool.kind })
        // Come-here stops where an unfolded chat does: the same stand spot, with the same leg offset.
        const toolX = tool.kind === 'come-here' && input.chatX !== null
          ? chatStandGoal(input.chatX, input.homeX, leg, zones)
          : clampToZones(input.homeX, zones)
        request = { x: toolX, urgency: GOAL_URGENCY.tool, reason: 'tool' }
      }
    }
  }

  if (input.debugGoal !== null && input.debugGoal.seq > previous.lastDebugSeq && ground !== null) {
    request = { x: clampToZones(input.debugGoal.x, zones), urgency: input.debugGoal.urgency, reason: 'debug' }
  }

  if (request !== null)
    pending = { ...request, requestedAtMs: nowMs }
  // A held goal does not age while a full-body clip runs, and a clip that ends hands it a fresh time to live.
  if (fullEnded && pending !== null)
    pending = { ...pending, requestedAtMs: nowMs }
  if (pending !== null && performing?.request.layer !== 'full' && nowMs - pending.requestedAtMs >= PENDING_GOAL_TTL_MS)
    pending = null

  const gateOpen = ground !== null
    && stance === 'stand'
    && !input.clipOwnsRoot
    && performing?.request.layer !== 'full'
    && !input.speaking
    && input.performance.mode !== 'talking'
  let issued = false
  const canIssue = () => gateOpen && !issued && (goalX === null || goalSinceMs === null || nowMs - goalSinceMs >= GOAL_MIN_DWELL_MS)
  const issue = (goal: BodyGoalRequest) => {
    cursorStepPending = false
    // Any other goal takes her away from where a wander took her, the walk home included.
    if (goal.reason !== 'wander' && goal.reason !== 'visit')
      wanderStay = null
    goalX = goal.x
    goalUrgency = goal.urgency
    reason = goal.reason
    goalSinceMs = nowMs
    lastReasonMs = nowMs
    issued = true
  }

  if (pending !== null && canIssue()) {
    issue(pending)
    pending = null
  }

  // D16: wait for the braking slide to finish, then spend the chase's one correction before any new idle goal.
  if (cursorStepPending && !arrived && goalX === null && pending === null && input.locomotionMode === 'idle' && input.cursorX !== null && canIssue())
    issue({ x: clampToZones(input.cursorX, zones), urgency: GOAL_URGENCY.cursorStep, reason: 'approach-cursor' })

  const chasing = attendingCursor
    && input.cursorX !== null
    && Math.abs(input.cursorX - input.rootX) > CHASE_STOP_LEGS * leg
  if (chasing && ground !== null && input.cursorX !== null && pending === null && canIssue()) {
    const chaseX = clampToZones(input.cursorX - Math.sign(input.cursorX - input.rootX) * CHASE_STOP_LEGS * leg, zones)
    const sameGoal = reason === 'approach-cursor' && goalX !== null && Math.abs(chaseX - goalX) <= ARRIVAL_TOLERANCE
    if (!sameGoal && Math.abs(chaseX - input.rootX) > ARRIVAL_TOLERANCE)
      issue({ x: chaseX, urgency: GOAL_URGENCY.chase, reason: 'approach-cursor' })
  }

  if (
    ground !== null
    && pending === null
    && goalX === null
    && canIssue()
    && !chasing
    && nowMs - lastReasonMs >= RETURN_HOME_DELAY_MS
    && nowMs >= lingerUntilMs
    && !atHome
  ) {
    issue({ x: clampToZones(input.homeX, zones), urgency: GOAL_URGENCY.returnHome, reason: 'return-home' })
  }
  // A stay that ends at home needs no walk home.
  if (wanderStay !== null && goalX === null && nowMs >= lingerUntilMs && atHome)
    wanderStay = null

  // A root at rest in a wing is unseen, so she walks to the nearest zone. Issuing here also keeps a wander from starting there.
  if (inWing && input.reach !== undefined && pending === null && goalX === null && input.locomotionMode === 'idle' && canIssue())
    issue({ x: clampToZones(input.rootX, input.reach), urgency: GOAL_URGENCY.enterStage, reason: 'enter-stage' })

  const watching = input.performance.mode === 'watching'
  if (
    ground !== null
    && pendingWander !== null
    && (input.performance.mode === 'idle' || watching)
    && goalX === null
    && canIssue()
  ) {
    const asked = pendingWander
    // A cursor already within a visit's stop distance is a visit that has arrived: she stays where she is.
    const visitInPlace = cursorDistance !== null && cursorDistance <= VISIT_STOP_LEGS * leg
    const arriveInPlace = () => {
      lingerUntilMs = nowMs + asked.lingerSeconds * 1000
      lastReasonMs = nowMs
      issued = true
    }
    // Where the user is working, as far as the cursor shows it. A visit stops short of it on her side and stays on
    // the ground she stands on, like a wander.
    const cursorVisitX = input.cursorOnStage && input.cursorX !== null
      ? clampToGround(input.cursorX - Math.sign(input.cursorX - input.rootX) * VISIT_STOP_LEGS * leg, ground)
      : null
    const visitX = cursorVisitX !== null && Math.abs(cursorVisitX - input.rootX) >= WANDER_FLOOR_LEGS * leg ? cursorVisitX : null
    if (watching) {
      // While the user is active she only ever walks over to them; an aimless stroll would ignore them. Without a
      // place to visit the wander waits until they pause.
      if (visitInPlace)
        arriveInPlace()
      else if (visitX !== null)
        issue({ x: visitX, urgency: GOAL_URGENCY.visit, reason: 'visit' })
    }
    else {
      const visiting = (visitInPlace || visitX !== null) && asked.pick < VISIT_SHARE
      if (visiting && visitInPlace) {
        arriveInPlace()
      }
      else if (visiting && visitX !== null) {
        issue({ x: visitX, urgency: GOAL_URGENCY.visit, reason: 'visit' })
      }
      else {
        const longestSide = Math.max(input.rootX - ground.minX, ground.maxX - input.rootX)
        const minDistance = longestSide > WANDER_MIN_LEGS * leg
          ? WANDER_MIN_LEGS * leg
          : Math.max(WANDER_FLOOR_LEGS * leg, longestSide / 2)
        const leftLength = Math.max(0, input.rootX - minDistance - ground.minX)
        const rightLength = Math.max(0, ground.maxX - (input.rootX + minDistance))
        if (leftLength + rightLength > 0) {
          const draw = drawRandom(rngState)
          rngState = draw.state
          const offset = draw.value * (leftLength + rightLength)
          const x = offset < leftLength
            ? ground.minX + offset
            : input.rootX + minDistance + (offset - leftLength)
          issue({ x, urgency: GOAL_URGENCY.wander, reason: 'wander' })
        }
      }
      // Without room to wander, the request is spent like a refused act.
      if (!issued)
        refuseWander()
    }
    if (issued) {
      wanderAnswer = { seq: asked.seq, accepted: true }
      wanderStay = { seq: asked.seq, lingerSeconds: asked.lingerSeconds }
      pendingWander = null
    }
  }
  if (pendingWander !== null && nowMs - pendingWander.sinceMs >= PENDING_GOAL_TTL_MS)
    refuseWander()

  if (goalX !== null || chasing || pending !== null)
    lastReasonMs = nowMs

  const arriveFacing = reason === 'approach-chat' && goalX !== null && input.chatX !== null
    ? Math.sign(input.chatX - goalX) * (Math.PI / 4)
    : 0

  return {
    intent: {
      stance,
      rest,
      look: lookOverride === null ? null : { seq: lookOverride.seq, target: lookOverride.target, holdMs: LOOK_OVERRIDE_MS },
      facingYaw: 0,
      locomotion: ground === null
        ? { homeX: input.homeX, goalX: null, urgency: WALK_URGENCY, arriveFacing: 0, reason: 'stay' }
        : {
            homeX: input.homeX,
            goalX,
            // Standing still keeps no hurry from the goal she reached.
            urgency: goalX === null ? WALK_URGENCY : goalUrgency,
            arriveFacing,
            reason,
            // Only the one corrective approach strolls; every chase hurries.
            ...(goalX !== null && reason === 'approach-cursor' && goalUrgency === GOAL_URGENCY.cursorStep ? { step: 'sidestep' as const } : {}),
          },
      action: performing === null
        ? null
        : { seq: performing.request.seq, clipId: performing.request.clipId, layer: performing.request.layer, loop: performing.request.loop, phase: performing.phase },
    },
    reports,
    memory: {
      nowMs,
      idleSinceMs,
      stance,
      stanceSinceMs,
      goalX,
      goalSinceMs,
      goalUrgency,
      reason,
      cursorStepPending,
      pendingGoal: pending,
      lastChatOpenSeq: Math.max(previous.lastChatOpenSeq, input.attend.chatOpenSeq),
      lastTouchSeq: Math.max(previous.lastTouchSeq, input.attend.touchSeq),
      lastChatSeq: Math.max(previous.lastChatSeq, input.attend.chatSeq),
      lastToolSeq: tool !== null ? Math.max(previous.lastToolSeq, tool.seq) : previous.lastToolSeq,
      lastDebugSeq: input.debugGoal !== null ? Math.max(previous.lastDebugSeq, input.debugGoal.seq) : previous.lastDebugSeq,
      toolRefused,
      toolRetryAfterMs,
      toolRefusalReason,
      performing,
      lastActionSeq,
      actionRefusal,
      actionRetryAfterMs,
      lastReasonMs,
      lastWanderSeq,
      pendingWander,
      wanderAnswer,
      lingerUntilMs,
      wanderStay,
      rngState,
      lookOverride,
    },
  }
}
