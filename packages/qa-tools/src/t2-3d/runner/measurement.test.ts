import { expect, it } from 'vitest'

import { readStageEvidence } from '../../stage/gates'
import { Motion3dMeasurement } from './measurement'

it('keeps scored percentiles and exposes exactly one walk timeline and one arm run', () => {
  const measurement = new Motion3dMeasurement()
  measurement.recordStage('natural', 1000)
  measurement.scored = true
  for (const ms of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    measurement.recordStage('natural', ms)
  measurement.recordStage('physics.update', 500)
  measurement.sample({
    feet: { maxError: 0, errorL: 0, errorR: 0, contact: 0 },
    lookAt: { target: null, yaw: 0, pitch: 0, turning: false, turns: 0 },
    arms: null,
    performance: null,
    locomotion: null,
  }, { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 1, leftFingers: 0, rightFingers: 0.5, upperBody: 0, head: 0 }, null)
  const summary = measurement.finish({
    model: 'stub-model',
    scenario: { id: 'walk', class: 'walk', seed: 1, seconds: 1 / 60, warmupSeconds: 0 },
    provenance: {},
    poseStages: ['natural'],
    wallMs: 10,
    simulatedSeconds: 1 / 60,
    collisions: { count: 2, last: { side: 'left', depth: 0.1, tick: 7 } },
    corrector: { capHits: 3, guardScans: 1, holds: 2 },
    clipBones: null,
  })
  expect(summary.timing.stages.natural).toEqual({ meanMs: 5.5, p50Ms: 5, p95Ms: 10, p99Ms: 10, maxMs: 10 })
  expect(summary.timing.poseStageP95Ms).toBe(10)
  expect(summary.collisions).toEqual({ count: 2, last: { side: 'left', depth: 0.1, tick: 7 } })
  expect(summary.corrector).toEqual({ capHits: 3, guardScans: 1, holds: 2 })
  expect(summary.owned.perFrame).toEqual([[0, 0, 0, 0, 0, 1, 0, 0.5, 0, 0]])
  expect(summary.ownership.deviationRad).toEqual([[0, 0, 0, 0, 0, 0, 0]])
  expect(summary.clip).toBeNull()
  expect(summary.timing.airiStageP95Ms).toBe(10)
  const inputs = readStageEvidence('stub-summary.json', summary)
  expect(inputs.map(input => input.kind)).toEqual(['walk', 'arms'])
  expect(inputs[0]).toMatchObject({ frames: [{ mode: 'idle', skate: 0, feetMaxError: 0 }] })
  expect(inputs[1]).toMatchObject({ model: 'stub-model', penetration: { left: 0, right: 0 } })
})

it('appends the contact-point skate to the per-frame series after the ankle skate and foot error', () => {
  const measurement = new Motion3dMeasurement()
  measurement.scored = true
  measurement.sample({
    feet: { maxError: 0.002, errorL: 0, errorR: 0, contact: 1 },
    lookAt: { target: null, yaw: 0, pitch: 0, turning: false, turns: 0 },
    arms: null,
    performance: null,
    locomotion: { mode: 'walking', position: { x: 0, z: 0 }, yaw: 0, goalX: 1, reason: 'debug', pace: 'walk', speed: 1, phase: 0, weight: 1, skate: 0.3, leashClamps: 0, enabled: true, skateContact: 0.001, skateContactPeak: 0.001 },
  }, { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 }, null)
  const { perFrameSeries } = measurement.finish({ model: 'stub-model', scenario: { id: 'walk', class: 'walk', seed: 1, seconds: 1 / 60, warmupSeconds: 0 }, provenance: {}, poseStages: [], wallMs: 1, simulatedSeconds: 1 / 60, collisions: { count: 0, last: null }, corrector: { capHits: 0, guardScans: 0, holds: 0 }, clipBones: null })
  expect(perFrameSeries).toEqual({ columns: ['t_ms', 'mode', 'skate', 'feetMaxError', 'skateContact'], rows: [[0, 'walking', 0.3, 0.002, 0.001]] })
})
