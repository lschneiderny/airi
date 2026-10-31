import type { PerformanceAttention, PerformanceMode, PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { BodyIntent } from '../types'

import { describe, expect, it } from 'vitest'

import { decideBody, initialBodyDirectorMemory } from './index'

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
