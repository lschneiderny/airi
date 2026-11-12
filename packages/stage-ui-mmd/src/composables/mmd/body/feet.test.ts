import type { Bone } from 'three'

import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { MMDFootContact } from './feet'
import { bodyFixture } from './fixture'
import { MMDBodyPose } from './pose'

/** The fixture's feet planted by the foot stage alone, so both carry weight and the next measure compares two frames. */
function plantedFeet() {
  const fixture = bodyFixture()
  const feet = new MMDFootContact(new MMDBodyPose(fixture.mmd, fixture.rig))
  fixture.pipeline.poseStages.length = 0
  fixture.pipeline.surfaceStages.length = 0
  fixture.pipeline.poseStages.push({ id: 'foot-contact', run: context => feet.apply(context, {
    offset: new Vector3(),
    duck: 1,
    contactDuck: 1,
    disabled: false,
    turnSteps: [],
    now: 0,
    clips: new Map(),
    root: { x: 0, yaw: 0 },
    gait: null,
  }) })
  for (let frame = 0; frame < 60; frame++)
    fixture.pipeline.step(1 / 60)
  feet.measure()
  return { feet, ankle: fixture.bone('左足首') }
}

/** Turns the ankle bone by `angle` about the world X axis through `pivot` (world), as a rolling foot does. */
function rollAbout(ankle: Bone, pivot: Vector3, angle: number) {
  const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle)
  const parent = ankle.parent!
  const world = ankle.getWorldPosition(new Vector3()).sub(pivot).applyQuaternion(turn).add(pivot)
  const rotation = turn.multiply(ankle.getWorldQuaternion(new Quaternion()))
  ankle.position.copy(parent.worldToLocal(world))
  ankle.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation))
  ankle.updateWorldMatrix(true, false)
}

const heel = { kind: 'heel', point: { x: 0, y: -1, z: -1 } } as const

it('measures a foot rolling about its heel as a moving ankle but a still contact point', () => {
  const { feet, ankle } = plantedFeet()
  rollAbout(ankle, new Vector3(0, -1, -1).applyMatrix4(ankle.matrixWorld), 0.3)
  const measured = feet.measure({ left: heel })
  expect(measured.skate).toBeGreaterThan(0.1)
  expect(measured.skateContact).toBeLessThan(1e-6)
})

it('measures a foot pitched about its ankle as a still ankle but a sliding heel, and a flat pivot as the ankle', () => {
  const pitched = plantedFeet()
  const before = new Vector3(0, -1, -1).applyMatrix4(pitched.ankle.matrixWorld)
  rollAbout(pitched.ankle, pitched.ankle.getWorldPosition(new Vector3()), 0.3)
  const after = new Vector3(0, -1, -1).applyMatrix4(pitched.ankle.matrixWorld)
  const measured = pitched.feet.measure({ left: heel })
  expect(measured.skate).toBeLessThan(1e-6)
  expect(measured.skateContact).toBeCloseTo(Math.hypot(after.x - before.x, after.z - before.z), 9)
  expect(measured.skateContact).toBeGreaterThan(0.1)

  const flat = plantedFeet()
  rollAbout(flat.ankle, new Vector3(0, -1, -1).applyMatrix4(flat.ankle.matrixWorld), 0.3)
  const ankle = flat.feet.measure({ left: { kind: 'flat' } })
  expect(ankle.skateContact).toBe(ankle.skate)
})
