import process from 'node:process'

import { expect, it } from 'vitest'

import { runMotion3dScenario } from '../runner/run'
import { motion3dScenarios } from '../scenarios'
import { analyseClearanceModel, MMDClearanceRecorder } from './mmd'

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
