import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { ensureAmmo } from '../../../utils/ammo'
import { bodyFixture } from './fixture'

it('solves planted ankles with the real MMDIKSolver through the browser frame pipeline', () => {
  const { pipeline, bone, mmd } = bodyFixture()
  // Bone morphs run after the body stages. This unanticipated hip delta must
  // be corrected by the real CCD solver, not merely by the adapter's seed.
  pipeline.poseStages.push({ id: 'bone-morph', run: () => {
    bone('左足').quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.02))
  } })
  let displacement = 0
  for (let frame = 0; frame < 600; frame++) {
    pipeline.step(1 / 30)
    displacement = Math.max(displacement, Math.abs(bone('グルーブ').position.x))
    expect(bone('左足首').getWorldPosition(new Vector3()).distanceTo(new Vector3(1, 1, 0))).toBeLessThan(0.01)
    expect(bone('右足首').getWorldPosition(new Vector3()).distanceTo(new Vector3(-1, 1, 0))).toBeLessThan(0.01)
    expect(mmd.ikSolver.isEnabled(16)).toBe(true)
  }
  expect(displacement).toBeGreaterThan(0.3)
})

it('walks eight units on planted feet while the hair physics feels the travel', async () => {
  const createPhysics = await ensureAmmo()
  const run = (walk: boolean) => {
    const { pipeline, body, mmd, bone, setInput } = bodyFixture(0, Math.PI, { hair: true })
    mmd.setPhysics(createPhysics)
    pipeline.options.physics = true
    setInput({ rootMotion: true })
    // The tip of the hair bone, relative to the head in model axes: root travel alone never moves it.
    const tip = () => mmd.mesh.worldToLocal(bone('髪').localToWorld(new Vector3(0, -1, 0)))
      .sub(mmd.mesh.worldToLocal(bone('頭').getWorldPosition(new Vector3())))
    for (let frame = 0; frame < 120; frame++)
      pipeline.step(1 / 60)
    const rest = tip()
    if (walk)
      body.setLocomotionGoal({ goalX: 8, pace: 'walk', arriveFacing: 0, reason: 'debug' })
    let swing = 0
    let maxError = 0
    for (let frame = 0; frame < 600; frame++) {
      pipeline.step(1 / 60)
      swing = Math.max(swing, tip().distanceTo(rest))
      maxError = Math.max(maxError, body.diagnostics.feet.maxError)
    }
    mmd.dispose()
    return { swing, maxError, locomotion: body.diagnostics.locomotion }
  }
  const still = run(false)
  const walked = run(true)
  expect(walked.locomotion?.mode).toBe('idle')
  expect(Math.abs((walked.locomotion?.position.x ?? 0) - 8)).toBeLessThan(1e-2)
  expect(walked.maxError).toBeLessThan(0.05)
  expect(walked.swing).toBeGreaterThan(0.05)
  expect(walked.swing).toBeGreaterThan(3 * still.swing)
})
