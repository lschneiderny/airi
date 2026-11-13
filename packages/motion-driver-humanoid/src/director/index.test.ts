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
  LINGER_MAX_MS,
  LINGER_MIN_MS,
  LOOK_OVERRIDE_MS,
  LOOK_TOOL_REFRACTORY_MS,
  MOVE_TOOL_REFRACTORY_MS,
  NO_WORLD_BODY_INPUT,
  PENDING_GOAL_TTL_MS,
  RETURN_HOME_DELAY_MS,
  STAND_SETTLE_MS,
  VISIT_SHARE,
  VISIT_STOP_LEGS,
  WANDER_MAX_MS,
  WANDER_MIN_MS,
} from './index'

type DirectorInput = Parameters<typeof decideBody>[0]

const cameraPoint = { x: 0, y: 1, z: 2 }
const cursorPoint = { x: 3, y: 4, z: 5 }
const chatPoint = { x: 6, y: 7, z: 8 }
/** Natural's long idle states: settled in after a long idle, asleep while the user is away. */
const SETTLED = { settled: true, asleep: false }
const ASLEEP = { settled: false, asleep: true }

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
    chatSendSeq: 0,
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
    idle: { settled: false, asleep: false },
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
  it('sits when Natural has settled her in, however long the idle, and stands when she is no longer settled', () => {
    const started = decide(input({ nowMs: 0 }))
    const longIdle = decide(input({ nowMs: 300_000 }), started.memory)
    const settled = decide(input({ nowMs: 300_001, idle: SETTLED }), longIdle.memory)
    const up = decide(input({ nowMs: 304_000 }), settled.memory)

    expect(longIdle.intent.stance).toBe('stand')
    expect(settled.intent).toMatchObject({ stance: 'sit', rest: 'none' })
    expect(up.intent.stance).toBe('stand')
  })

  it('rests and dozes procedurally when Natural settles her in or she sleeps and the model has no clip for it', () => {
    const noClips = { slots: { sit: false, sleep: false } }
    const resting = decide(input({ nowMs: 0, idle: SETTLED, ...noClips }))
    const dozing = decide(input({ nowMs: 4_000, idle: ASLEEP, performance: performance('idle', 'camera', true), ...noClips }), resting.memory)
    const awake = decide(input({ nowMs: 8_000, ...noClips }), dozing.memory)

    expect(resting.intent).toMatchObject({ stance: 'stand', rest: 'rest' })
    expect(dozing.intent).toMatchObject({ stance: 'stand', rest: 'doze' })
    expect(awake.intent).toMatchObject({ stance: 'stand', rest: 'none' })
  })

  it('neither rests nor dozes while she talks, walks, is away from home or performs a full clip', () => {
    const rest = (overrides: Partial<DirectorInput>) => decide(world({ slots: { sit: false, sleep: false }, idle: SETTLED, ...overrides })).intent.rest
    const doze = (overrides: Partial<DirectorInput>) => decide(world({ slots: { sit: false, sleep: false }, idle: ASLEEP, ...overrides })).intent.rest

    expect(rest({})).toBe('rest')
    expect(rest({ performance: performance('talking') })).toBe('none')
    expect(rest({ locomotionMode: 'walking' })).toBe('none')
    expect(rest({ rootX: 5 })).toBe('none')
    expect(rest({ actionRequest: { seq: 1, clipId: 'dance', kind: 'dance', layer: 'full', loop: false, durationMs: 30_000, source: 'tool' } })).toBe('none')
    expect(doze({})).toBe('doze')
    expect(doze({ rootX: 5 })).toBe('none')
  })

  it('stands on every talking frame', () => {
    const result = decide(input({ performance: performance('talking') }))

    expect(result.intent.stance).toBe('stand')
  })

  it('sleeps when Natural is asleep and the sleep slot is present, and not merely because the user is away', () => {
    const prior = decide(input({ nowMs: 0 }))
    const away = decide(input({ nowMs: 3_000, performance: performance('idle', 'camera', true) }), prior.memory)
    const asleep = decide(input({ nowMs: 3_000, performance: performance('idle', 'camera', true), idle: ASLEEP }), prior.memory)

    expect(away.intent.stance).toBe('stand')
    expect(asleep.intent).toMatchObject({ stance: 'sleep', rest: 'none' })
  })

  it('enforces the minimum dwell between stance changes', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000, idle: SETTLED }), started.memory)
    const beforeDwell = decide(input({
      nowMs: 122_999,
      performance: performance('idle', 'camera', true),
      idle: ASLEEP,
    }), sitting.memory)
    const afterDwell = decide(input({
      nowMs: 123_000,
      performance: performance('idle', 'camera', true),
      idle: ASLEEP,
    }), beforeDwell.memory)

    expect(sitting.intent.stance).toBe('sit')
    expect(beforeDwell.intent.stance).toBe('sit')
    expect(afterDwell.intent.stance).toBe('sleep')
  })

  it('returns to standing when talking starts after stance dwell', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000, idle: SETTLED }), started.memory)
    const talking = decide(input({
      nowMs: 123_000,
      performance: performance('talking'),
    }), sitting.memory)

    expect(sitting.intent.stance).toBe('sit')
    expect(talking.intent.stance).toBe('stand')
  })

  it('clamps a backwards clock to the latest observed time', () => {
    const started = decide(input({ nowMs: 0 }))
    const sitting = decide(input({ nowMs: 120_000, idle: SETTLED }), started.memory)
    const backwards = decide(input({ nowMs: 119_000, idle: SETTLED }), sitting.memory)

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
    const sitting = decide(input({ nowMs: 120_000, rootX: 9, idle: SETTLED }), started.memory)

    expect(stay.intent.locomotion).toEqual({ homeX: 2, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' })
    expect(sitting.intent.stance).toBe('sit')
  })

  const blockers: Array<[string, Partial<DirectorInput>]> = [
    ['speaking', { speaking: true }],
    ['the clip owning the root', { clipOwnsRoot: true }],
    ['talking mode', { performance: performance('talking') }],
  ]
  it('keeps the legacy six-field input on the old stance behaviour when spread with the no-world constant', () => {
    const legacy = (nowMs: number, mode: PerformanceMode = 'idle', away = false, idle = { settled: false, asleep: false }): DirectorInput => ({
      nowMs,
      performance: performance(mode, 'camera', away),
      cursorPoint,
      chatPoint,
      cameraPoint,
      slots: { sit: true, sleep: true },
      ...NO_WORLD_BODY_INPUT,
      interactionSeq: 0,
      chatSendSeq: 0,
      interactionAtMs: null,
      actionRequest: null,
      actionFeedback: null,
      dragging: false,
      idle,
    })
    const started = decide(legacy(0))
    const sitting = decide(legacy(120_000, 'idle', false, SETTLED), started.memory)
    const sleeping = decide(legacy(123_000, 'idle', true, ASLEEP), sitting.memory)
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
      return decide(world({ nowMs: 120_000, idle: SETTLED, ...overrides }), started.memory).intent.stance
    }
    const sleep = (overrides: Partial<DirectorInput>) => {
      const started = decide(world({ nowMs: 0, ...overrides }))
      return decide(world({ nowMs: 3_000, performance: performance('idle', 'camera', true), idle: ASLEEP, ...overrides }), started.memory).intent.stance
    }

    expect(sit({ rootX: 5 })).toBe('stand')
    expect(sit({ locomotionMode: 'walking' })).toBe('stand')
    expect(sit({ rootX: 0.05 })).toBe('sit')
    expect(sleep({ rootX: 5 })).toBe('stand')
    expect(sleep({})).toBe('sleep')
  })

  it('stands a sitting character up to take a pending goal', () => {
    const started = decide(world({ nowMs: 0 }))
    const sitting = decide(world({ nowMs: 120_000, idle: SETTLED }), started.memory)
    const requested = decide(world({ nowMs: 123_000, idle: SETTLED, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), sitting.memory)
    const standing = decide(world({ nowMs: 124_000, idle: SETTLED, debugGoal: { seq: 1, x: 4, pace: 'walk' } }), requested.memory)

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
    const sitting = decide(world({ nowMs: 120_000, idle: SETTLED }), started.memory)
    // 1 s after the sit, inside the stance dwell: a performance is not held back by it.
    const requested = decide(world({ nowMs: 121_000, idle: SETTLED, actionRequest: action(1) }), sitting.memory)
    const early = decide(world({ nowMs: 121_000 + STAND_SETTLE_MS - 1, idle: SETTLED, actionRequest: action(1) }), requested.memory)
    const settled = decide(world({ nowMs: 121_000 + STAND_SETTLE_MS, idle: SETTLED, actionRequest: action(1) }), early.memory)
    const waving = decide(world({ nowMs: 121_000, idle: SETTLED, actionRequest: gesture(1) }), sitting.memory)
    const later = decide(world({ nowMs: 122_000, idle: SETTLED, actionRequest: gesture(1) }), waving.memory)

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

  it('lets a looping debug gesture repeat inside the per-clip cooldown and keeps the busy and dragging rules', () => {
    const first = decide(world({ actionRequest: gesture(1, { source: 'debug', loop: true }) }))
    const stopped = decide(world({ nowMs: 1_000, actionRequest: gesture(2, { clipId: '', source: 'debug' }) }), first.memory)
    const again = decide(world({ nowMs: 1_500, actionRequest: gesture(3, { source: 'debug', loop: true }) }), stopped.memory)
    const oneShot = decide(world({ nowMs: 1_500, actionRequest: gesture(3, { source: 'debug' }) }), stopped.memory)
    const toolLoop = decide(world({ nowMs: 1_500, actionRequest: gesture(3, { loop: true }) }), stopped.memory)
    const busy = decide(world({ nowMs: 2_000, actionRequest: gesture(4, { clipId: 'nod', source: 'debug', loop: true }) }), again.memory)
    const dragged = decide(world({ nowMs: 1_500, dragging: true, actionRequest: gesture(3, { source: 'debug', loop: true }) }), stopped.memory)

    expect(stopped.intent.action).toBeNull()
    expect(again.memory).toMatchObject({ lastActionSeq: 3, actionRefusal: null })
    expect(again.intent.action).toMatchObject({ seq: 3, clipId: 'wave', loop: true, phase: 'playing' })
    expect(oneShot.memory).toMatchObject({ lastActionSeq: 3, actionRefusal: 'refractory' })
    expect(toolLoop.memory).toMatchObject({ lastActionSeq: 3, actionRefusal: 'refractory' })
    expect(busy.memory).toMatchObject({ lastActionSeq: 4, actionRefusal: 'busy' })
    expect(busy.intent.action?.seq).toBe(3)
    expect(dragged.memory).toMatchObject({ lastActionSeq: 3, actionRefusal: 'dragging' })
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

  describe('a sent chat message', () => {
    const goal = { seq: 1, x: 10, pace: 'walk' as const }
    const start = (request: BodyActionRequest) => {
      const walking = decide(world({ debugGoal: goal }))
      const accepted = decide(world({ nowMs: 5_000, rootX: 4, locomotionMode: 'walking', debugGoal: goal, actionRequest: request }), walking.memory)
      return decide(world({ nowMs: 6_000, rootX: 4, debugGoal: goal, actionRequest: request }), accepted.memory)
    }

    it('keeps a full one-shot playing with the goal pending, issues it after the clip, while a poke still ends it', () => {
      const request = dance(1)
      const playing = start(request)
      const sent = decide(world({ nowMs: 7_000, rootX: 4, clipOwnsRoot: true, chatSendSeq: 1, actionRequest: request }), playing.memory)
      const finished = decide(world({ nowMs: 8_000, rootX: 4, clipOwnsRoot: true, chatSendSeq: 1, actionRequest: request, actionFeedback: { seq: 1, state: 'finished' } }), sent.memory)
      const poked = decide(world({ nowMs: 7_000, rootX: 4, clipOwnsRoot: true, interactionSeq: 1, actionRequest: request }), playing.memory)

      expect(playing.intent.action?.phase).toBe('playing')
      expect(sent.intent.action).toMatchObject({ seq: 1, phase: 'playing' })
      expect(sent.memory.pendingGoal).not.toBeNull()
      expect(finished.intent.action).toBeNull()
      expect(poked.intent.action).toBeNull()
    })

    it('ends a looping clip, like a chat unfold', () => {
      const request = dance(1, { loop: true })
      const playing = start(request)
      const sent = decide(world({ nowMs: 7_000, rootX: 4, clipOwnsRoot: true, chatSendSeq: 1, actionRequest: request }), playing.memory)

      expect(playing.intent.action?.phase).toBe('playing')
      expect(sent.intent.action).toBeNull()
    })
  })

  it('works without a world: the classic window still performs and ends on a poke', () => {
    const quiet = { ...NO_WORLD_BODY_INPUT, interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: null, actionFeedback: null, dragging: false, idle: { settled: false, asleep: false } }
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

describe('body director reach zones', () => {
  const left = stage
  const right = { minX: 30, maxX: 70 }
  const reach = [left, right]
  /** A root in the wing between the two zones. */
  const wingX = 26
  const chase = { interactionSeq: 1, interactionAtMs: 0, cursorOnStage: true }

  it('decides exactly as without reach when the ground line is the only zone', () => {
    const frames = (extra: Partial<DirectorInput>) => [
      world({ ...extra, ...chase, nowMs: 1_000, cursorX: 40 }),
      world({ ...extra, ...chase, nowMs: 5_000, cursorX: -40, rootX: 12, locomotionMode: 'walking' }),
      world({ ...extra, nowMs: 70_000, rootX: 19, chatUnfoldSeq: 1, chatX: 30 }),
      world({ ...extra, nowMs: 75_000, rootX: 19, toolRequest: { seq: 1, kind: 'go-home' }, debugGoal: { seq: 1, x: 99, pace: 'stroll' } }),
      world({ ...extra, nowMs: 200_000, rootX: 25 }),
    ]

    expect(run(frames({ reach: [stage] }))).toEqual(run(frames({})))
  })

  it('chases a cursor on another zone to one leg short of it', () => {
    const crossing = decide(world({ ...chase, nowMs: 1_000, reach, cursorX: 50 }))
    const single = decide(world({ ...chase, nowMs: 1_000, cursorX: 50 }))

    expect(crossing.intent.locomotion).toMatchObject({ goalX: 49, reason: 'approach-cursor' })
    expect(single.intent.locomotion.goalX).toBe(20)
  })

  it('stops a goal that falls in a wing at the edge of the nearest zone', () => {
    const nearRight = decide(world({ reach, debugGoal: { seq: 1, x: 28, pace: 'walk' } }))
    const nearLeft = decide(world({ reach, debugGoal: { seq: 1, x: 22, pace: 'walk' } }))

    expect(nearRight.intent.locomotion).toMatchObject({ goalX: 30, reason: 'debug' })
    expect(nearLeft.intent.locomotion).toMatchObject({ goalX: 20, reason: 'debug' })
  })

  it('returns home across zones, and takes the home tool and the chat there too', () => {
    const onRight = { ground: right, reach, rootX: 50, homeX: 0 }
    const started = decide(input(onRight))
    const home = decide(input({ ...onRight, nowMs: RETURN_HOME_DELAY_MS }), started.memory)
    const tool = decide(input({ ...onRight, toolRequest: { seq: 1, kind: 'go-home' } }))
    const chat = decide(input({ ...onRight, chatUnfoldSeq: 1, chatX: 6 }))

    expect(home.intent.locomotion).toMatchObject({ goalX: 0, pace: 'stroll', reason: 'return-home' })
    expect(tool.intent.locomotion).toMatchObject({ goalX: 0, reason: 'tool' })
    // One leg short of the chat on the side of home, as on a single zone.
    expect(chat.intent.locomotion).toMatchObject({ goalX: 5, reason: 'approach-chat' })
  })

  it('keeps a wander on the ground line she stands on', () => {
    for (const seed of [1, 7, 42, 1234]) {
      // She lives at the edge next to the other zone, so a wander that used the zones could cross.
      const roaming = { reach, rootX: 18, homeX: 18, roamMode: 'roam' as const, seed, slots: { sit: false, sleep: false } }
      const started = decide(world(roaming))
      const due = decide(world({ ...roaming, nowMs: started.memory.nextWanderAtMs as number }), started.memory)

      expect(due.intent.locomotion.reason).toBe('wander')
      expect(due.intent.locomotion.goalX).toBeGreaterThanOrEqual(left.minX)
      expect(due.intent.locomotion.goalX).toBeLessThanOrEqual(left.maxX)
    }
  })

  it('refuses a clip that stops her as busy in a wing, and still plays a gesture there', () => {
    const walking = { reach, rootX: wingX, locomotionMode: 'walking' as const }
    const full = decide(world({ ...walking, actionRequest: action(1) }))
    const waved = decide(world({ ...walking, actionRequest: gesture(1) }))
    const onStage = decide(world({ reach, rootX: 19, actionRequest: action(1) }))
    const single = decide(world({ rootX: wingX, actionRequest: action(1) }))

    expect(full.memory).toMatchObject({ lastActionSeq: 1, actionRefusal: 'busy', actionRetryAfterMs: null, performing: null })
    expect(waved.intent.action).toMatchObject({ seq: 1, phase: 'playing' })
    expect(onStage.intent.action?.seq).toBe(1)
    expect(single.intent.action?.seq).toBe(1)
  })

  it('walks a root at rest in a wing to the nearest zone', () => {
    const rest = decide(world({ reach, rootX: wingX }))
    const nearLeft = decide(world({ reach, rootX: 23 }))
    const beyond = decide(input({ ground: right, reach, rootX: 80, homeX: 80 }))

    expect(rest.intent.locomotion).toMatchObject({ goalX: 30, pace: 'walk', reason: 'enter-stage' })
    expect(nearLeft.intent.locomotion.goalX).toBe(20)
    expect(beyond.intent.locomotion.goalX).toBe(70)
  })

  it('leaves her alone in a wing while she walks to a goal, and without reach', () => {
    const goal = decide(world({ ...chase, nowMs: 1_000, reach, cursorX: 50 }))
    const crossing = decide(world({ ...chase, nowMs: 1_500, reach, cursorX: 50, rootX: wingX, locomotionMode: 'walking' }), goal.memory)
    const single = decide(world({ rootX: wingX, homeX: wingX }))

    expect(crossing.intent.locomotion).toMatchObject({ goalX: 49, reason: 'approach-cursor' })
    expect(single.intent.locomotion.goalX).toBeNull()
  })
})

describe('body director visits and lingering', () => {
  /** A roaming frame with the cursor resting on the stage at `cursorX`. */
  const roaming = (overrides: Partial<DirectorInput> = {}) => world({ roamMode: 'roam', seed: 7, cursorOnStage: true, cursorX: 14, slots: { sit: false, sleep: false }, ...overrides })

  it('walks over to where the user works while they are active, and stops short of the cursor', () => {
    const started = decide(roaming())
    const dueMs = started.memory.nextWanderAtMs as number
    const due = decide(roaming({ nowMs: dueMs, performance: performance('watching') }), started.memory)

    expect(due.intent.locomotion).toMatchObject({ goalX: 14 - VISIT_STOP_LEGS, pace: 'stroll', reason: 'visit' })
    expect(due.memory.nextWanderAtMs).toBeGreaterThanOrEqual(dueMs + WANDER_MIN_MS)
  })

  it('stays put while the user is active and the cursor is already beside her', () => {
    const started = decide(roaming({ cursorX: 1.6 }))
    const dueMs = started.memory.nextWanderAtMs as number
    const due = decide(roaming({ nowMs: dueMs, cursorX: 1.6, performance: performance('watching') }), started.memory)

    expect(due.intent.locomotion.goalX).toBeNull()
    expect(due.memory.nextWanderAtMs).toBe(dueMs)
  })

  it('visits in about the visit share of idle wanders and strolls anywhere in the rest', () => {
    let visits = 0
    const seeds = 200
    for (let seed = 1; seed <= seeds; seed++) {
      const started = decide(roaming({ seed }))
      const dueMs = started.memory.nextWanderAtMs as number
      const due = decide(roaming({ nowMs: dueMs, seed }), started.memory)
      expect(['visit', 'wander']).toContain(due.intent.locomotion.reason)
      if (due.intent.locomotion.reason === 'visit')
        visits++
    }
    expect(visits / seeds).toBeGreaterThan(VISIT_SHARE - 0.12)
    expect(visits / seeds).toBeLessThan(VISIT_SHARE + 0.12)
  })

  it('stays where a visit took her before walking home', () => {
    const started = decide(roaming())
    const dueMs = started.memory.nextWanderAtMs as number
    const due = decide(roaming({ nowMs: dueMs, performance: performance('watching') }), started.memory)
    const goalX = due.intent.locomotion.goalX as number
    const arrived = decide(roaming({ nowMs: dueMs + 10_000, rootX: goalX }), due.memory)
    const lingerMs = arrived.memory.lingerUntilMs - (dueMs + 10_000)

    expect(arrived.intent.locomotion.reason).toBe('stay')
    expect(lingerMs).toBeGreaterThanOrEqual(LINGER_MIN_MS)
    expect(lingerMs).toBeLessThanOrEqual(LINGER_MAX_MS)
    // Past the old 20 s return delay she is still there; after the stay she strolls home.
    const staying = decide(roaming({ nowMs: dueMs + 10_000 + LINGER_MIN_MS - 1_000, rootX: goalX }), arrived.memory)
    expect(staying.intent.locomotion.goalX).toBeNull()
    const leaving = decide(roaming({ nowMs: arrived.memory.lingerUntilMs, rootX: goalX }), staying.memory)
    expect(leaving.intent.locomotion).toMatchObject({ goalX: 0, pace: 'stroll', reason: 'return-home' })
  })
})

describe('body director unasked clips', () => {
  const idle = (seq: number, overrides: Partial<BodyActionRequest> = {}) => gesture(seq, { source: 'idle', ...overrides })

  it('plays an unasked clip on a quiet body without arming a cooldown or a refractory', () => {
    const playing = decide(world({ actionRequest: idle(1) }))
    const ended = decide(world({ nowMs: 2_100, actionRequest: idle(1), actionFeedback: { seq: 1, state: 'finished' } }), playing.memory)
    const full = decide(world({ nowMs: 3_000, actionRequest: action(2, { source: 'idle' }) }), ended.memory)
    const fullEnded = decide(world({ nowMs: 20_000, actionRequest: action(2, { source: 'idle' }), actionFeedback: { seq: 2, state: 'finished' } }), full.memory)

    expect(playing.intent.action).toMatchObject({ seq: 1, clipId: 'wave', phase: 'playing' })
    expect(playing.memory.gestureCooldown).toBeNull()
    expect(full.intent.action).toMatchObject({ seq: 2, layer: 'full' })
    expect(fullEnded.memory.actionRefractoryUntilMs).toEqual({ action: 0, dance: 0 })
  })

  it('refuses an unasked clip while she talks, thinks, walks, or already performs', () => {
    const talking = decide(world({ speaking: true, actionRequest: idle(1) }))
    const thinking = decide(world({ performance: performance('thinking'), actionRequest: idle(1) }))
    const goal = { seq: 1, x: 10, pace: 'walk' as const }
    const walking = decide(world({ nowMs: 1_000, rootX: 2, locomotionMode: 'walking', debugGoal: goal, actionRequest: idle(1) }), decide(world({ debugGoal: goal })).memory)
    const performing = decide(world({ actionRequest: gesture(1) }))
    const second = decide(world({ nowMs: 500, actionRequest: idle(2, { clipId: 'nod' }) }), performing.memory)

    for (const refused of [talking, thinking, walking, second])
      expect(refused.memory.actionRefusal).toBe('busy')
    expect(talking.intent.action).toBeNull()
    expect(second.intent.action).toMatchObject({ seq: 1 })
  })

  it('gives way to any asked request', () => {
    const unasked = decide(world({ actionRequest: action(1, { source: 'idle', durationMs: 30_000 }) }))
    const playing = decide(world({ nowMs: 1_000, actionRequest: action(1, { source: 'idle', durationMs: 30_000 }) }), unasked.memory)
    const asked = decide(world({ nowMs: 5_000, actionRequest: dance(2) }), playing.memory)

    expect(asked.memory.actionRefusal).toBeNull()
    expect(asked.intent.action).toMatchObject({ seq: 2, clipId: 'dance' })
  })

  it('ends an unasked clip when the user sends a message, touches her, or she starts to talk', () => {
    const start = () => decide(world({ actionRequest: idle(1, { durationMs: 6_000 }) }))
    const sent = decide(world({ nowMs: 1_000, chatSendSeq: 1, actionRequest: idle(1) }), start().memory)
    const touched = decide(world({ nowMs: 1_000, interactionSeq: 1, actionRequest: idle(1) }), start().memory)
    const talking = decide(world({ nowMs: 1_000, performance: performance('talking'), actionRequest: idle(1) }), start().memory)

    for (const ended of [sent, touched, talking])
      expect(ended.intent.action).toBeNull()
  })

  it('never stops a performance with an empty unasked request', () => {
    const playing = decide(world({ actionRequest: dance(1) }))
    const stop = decide(world({ nowMs: 1_000, actionRequest: action(2, { clipId: '', source: 'idle' }) }), playing.memory)

    expect(stop.intent.action).toMatchObject({ seq: 1 })
  })
})
