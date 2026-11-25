import process from 'node:process'

import { Bone, Skeleton, SkinnedMesh } from 'three'
import { expect, it } from 'vitest'

import { runMotion3dScenario } from '../runner/run'
import { motion3dScenarios } from '../scenarios'
import { skinVertices } from './geometry'
import { analyseClearanceModel, ClearancePoseReader, MMDClearanceRecorder } from './mmd'

it('skins a rotated bone about its translated bind pivot without writing to the mesh', () => {
  const mesh = new SkinnedMesh()
  const bone = new Bone()
  bone.position.x = 2
  mesh.add(bone)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton([bone]))
  const bindWorld = bone.matrixWorld.toArray()
  bone.rotation.z = Math.PI / 2

  const pose = new ClearancePoseReader(mesh).read()
  const out = new Float64Array(3)
  skinVertices(Float64Array.of(3, 0, 0), Uint16Array.of(0, 0, 0, 0), Float32Array.of(1, 0, 0, 0), pose.skin, out)

  expect(out[0]).toBeCloseTo(2, 12)
  expect(out[1]).toBeCloseTo(1, 12)
  expect(bone.matrixWorld.toArray()).toEqual(bindWorld)
})

it.runIf(process.env.AIRI_QA_MMD_MODEL)('measures a run without changing its trace', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  const scenario = motion3dScenarios.find(entry => entry.id === 'walk')
  if (!model || !scenario)
    throw new Error('AIRI_QA_MMD_MODEL and the walk scenario are required')
  const options = { model, scenario, seed: 1, seconds: 3, warmupSeconds: 1, acts: 'on', git: { gitSha: 'test', dirty: false }, signal: new AbortController().signal } as const
  const plain = await runMotion3dScenario(options)
  const recorder = new MMDClearanceRecorder(await analyseClearanceModel(model), 60)
  const measured = await runMotion3dScenario({ ...options, onFrame: recorder.onFrame })
  expect(JSON.stringify(measured.trace)).toBe(JSON.stringify(plain.trace))
  const clearance = recorder.finish()
  expect(clearance.sampledFrames).toBe(90)
  expect(clearance.triangles.tested).toBeGreaterThan(0)
}, 120_000)
