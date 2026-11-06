import type { PerformanceAttention, PerformanceMode, PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { BodyIntent } from '../types'
import type { BodyActionRequest } from './index'

import { describe, expect, it } from 'vitest'

import {
  ACTION_REFRACTORY_MS,
  DANCE_REFRACTORY_MS,
  decideBody,
  GOAL_MIN_DWELL_MS,
  initialBodyDirectorMemory,
  LOOK_OVERRIDE_MS,
  LOOK_TOOL_REFRACTORY_MS,
  MOVE_TOOL_REFRACTORY_MS,
  NO_WORLD_BODY_INPUT,
  PENDING_GOAL_TTL_MS,
  RETURN_HOME_DELAY_MS,
  STAND_SETTLE_MS,
  WANDER_MAX_MS,
  WANDER_MIN_MS,
} from './index'

type DirectorInput = Parameters<typeof decideBody>[0]

const cameraPoint = { x: 0, y: 1, z: 2 }
const cursorPoint = { x: 3, y: 4, z: 5 }
const chatPoint = { x: 6, y: 7, z: 8 }

function input(overrides: Partial<DirectorInput> = {}): DirectorInput {
  return {
    nowMs: 0,
    performance: {
      mode: 'idle',
      attention: 'camera',
      away: false,
    },
    cursorPoint,
    chatPoint,
    cameraPoint,
    slots: { sit: true, sleep: true },
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
    actionRequest: null,
    actionFeedback: null,
    dragging: false,
    cursorX: null,
    cursorOnStage: false,
    toolRequest: null,
    debugGoal: null,
    legLength: 1,
    seed: 1,
    ...overrides,
  }
}

function performance(
  mode: PerformanceMode = 'idle',
  attention: PerformanceAttention = 'camera',
  away = false,
): DirectorInput['performance'] {
  const state: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode, attention, away }
  return state
}

function decide(
  frame: DirectorInput,
  memory = initialBodyDirectorMemory,
): { intent: BodyIntent, memory: typeof initialBodyDirectorMemory } {
  return decideBody(frame, memory)
}

describe('body director', () => {
  it('sits after 120 seconds of continuous idle', () => {
    const started = decide(input({ nowMs: 0 }))
    const beforeThreshold = decide(input({ nowMs: 119_000 }), started.memory)
    const atThreshold = decide(input({ nowMs: 120_000 }), beforeThreshold.memory)

    expect(beforeThreshold.intent.stance).toBe('stand')
    expect(atThreshold.intent.stance).toBe('sit')
  })

  it('restarts the idle timer after talking interrupts idle', () => {
    const started = decide(input({ nowMs: 0 }))
    const idleAfter100Seconds = decide(input({ nowMs: 100_000 }), started.memory)
    const talking = decide(input({
      nowMs: 100_000,
      performance: performance('talking'),
    }), idleAfter100Seconds.memory)
    const idleResumed = decide(input({ nowMs: 100_001 }), talking.memory)
    const idleAfter100SecondsAgain = decide(input({ nowMs: 200_001 }), idleResumed.memory)
    const idleAfter120SecondsAgain = decide(input({ nowMs: 220_001 }), idleAfter100SecondsAgain.memory)

    expect(idleResumed.intent.stance).toBe('stand')
    expect(idleAfter100SecondsAgain.intent.stance).toBe('stand')
    expect(idleAfter120SecondsAgain.intent.stance).toBe('sit')
  })

  it('stands on every talking frame', () => {
    const result = decide(input({ performance: performance('talking') }))

    expect(result.intent.stance).toBe('stand')
  })

  it('sleeps while away when the sleep slot is present', () => {
    const prior = decide(input({ nowMs: 0 }))
    const result = decide(input({
      nowMs: 3_000,
      performance: performance('idle', 'camera', true),
    }), prior.memory)

    expect(result.intent.stance).toBe('sleep')
  })

  it('stands when the requested stance slot is missing', () => {
    const started = decide(input({ nowMs: 0, slots: { sit: false, sleep: true } }))
    const idle = decide(input({ nowMs: 120_000, slots: { sit: false, sleep: true } }), started.memory)
    const away = decide(input({
      nowMs: 123_000,
      performance: performance('idle', 'camera', true),
      slots: { sit: true, sleep: false },
    }), idle.memory)

    expect(idle.intent.stance).toBe('stand')
    expect(away.intent.stance).toBe('stand')
  })

  it('enforces the minimum dwell between stance changes', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000 }), started.memory)
    const beforeDwell = decide(input({
      nowMs: 122_999,
      performance: performance('idle', 'camera', true),
    }), sitting.memory)
    const afterDwell = decide(input({
      nowMs: 123_000,
      performance: performance('idle', 'camera', true),
    }), beforeDwell.memory)

    expect(sitting.intent.stance).toBe('sit')
    expect(beforeDwell.intent.stance).toBe('sit')
    expect(afterDwell.intent.stance).toBe('sleep')
  })

  it('returns to standing when talking starts after stance dwell', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000 }), started.memory)
    const talking = decide(input({
      nowMs: 123_000,
      performance: performance('talking'),
    }), sitting.memory)

    expect(sitting.intent.stance).toBe('sit')
    expect(talking.intent.stance).toBe('stand')
  })

  it('clamps a backwards clock to the latest observed time', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000 }), started.memory)
    const backwards = decide(input({ nowMs: 119_000 }), sitting.memory)

    expect(backwards.memory.nowMs).toBe(120_000)
    expect(backwards.intent.stance).toBe('sit')
  })

  it('keeps time stable when nowMs is NaN', () => {
    const atTime = decide(input({ nowMs: 7_000 }))
    const invalidTime = decide(input({ nowMs: Number.NaN }), atTime.memory)

    expect(invalidTime.memory.nowMs).toBe(7_000)
  })

  it('maps performance attention to available points without using chat glance', () => {
    const camera = decide(input({ performance: performance('idle', 'camera') }))
    const screen = decide(input({ performance: performance('watching', 'screen') }))
    const cursor = decide(input({ performance: performance('watching', 'cursor') }))
    const cursorWithoutPoint = decide(input({
      performance: performance('watching', 'cursor'),
      cursorPoint: null,
    }))
    const aside = decide(input({ performance: performance('talking', 'aside') }))

    expect(camera.intent.attention).toEqual({ kind: 'camera', point: cameraPoint })
    expect(screen.intent.attention).toEqual({ kind: 'screen', point: null })
    expect(cursor.intent.attention).toEqual({ kind: 'cursor', point: cursorPoint })
    expect(cursorWithoutPoint.intent.attention).toEqual({ kind: 'cursor', point: null })
    expect(aside.intent.attention).toEqual({ kind: 'aside', point: null })
  })
})

const stage = { minX: -20, maxX: 20 }

function world(overrides: Partial<DirectorInput> = {}): DirectorInput {
  return input({ ground: stage, ...overrides })
}

function run(frames: DirectorInput[], memory = initialBodyDirectorMemory) {
  let current = memory
  let last = decide(frames[0], current)
  current = last.memory
  for (const frame of frames.slice(1)) {
    last = decide(frame, current)
    current = last.memory
  }
  return last
}

describe('body director home, goals, roam and tools', () => {
  it('reports a stay intent and keeps the stance logic when there is no world', () => {
    const stay = decide(input({ homeX: 2, chatUnfoldSeq: 1, chatX: 6 }))
    const started = decide(input({ nowMs: 0, rootX: 9 }))
    const sitting = decide(input({ nowMs: 120_000, rootX: 9 }), started.memory)

    expect(stay.intent.locomotion).toEqual({ homeX: 2, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' })
    expect(sitting.intent.stance).toBe('sit')
  })

  const blockers: Array<[string, Partial<DirectorInput>]> = [
    ['speaking', { speaking: true }],
    ['the clip owning the root', { clipOwnsRoot: true }],
    ['talking mode', { performance: performance('talking') }],
  ]
  it('keeps the legacy six-field input on the old stance behaviour when spread with the no-world constant', () => {
    const legacy = (nowMs: number, mode: PerformanceMode = 'idle', away = false): DirectorInput => ({
      nowMs,
      performance: performance(mode, 'camera', away),
      cursorPoint,
      chatPoint,
      cameraPoint,
      slots: { sit: true, sleep: true },
      ...NO_WORLD_BODY_INPUT,
      interactionSeq: 0,
      interactionAtMs: null,
      actionRequest: null,
      actionFeedback: null,
      dragging: false,
    })
    const started = decide(legacy(0))
    const sitting = decide(legacy(120_000), started.memory)
    const sleeping = decide(legacy(123_000, 'idle', true), sitting.memory)
    const talking = decide(legacy(126_000, 'talking'), sleeping.memory)

    expect([started, sitting, sleeping, talking].map(result => result.intent.stance)).toEqual(['stand', 'sit', 'sleep', 'stand'])
    expect(talking.intent.locomotion).toEqual({ homeX: 0, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' })
    expect(talking.intent.attention).toEqual({ kind: 'camera', point: cameraPoint })
  })

  it.each(blockers)('holds a goal as pending while %s blocks it', (_name, blocked) => {
    const held = decide(world({ chatUnfoldSeq: 1, chatX: 6, ...blocked }))

    expect(held.intent.locomotion.goalX).toBeNull()
    expect(held.memory.pendingGoal).toMatchObject({ reason: 'approach-chat', requestedAtMs: 0 })
  })

  it('issues a pending goal when the gate opens inside the time to live', () => {
    const held = decide(world({ chatUnfoldSeq: 1, chatX: 6, speaking: true }))
    const issued = decide(world({ nowMs: 10_000, chatUnfoldSeq: 1, chatX: 6 }), held.memory)

    expect(issued.intent.locomotion).toMatchObject({ goalX: 5, reason: 'approach-chat' })
    expect(issued.memory.pendingGoal).toBeNull()
  })

  it('drops a pending goal once the time to live has passed', () => {
    const blocked = world({ chatUnfoldSeq: 1, chatX: 6, speaking: true })
    const first = decide(blocked)
    const held = decide({ ...blocked, nowMs: PENDING_GOAL_TTL_MS - 1 }, first.memory)
    const dropped = decide(world({ nowMs: PENDING_GOAL_TTL_MS, chatUnfoldSeq: 1, chatX: 6 }), held.memory)

    expect(held.memory.pendingGoal).not.toBeNull()
    expect(dropped.intent.locomotion.goalX).toBeNull()
    expect(dropped.memory.pendingGoal).toBeNull()
  })

  it('keeps only the latest blocked request as the pending goal', () => {
    const chat = decide(world({ chatUnfoldSeq: 1, chatX: 6, speaking: true }))
    const debug = decide(world({ nowMs: 1_000, speaking: true, debugGoal: { seq: 1, x: -4, pace: 'stroll' } }), chat.memory)
    const issued = decide(world({ nowMs: 2_000 }), debug.memory)

    expect(issued.intent.locomotion).toMatchObject({ goalX: -4, reason: 'debug', pace: 'stroll' })
  })

  it('never replaces a goal in progress before the minimum dwell', () => {
    const first = decide(world({ debugGoal: { seq: 1, x: 4, pace: 'walk' } }))
    const early = decide(world({ nowMs: GOAL_MIN_DWELL_MS - 1, debugGoal: { seq: 2, x: -4, pace: 'walk' } }), first.memory)
    const later = decide(world({ nowMs: GOAL_MIN_DWELL_MS, debugGoal: { seq: 2, x: -4, pace: 'walk' } }), early.memory)

    expect(early.intent.locomotion.goalX).toBe(4)
    expect(later.intent.locomotion.goalX).toBe(-4)
  })

  it('clamps a debug goal to the ground and tags it debug', () => {
    const result = decide(world({ debugGoal: { seq: 1, x: 50, pace: 'stroll' } }))

    expect(result.intent.locomotion).toMatchObject({ goalX: 20, reason: 'debug', pace: 'stroll' })
    expect(result.memory.lastDebugSeq).toBe(1)
  })

  it('applies the talking gate to a debug goal and issues it afterwards', () => {
    const talking = decide(world({ performance: performance('talking'), debugGoal: { seq: 1, x: 4, pace: 'walk' } }))
    const idle = decide(world({ nowMs: 1_000, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), talking.memory)

    expect(talking.intent.locomotion.goalX).toBeNull()
    expect(talking.memory.pendingGoal).toMatchObject({ reason: 'debug' })
    expect(idle.intent.locomotion).toMatchObject({ goalX: 4, reason: 'debug' })
  })

  it('approaches the chat one leg length short of it, facing the chat side', () => {
    const right = decide(world({ chatUnfoldSeq: 1, chatX: 6 }))
    const left = decide(world({ chatUnfoldSeq: 1, chatX: -6 }))
    const clamped = decide(world({ chatUnfoldSeq: 1, chatX: 30 }))

    expect(right.intent.locomotion).toEqual({ homeX: 0, goalX: 5, pace: 'walk', arriveFacing: Math.PI / 4, reason: 'approach-chat' })
    expect(left.intent.locomotion).toMatchObject({ goalX: -5, arriveFacing: -Math.PI / 4 })
    expect(clamped.intent.locomotion.goalX).toBe(19)
    expect(right.intent.facingYaw).toBe(0)
  })

  it('records the interaction sequence it has seen', () => {
    const result = decide(world({ interactionSeq: 3 }))

    expect(result.memory.lastInteractionSeq).toBe(3)
  })

  it('chases the cursor to one leg length short of it inside the chase window', () => {
    const result = decide(world({ nowMs: 1_000, interactionSeq: 1, interactionAtMs: 0, cursorOnStage: true, cursorX: 8 }))

    expect(result.intent.locomotion).toMatchObject({ goalX: 7, pace: 'walk', reason: 'approach-cursor', arriveFacing: 0 })
  })

  it('does not chase outside the window, off stage, when close, or without a cursor', () => {
    const base = { interactionSeq: 1, interactionAtMs: 0, cursorOnStage: true, cursorX: 8 }
    const results = [
      decide(world({ ...base, nowMs: 60_001 })),
      decide(world({ ...base, nowMs: 1_000, cursorOnStage: false })),
      decide(world({ ...base, nowMs: 1_000, cursorX: 1 })),
      decide(world({ ...base, nowMs: 1_000, cursorX: null })),
      decide(world({ ...base, nowMs: 1_000, interactionAtMs: null })),
    ]

    expect(results.map(result => result.intent.locomotion.goalX)).toEqual([null, null, null, null, null])
  })

  it('re-issues a chase goal at most once per minimum dwell', () => {
    const base = { interactionSeq: 1, interactionAtMs: 0, cursorOnStage: true }
    const first = decide(world({ ...base, nowMs: 1_000, cursorX: 8 }))
    const early = decide(world({ ...base, nowMs: 2_000, cursorX: 12 }), first.memory)
    const later = decide(world({ ...base, nowMs: 1_000 + GOAL_MIN_DWELL_MS, cursorX: 12 }), early.memory)

    expect(early.intent.locomotion.goalX).toBe(7)
    expect(later.intent.locomotion.goalX).toBe(11)
  })

  it('returns home slowly after the return-home delay with no reason', () => {
    const started = decide(world({ rootX: 5 }))
    const early = decide(world({ nowMs: RETURN_HOME_DELAY_MS - 1, rootX: 5 }), started.memory)
    const due = decide(world({ nowMs: RETURN_HOME_DELAY_MS, rootX: 5 }), early.memory)
    const home = run([world({ rootX: 0.05 }), world({ nowMs: RETURN_HOME_DELAY_MS, rootX: 0.05 })])

    expect(early.intent.locomotion.goalX).toBeNull()
    expect(due.intent.locomotion).toMatchObject({ goalX: 0, pace: 'stroll', reason: 'return-home', arriveFacing: 0 })
    expect(home.intent.locomotion.goalX).toBeNull()
  })

  it('schedules and issues a seeded wander at least three legs away when roaming', () => {
    const frames = (seed: number) => {
      const started = decide(world({ roamMode: 'roam', seed, slots: { sit: false, sleep: false } }))
      const dueMs = started.memory.nextWanderAtMs as number
      const before = decide(world({ nowMs: dueMs - 1, roamMode: 'roam', seed, slots: { sit: false, sleep: false } }), started.memory)
      const due = decide(world({ nowMs: dueMs, roamMode: 'roam', seed, slots: { sit: false, sleep: false } }), before.memory)
      return { started, before, due, dueMs }
    }
    const a = frames(7)
    const b = frames(7)
    const goalX = a.due.intent.locomotion.goalX as number

    expect(a.dueMs).toBeGreaterThanOrEqual(WANDER_MIN_MS)
    expect(a.dueMs).toBeLessThanOrEqual(WANDER_MAX_MS)
    expect(a.before.intent.locomotion.goalX).toBeNull()
    expect(a.due.intent.locomotion).toMatchObject({ pace: 'stroll', reason: 'wander', arriveFacing: 0 })
    expect(Math.abs(goalX)).toBeGreaterThanOrEqual(3)
    expect(Math.abs(goalX)).toBeLessThanOrEqual(20)
    expect(a.due.memory.nextWanderAtMs).toBeGreaterThanOrEqual(a.dueMs + WANDER_MIN_MS)
    expect(a.due.memory.nextWanderAtMs).toBeLessThanOrEqual(a.dueMs + WANDER_MAX_MS)
    expect(b.due).toEqual(a.due)
  })

  it('wanders at the default height on a 1440 DIP work area, where three legs fit on neither side of home', () => {
    // Measured on the real surface (task-16-chisa-4.json): standard Chisa at 560 DIP, root at home.
    const ground = { minX: 5.87, maxX: 44.41 }
    const homeX = 19.13
    const legLength = 9.7
    const frame = (nowMs: number) => world({ nowMs, ground, rootX: homeX, homeX, legLength, roamMode: 'roam', seed: 7, slots: { sit: false, sleep: false } })
    const started = decide(frame(0))
    const dueMs = started.memory.nextWanderAtMs as number
    const due = decide(frame(dueMs), started.memory)
    const goalX = due.intent.locomotion.goalX as number

    expect(due.intent.locomotion).toMatchObject({ pace: 'stroll', reason: 'wander' })
    expect(goalX).toBeGreaterThanOrEqual(ground.minX)
    expect(goalX).toBeLessThanOrEqual(ground.maxX)
    expect(Math.abs(goalX - homeX)).toBeGreaterThanOrEqual(legLength)
    expect(due.memory.nextWanderAtMs).toBeGreaterThanOrEqual(dueMs + WANDER_MIN_MS)
  })

  it('does not wander when neither side of her has one leg length of ground', () => {
    const frame = (nowMs: number) => world({ nowMs, ground: { minX: 0, maxX: 15 }, rootX: 7.5, homeX: 7.5, legLength: 9.7, roamMode: 'roam', seed: 7, slots: { sit: false, sleep: false } })
    const started = decide(frame(0))
    const dueMs = started.memory.nextWanderAtMs as number
    const due = decide(frame(dueMs), started.memory)

    expect(due.intent.locomotion.goalX).toBeNull()
    expect(due.memory.nextWanderAtMs).toBeGreaterThanOrEqual(dueMs + WANDER_MIN_MS)
  })

  it('does not wander in stay mode, and waits for idle mode when roaming', () => {
    const stay = run([world({ seed: 7 }), world({ nowMs: 2_000_000, seed: 7 })])
    const started = decide(world({ roamMode: 'roam', seed: 7 }))
    const dueMs = started.memory.nextWanderAtMs as number
    const busy = decide(world({ nowMs: dueMs, roamMode: 'roam', seed: 7, performance: performance('watching') }), started.memory)

    expect(stay.intent.locomotion.goalX).toBeNull()
    expect(stay.memory.nextWanderAtMs).toBeNull()
    expect(busy.intent.locomotion.goalX).toBeNull()
    expect(busy.memory.nextWanderAtMs).toBe(dueMs)
  })

  it('accepts come-here toward the chat and go-home toward home', () => {
    const come = decide(world({ chatX: 6, toolRequest: { seq: 1, kind: 'come-here' } }))
    const home = decide(world({ rootX: 8, homeX: 1, toolRequest: { seq: 1, kind: 'go-home' } }))

    expect(come.intent.locomotion).toMatchObject({ goalX: 5, reason: 'tool', pace: 'walk', arriveFacing: 0 })
    expect(come.memory).toMatchObject({ lastToolSeq: 1, toolRefused: false, moveRefractoryUntilMs: MOVE_TOOL_REFRACTORY_MS })
    expect(home.intent.locomotion).toMatchObject({ goalX: 1, reason: 'tool', pace: 'walk' })
  })

  it('refuses a second movement tool inside the shared refractory and accepts it after', () => {
    const first = decide(world({ chatX: 6, toolRequest: { seq: 1, kind: 'come-here' } }))
    const refused = decide(world({ nowMs: 1_000, chatX: 6, toolRequest: { seq: 2, kind: 'go-home' } }), first.memory)
    const accepted = decide(world({ nowMs: MOVE_TOOL_REFRACTORY_MS, rootX: 6, chatX: 6, toolRequest: { seq: 3, kind: 'go-home' } }), refused.memory)

    expect(refused.memory).toMatchObject({ lastToolSeq: 2, toolRefused: true, toolRetryAfterMs: MOVE_TOOL_REFRACTORY_MS - 1_000 })
    expect(refused.intent.locomotion).toMatchObject({ goalX: 5, reason: 'tool' })
    expect(accepted.memory.toolRefused).toBe(false)
    expect(accepted.intent.locomotion.goalX).toBe(0)
  })

  it('keeps the look refractory independent of the movement refractory', () => {
    const first = decide(world({ toolRequest: { seq: 1, kind: 'look-at', target: 'camera' } }))
    const refused = decide(world({ nowMs: 1_000, toolRequest: { seq: 2, kind: 'look-at', target: 'chat' } }), first.memory)
    const move = decide(world({ nowMs: 2_000, chatX: 6, toolRequest: { seq: 3, kind: 'come-here' } }), refused.memory)
    const after = decide(world({ nowMs: LOOK_TOOL_REFRACTORY_MS, toolRequest: { seq: 4, kind: 'look-at', target: 'chat' } }), move.memory)

    expect(refused.memory).toMatchObject({ toolRefused: true, toolRetryAfterMs: LOOK_TOOL_REFRACTORY_MS - 1_000 })
    expect(move.memory.toolRefused).toBe(false)
    expect(after.memory.toolRefused).toBe(false)
  })

  it('lets a look-at override the attention for the override duration', () => {
    const accepted = decide(world({ toolRequest: { seq: 1, kind: 'look-at', target: 'chat' } }))
    const still = decide(world({ nowMs: LOOK_OVERRIDE_MS - 1, toolRequest: { seq: 1, kind: 'look-at', target: 'chat' } }), accepted.memory)
    const expired = decide(world({ nowMs: LOOK_OVERRIDE_MS, toolRequest: { seq: 1, kind: 'look-at', target: 'chat' } }), still.memory)
    const away = decide(world({ toolRequest: { seq: 1, kind: 'look-at', target: 'away' } }))

    expect(accepted.intent.attention).toEqual({ kind: 'chat', point: chatPoint })
    expect(still.intent.attention.kind).toBe('chat')
    expect(expired.intent.attention).toEqual({ kind: 'camera', point: cameraPoint })
    expect(away.intent.attention).toEqual({ kind: 'aside', point: null })
  })

  it('allows sit and sleep only when idle at home', () => {
    const sit = (overrides: Partial<DirectorInput>) => {
      const started = decide(world({ nowMs: 0, ...overrides }))
      return decide(world({ nowMs: 120_000, ...overrides }), started.memory).intent.stance
    }
    const sleep = (overrides: Partial<DirectorInput>) => {
      const started = decide(world({ nowMs: 0, ...overrides }))
      return decide(world({ nowMs: 3_000, performance: performance('idle', 'camera', true), ...overrides }), started.memory).intent.stance
    }

    expect(sit({ rootX: 5 })).toBe('stand')
    expect(sit({ locomotionMode: 'walking' })).toBe('stand')
    expect(sit({ rootX: 0.05 })).toBe('sit')
    expect(sleep({ rootX: 5 })).toBe('stand')
    expect(sleep({})).toBe('sleep')
  })

  it('stands a sitting character up to take a pending goal', () => {
    const started = decide(world({ nowMs: 0 }))
    const sitting = decide(world({ nowMs: 120_000 }), started.memory)
    const requested = decide(world({ nowMs: 123_000, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), sitting.memory)
    const standing = decide(world({ nowMs: 124_000, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), requested.memory)

    expect(requested.intent.stance).toBe('sit')
    expect(requested.intent.locomotion.goalX).toBeNull()
    expect(standing.intent.stance).toBe('stand')
    expect(standing.intent.locomotion).toMatchObject({ goalX: 4, reason: 'debug' })
  })

  it('clears the goal on arrival once the character is idle', () => {
    const issued = decide(world({ debugGoal: { seq: 1, x: 4, pace: 'walk' } }))
    const walking = decide(world({ nowMs: 1_000, rootX: 4, locomotionMode: 'stopping', debugGoal: { seq: 1, x: 4, pace: 'walk' } }), issued.memory)
    const arrived = decide(world({ nowMs: 2_000, rootX: 4, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), walking.memory)

    expect(walking.intent.locomotion.goalX).toBe(4)
    expect(arrived.intent.locomotion).toMatchObject({ goalX: null, reason: 'stay' })
  })
})

describe('body director twenty minute scenario', () => {
  it('approaches the chat then the cursor, holds still while speaking, goes home, then wanders', () => {
    const timeline: Array<{ atMs: number, reason: string, x: number, pace: string }> = []
    let memory = initialBodyDirectorMemory
    let rootX = 0
    let mode: DirectorInput['locomotionMode'] = 'idle'
    let lastSinceMs: number | null = null

    for (let nowMs = 0; nowMs <= 1_200_000; nowMs += 500) {
      const speaking = nowMs >= 70_000 && nowMs < 80_000
      const out = decide(world({
        nowMs,
        rootX,
        locomotionMode: mode,
        speaking,
        performance: performance(speaking ? 'talking' : 'idle'),
        roamMode: 'roam',
        seed: 11,
        chatUnfoldSeq: nowMs >= 10_000 ? 1 : 0,
        chatX: 6,
        interactionSeq: nowMs >= 60_000 ? 1 : 0,
        interactionAtMs: nowMs >= 60_000 ? 60_000 : null,
        cursorOnStage: nowMs >= 60_000 && nowMs < 75_000,
        cursorX: 13,
      }), memory)
      memory = out.memory

      const { goalX, pace, reason } = out.intent.locomotion
      if (goalX !== null && memory.goalSinceMs !== lastSinceMs) {
        lastSinceMs = memory.goalSinceMs
        timeline.push({ atMs: nowMs, reason, x: goalX, pace })
      }
      if (goalX !== null && Math.abs(goalX - rootX) > 0.1) {
        const stepSize = (pace === 'walk' ? 1 : 0.6) * 0.5
        rootX += Math.sign(goalX - rootX) * Math.min(stepSize, Math.abs(goalX - rootX))
        mode = 'walking'
      }
      else {
        mode = 'idle'
      }
    }

    console.info(timeline.map(entry => `goal t=${(entry.atMs / 1000).toFixed(1)}s ${entry.reason} x=${entry.x.toFixed(2)} ${entry.pace}`).join('\n'))

    // The chat is open from t=10 s, so the character also goes home once, 20 s after arriving, before the cursor chase.
    const reasons = timeline.map(entry => entry.reason)
    const chat = reasons.indexOf('approach-chat')
    const cursor = reasons.indexOf('approach-cursor')
    const home = reasons.indexOf('return-home', cursor)
    const wander = reasons.indexOf('wander', home)

    expect(chat).toBe(0)
    expect(cursor).toBeGreaterThan(chat)
    expect(home).toBeGreaterThan(cursor)
    expect(wander).toBeGreaterThan(home)
    expect(timeline.filter(entry => entry.atMs >= 70_000 && entry.atMs < 80_000)).toEqual([])
    expect(timeline[wander].atMs).toBeGreaterThanOrEqual(WANDER_MIN_MS)
  })
})

function action(seq: number, overrides: Partial<BodyActionRequest> = {}): BodyActionRequest {
  return { seq, clipId: 'clip', kind: 'action', layer: 'full', loop: false, durationMs: 10_000, source: 'tool', ...overrides }
}

function gesture(seq: number, overrides: Partial<BodyActionRequest> = {}): BodyActionRequest {
  return action(seq, { clipId: 'wave', kind: 'gesture', layer: 'upper', durationMs: 2_000, ...overrides })
}

function dance(seq: number, overrides: Partial<BodyActionRequest> = {}): BodyActionRequest {
  return action(seq, { clipId: 'dance', kind: 'dance', durationMs: 45_000, ...overrides })
}

describe('body director actions', () => {
  it('(a) moves the goal to pending for a full action mid-walk, plays once idle and issues the goal again after it', () => {
    const goal = { seq: 1, x: 10, pace: 'walk' as const }
    const walking = decide(world({ debugGoal: goal }))
    const accepted = decide(world({ nowMs: 5_000, rootX: 4, locomotionMode: 'walking', debugGoal: goal, actionRequest: action(1, { durationMs: 60_000 }) }), walking.memory)
    const stillWalking = decide(world({ nowMs: 5_500, rootX: 4, locomotionMode: 'walking', debugGoal: goal, actionRequest: action(1, { durationMs: 60_000 }) }), accepted.memory)
    const playing = decide(world({ nowMs: 6_000, rootX: 4, debugGoal: goal, actionRequest: action(1, { durationMs: 60_000 }) }), stillWalking.memory)
    const fadeTail = decide(world({ nowMs: 40_000, rootX: 4, clipOwnsRoot: true, debugGoal: goal, actionRequest: action(1, { durationMs: 60_000 }), actionFeedback: { seq: 1, state: 'finished' } }), playing.memory)
    const resumed = decide(world({ nowMs: 41_000, rootX: 4, debugGoal: goal, actionRequest: action(1, { durationMs: 60_000 }), actionFeedback: { seq: 1, state: 'finished' } }), fadeTail.memory)

    expect(walking.intent.locomotion.goalX).toBe(10)
    expect(accepted.intent.action).toMatchObject({ seq: 1, clipId: 'clip', layer: 'full', phase: 'settling' })
    expect(accepted.intent.locomotion.goalX).toBeNull()
    expect(accepted.memory.pendingGoal).toMatchObject({ x: 10, reason: 'debug', requestedAtMs: 5_000 })
    expect(stillWalking.intent.action?.phase).toBe('settling')
    expect(playing.intent.action).toMatchObject({ seq: 1, phase: 'playing' })
    expect(playing.intent.locomotion.goalX).toBeNull()
    // The pending goal outlives the 30 s time to live while the full clip runs.
    expect(fadeTail.intent.action).toBeNull()
    expect(fadeTail.memory.pendingGoal).toMatchObject({ x: 10, requestedAtMs: 40_000 })
    expect(fadeTail.intent.locomotion.goalX).toBeNull()
    expect(resumed.intent.locomotion).toMatchObject({ goalX: 10, reason: 'debug' })
    expect(resumed.memory.pendingGoal).toBeNull()
  })

  it('(b) keeps a pending approach-chat through a 45 second dance and issues it afterwards', () => {
    const started = decide(world({ actionRequest: dance(1) }))
    const unfolded = decide(world({ nowMs: 1_000, chatUnfoldSeq: 1, chatX: 6, actionRequest: dance(1) }), started.memory)
    const during = decide(world({ nowMs: 40_000, chatUnfoldSeq: 1, chatX: 6, actionRequest: dance(1) }), unfolded.memory)
    const finished = decide(world({ nowMs: 46_000, chatUnfoldSeq: 1, chatX: 6, actionRequest: dance(1), actionFeedback: { seq: 1, state: 'finished' } }), during.memory)

    expect(started.intent.action).toMatchObject({ phase: 'playing', layer: 'full' })
    expect(unfolded.memory.pendingGoal).toMatchObject({ reason: 'approach-chat' })
    expect(unfolded.intent.action).not.toBeNull()
    expect(during.memory.pendingGoal).toMatchObject({ reason: 'approach-chat' })
    expect(during.intent.locomotion.goalX).toBeNull()
    expect(finished.intent.action).toBeNull()
    expect(finished.intent.locomotion).toMatchObject({ goalX: 5, reason: 'approach-chat' })
  })

  it('(c) stands a sitting character up for a full action and keeps the sit under an upper gesture', () => {
    const started = decide(world({ nowMs: 0 }))
    const sitting = decide(world({ nowMs: 120_000 }), started.memory)
    // 1 s after the sit, inside the stance dwell: a performance is not held back by it.
    const requested = decide(world({ nowMs: 121_000, actionRequest: action(1) }), sitting.memory)
    const early = decide(world({ nowMs: 121_000 + STAND_SETTLE_MS - 1, actionRequest: action(1) }), requested.memory)
    const settled = decide(world({ nowMs: 121_000 + STAND_SETTLE_MS, actionRequest: action(1) }), early.memory)
    const waving = decide(world({ nowMs: 121_000, actionRequest: gesture(1) }), sitting.memory)
    const later = decide(world({ nowMs: 122_000, actionRequest: gesture(1) }), waving.memory)

    expect(sitting.intent.stance).toBe('sit')
    expect(requested.intent.stance).toBe('stand')
    expect(requested.intent.action?.phase).toBe('settling')
    expect(early.intent.action?.phase).toBe('settling')
    expect(settled.intent.action?.phase).toBe('playing')
    expect(waving.intent.stance).toBe('sit')
    expect(waving.intent.action).toMatchObject({ layer: 'upper', phase: 'playing' })
    expect(later.intent.stance).toBe('sit')
  })

  it('(d) reports the retry time of a refractory refusal and still advances the sequence', () => {
    const started = decide(world({ actionRequest: action(1) }))
    const finished = decide(world({ nowMs: 5_000, actionRequest: action(1), actionFeedback: { seq: 1, state: 'finished' } }), started.memory)
    const refused = decide(world({
      nowMs: 6_000,
      actionRequest: action(2),
      toolRequest: { seq: 1, kind: 'look-at', target: 'chat' },
    }), finished.memory)
    const accepted = decide(world({ nowMs: 5_000 + ACTION_REFRACTORY_MS, actionRequest: action(3) }), refused.memory)

    expect(finished.intent.action).toBeNull()
    expect(refused.memory).toMatchObject({ lastActionSeq: 2, actionRefusal: 'refractory', actionRetryAfterMs: ACTION_REFRACTORY_MS - 1_000, toolRefused: false })
    expect(refused.intent.action).toBeNull()
    expect(accepted.memory).toMatchObject({ lastActionSeq: 3, actionRefusal: null, actionRetryAfterMs: null })
    expect(accepted.intent.action?.seq).toBe(3)
  })

  it('(d) drops a repeated gesture inside the per-clip cooldown without a retry time', () => {
    const first = decide(world({ actionRequest: gesture(1) }))
    const finished = decide(world({ nowMs: 1_000, actionRequest: gesture(1), actionFeedback: { seq: 1, state: 'finished' } }), first.memory)
    const repeated = decide(world({ nowMs: 2_000, actionRequest: gesture(2) }), finished.memory)
    const other = decide(world({ nowMs: 2_500, actionRequest: gesture(3, { clipId: 'nod' }) }), repeated.memory)
    const again = decide(world({ nowMs: 4_000, actionRequest: gesture(4) }), other.memory)

    expect(repeated.memory).toMatchObject({ lastActionSeq: 2, actionRefusal: 'refractory', actionRetryAfterMs: null })
    expect(repeated.intent.action).toBeNull()
    expect(other.intent.action).toMatchObject({ seq: 3, clipId: 'nod' })
    expect(again.memory.lastActionSeq).toBe(4)
  })

  it('(h) holds a full action in settling while she speaks, with no timeout, but plays a gesture at once', () => {
    const speaking = { speaking: true, performance: performance('talking') }
    const held = decide(world({ ...speaking, actionRequest: action(1) }))
    const longHeld = decide(world({ ...speaking, nowMs: 60_000, actionRequest: action(1) }), held.memory)
    const released = decide(world({ nowMs: 61_000, actionRequest: action(1) }), longHeld.memory)
    const wave = decide(world({ ...speaking, actionRequest: gesture(1) }))

    expect(held.intent.action?.phase).toBe('settling')
    expect(longHeld.intent.action?.phase).toBe('settling')
    expect(released.intent.action?.phase).toBe('playing')
    expect(wave.intent.action).toMatchObject({ layer: 'upper', phase: 'playing' })
  })

  it('(e) ends a looping dance on a chat unfold and on a move tool, but not a one-shot', () => {
    const loop = decide(world({ actionRequest: dance(1, { loop: true }) }))
    const unfolded = decide(world({ nowMs: 1_000, chatUnfoldSeq: 1, chatX: 6, actionRequest: dance(1, { loop: true }) }), loop.memory)
    const moved = decide(world({ nowMs: 1_000, chatX: 6, actionRequest: dance(1, { loop: true }), toolRequest: { seq: 1, kind: 'come-here' } }), loop.memory)
    const oneShot = decide(world({ actionRequest: dance(1) }))
    const oneShotUnfolded = decide(world({ nowMs: 1_000, chatUnfoldSeq: 1, chatX: 6, actionRequest: dance(1) }), oneShot.memory)
    const oneShotMoved = decide(world({ nowMs: 1_000, chatX: 6, actionRequest: dance(1), toolRequest: { seq: 1, kind: 'come-here' } }), oneShot.memory)

    expect(loop.intent.action?.loop).toBe(true)
    expect(unfolded.intent.action).toBeNull()
    expect(unfolded.intent.locomotion).toMatchObject({ goalX: 5, reason: 'approach-chat' })
    expect(unfolded.memory.actionRefractoryUntilMs.dance).toBe(1_000 + DANCE_REFRACTORY_MS)
    expect(moved.intent.action).toBeNull()
    expect(moved.intent.locomotion).toMatchObject({ goalX: 5, reason: 'tool' })
    expect(oneShotUnfolded.intent.action?.phase).toBe('playing')
    expect(oneShotUnfolded.memory.pendingGoal).toMatchObject({ reason: 'approach-chat' })
    expect(oneShotUnfolded.intent.locomotion.goalX).toBeNull()
    expect(oneShotMoved.intent.action?.phase).toBe('playing')
    expect(oneShotMoved.memory.pendingGoal).toMatchObject({ reason: 'tool' })
  })

  it('(e) ends a one-shot that never reports back with the watchdog, two seconds after its duration', () => {
    const request = action(1, { durationMs: 10_000 })
    const started = decide(world({ actionRequest: request }))
    const nearly = decide(world({ nowMs: 11_999, actionRequest: request }), started.memory)
    const ended = decide(world({ nowMs: 12_000, actionRequest: request }), nearly.memory)

    expect(started.intent.action?.phase).toBe('playing')
    expect(nearly.intent.action).not.toBeNull()
    expect(ended.intent.action).toBeNull()
    expect(ended.memory.actionRefractoryUntilMs.action).toBe(12_000 + ACTION_REFRACTORY_MS)
  })

  it('ends a failed performance without arming the refractory', () => {
    const started = decide(world({ actionRequest: action(1) }))
    const failed = decide(world({ nowMs: 1_000, actionRequest: action(1), actionFeedback: { seq: 1, state: 'failed' } }), started.memory)
    const again = decide(world({ nowMs: 1_500, actionRequest: action(2) }), failed.memory)

    expect(failed.intent.action).toBeNull()
    expect(failed.memory.actionRefractoryUntilMs).toEqual({ action: 0, dance: 0 })
    expect(again.intent.action?.seq).toBe(2)
  })

  it('stops a performance on an empty clip id from a tool or debug source', () => {
    const loop = decide(world({ actionRequest: dance(1, { loop: true }) }))
    const stopped = decide(world({ nowMs: 1_000, actionRequest: action(2, { clipId: '', source: 'debug' }) }), loop.memory)

    expect(stopped.intent.action).toBeNull()
    expect(stopped.memory.lastActionSeq).toBe(2)
    expect(stopped.memory.actionRefusal).toBeNull()
  })

  it('(f) refuses while dragging and ends a full performance or a loop when the drag starts', () => {
    const refused = decide(world({ dragging: true, actionRequest: action(1) }))
    const full = decide(world({ actionRequest: action(1) }))
    const dragged = decide(world({ nowMs: 1_000, dragging: true, actionRequest: action(1) }), full.memory)
    const upper = decide(world({ actionRequest: gesture(1) }))
    const upperDragged = decide(world({ nowMs: 500, dragging: true, actionRequest: gesture(1) }), upper.memory)
    const loop = decide(world({ actionRequest: gesture(1, { loop: true }) }))
    const loopDragged = decide(world({ nowMs: 500, dragging: true, actionRequest: gesture(1, { loop: true }) }), loop.memory)

    expect(refused.intent.action).toBeNull()
    expect(refused.memory).toMatchObject({ lastActionSeq: 1, actionRefusal: 'dragging' })
    expect(dragged.intent.action).toBeNull()
    expect(upperDragged.intent.action).not.toBeNull()
    expect(loopDragged.intent.action).toBeNull()
  })

  it('refuses asleep while away and busy while another clip runs, and lets an action replace a gesture', () => {
    const away = decide(world({ performance: performance('idle', 'camera', true), actionRequest: action(1) }))
    const full = decide(world({ actionRequest: action(1, { durationMs: 10_000 }) }))
    const busy = decide(world({ nowMs: 3_000, actionRequest: action(2, { clipId: 'other' }) }), full.memory)
    const loopBusy = decide(world({ nowMs: 3_000, actionRequest: gesture(2) }), decide(world({ actionRequest: dance(1, { loop: true }) })).memory)
    const upper = decide(world({ actionRequest: gesture(1) }))
    const gestureBusy = decide(world({ nowMs: 500, actionRequest: gesture(2, { clipId: 'nod' }) }), upper.memory)
    const replaced = decide(world({ nowMs: 500, actionRequest: action(2) }), upper.memory)

    expect(away.memory).toMatchObject({ lastActionSeq: 1, actionRefusal: 'asleep' })
    expect(busy.memory).toMatchObject({ lastActionSeq: 2, actionRefusal: 'busy', actionRetryAfterMs: 7_000 })
    expect(busy.intent.action?.seq).toBe(1)
    expect(loopBusy.memory).toMatchObject({ actionRefusal: 'busy', actionRetryAfterMs: 0 })
    expect(gestureBusy.memory).toMatchObject({ actionRefusal: 'busy', actionRetryAfterMs: 1_500 })
    expect(replaced.intent.action?.seq).toBe(2)
    expect(replaced.intent.action?.layer).toBe('full')
  })

  it('(g) names why a movement tool was refused', () => {
    const closed = decide(world({ chatX: null, toolRequest: { seq: 1, kind: 'come-here' } }))
    const noWorld = decide(input({ toolRequest: { seq: 1, kind: 'go-home' } }))
    const first = decide(world({ chatX: 6, toolRequest: { seq: 1, kind: 'come-here' } }))
    const refractory = decide(world({ nowMs: 1_000, chatX: 6, toolRequest: { seq: 2, kind: 'go-home' } }), first.memory)
    const accepted = decide(world({ nowMs: MOVE_TOOL_REFRACTORY_MS, chatX: 6, toolRequest: { seq: 3, kind: 'go-home' } }), refractory.memory)

    expect(closed.memory).toMatchObject({ toolRefused: true, toolRefusalReason: 'chat-closed' })
    expect(noWorld.memory).toMatchObject({ toolRefused: true, toolRefusalReason: 'no-world' })
    expect(first.memory.toolRefusalReason).toBeNull()
    expect(refractory.memory).toMatchObject({ toolRefused: true, toolRefusalReason: 'refractory' })
    expect(accepted.memory.toolRefusalReason).toBeNull()
  })

  describe('cancel and resume', () => {
    const goal = { seq: 1, x: 10, pace: 'walk' as const }
    const enders: Array<[string, Partial<DirectorInput>]> = [
      ['an interaction', { interactionSeq: 1 }],
      ['a drag', { dragging: true }],
      ['a chat unfold', { chatUnfoldSeq: 1, chatX: 6 }],
      ['going away', { performance: performance('idle', 'camera', true) }],
    ]

    it.each(enders)('refreshes the pending goal time to live when %s ends a performance, then accepts a re-request after the refractory', (_name, ender) => {
      const request = dance(1, { loop: true })
      const walking = decide(world({ debugGoal: goal }))
      const accepted = decide(world({ nowMs: 5_000, rootX: 4, locomotionMode: 'walking', debugGoal: goal, actionRequest: request }), walking.memory)
      const playing = decide(world({ nowMs: 6_000, rootX: 4, debugGoal: goal, actionRequest: request }), accepted.memory)
      // 35 s in: older than the time to live, kept alive only because the full clip runs.
      const ended = decide(world({ nowMs: 40_000, rootX: 4, clipOwnsRoot: true, debugGoal: goal, actionRequest: request, ...ender }), playing.memory)
      const settled = decide(world({ nowMs: 40_001, rootX: 4, clipOwnsRoot: true, debugGoal: goal, actionRequest: request, ...ender, dragging: false }), ended.memory)
      const stillHeld = decide(world({ nowMs: 69_999, rootX: 4, clipOwnsRoot: true, debugGoal: goal, actionRequest: request }), settled.memory)
      const early = decide(world({ nowMs: 40_000 + DANCE_REFRACTORY_MS - 1, rootX: 4, actionRequest: dance(2) }), stillHeld.memory)
      // A refused request is consumed; the caller asks again with a new sequence number.
      const again = decide(world({ nowMs: 40_000 + DANCE_REFRACTORY_MS, rootX: 4, actionRequest: dance(3) }), early.memory)

      expect(playing.intent.action?.phase).toBe('playing')
      expect(playing.memory.pendingGoal).toMatchObject({ requestedAtMs: 5_000 })
      expect(ended.intent.action).toBeNull()
      expect(ended.memory.pendingGoal?.requestedAtMs).toBe(40_000)
      expect(stillHeld.memory.pendingGoal).not.toBeNull()
      expect(early.memory).toMatchObject({ lastActionSeq: 2, actionRefusal: 'refractory', actionRetryAfterMs: 1 })
      expect(early.intent.action).toBeNull()
      expect(again.intent.action).toMatchObject({ seq: 3, clipId: 'dance' })
      expect(again.memory.actionRefusal).toBeNull()
    })

    it('ends a full one-shot on an interaction but lets an upper one-shot continue', () => {
      const full = decide(world({ actionRequest: action(1) }))
      const fullPoked = decide(world({ nowMs: 1_000, interactionSeq: 1, actionRequest: action(1) }), full.memory)
      const upper = decide(world({ actionRequest: gesture(1) }))
      const upperPoked = decide(world({ nowMs: 500, interactionSeq: 1, actionRequest: gesture(1) }), upper.memory)

      expect(fullPoked.intent.action).toBeNull()
      expect(upperPoked.intent.action).toMatchObject({ layer: 'upper', phase: 'playing' })
    })
  })

  it('works without a world: the classic window still performs and ends on a poke', () => {
    const quiet = { ...NO_WORLD_BODY_INPUT, interactionSeq: 0, interactionAtMs: null, actionRequest: null, actionFeedback: null, dragging: false }
    const frame = (nowMs: number, patch: Partial<DirectorInput> = {}): DirectorInput => ({
      nowMs,
      performance: performance(),
      cursorPoint,
      chatPoint,
      cameraPoint,
      slots: { sit: true, sleep: true },
      ...quiet,
      ...patch,
    })
    const started = decide(frame(0, { actionRequest: action(1) }))
    const poked = decide(frame(1_000, { actionRequest: action(1), interactionSeq: 1 }), started.memory)

    expect(started.intent.action).toMatchObject({ phase: 'playing' })
    expect(poked.intent.action).toBeNull()
  })
})

describe('body director three minute performance scenario', () => {
  it('walks to the chat, dances through a come_here, resumes it, then a poke ends the second action', () => {
    const labels: Array<{ atMs: number, label: string }> = []
    const log = (atMs: number, label: string) => labels.push({ atMs, label })
    const first = dance(1, { durationMs: 50_000 })
    const second = action(2, { clipId: 'spin', durationMs: 30_000 })
    let memory = initialBodyDirectorMemory
    let rootX = 0
    let mode: DirectorInput['locomotionMode'] = 'idle'

    for (let nowMs = 0; nowMs <= 180_000; nowMs += 500) {
      const previous = memory
      const frame = world({
        nowMs,
        rootX,
        locomotionMode: mode,
        chatUnfoldSeq: nowMs >= 10_000 ? 1 : 0,
        chatX: 14,
        toolRequest: nowMs >= 40_000 ? { seq: 1, kind: 'come-here' } : null,
        actionRequest: nowMs >= 80_000 ? second : nowMs >= 20_000 ? first : null,
        actionFeedback: nowMs >= 70_000 ? { seq: 1, state: 'finished' } : null,
        interactionSeq: nowMs >= 90_000 ? 1 : 0,
      })
      const out = decide(frame, previous)
      memory = out.memory

      if (previous.performing && !memory.performing)
        log(nowMs, memory.lastInteractionSeq > previous.lastInteractionSeq ? 'ended by interaction' : 'finished')
      if (memory.goalSinceMs !== previous.goalSinceMs && memory.goalX !== null)
        log(nowMs, memory.reason === 'tool' ? 'tool issued' : memory.reason)
      if (memory.performing && memory.performing.phase !== previous.performing?.phase)
        log(nowMs, `performing ${memory.performing.phase}`)
      if (memory.pendingGoal?.reason === 'tool' && previous.pendingGoal?.reason !== 'tool')
        log(nowMs, 'pending tool')

      const { goalX, pace } = out.intent.locomotion
      if (goalX !== null && Math.abs(goalX - rootX) > 0.1) {
        rootX += Math.sign(goalX - rootX) * Math.min((pace === 'walk' ? 1 : 0.6) * 0.5, Math.abs(goalX - rootX))
        mode = 'walking'
      }
      else {
        mode = 'idle'
      }
    }

    console.info(labels.map(entry => `scenario t=${(entry.atMs / 1000).toFixed(1)}s ${entry.label}`).join('\n'))

    const order = ['approach-chat', 'performing settling', 'performing playing', 'pending tool', 'finished', 'tool issued', 'performing playing', 'ended by interaction']
    let cursor = -1
    for (const label of order) {
      const index = labels.findIndex((entry, at) => at > cursor && entry.label === label)
      expect(index, `${label} after position ${cursor}`).toBeGreaterThan(cursor)
      cursor = index
    }
    expect(labels.find(entry => entry.label === 'finished')?.atMs).toBe(70_000)
    expect(labels.find(entry => entry.label === 'ended by interaction')?.atMs).toBe(90_000)
  })
})
