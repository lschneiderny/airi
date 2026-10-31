import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { resolveBodyTarget } from './attention'

type Points = NonNullable<Parameters<typeof resolveBodyTarget>[0]>

const points: Points = {
  cursor: new Vector3(1, 2, 3),
  chat: new Vector3(4, 5, 6),
  camera: new Vector3(7, 8, 9),
}

function frame(onChat: boolean) {
  return { onChat }
}

function intent(point: BodyIntent['attention']['point']): BodyIntent {
  return {
    stance: 'stand',
    attention: { kind: 'cursor', point },
    facingYaw: 0,
    locomotion: { homeX: 0, goalX: null, pace: 'walk', arriveFacing: 0, reason: 'stay' },
    action: null,
  }
}

describe('resolveBodyTarget', () => {
  it('follows the director intent point, as a copy', () => {
    const target = resolveBodyTarget(points, frame(false), 'mouse', intent(points.cursor))
    expect(target).toEqual(points.cursor)
    expect(target).not.toBe(points.cursor)
  })

  it('has no target before the director has produced an intent', () => {
    expect(resolveBodyTarget(points, frame(false), 'mouse', null)).toBeNull()
    expect(resolveBodyTarget(points, frame(false), 'mouse', intent(null))).toBeNull()
  })

  it('looks at the chat while Natural glances at it, whatever the intent says', () => {
    expect(resolveBodyTarget(points, frame(true), 'mouse', intent(points.cursor))).toEqual(points.chat)
  })

  it('looks at the camera in camera mode and nowhere without gaze or points', () => {
    expect(resolveBodyTarget(points, frame(false), 'camera', intent(points.cursor))).toEqual(points.camera)
    expect(resolveBodyTarget(points, frame(false), 'none', intent(points.cursor))).toBeNull()
    expect(resolveBodyTarget(null, frame(false), 'mouse', intent(points.cursor))).toBeNull()
  })
})
