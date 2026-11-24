import type { Foot, LegGeometry } from '@proj-airi/motion-driver-humanoid/foot-contact'
import type { FootGeometry, LocomotionFrame, LocomotionInput } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { BodyLocomotionIntent, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { createLocomotion } from '@proj-airi/motion-driver-humanoid/locomotion'
import { BODY_TICK, channelIndex, DEFAULT_ARM_REST_POSE } from '@proj-airi/motion-driver-humanoid/performance'
import { WALK_URGENCY } from '@proj-airi/motion-driver-humanoid/types'

/** The director's goal, including the optional corrective sidestep. */
export type MMDLocomotionGoal = Pick<BodyLocomotionIntent, 'goalX' | 'urgency' | 'arriveFacing' | 'reason' | 'step'>

/**
 * Moves the model root on the ground line. Per-frame root motion never requests a physics reset, so hair and skirts
 * feel the travel; only user transform edits and teleports reset physics.
 */
export interface MMDBodyRoot {
  setPose: (x: number, yaw: number) => void
}

const swingChannels = {
  left: { flex: channelIndex('leftFlex'), elbow: channelIndex('leftElbow'), abduct: channelIndex('leftAbduct'), clavProt: channelIndex('leftClavProt'), wflex: channelIndex('leftWflex'), thumb: channelIndex('leftThumb0'), opposition: channelIndex('leftOpposition') },
  right: { flex: channelIndex('rightFlex'), elbow: channelIndex('rightElbow'), abduct: channelIndex('rightAbduct'), clavProt: channelIndex('rightClavProt'), wflex: channelIndex('rightWflex'), thumb: channelIndex('rightThumb0'), opposition: channelIndex('rightOpposition') },
} as const

/**
 * Writes one gait frame into the performer's `BODY_CHANNELS` table: pelvis in leg lengths, angles in radians, zero for
 * every channel the gait does not drive. The gait models a positive `pelvisLateral` as a shift toward the character's
 * right (-X, `anchorDrop` in the locomotion module), while the channel's +X is the character's left, so the sign flips.
 * The legacy weight-shift stage applied it toward +X, against the gait's own reach model. The walk's hand curl, a share of
 * the rest curl, becomes each finger joint's offset from the performer's nominal rest curl.
 */
export function writeGaitChannels(frame: LocomotionFrame, legLength: number, out: Float64Array): void {
  out.fill(0)
  const { body, armSwing } = frame
  out[0] = -body.pelvisLateral / legLength
  out[1] = -body.pelvisDrop / legLength
  out[2] = body.pelvisForeAft / legLength
  out[3] = body.lowerBodyYaw
  out[5] = body.lowerBodyRoll
  out[7] = body.spinePitch
  out[8] = body.upperBodyRoll
  // The twist runs up the torso chain's three controls; the upper one reaches the top bone on every chain length.
  out[6] = body.twist.lower
  out[9] = body.twist.mid
  out[12] = body.twist.upper
  // The head counter is split between neck and head as the performer splits its own stabilising counter (steadyHead).
  out[15] = 0.35 * body.twist.head
  out[18] = 0.65 * body.twist.head
  out[13] = body.chestPitch
  out[16] = body.neckPitch
  out[14] = body.chestCounterRoll
  for (const side of ['left', 'right'] as const) {
    out[swingChannels[side].flex] = armSwing[side].flexion
    out[swingChannels[side].elbow] = armSwing[side].elbowFlex
    out[swingChannels[side].abduct] = armSwing[side].abduct
    out[swingChannels[side].clavProt] = armSwing[side].clavProt
    out[swingChannels[side].wflex] = armSwing[side].wristFlex
    const curl = frame.handCurl - 1
    const { fingerCurl, opposition } = DEFAULT_ARM_REST_POSE
    for (let finger = 0; finger < 5; finger++) {
      for (let joint = 0; joint < 3; joint++)
        out[swingChannels[side].thumb + finger * 3 + joint] = curl * fingerCurl[finger][joint]
    }
    out[swingChannels[side].opposition] = curl * opposition
  }
}

/** Runs one character's gait one fixed tick at a time; `MMDBodyClock` decides how many ticks a display frame holds. */
export class MMDLocomotion {
  private readonly gait
  private current: LocomotionFrame

  /** `foot` is the rig's roll geometry (`MMDFootContact.rollGeometry`); without it the feet stay flat. */
  constructor(legs: Record<Foot, LegGeometry>, traits: Pick<RigTraits, 'legLength' | 'footBaselineY'>, seed: number, foot: Record<Foot, FootGeometry> | null = null) {
    const anchor = (leg: LegGeometry) => ({ position: { x: leg.ankle.x, y: traits.footBaselineY, z: leg.ankle.z }, yaw: 0 })
    this.gait = createLocomotion({
      traits: {
        legLength: traits.legLength,
        footBaselineY: traits.footBaselineY,
        hipToAnkleY: (legs.left.hip.y - legs.left.ankle.y + legs.right.hip.y - legs.right.ankle.y) / 2,
        bindAnkles: { left: { ...legs.left.ankle }, right: { ...legs.right.ankle } },
        bindHips: { left: { ...legs.left.hip }, right: { ...legs.right.hip } },
        ...foot ? { foot } : {},
      },
      seed,
    })
    this.current = this.gait.step({
      now: 0,
      goalX: null,
      urgency: WALK_URGENCY,
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

  tick(input: LocomotionInput): LocomotionFrame {
    this.current = this.gait.step(input, BODY_TICK)
    return this.current
  }

  /** Puts the root at `x` with both feet re-planted beside it; the frame is refreshed at once, so the next one cannot undo it. */
  rebase(x: number, yaw: number, now: number): void {
    this.gait.rebase({ x, yaw })
    const feet = this.current.feet
    this.current = this.gait.step({
      now,
      goalX: null,
      urgency: WALK_URGENCY,
      arriveFacing: yaw,
      enabled: true,
      idleSupport: 0,
      plantedFeet: { left: feet.left.target, right: feet.right.target },
    }, 0)
  }
}
