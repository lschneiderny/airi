import type { PmxObject } from '@moeru/three-mmd'
import type { BodyModel } from '@proj-airi/motion-driver-humanoid/body-model'

import type { MMDBodyModelMesh, MMDBodyModelSource } from './body-model'

import { readMMDRigProfile } from '../rig'
import { mmdArmBodies, mmdBodiesCollide, readMMDBodyModel } from './body-model'

/** PMX physics mode 0: the body follows its bone. Modes 1 and 2 are simulated. */
const PHYSICS_FOLLOW_BONE = 0
/** PMX collision groups are 0 to 15. */
const COLLISION_GROUPS = 16
/** The rigid body fields the arm collision setup reads and writes. `mmd.pmx.rigidBodies` satisfies it. */
export type MMDCollisionBody = Pick<PmxObject.RigidBody, 'boneIndex' | 'physicsMode'> & {
  collisionGroup: number
  collisionMask: number
}

export interface MMDArmCollisionReport {
  /**
   * `applied`: the arms have their own collision group and the soft garments collide with it. Every other status leaves
   * the rig as its author built it: it has no bone-following body on an arm, no garment the simulator can move out of
   * an arm's way, no unused collision group, or no body model.
   */
  readonly status: 'applied' | 'no-arm-bodies' | 'no-soft-garments' | 'no-free-group' | 'no-body-model'
  /** The collision groups the arm bodies moved to, one for each group their author put them in; empty unless applied. */
  readonly groups: readonly number[]
  readonly armBodies: number
  /** The soft garment bodies the setup made collide with every arm body. */
  readonly garmentBodies: number
  /** Soft garment bodies left as authored, because the rig had no unused collision group left for them. */
  readonly skippedBodies: number
}

/**
 * The secondary-motion boundary of the body model for MMD and Ammo: the garments an author built to collide with an
 * arm yield to the whole arm.
 *
 * An author often lets part of a skirt collide with one arm body and masks the rest out, so a forearm passes through
 * cloth the upper arm pushes (Aha's gown, pierced in every frame until the forearm and hand collide too; Carlotta's
 * dress, where 14 of 204 bodies meet an arm). For each soft garment of which some body already collides with some arm
 * body, the setup changes groups and masks until every arm body and every body of the garment collide, and no other
 * pair changes. Ammo collides a pair only when each body's mask holds the other's group:
 *
 * - The arm's bone-following bodies move to unused groups, one for each group their author put them in, so two arm
 *   bodies the author told apart stay apart. A body gains a new group when it collided with the old one or belongs to
 *   such a garment, and loses it otherwise (a mask keeps the bits of groups no body used).
 * - An arm body's mask must hold the garment's group. Where the group also holds another body that collides with the
 *   arms' group and some arm body's mask left the group out (an arm that does not collide with its own sleeve), the
 *   garment bodies of that group move to a further unused group, which every mask that held the old group then holds.
 *
 * Everything else stays as authored: garments the resting arm sits inside (`BodyGarment.pinched`), because an arm
 * cannot push cloth it rests inside out of its own way and the pinched bodies jitter (Aria: 20 to 30 % of the cloth
 * vertices reverse a sample); garments the author kept apart from every arm body, which are built to pass the arm
 * (Vivian's skirt drapes under her simulated sleeves and is pierced in every frame once the arm bodies press it);
 * flesh, hair, sleeves; and garment bodies with an empty mask.
 *
 * It writes `collisionGroup` and `collisionMask` only, and must run before `mmd.setPhysics` builds the bodies.
 */
export function separateMMDArmCollisions(bodies: readonly MMDCollisionBody[], bones: MMDBodyModelSource['bones'], arms: readonly number[], model: BodyModel): MMDArmCollisionReport {
  const armBodies = mmdArmBodies(bodies, bones, arms)
  const meetsArm = (body: MMDCollisionBody) => armBodies.some(arm => mmdBodiesCollide(body, arm))
  const garmentBodies = new Set<MMDCollisionBody>()
  for (const garment of model.garments) {
    if (garment.pinched)
      continue
    const carried = new Set(garment.bones)
    // A simulated body whose mask is empty collides with nothing by its author's choice: it is a weight or an anchor
    // of the cloth, often larger than the cloth, and not its surface.
    const surface = bodies.filter(body => body.physicsMode !== PHYSICS_FOLLOW_BONE && body.collisionMask !== 0 && carried.has(body.boneIndex))
    if (surface.some(meetsArm))
      surface.forEach(body => garmentBodies.add(body))
  }
  // A setup that changed nothing made no garment body collide and left every one of them as authored.
  const unchanged = (status: MMDArmCollisionReport['status']): MMDArmCollisionReport => ({ status, groups: [], armBodies: armBodies.length, garmentBodies: 0, skippedBodies: garmentBodies.size })
  if (!armBodies.length)
    return unchanged('no-arm-bodies')
  if (!garmentBodies.size)
    return unchanged('no-soft-garments')
  const used = new Set(bodies.map(body => body.collisionGroup))
  const free = Array.from({ length: COLLISION_GROUPS }, (_, index) => index).filter(index => !used.has(index))
  const armGroups = [...new Set(armBodies.map(body => body.collisionGroup))].sort((a, b) => a - b)
  if (free.length < armGroups.length)
    return unchanged('no-free-group')
  const armSet = new Set(armBodies)
  let oldGroups = 0
  for (const group of armGroups)
    oldGroups |= 1 << group
  const setBit = (body: MMDCollisionBody, bit: number, on: boolean) => {
    body.collisionMask = on ? body.collisionMask | (1 << bit) : body.collisionMask & ~(1 << bit)
  }
  const collidedWithArms = new Set(bodies.filter(body => !armSet.has(body) && (body.collisionMask & oldGroups) !== 0))
  // Each old group gets its own new one: a body, an arm body included, holds the new group exactly when it held the
  // old one, so every pair that involves an arm body stays as authored, and the chosen garments gain them all.
  const moved = new Map(armGroups.map(group => [group, free.shift() ?? group]))
  for (const [from, to] of moved) {
    for (const body of bodies)
      setBit(body, to, garmentBodies.has(body) || (body.collisionMask & (1 << from)) !== 0)
  }
  for (const body of armBodies)
    body.collisionGroup = moved.get(body.collisionGroup) ?? body.collisionGroup
  let skipped = 0
  for (const garmentGroup of [...new Set([...garmentBodies].map(body => body.collisionGroup))].sort((a, b) => a - b)) {
    if (armBodies.every(body => (body.collisionMask & (1 << garmentGroup)) !== 0))
      continue
    const members = bodies.filter(body => body.collisionGroup === garmentGroup && !armSet.has(body))
    if (members.every(body => garmentBodies.has(body) || !collidedWithArms.has(body))) {
      for (const body of armBodies)
        setBit(body, garmentGroup, true)
      continue
    }
    const own = free.shift()
    const garmentMembers = members.filter(body => garmentBodies.has(body))
    if (own === undefined) {
      // No group left: these bodies hold an arm group only where they held its old one, as authored.
      for (const body of garmentMembers) {
        for (const [from, to] of moved)
          setBit(body, to, (body.collisionMask & (1 << from)) !== 0)
      }
      skipped += garmentMembers.length
      continue
    }
    for (const body of bodies)
      setBit(body, own, armSet.has(body) || (body.collisionMask & (1 << garmentGroup)) !== 0)
    for (const body of garmentMembers)
      body.collisionGroup = own
  }
  return { status: 'applied', groups: [...moved.values()], armBodies: armBodies.length, garmentBodies: garmentBodies.size - skipped, skippedBodies: skipped }
}

const reports = new WeakMap<object, MMDArmCollisionReport>()

/**
 * Prepares a loaded model's rigid bodies for the simulator: call it once, before `mmd.setPhysics`, wherever a model gets
 * its physics (the scene's animation manager and the headless loader), so both simulate the same cloth. A second call
 * for the same model changes nothing and returns the first report.
 */
export function prepareMMDSecondaryMotion(mmd: { readonly pmx: MMDBodyModelSource & { readonly rigidBodies: readonly MMDCollisionBody[] } & Parameters<typeof readMMDRigProfile>[0], readonly mesh: MMDBodyModelMesh }): MMDArmCollisionReport {
  const known = reports.get(mmd)
  if (known)
    return known
  const built = readMMDBodyModel(mmd, readMMDRigProfile(mmd.pmx))
  const arms = built ? [built.source.canonical.arms.left.upper, built.source.canonical.arms.right.upper] : []
  const report: MMDArmCollisionReport = built
    ? separateMMDArmCollisions(mmd.pmx.rigidBodies, mmd.pmx.bones, arms, built.model)
    : { status: 'no-body-model', groups: [], armBodies: 0, garmentBodies: 0, skippedBodies: 0 }
  reports.set(mmd, report)
  return report
}

/** The report of `prepareMMDSecondaryMotion` for a model, or null when it never ran (a model without physics). */
export function readMMDArmCollisionReport(mmd: object): MMDArmCollisionReport | null {
  return reports.get(mmd) ?? null
}
