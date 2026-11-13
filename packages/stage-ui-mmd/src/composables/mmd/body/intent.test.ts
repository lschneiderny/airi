import type { BodyGazeGoal } from '@proj-airi/motion-driver-humanoid/performance'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { describe, expect, it } from 'vitest'

import { bodyIdleAct, MMDBodyIntent } from './intent'

const owned = { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 }

function mapper() {
  const natural = new NaturalMotion({ seed: 1 })
  const frame = natural.advance(0)
  const intent = new MMDBodyIntent()
  const capture = (gaze: BodyGazeGoal) => intent.capture({ intent: natural.bodyIntent(), frame, dt: 1 / 60, gaze, viewerYaw: 0, energy: 0.5, stance: 'stand', rest: 'none', dragging: false, owned, armLift: { left: 0, right: 0 }, eyeLimits: { yaw: 0.35, pitch: 0.25 } })
  const tick = (alpha: number) => intent.tick({ alpha, facingYaw: 0, allowTurn: false, rootVelocity: { x: 0, y: 0, z: 0 }, gait: null }).gaze
  return { capture, tick }
}

describe('mmd body intent mapping', () => {
  it('hands a jumping gaze target to the first tick of the frame whole, and blends continuous pursuit across ticks', () => {
    const { capture, tick } = mapper()
    capture({ yaw: 0, pitch: 0, kind: 'sustained' })
    tick(1)
    capture({ yaw: 0.6, pitch: -0.2, kind: 'sustained' })
    expect(tick(0.5)).toMatchObject({ yaw: 0.6, pitch: -0.2 })
    tick(1)
    capture({ yaw: 0.62, pitch: -0.2, kind: 'sustained' })
    expect(tick(0.5).yaw).toBeCloseTo(0.61, 12)
  })

  it('gives the performer an idle behaviour in its own seconds, with a release only when it was let go early', () => {
    const base = { seq: 3, kind: 'yawn', start: 100, end: 105.5, releasedAt: null, releaseSeconds: 0, side: -1, period: 2, tone: 0, count: 1, variant: 0, keys: [], glances: [] } as const
    expect(bodyIdleAct(base)).toMatchObject({ seq: 3, kind: 'yawn', duration: 5.5, release: null, side: -1 })
    expect(bodyIdleAct({ ...base, releasedAt: 102, releaseSeconds: 0.4 }).release).toBe(0.4)
    expect(bodyIdleAct({ ...base, releasedAt: 105.5, releaseSeconds: 0 }).release).toBeNull()
    expect(bodyIdleAct({ ...base, kind: 'sleep', end: Number.POSITIVE_INFINITY, releasedAt: 900, releaseSeconds: 1.6 }).release).toBe(1.6)
  })
})
