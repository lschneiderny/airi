import type { Foot, FootAnchor } from '../foot-contact'
import type { GaitTraits } from '../locomotion'
import type { BodyDirectorInput, BodyDirectorMemory } from './index'

import { describe, expect, it } from 'vitest'

import { createLocomotion, urgencySpeedShare } from '../locomotion'
import { decideBody, GOAL_URGENCY, initialBodyDirectorMemory, NO_BODY_REFRACTORY, NO_WORLD_BODY_INPUT, STEP_ONTO_CURSOR_MIN_LEGS } from './index'

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
  let restX: number | null = null
  let gait: BodyDirectorInput['locomotionMode'] = 'idle'
  let aim: number | null = null
  let lastMovingS = 0
  let firstRestAfterLandingS: number | null = null
  let maxTravel = 0
  let travel = 0
  let correctiveGoals = 0
  let correctiveDistance = 0
  let chaseRestAtS: number | null = null
  let correctiveRestAtS: number | null = null
  let correctiveTurning = false
  let correcting = false
  for (let tick = 0; tick < durationS * 120; tick++) {
    const t = tick * dt
    if (t >= scenario.landAtS)
      aim ??= rootX + scenario.landOffset
    if (aim !== null && gait === 'idle')
      firstRestAfterLandingS ??= Math.max(0, lastMovingS - scenario.landAtS)
    const cursorX = aim ?? scenario.farX
    const result = decideBody({
      ...NO_WORLD_BODY_INPUT,
      nowMs: t * 1000,
      performance: { mode: scenario.mode },
      away: false,
      slots: { sit: false, sleep: false },
      ground: { minX: -60 * leg, maxX: 60 * leg },
      rootX,
      restX,
      homeX: 0,
      locomotionMode: gait,
      roamMode: 'roam',
      attend: { untilMs: scenario.chase ? 60_000 : null, touchSeq: 0, chatSeq: 0, chatOpenSeq: 0 },

      actionRequest: null,
      actionFeedback: null,
      refractory: NO_BODY_REFRACTORY,
      dragging: false,
      cursorX,
      cursorOnStage: true,
      legLength: leg,
      seed: 1,
      idle: { settled: false, asleep: false },
      wander: scenario.wanderAtS !== null && t >= scenario.wanderAtS ? { seq: 1, pick: 0.5, lingerSeconds: 60 } : null,
    }, memory)
    const goal = result.intent.locomotion
    if (goal.goalX !== null && goal.reason === 'approach-cursor' && goal.step === 'sidestep' && result.memory.goalSinceMs !== memory.goalSinceMs) {
      correctiveGoals++
      correctiveDistance = Math.abs(goal.goalX - rootX)
      correcting = true
    }
    memory = result.memory
    const frame = locomotion.step({ now: t, goalX: goal.goalX, urgency: goal.urgency, step: goal.step, arriveFacing: 0, enabled: true, idleSupport: 0, plantedFeet: planted }, dt)
    if (aim !== null && frame.mode === 'idle')
      chaseRestAtS ??= t
    if (correcting) {
      correctiveTurning ||= frame.mode === 'turning'
      if (frame.mode === 'idle') {
        correctiveRestAtS = t
        correcting = false
      }
    }
    planted = { left: frame.feet.left.target, right: frame.feet.right.target }
    // She is at rest once her root stops travelling; the feet may still close up under her.
    if (Math.abs(frame.root.position.x - rootX) > restEpsilon)
      lastMovingS = t
    travel += Math.abs(frame.root.position.x - rootX)
    rootX = frame.root.position.x
    restX = frame.restX
    gait = frame.mode
    maxTravel = Math.max(maxTravel, Math.abs(rootX))
  }
  return {
    restAfterLandingS: Math.max(0, lastMovingS - scenario.landAtS),
    firstRestAfterLandingS,
    offsetLegs: Math.abs(rootX - (aim ?? 0)) / leg,
    goalX: memory.goalX,
    maxTravelLegs: maxTravel / leg,
    travelLegs: travel / leg,
    correctiveDistanceLegs: correctiveDistance / leg,
    correctiveGoals,
    correctiveTurning,
    // No correction is needed when the first rest already lies on the pointer.
    correctiveRestToRestS: chaseRestAtS === null ? null : (correctiveRestAtS ?? chaseRestAtS) - chaseRestAtS,
    gait,
  }
}

/** Seconds a chase at full speed takes to brake: the gait sheds v_ref per second, so 1 s at the former walk speed. */
const chaseBrakeS = urgencySpeedShare(GOAL_URGENCY.chase)

describe('body director press loop', () => {
  it.each([1, 2, 4])('brakes within the chase\'s braking time and ends within 0.5 L of a pointer that lands on her %i s into a chase', (landAtS) => {
    const result = simulate({ mode: 'watching', landAtS, farX: 8 * leg, landOffset: 0, chase: true, wanderAtS: null })

    // D16 adds another walk after braking; the braking bound applies to that first stop. It was 1 s while a chase
    // walked; since 2026-11-23 a chase hurries at 1.131 v_ref and needs up to 1.131 s (1.125 s when it lands at 2 s).
    expect(result.firstRestAfterLandingS).not.toBeNull()
    expect(result.firstRestAfterLandingS).toBeLessThanOrEqual(chaseBrakeS)
    expect(result.offsetLegs).toBeLessThanOrEqual(0.5)
  })

  // Total travel without the correction in this deterministic fixture, rounded up to six decimals. Pinned again on
  // 2026-11-23: a walk now turns while it steps off, so she is under way sooner than when she first turned on the spot
  // (0, 0.676 and 2.535001 L before). Pinned again the same day when a chase began to hurry at urgency 0.75: it covers
  // more ground before the pointer lands and slides further while braking (0.247382, 1.400606 and 3.008447 L at walk).
  it.each([
    { landAtS: 1, originalTravelLegs: 0.222553 },
    { landAtS: 2, originalTravelLegs: 1.549428 },
    { landAtS: 4, originalTravelLegs: 3.339705 },
  ])('takes at most one corrective step onto a pointer that lands on her $landAtS s into a chase', ({ landAtS, originalTravelLegs }) => {
    const result = simulate({ mode: 'watching', landAtS, farX: 8 * leg, landOffset: 0, chase: true, wanderAtS: null })
    // One 120 Hz tick at the chase speed is 0.0085 L; allow 0.01 L for discrete stopping.
    const toleranceLegs = 0.01

    expect(result.offsetLegs, JSON.stringify({ landAtS, ...result })).toBeLessThanOrEqual(STEP_ONTO_CURSOR_MIN_LEGS + toleranceLegs)
    expect(result.gait).toBe('idle')
    expect(result.restAfterLandingS).toBeLessThanOrEqual(6)
    expect(result.goalX).toBeNull()
    expect(result.correctiveGoals).toBeLessThanOrEqual(1)
    expect(result.travelLegs).toBeLessThanOrEqual(originalTravelLegs + result.correctiveDistanceLegs + toleranceLegs)
  })

  // The pointer lands 0.65 L ahead, beyond the 0.58 L a chase at full speed slides while braking. It landed 0.5 L
  // ahead while a chase walked (0.45 L slide); a hurried chase passed a pointer that close by 0.093 L at 2 s.
  it.each([1, 2, 4])('comes to rest on a pointer that lands 0.65 L ahead of her %i s into a chase', (landAtS) => {
    const result = simulate({ mode: 'watching', landAtS, farX: 8 * leg, landOffset: 0.65 * leg, chase: true, wanderAtS: null })

    expect(result.offsetLegs).toBeLessThanOrEqual(0.02)
    expect(result.goalX).toBeNull()
  })

  it.each([1, 2, 4])('keeps facing through the correction after a pointer lands at %i s', (landAtS) => {
    const result = simulate({ mode: 'watching', landAtS, farX: 8 * leg, landOffset: 0, chase: true, wanderAtS: null })

    expect(result.offsetLegs).toBeLessThanOrEqual(STEP_ONTO_CURSOR_MIN_LEGS)
    expect(result.gait).toBe('idle')
    expect(result.correctiveTurning).toBe(false)
    expect(result.correctiveRestToRestS).not.toBeNull()
    if (result.correctiveGoals > 0)
      expect(result.correctiveRestToRestS).toBeGreaterThan(0)
    console.info('corrective sidestep', JSON.stringify({ landAtS, ...result }))
  })

  it('does not move for a visit while the pointer rests on her', () => {
    const result = simulate({ mode: 'watching', landAtS: 0, farX: 0, landOffset: 0.2 * leg, chase: false, wanderAtS: 1 })

    expect(result.maxTravelLegs).toBeLessThanOrEqual(0.05)
  })
})
