import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { BodyIntent, BodyLocomotionReason, LocomotionPace, Vec3 } from '../types'

import { createRandomStream } from '../random'

/** Continuous idle time in milliseconds required before requesting a sit. */
export const IDLE_TO_SIT_MS = 120_000

/** Minimum time in milliseconds between stance changes. */
export const STANCE_MIN_DWELL_MS = 3_000

/** Chase window in milliseconds after the latest user interaction. */
export const CHASE_WINDOW_MS = 60_000

/** Distance, in leg lengths, at which a chase stops short of the cursor. */
export const CHASE_STOP_LEGS = 1.0

/** Milliseconds with no goal reason before the character walks home. */
export const RETURN_HOME_DELAY_MS = 20_000

/** Lower bound of the wander interval in milliseconds. */
export const WANDER_MIN_MS = 600_000

/** Upper bound of the wander interval in milliseconds. */
export const WANDER_MAX_MS = 1_200_000

/** Refractory in milliseconds shared by the come-here and go-home tools. */
export const MOVE_TOOL_REFRACTORY_MS = 60_000

/** Refractory in milliseconds for the look-at tool. */
export const LOOK_TOOL_REFRACTORY_MS = 15_000

/** Minimum time in milliseconds a goal in progress is kept before it is replaced. */
export const GOAL_MIN_DWELL_MS = 3_000

/** Duration in milliseconds a look-at tool overrides the attention target. */
export const LOOK_OVERRIDE_MS = 8_000

/** Time in milliseconds a goal blocked by a gate is held before it is dropped. */
export const PENDING_GOAL_TTL_MS = 30_000

/** Refractory in milliseconds after a full-body action ends, before another action or dance is accepted. */
export const ACTION_REFRACTORY_MS = 15_000

/** Refractory in milliseconds after a dance ends. */
export const DANCE_REFRACTORY_MS = 60_000

/** Minimum time in milliseconds before the same gesture clip is accepted again. */
export const GESTURE_REPEAT_MS = 4_000

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

/** Target of a look-at tool request. */
export type BodyLookTarget = 'camera' | 'cursor' | 'chat' | 'away'

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
 */
export interface BodyActionRequest {
  seq: number
  clipId: string
  kind: BodyActionKind
  layer: BodyActionLayer
  loop: boolean
  durationMs: number
  source: 'act' | 'tool' | 'debug'
}

/** The adapter's report on the clip the director last accepted. */
export interface BodyActionFeedback {
  seq: number
  state: 'playing' | 'finished' | 'failed'
}

/** A locomotion goal request before the gates are applied. */
export interface BodyGoalRequest {
  x: number
  pace: LocomotionPace
  reason: BodyLocomotionReason
}

/** Inputs required to produce a renderer-neutral body intent for one frame. */
export interface BodyDirectorInput {
  /** Epoch milliseconds supplied by the caller; this module never reads a clock. */
  nowMs: number
  /** The resolved mode, attention, and away overlay from stage-shared. */
  performance: Pick<PerformanceState, 'mode' | 'attention' | 'away'>
  /** Optional target positions in model units. */
  cursorPoint: Vec3 | null
  chatPoint: Vec3 | null
  cameraPoint: Vec3 | null
  /** Imported stance clips available for this model. */
  slots: {
    sit: boolean
    sleep: boolean
  }
  /** Walkable ground line; null means no world (legacy window mode). */
  ground: { minX: number, maxX: number } | null
  rootX: number
  homeX: number
  locomotionMode: 'idle' | 'turning' | 'starting' | 'walking' | 'stopping'
  /** True while a clip owns the root. */
  clipOwnsRoot: boolean
  speaking: boolean
  roamMode: 'stay' | 'roam'
  chatUnfoldSeq: number
  chatX: number | null
  interactionSeq: number
  /** Count of chat messages the user sent; it ends a looping clip like a chat unfold and leaves a one-shot running. */
  chatSendSeq: number
  interactionAtMs: number | null
  actionRequest: BodyActionRequest | null
  actionFeedback: BodyActionFeedback | null
  /** True while the user drags the character. */
  dragging: boolean
  cursorX: number | null
  cursorOnStage: boolean
  toolRequest: BodyToolRequest | null
  /** Lab "Walk here" goal; same gates as every other reason, no refractory. */
  debugGoal: { seq: number, x: number, pace: LocomotionPace } | null
  /** Leg length in model units; every distance rule scales by it. */
  legLength: number
  seed: number
}

/**
 * Director inputs for hosts without a stage world (classic window mode).
 * Spread it under the six legacy fields; every goal rule stays inert. Clips, pokes and drags exist without a world, so
 * every host supplies the interaction and action inputs itself.
 */
export const NO_WORLD_BODY_INPUT: Omit<BodyDirectorInput, 'nowMs' | 'performance' | 'cursorPoint' | 'chatPoint' | 'cameraPoint' | 'slots' | 'interactionSeq' | 'chatSendSeq' | 'interactionAtMs' | 'actionRequest' | 'actionFeedback' | 'dragging'> = Object.freeze({
  ground: null,
  rootX: 0,
  homeX: 0,
  locomotionMode: 'idle',
  clipOwnsRoot: false,
  speaking: false,
  roamMode: 'stay',
  chatUnfoldSeq: 0,
  chatX: null,
  cursorX: null,
  cursorOnStage: false,
  toolRequest: null,
  debugGoal: null,
  legLength: 1,
  seed: 0,
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
  readonly goalPace: LocomotionPace
  readonly reason: BodyLocomotionReason
  /** A goal a gate blocked, held until the gate opens or the time to live passes. */
  readonly pendingGoal: (BodyGoalRequest & { requestedAtMs: number }) | null
  readonly lastUnfoldSeq: number
  readonly lastInteractionSeq: number
  readonly lastSendSeq: number
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
  readonly actionRefractoryUntilMs: { action: number, dance: number }
  readonly gestureCooldown: { clipId: string, untilMs: number } | null
  readonly moveRefractoryUntilMs: number
  readonly lookRefractoryUntilMs: number
  /** Latest time a goal reason held, used for the return-home delay. */
  readonly lastReasonMs: number | null
  /** Null until the first roaming frame schedules a wander. */
  readonly nextWanderAtMs: number | null
  /** Mulberry32 seed advanced after every draw; null until seeded from the input. */
  readonly rngState: number | null
  readonly lookOverride: { target: BodyLookTarget, untilMs: number } | null
}

/** Initial pure director state for a newly loaded rig. */
export const initialBodyDirectorMemory: BodyDirectorMemory = Object.freeze({
  nowMs: null,
  idleSinceMs: null,
  stance: 'stand',
  stanceSinceMs: null,
  goalX: null,
  goalSinceMs: null,
  goalPace: 'walk',
  reason: 'stay',
  pendingGoal: null,
  lastUnfoldSeq: 0,
  lastInteractionSeq: 0,
  lastSendSeq: 0,
  lastToolSeq: 0,
  lastDebugSeq: 0,
  toolRefused: false,
  toolRetryAfterMs: null,
  toolRefusalReason: null,
  performing: null,
  lastActionSeq: 0,
  actionRefusal: null,
  actionRetryAfterMs: null,
  actionRefractoryUntilMs: Object.freeze({ action: 0, dance: 0 }),
  gestureCooldown: null,
  moveRefractoryUntilMs: 0,
  lookRefractoryUntilMs: 0,
  lastReasonMs: null,
  nextWanderAtMs: null,
  rngState: null,
  lookOverride: null,
})

function attentionIntent(input: BodyDirectorInput): BodyIntent['attention'] {
  const { attention } = input.performance

  if (attention === 'camera')
    return { kind: 'camera', point: input.cameraPoint }
  if (attention === 'cursor')
    return { kind: 'cursor', point: input.cursorPoint }

  // Screen targets are supplied by the renderer-specific adapter; the chat
  // glance point is owned by the Natural adapter, not the body director.
  if (attention === 'screen')
    return { kind: 'screen', point: null }

  return { kind: 'aside', point: null }
}

function lookIntent(input: BodyDirectorInput, target: BodyLookTarget): BodyIntent['attention'] {
  if (target === 'camera')
    return { kind: 'camera', point: input.cameraPoint }
  if (target === 'cursor')
    return { kind: 'cursor', point: input.cursorPoint }
  if (target === 'chat')
    return { kind: 'chat', point: input.chatPoint }

  return { kind: 'aside', point: null }
}

function clampToGround(x: number, ground: { minX: number, maxX: number }): number {
  return Math.min(Math.max(x, ground.minX), ground.maxX)
}

/**
 * Where she stops for the chat anchor `chatX`: one leg length short of it, on the side of home.
 * The approach-chat reason and the come-here tool share this rule.
 */
function chatStandGoal(chatX: number, homeX: number, leg: number, ground: { minX: number, maxX: number }): number {
  const anchor = clampToGround(chatX, ground)
  return clampToGround(anchor + Math.sign(homeX - anchor) * leg, ground)
}

/** Draws one uniform value and returns the advanced seed; no hidden state. */
function drawRandom(state: number): { value: number, state: number } {
  const stream = createRandomStream(state)
  const value = stream()
  return { value, state: Math.floor(stream() * 2 ** 32) >>> 0 }
}

/**
 * Produces a body stance and attention target without side effects.
 *
 * Time is supplied in milliseconds and clamped against the latest finite
 * timestamp in memory. Idle duration and stance dwell are retained only in the
 * returned memory, which callers pass into the next frame.
 */
export function decideBody(
  input: BodyDirectorInput,
  previous: BodyDirectorMemory,
): { intent: BodyIntent, memory: BodyDirectorMemory } {
  const finiteNowMs = Number.isFinite(input.nowMs) ? input.nowMs : previous.nowMs ?? 0
  const nowMs = previous.nowMs === null ? finiteNowMs : Math.max(previous.nowMs, finiteNowMs)
  const { ground } = input
  const atHome = Math.abs(input.rootX - input.homeX) <= ARRIVAL_TOLERANCE

  const leg = input.legLength
  let rngState = previous.rngState ?? input.seed >>> 0
  let goalX = ground === null ? null : previous.goalX
  let goalSinceMs = previous.goalSinceMs
  let goalPace = previous.goalPace
  let reason = ground === null ? 'stay' : previous.reason
  let pending = previous.pendingGoal
  let lastReasonMs = previous.lastReasonMs ?? nowMs
  let nextWanderAtMs = previous.nextWanderAtMs
  let toolRefused = previous.toolRefused
  let toolRetryAfterMs = previous.toolRetryAfterMs
  let toolRefusalReason = previous.toolRefusalReason
  let moveRefractoryUntilMs = previous.moveRefractoryUntilMs
  let lookRefractoryUntilMs = previous.lookRefractoryUntilMs
  let lookOverride = previous.lookOverride !== null && nowMs < previous.lookOverride.untilMs
    ? previous.lookOverride
    : null

  // A goal in progress ends once the body has settled on it.
  const arrived = goalX !== null && input.locomotionMode === 'idle' && Math.abs(input.rootX - goalX) <= ARRIVAL_TOLERANCE
  if (arrived) {
    goalX = null
    reason = 'stay'
  }

  // Performance bookkeeping. The director never starts or names clips: it accepts a request, echoes its `clipId` and
  // ends the performance on feedback, a watchdog, or a user intent.
  let performing = previous.performing
  let lastActionSeq = previous.lastActionSeq
  let actionRefusal = previous.actionRefusal
  let actionRetryAfterMs = previous.actionRetryAfterMs
  let actionRefractoryUntilMs = previous.actionRefractoryUntilMs
  let gestureCooldown = previous.gestureCooldown
  let fullEnded = false
  const endPerformance = (armRefractory: boolean) => {
    if (performing === null)
      return
    const { kind, layer } = performing.request
    if (layer === 'full')
      fullEnded = true
    if (armRefractory && kind === 'action')
      actionRefractoryUntilMs = { ...actionRefractoryUntilMs, action: nowMs + ACTION_REFRACTORY_MS }
    if (armRefractory && kind === 'dance')
      actionRefractoryUntilMs = { ...actionRefractoryUntilMs, dance: nowMs + DANCE_REFRACTORY_MS }
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
  if (performing !== null) {
    const broad = performing.request.layer === 'full' || performing.request.loop
    if (input.performance.away)
      endPerformance(true)
    else if (broad && (input.dragging || input.interactionSeq > previous.lastInteractionSeq))
      endPerformance(true)
    else if (performing.request.loop && (input.chatUnfoldSeq > previous.lastUnfoldSeq || input.chatSendSeq > previous.lastSendSeq))
      endPerformance(true)
  }

  const requested = input.actionRequest
  if (requested !== null && requested.seq > lastActionSeq) {
    lastActionSeq = requested.seq
    const isGesture = requested.kind === 'gesture'
    const refractoryKey = requested.kind === 'dance' ? 'dance' : 'action'
    const refuse = (reason: BodyActionRefusal, retryAfterMs: number | null) => {
      actionRefusal = reason
      actionRetryAfterMs = retryAfterMs
    }
    if (requested.clipId === '') {
      if (requested.source !== 'act')
        endPerformance(true)
    }
    else if (input.performance.away || previous.stance === 'sleep') {
      refuse('asleep', null)
    }
    else if (input.dragging) {
      refuse('dragging', null)
    }
    else if (isGesture && gestureCooldown !== null && gestureCooldown.clipId === requested.clipId && nowMs < gestureCooldown.untilMs) {
      // ACT has no answer channel: the gesture is dropped without a retry time.
      refuse('refractory', null)
    }
    else if (!isGesture && nowMs < actionRefractoryUntilMs[refractoryKey]) {
      refuse('refractory', actionRefractoryUntilMs[refractoryKey] - nowMs)
    }
    else if (performing !== null && (performing.request.layer === 'full' || isGesture)) {
      refuse('busy', remainingMs())
    }
    else {
      // An upper performance gives way to an action or a dance.
      performing = null
      actionRefusal = null
      actionRetryAfterMs = null
      if (isGesture) {
        gestureCooldown = { clipId: requested.clipId, untilMs: nowMs + GESTURE_REPEAT_MS }
        performing = { request: requested, phase: 'playing', sinceMs: nowMs }
      }
      else {
        // The walk resumes after the clip: the goal in progress waits as a pending goal (a newer pending goal wins).
        if (goalX !== null) {
          pending ??= { x: goalX, pace: goalPace, reason, requestedAtMs: nowMs }
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
  // A held goal or a due wander stands the character up so the goal can be issued.
  const wakeForGoal = ground !== null
    && !input.performance.away
    && (
      previous.pendingGoal !== null
      || (
        input.roamMode === 'roam'
        && input.performance.mode === 'idle'
        && previous.nextWanderAtMs !== null
        && nowMs >= previous.nextWanderAtMs
      )
    )

  let desiredStance: BodyIntent['stance'] = 'stand'
  if (forceStand) {
    // A performance stands her up and holds the stand.
  }
  else if (input.performance.away) {
    if (input.slots.sleep && mayRest)
      desiredStance = 'sleep'
  }
  else if (
    !wakeForGoal
    && mayRest
    && input.performance.mode === 'idle'
    && input.slots.sit
    && idleSinceMs !== null
    && nowMs - idleSinceMs >= IDLE_TO_SIT_MS
  ) {
    desiredStance = 'sit'
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
  if (input.chatUnfoldSeq > previous.lastUnfoldSeq && ground !== null && input.chatX !== null) {
    request = {
      x: chatStandGoal(input.chatX, input.homeX, leg, ground),
      pace: 'walk',
      reason: 'approach-chat',
    }
  }

  const tool = input.toolRequest
  if (tool !== null && tool.seq > previous.lastToolSeq) {
    const isLook = tool.kind === 'look-at'
    const untilMs = isLook ? lookRefractoryUntilMs : moveRefractoryUntilMs
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
        lookRefractoryUntilMs = nowMs + LOOK_TOOL_REFRACTORY_MS
        lookOverride = { target: tool.target ?? 'camera', untilMs: nowMs + LOOK_OVERRIDE_MS }
      }
      else if (ground !== null) {
        // A move tool is a user intent: it ends a looping clip. A one-shot plays on with the goal pending.
        if (performing?.request.loop)
          endPerformance(true)
        moveRefractoryUntilMs = nowMs + MOVE_TOOL_REFRACTORY_MS
        // Come-here stops where an unfolded chat does: the same stand spot, with the same leg offset.
        const toolX = tool.kind === 'come-here' && input.chatX !== null
          ? chatStandGoal(input.chatX, input.homeX, leg, ground)
          : clampToGround(input.homeX, ground)
        request = { x: toolX, pace: 'walk', reason: 'tool' }
      }
    }
  }

  if (input.debugGoal !== null && input.debugGoal.seq > previous.lastDebugSeq && ground !== null) {
    request = { x: clampToGround(input.debugGoal.x, ground), pace: input.debugGoal.pace, reason: 'debug' }
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
    goalX = goal.x
    goalPace = goal.pace
    reason = goal.reason
    goalSinceMs = nowMs
    lastReasonMs = nowMs
    issued = true
  }

  if (pending !== null && canIssue()) {
    issue(pending)
    pending = null
  }

  const chasing = ground !== null
    && input.interactionAtMs !== null
    && input.cursorOnStage
    && input.cursorX !== null
    && nowMs - input.interactionAtMs <= CHASE_WINDOW_MS
    && Math.abs(input.cursorX - input.rootX) > CHASE_STOP_LEGS * leg
  if (chasing && ground !== null && input.cursorX !== null && pending === null && canIssue()) {
    const chaseX = clampToGround(input.cursorX - Math.sign(input.cursorX - input.rootX) * CHASE_STOP_LEGS * leg, ground)
    const sameGoal = reason === 'approach-cursor' && goalX !== null && Math.abs(chaseX - goalX) <= ARRIVAL_TOLERANCE
    if (!sameGoal && Math.abs(chaseX - input.rootX) > ARRIVAL_TOLERANCE)
      issue({ x: chaseX, pace: 'walk', reason: 'approach-cursor' })
  }

  if (
    ground !== null
    && pending === null
    && goalX === null
    && canIssue()
    && !chasing
    && nowMs - lastReasonMs >= RETURN_HOME_DELAY_MS
    && !atHome
  ) {
    issue({ x: clampToGround(input.homeX, ground), pace: 'stroll', reason: 'return-home' })
  }

  const scheduleWander = () => {
    const draw = drawRandom(rngState)
    rngState = draw.state
    nextWanderAtMs = nowMs + WANDER_MIN_MS * (WANDER_MAX_MS / WANDER_MIN_MS) ** draw.value
  }
  // A wander that fell due while a goal was walking is drawn again from the arrival, so she never wanders on arrival.
  const dueOnArrival = arrived && nextWanderAtMs !== null && nowMs >= nextWanderAtMs
  if (ground !== null && input.roamMode === 'roam' && (nextWanderAtMs === null || dueOnArrival))
    scheduleWander()
  if (
    ground !== null
    && input.roamMode === 'roam'
    && input.performance.mode === 'idle'
    && nextWanderAtMs !== null
    && nowMs >= nextWanderAtMs
    && goalX === null
    && canIssue()
  ) {
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
      issue({ x, pace: 'stroll', reason: 'wander' })
    }
    scheduleWander()
  }

  if (goalX !== null || chasing || pending !== null)
    lastReasonMs = nowMs

  const arriveFacing = reason === 'approach-chat' && goalX !== null && input.chatX !== null
    ? Math.sign(input.chatX - goalX) * (Math.PI / 4)
    : 0

  return {
    intent: {
      stance,
      attention: lookOverride !== null ? lookIntent(input, lookOverride.target) : attentionIntent(input),
      facingYaw: 0,
      locomotion: ground === null
        ? { homeX: input.homeX, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' }
        : { homeX: input.homeX, goalX, pace: goalPace, arriveFacing, reason },
      action: performing === null
        ? null
        : { seq: performing.request.seq, clipId: performing.request.clipId, layer: performing.request.layer, loop: performing.request.loop, phase: performing.phase },
    },
    memory: {
      nowMs,
      idleSinceMs,
      stance,
      stanceSinceMs,
      goalX,
      goalSinceMs,
      goalPace,
      reason,
      pendingGoal: pending,
      lastUnfoldSeq: Math.max(previous.lastUnfoldSeq, input.chatUnfoldSeq),
      lastInteractionSeq: Math.max(previous.lastInteractionSeq, input.interactionSeq),
      lastSendSeq: Math.max(previous.lastSendSeq, input.chatSendSeq),
      lastToolSeq: tool !== null ? Math.max(previous.lastToolSeq, tool.seq) : previous.lastToolSeq,
      lastDebugSeq: input.debugGoal !== null ? Math.max(previous.lastDebugSeq, input.debugGoal.seq) : previous.lastDebugSeq,
      toolRefused,
      toolRetryAfterMs,
      toolRefusalReason,
      performing,
      lastActionSeq,
      actionRefusal,
      actionRetryAfterMs,
      actionRefractoryUntilMs,
      gestureCooldown,
      moveRefractoryUntilMs,
      lookRefractoryUntilMs,
      lastReasonMs,
      nextWanderAtMs,
      rngState,
      lookOverride,
    },
  }
}
