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

/** Distance, in world units, within which the root counts as at a point. */
const ARRIVAL_TOLERANCE = 0.1

/** Minimum wander distance in leg lengths. */
const WANDER_MIN_LEGS = 3

/** Target of a look-at tool request. */
export type BodyLookTarget = 'camera' | 'cursor' | 'chat' | 'away'

/** A tool request from the model; a new `seq` marks a new request. */
export interface BodyToolRequest {
  seq: number
  kind: 'come-here' | 'go-home' | 'look-at'
  target?: BodyLookTarget
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
  interactionAtMs: number | null
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
 * Spread it under the six legacy fields; every goal rule stays inert.
 */
export const NO_WORLD_BODY_INPUT: Omit<BodyDirectorInput, 'nowMs' | 'performance' | 'cursorPoint' | 'chatPoint' | 'cameraPoint' | 'slots'> = Object.freeze({
  ground: null,
  rootX: 0,
  homeX: 0,
  locomotionMode: 'idle',
  clipOwnsRoot: false,
  speaking: false,
  roamMode: 'stay',
  chatUnfoldSeq: 0,
  chatX: null,
  interactionSeq: 0,
  interactionAtMs: null,
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
  readonly lastToolSeq: number
  readonly lastDebugSeq: number
  readonly toolRefused: boolean
  /** Milliseconds until a refused tool may be retried, or null when none was refused. */
  readonly toolRetryAfterMs: number | null
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
  lastToolSeq: 0,
  lastDebugSeq: 0,
  toolRefused: false,
  toolRetryAfterMs: null,
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
  const idleSinceMs = input.performance.mode === 'idle'
    ? previous.idleSinceMs ?? nowMs
    : null

  const { ground } = input
  const atHome = Math.abs(input.rootX - input.homeX) <= ARRIVAL_TOLERANCE
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
  if (input.performance.away) {
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
    if (currentStanceSlotMissing || dwellElapsed) {
      stance = desiredStance
      stanceSinceMs = nowMs
    }
  }

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
  let moveRefractoryUntilMs = previous.moveRefractoryUntilMs
  let lookRefractoryUntilMs = previous.lookRefractoryUntilMs
  let lookOverride = previous.lookOverride !== null && nowMs < previous.lookOverride.untilMs
    ? previous.lookOverride
    : null

  // A goal in progress ends once the body has settled on it.
  if (goalX !== null && input.locomotionMode === 'idle' && Math.abs(input.rootX - goalX) <= ARRIVAL_TOLERANCE) {
    goalX = null
    reason = 'stay'
  }

  // Event requests: later sources win (debug over tool over chat).
  let request: BodyGoalRequest | null = null
  if (input.chatUnfoldSeq > previous.lastUnfoldSeq && ground !== null && input.chatX !== null) {
    const chatX = clampToGround(input.chatX, ground)
    request = {
      x: clampToGround(chatX + Math.sign(input.homeX - chatX) * leg, ground),
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
    }
    else if (unavailable) {
      toolRefused = true
      toolRetryAfterMs = 0
    }
    else {
      toolRefused = false
      toolRetryAfterMs = null
      if (isLook) {
        lookRefractoryUntilMs = nowMs + LOOK_TOOL_REFRACTORY_MS
        lookOverride = { target: tool.target ?? 'camera', untilMs: nowMs + LOOK_OVERRIDE_MS }
      }
      else if (ground !== null) {
        moveRefractoryUntilMs = nowMs + MOVE_TOOL_REFRACTORY_MS
        const toolX = tool.kind === 'come-here' ? input.chatX ?? input.homeX : input.homeX
        request = { x: clampToGround(toolX, ground), pace: 'walk', reason: 'tool' }
      }
    }
  }

  if (input.debugGoal !== null && input.debugGoal.seq > previous.lastDebugSeq && ground !== null) {
    request = { x: clampToGround(input.debugGoal.x, ground), pace: input.debugGoal.pace, reason: 'debug' }
  }

  if (request !== null)
    pending = { ...request, requestedAtMs: nowMs }
  if (pending !== null && nowMs - pending.requestedAtMs >= PENDING_GOAL_TTL_MS)
    pending = null

  const gateOpen = ground !== null
    && stance === 'stand'
    && !input.clipOwnsRoot
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
  if (ground !== null && input.roamMode === 'roam' && nextWanderAtMs === null)
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
    const minDistance = WANDER_MIN_LEGS * leg
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
      lastToolSeq: tool !== null ? Math.max(previous.lastToolSeq, tool.seq) : previous.lastToolSeq,
      lastDebugSeq: input.debugGoal !== null ? Math.max(previous.lastDebugSeq, input.debugGoal.seq) : previous.lastDebugSeq,
      toolRefused,
      toolRetryAfterMs,
      moveRefractoryUntilMs,
      lookRefractoryUntilMs,
      lastReasonMs,
      nextWanderAtMs,
      rngState,
      lookOverride,
    },
  }
}
