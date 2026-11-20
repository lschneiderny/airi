import type { Foot, FootAnchor } from '../foot-contact'
import type { GaitTraits } from '../locomotion'
import type { BodyDirectorInput, BodyDirectorMemory } from './index'

import { describe, expect, it } from 'vitest'

import { createLocomotion } from '../locomotion'
import { decideBody, initialBodyDirectorMemory, NO_WORLD_BODY_INPUT } from './index'

// The locomotion tests' fixture traits: leg 10, on a ground of 60 legs each side.
const leg = 10
const traits: GaitTraits = {
  legLength: leg,
  footBaselineY: 1,
  hipToAnkleY: 10,
  bindAnkles: { left: { x: 1, y: 1, z: 0 }, right: { x: -1, y: 1, z: 0 } },
}
const dt = 1 / 120
const durationS = 14
/** Root travel per step, in world units, below which she counts as at rest. */
const restEpsilon = 1e-4 * leg

function bindFeet(x: number): Record<Foot, FootAnchor> {
  return {
    left: { position: { x: x + 1, y: 1, z: 0 }, yaw: 0 },
    right: { position: { x: x - 1, y: 1, z: 0 }, yaw: 0 },
  }
}

interface PressScenario {
  mode: 'idle' | 'watching'
  /** Seconds after which the pointer leaves `farX` and rests where she stands then. */
  landAtS: number
  /** Where the pointer rests before it lands on her. */
  farX: number
  /** Offset of the landed pointer from her root at landing. */
  landOffset: number
  chase: boolean
  wanderAtS: number | null
}

/** Steps `decideBody` and `createLocomotion` in a closed loop and records where she is relative to the pointer. */
function simulate(scenario: PressScenario) {
  const locomotion = createLocomotion({ traits, seed: 7 })
  locomotion.rebase({ x: 0, yaw: 0 })
  let planted = bindFeet(0)
  let memory: BodyDirectorMemory = initialBodyDirectorMemory
  let rootX = 0
  let gait: BodyDirectorInput['locomotionMode'] = 'idle'
  let aim: number | null = null
  let lastMovingS = 0
  let maxTravel = 0
  for (let tick = 0; tick < durationS * 120; tick++) {
    const t = tick * dt
    if (t >= scenario.landAtS)
      aim ??= rootX + scenario.landOffset
    const cursorX = aim ?? scenario.farX
    const result = decideBody({
      ...NO_WORLD_BODY_INPUT,
      nowMs: t * 1000,
      performance: { mode: scenario.mode, attention: 'cursor', away: false },
      cursorPoint: null,
      chatPoint: null,
      cameraPoint: null,
      slots: { sit: false, sleep: false },
      ground: { minX: -60 * leg, maxX: 60 * leg },
      rootX,
      homeX: 0,
      locomotionMode: gait,
      roamMode: 'roam',
      interactionSeq: 0,
      chatSendSeq: 0,
      attendUntilMs: scenario.chase ? 60_000 : null,
      actionRequest: null,
      actionFeedback: null,
      dragging: false,
      cursorX,
      cursorOnStage: true,
      legLength: leg,
      seed: 1,
      idle: { settled: false, asleep: false },
      wander: scenario.wanderAtS !== null && t >= scenario.wanderAtS ? { seq: 1 } : null,
    }, memory)
    memory = result.memory
    const goal = result.intent.locomotion
    const frame = locomotion.step({ now: t, goalX: goal.goalX, pace: goal.pace, arriveFacing: 0, enabled: true, idleSupport: 0, plantedFeet: planted }, dt)
    planted = { left: frame.feet.left.target, right: frame.feet.right.target }
    // She is at rest once her root stops travelling; the feet may still close up under her.
    if (Math.abs(frame.root.position.x - rootX) > restEpsilon)
      lastMovingS = t
    rootX = frame.root.position.x
    gait = frame.mode
    maxTravel = Math.max(maxTravel, Math.abs(rootX))
  }
  return {
    restAfterLandingS: Math.max(0, lastMovingS - scenario.landAtS),
    offsetLegs: Math.abs(rootX - (aim ?? 0)) / leg,
    maxTravelLegs: maxTravel / leg,
  }
}

describe('body director press loop', () => {
  it.each([1, 2, 4])('stops within 1 s and 0.5 L of a pointer that lands on her %i s into a chase', (landAtS) => {
    const result = simulate({ mode: 'watching', landAtS, farX: 8 * leg, landOffset: 0, chase: true, wanderAtS: null })

    expect(result.restAfterLandingS).toBeLessThanOrEqual(1)
    expect(result.offsetLegs).toBeLessThanOrEqual(0.5)
  })

  it('does not move for a visit while the pointer rests on her', () => {
    const result = simulate({ mode: 'watching', landAtS: 0, farX: 0, landOffset: 0.2 * leg, chase: false, wanderAtS: 1 })

    expect(result.maxTravelLegs).toBeLessThanOrEqual(0.05)
  })
})
