import type { BodyFootStep } from '@proj-airi/motion-driver-humanoid/performance'
import type { Bone } from 'three'

import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { MMDFootContact } from './feet'
import { bodyFixture } from './fixture'
import { MMDBodyPose } from './pose'

/** The fixture's feet planted by the foot stage alone, so both carry weight and the next measure compares two frames. */
function plantedFeet(toes = true) {
  const fixture = bodyFixture(0, Math.PI, { toes })
  const feet = new MMDFootContact(new MMDBodyPose(fixture.mmd, fixture.rig))
  fixture.pipeline.poseStages.length = 0
  fixture.pipeline.surfaceStages.length = 0
  fixture.pipeline.poseStages.push({ id: 'foot-contact', run: context => feet.apply(context, {
    offset: new Vector3(),
    duck: 1,
    contactDuck: 1,
    disabled: false,
    turnSteps: [],
    footSteps: [],
    now: 0,
    clips: new Map(),
    root: { x: 0, yaw: 0 },
    gait: null,
  }) })
  for (let frame = 0; frame < 60; frame++)
    fixture.pipeline.step(1 / 60)
  feet.measure()
  const ankle = fixture.bone('左足首')
  // The rig's points: the ball is the つま先 bone, the heel lies under the ankle at the toe bone's height.
  const heel = () => new Vector3(0, -1, 0).applyMatrix4(ankle.matrixWorld)
  const ball = () => new Vector3(0, -1, 1.5).applyMatrix4(ankle.matrixWorld)
  return { feet, ankle, heel, ball }
}

/** Turns the ankle bone by `angle` about a world axis through `pivot` (world), as a rolling or spinning foot does. */
function turnAbout(ankle: Bone, pivot: Vector3, angle: number, axis = new Vector3(1, 0, 0), slide = new Vector3()) {
  const turn = new Quaternion().setFromAxisAngle(axis, angle)
  const parent = ankle.parent!
  const world = ankle.getWorldPosition(new Vector3()).sub(pivot).applyQuaternion(turn).add(pivot).add(slide)
  const rotation = turn.multiply(ankle.getWorldQuaternion(new Quaternion()))
  ankle.position.copy(parent.worldToLocal(world))
  ankle.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation))
  ankle.updateWorldMatrix(true, true)
}

it('lifts a re-planted foot by its lift and lands it at its yaw from the standing angle, while the other foot stays put', () => {
  const fixture = bodyFixture(0, Math.PI, { toes: true })
  const feet = new MMDFootContact(new MMDBodyPose(fixture.mmd, fixture.rig))
  fixture.pipeline.poseStages.length = 0
  fixture.pipeline.surfaceStages.length = 0
  const dt = 1 / 60
  let now = 0
  let footSteps: BodyFootStep[] = []
  fixture.pipeline.poseStages.push({ id: 'foot-contact', run: context => feet.apply(context, { offset: new Vector3(), duck: 1, contactDuck: 1, disabled: false, turnSteps: [], footSteps, now, clips: new Map(), root: { x: 0, yaw: 0 }, gait: null }) })
  const frames = (count: number) => {
    for (let frame = 0; frame < count; frame++) {
      fixture.pipeline.step(dt)
      footSteps = []
      now += dt
    }
  }
  frames(60)
  const before = feet.anchors()
  const yaw = 6 * Math.PI / 180
  footSteps = [{ foot: 'left', startTime: now, duration: 0.4, yaw, lift: 0.2 }]
  frames(12)
  // Halfway through the 0.4 s step the foot is at the top of its arc.
  expect(feet.anchors().left.position.y - before.left.position.y).toBeCloseTo(0.2, 2)
  frames(30)
  const after = feet.anchors()
  expect(after.left.yaw).toBeCloseTo(yaw, 9)
  expect(after.left.position.y).toBeCloseTo(before.left.position.y, 9)
  // It turns about the root, as a turn step does: the ankle moves 2 d sin(yaw / 2).
  const d = Math.hypot(before.left.position.x, before.left.position.z)
  expect(Math.hypot(after.left.position.x - before.left.position.x, after.left.position.z - before.left.position.z)).toBeCloseTo(2 * d * Math.sin(yaw / 2), 6)
  expect(after.right).toEqual(before.right)
})

it('turns a standing foot toe-down about its ball for the performer\'s foot pitch, and leaves the other foot flat', () => {
  const fixture = bodyFixture(0, Math.PI, { toes: true })
  // Roll geometry needs a toe IK bone on each foot, which the fixture does not name.
  const feet = new MMDFootContact(new MMDBodyPose(fixture.mmd, { ...fixture.rig, toeIk: { left: '左つま先ＩＫ', right: '右つま先ＩＫ' } }))
  fixture.pipeline.poseStages.length = 0
  fixture.pipeline.surfaceStages.length = 0
  let footPitch = { left: 0, right: 0 }
  fixture.pipeline.poseStages.push({ id: 'foot-contact', run: context => feet.apply(context, { offset: new Vector3(), duck: 1, contactDuck: 1, disabled: false, turnSteps: [], footSteps: [], now: 0, clips: new Map(), root: { x: 0, yaw: 0 }, gait: null, footPitch }) })
  const frames = (count: number) => {
    for (let frame = 0; frame < count; frame++)
      fixture.pipeline.step(1 / 60)
  }
  frames(60)
  const ik = (side: '左' | '右') => {
    const bone = fixture.bone(`${side}足ＩＫ`)
    return { position: bone.getWorldPosition(new Vector3()), quaternion: bone.getWorldQuaternion(new Quaternion()) }
  }
  const flat = { left: ik('左'), right: ik('右') }
  const pitch = -14 * Math.PI / 180
  footPitch = { left: pitch, right: 0 }
  frames(2)
  const raised = { left: ik('左'), right: ik('右') }
  // The fixture's ball lies 1.5 ahead of the ankle and 1 below it: the ankle turns about it, up and a little forward.
  const geometry = { forward: -1.5, up: 1 }
  const offset = [geometry.forward * Math.cos(pitch) - geometry.up * Math.sin(pitch) - geometry.forward, geometry.forward * Math.sin(pitch) + geometry.up * Math.cos(pitch) - geometry.up]
  expect(raised.left.position.x - flat.left.position.x).toBeCloseTo(0, 6)
  expect(raised.left.position.y - flat.left.position.y).toBeCloseTo(offset[1], 6)
  expect(raised.left.position.z - flat.left.position.z).toBeCloseTo(offset[0], 6)
  expect(raised.left.quaternion.angleTo(flat.left.quaternion)).toBeCloseTo(-pitch, 6)
  expect(raised.right.position.distanceTo(flat.right.position)).toBeLessThan(1e-9)
  expect(feet.standingPivots).toEqual({ left: 'ball', right: 'flat' })
  footPitch = { left: 0, right: 0 }
  frames(2)
  expect(ik('左').position.distanceTo(flat.left.position)).toBeLessThan(1e-9)
})

it('reads a heel-to-toe roll about the rig\'s heel, then its ball, as a still contact point under a moving ankle', () => {
  const { feet, ankle, heel, ball } = plantedFeet()
  turnAbout(ankle, heel(), 0.3)
  const strike = feet.measure({ left: 'heel' })
  expect(strike.skate).toBeGreaterThan(0.1)
  expect(strike.skateContact).toBeLessThan(1e-6)
  turnAbout(ankle, ball(), -0.4)
  const off = feet.measure({ left: 'ball' })
  expect(off.skate).toBeGreaterThan(0.1)
  expect(off.skateContact).toBeLessThan(1e-6)
})

it('reads the slide of a contact point that slides while the foot rolls about it', () => {
  const { feet, ankle, heel } = plantedFeet()
  turnAbout(ankle, heel(), 0.3, undefined, new Vector3(0.08, 0, 0))
  expect(feet.measure({ left: 'heel' }).skateContact).toBeCloseTo(0.08, 9)
})

it('reads a flat foot\'s contact point as its ankle, bit for bit', () => {
  const { feet, ankle } = plantedFeet()
  turnAbout(ankle, ankle.getWorldPosition(new Vector3()).add(new Vector3(0, 0, -1)), 0.3)
  const flat = feet.measure({ left: 'flat' })
  expect(flat.skate).toBeGreaterThan(0.01)
  expect(flat.skateContact).toBe(flat.skate)
})

it('reads a turn about a point that is not one of the rig\'s contact points under every kind', () => {
  for (const kind of ['heel', 'ball'] as const) {
    const { feet, ankle } = plantedFeet()
    turnAbout(ankle, new Vector3(0, -1, 0.75).applyMatrix4(ankle.matrixWorld), 0.3)
    expect(feet.measure({ left: kind }).skateContact).toBeGreaterThan(0.01)
  }
})

it('reads a spin about the ball as still under the ball kind while the heel sweeps (stated limit)', () => {
  const { feet, ankle, heel, ball } = plantedFeet()
  const before = heel()
  turnAbout(ankle, ball(), 0.03, new Vector3(0, 1, 0))
  const after = heel()
  expect(feet.measure({ left: 'ball' }).skateContact).toBeLessThan(1e-6)
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.04)
})

it('reads the ankle for every kind on a foot without a toe bone', () => {
  const { feet, ankle, heel } = plantedFeet(false)
  turnAbout(ankle, heel(), 0.3)
  const measured = feet.measure({ left: 'heel' })
  expect(measured.skateContact).toBe(measured.skate)
})
