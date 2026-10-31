import type { Foot, LegGeometry } from '@proj-airi/motion-driver-humanoid/foot-contact'
import type { GaitEvent, LocomotionFrame, LocomotionInput } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { BodyLocomotionIntent, RigTraits } from '@proj-airi/motion-driver-humanoid/types'
import type { NaturalBodyComposition } from '@proj-airi/motion-driver-humanoid/weight-shift'

import { createLocomotion } from '@proj-airi/motion-driver-humanoid/locomotion'

/** The gait integrates on the 120 Hz grid its tests cover, whatever the display rate. */
const TICK = 1 / 120

/** Where the body walks. Todo 12's director supplies it; until then the `requestGoal` diagnostics command does. */
export type MMDLocomotionGoal = Pick<BodyLocomotionIntent, 'goalX' | 'pace' | 'arriveFacing' | 'reason'>

/**
 * Moves the model root on the ground line. Per-frame root motion never requests a physics reset, so hair and skirts
 * feel the travel; only user transform edits and teleports reset physics.
 */
export interface MMDBodyRoot {
  setPose: (x: number, yaw: number) => void
}

export function blendBodyComposition(from: NaturalBodyComposition, to: NaturalBodyComposition, weight: number): NaturalBodyComposition {
  const blended = { ...from }
  for (const key of Object.keys(from) as (keyof NaturalBodyComposition)[])
    blended[key] = from[key] + (to[key] - from[key]) * weight
  return blended
}

/** Runs one character's gait on a fixed tick, so a walk is the same at 30, 60 or 120 frames per second. */
export class MMDLocomotion {
  private readonly gait
  private remainder = 0
  private now = 0
  private current: LocomotionFrame

  constructor(legs: Record<Foot, LegGeometry>, traits: Pick<RigTraits, 'legLength' | 'footBaselineY'>, seed: number) {
    const anchor = (leg: LegGeometry) => ({ position: { x: leg.ankle.x, y: traits.footBaselineY, z: leg.ankle.z }, yaw: 0 })
    this.gait = createLocomotion({
      traits: {
        legLength: traits.legLength,
        footBaselineY: traits.footBaselineY,
        hipToAnkleY: (legs.left.hip.y - legs.left.ankle.y + legs.right.hip.y - legs.right.ankle.y) / 2,
        bindAnkles: { left: { ...legs.left.ankle }, right: { ...legs.right.ankle } },
      },
      seed,
    })
    this.current = this.gait.step({
      now: 0,
      goalX: null,
      pace: 'walk',
      arriveFacing: 0,
      enabled: false,
      idleSupport: 0,
      plantedFeet: { left: anchor(legs.left), right: anchor(legs.right) },
    }, 0)
  }

  /** Ticks on which the reach leash shortened root travel. Zero in normal driving. */
  get leashClamps() {
    return this.gait.leashClamps
  }

  get frame(): LocomotionFrame {
    return this.current
  }

  step(dt: number, input: Omit<LocomotionInput, 'now'>): LocomotionFrame {
    this.remainder += dt
    const events: GaitEvent[] = []
    // The tolerance keeps a 1/60 s frame at exactly two ticks despite rounding.
    while (this.remainder >= TICK - 1e-9) {
      this.remainder -= TICK
      this.now += TICK
      this.current = this.gait.step({ ...input, now: this.now }, TICK)
      events.push(...this.current.events)
    }
    this.current = { ...this.current, events }
    return this.current
  }

  /** Puts the root at `x` with both feet re-planted beside it; the frame is refreshed at once, so the next one cannot undo it. */
  rebase(x: number, yaw: number): void {
    this.gait.rebase({ x, yaw })
    const feet = this.current.feet
    this.current = this.gait.step({
      now: this.now,
      goalX: null,
      pace: 'walk',
      arriveFacing: yaw,
      enabled: true,
      idleSupport: 0,
      plantedFeet: { left: feet.left.target, right: feet.right.target },
    }, 0)
  }
}
