import type { BodyIntent, BodyLookTarget } from '@proj-airi/motion-driver-humanoid/types'
import type { PerformanceAttention } from '@proj-airi/stage-shared/performance-state'

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { resolveBodyTarget } from './attention'

type Points = NonNullable<Parameters<typeof resolveBodyTarget>[0]>

const points: Points = {
  cursor: new Vector3(1, 2, 3),
  chat: new Vector3(4, 5, 6),
  camera: new Vector3(7, 8, 9),
}

function intent(look: BodyIntent['look'] = null): BodyIntent {
  return {
    stance: 'stand',
    rest: 'none',
    look,
    facingYaw: 0,
    locomotion: { homeX: 0, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' },
    action: null,
  }
}

describe('resolveBodyTarget', () => {
  it.each<{ attention: PerformanceAttention, point: Vector3 | null }>([
    { attention: 'camera', point: points.camera },
    { attention: 'cursor', point: points.cursor },
    { attention: 'screen', point: null },
    { attention: 'aside', point: null },
  ])('maps resolver attention $attention to the same diagnostic point', ({ attention, point }) => {
    const target = resolveBodyTarget(points, { onChat: false }, 'mouse', intent(), attention)
    expect(target).toEqual(point)
    if (point)
      expect(target).not.toBe(point)
  })

  it.each<{ target: BodyLookTarget, point: Vector3 | null }>([
    { target: 'camera', point: points.camera },
    { target: 'cursor', point: points.cursor },
    { target: 'chat', point: points.chat },
    { target: 'away', point: null },
  ])('maps a look at $target over resolver attention', ({ target, point }) => {
    const looked = resolveBodyTarget(points, { onChat: false }, 'mouse', intent({ seq: 1, target, holdMs: 8000 }), 'aside')
    expect(looked).toEqual(point)
    if (point)
      expect(looked).not.toBe(point)
  })

  it.each(['cursor', 'chat'] as const)('has no diagnostic point when the requested %s is absent', (target) => {
    const missing = { ...points, [target]: null }
    expect(resolveBodyTarget(missing, { onChat: false }, 'mouse', intent({ seq: 1, target, holdMs: 8000 }), 'camera')).toBeNull()
    if (target === 'cursor')
      expect(resolveBodyTarget(missing, { onChat: false }, 'mouse', intent(), 'cursor')).toBeNull()
  })

  it('has no resolver target before the first directive', () => {
    expect(resolveBodyTarget(points, { onChat: false }, 'mouse', null, 'camera')).toBeNull()
  })

  it('keeps chat-read and camera-mode precedence over a look override', () => {
    const look = intent({ seq: 1, target: 'away', holdMs: 8000 })
    expect(resolveBodyTarget(points, { onChat: true }, 'mouse', look, 'cursor')).toBe(points.chat)
    expect(resolveBodyTarget(points, { onChat: true }, 'camera', look, 'cursor')).toBe(points.camera)
    expect(resolveBodyTarget(points, { onChat: false }, 'none', look, 'cursor')).toBeNull()
    expect(resolveBodyTarget(null, { onChat: false }, 'mouse', look, 'cursor')).toBeNull()
  })
})
