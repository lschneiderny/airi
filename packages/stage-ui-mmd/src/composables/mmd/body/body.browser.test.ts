import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

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
