import { MMDIKSolver } from '@moeru/three-mmd'
import { initAmmo, MMDAmmoPhysics } from '@moeru/three-mmd-physics-ammo'
import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { Object3D } from 'three'
import { custom, integer, literal, minLength, minValue, number, object, parse, pipe, safeParse, string, trim } from 'valibot'
import { expect, it } from 'vitest'

import budgetFile from './work-budget.json'

import { bodyFixture } from './body/fixture'
import { MMDUsageTotals } from './frame-metrics'
import { MMDFramePipeline } from './frame-pipeline'
import { composeMMDStages } from './stage-composition'

const counter = object({
  max: pipe(number(), integer(), minValue(0)),
  reason: pipe(string(), trim(), minLength(1)),
})
const counterIds = ['matrixWorld', 'worldMatrix', 'ikChains', 'physicsUpdates', 'physicsSubsteps', 'stageCalls'] as const
const budgetSchema = object({
  frames: literal(600),
  warmup: literal(60),
  seed: literal(1),
  fixture: literal('bodyFixture(hair, arms, bodies)'),
  counters: object({
    matrixWorld: counter,
    worldMatrix: counter,
    ikChains: counter,
    physicsUpdates: counter,
    physicsSubsteps: counter,
    stageCalls: counter,
  }),
})

it('rejects a budget entry with an empty reason', () => {
  const invalid = {
    ...budgetFile,
    counters: { ...budgetFile.counters, matrixWorld: { ...budgetFile.counters.matrixWorld, reason: '  ' } },
  }
  const result = safeParse(budgetSchema, invalid)
  expect(result.success).toBe(false)
  expect(result.issues?.[0].path?.map(item => item.key)).toEqual(['counters', 'matrixWorld', 'reason'])
})

it('keeps the composed headless pipeline within its deterministic work budget', async () => {
  const budget = parse(budgetSchema, budgetFile)
  await initAmmo()
  const fixture = bodyFixture(0, Math.PI, { hair: true, arms: true, bodies: true })
  // The fixture's pipeline has hand-pushed stages and physics off; only the composed pipeline runs here.
  fixture.pipeline.dispose()
  fixture.mmd.setPhysics(MMDAmmoPhysics)
  const physics = fixture.mmd.physics
  if (!physics)
    throw new TypeError('The work budget requires Ammo physics')
  const helper = physics.createHelper()
  // three-mmd-physics-ammo/dist/index.js: helper.getModel().world.world is the
  // btDiscreteDynamicsWorld held by the physics closure. Read no rigid-body state.
  const { getModel } = parse(object({ getModel: custom<() => unknown>(value => typeof value === 'function') }), helper)
  const { world: { world } } = parse(object({
    world: object({
      world: custom<{ stepSimulation: (delta: number, maxSteps: number, fixedStep: number) => number }>(
        value => typeof value === 'object' && value !== null && 'stepSimulation' in value && typeof value.stepSimulation === 'function',
      ),
    }),
  }), getModel())
  const natural = new NaturalMotion({ seed: budget.seed })
  natural.setRigTraits({ bodyFromHeadPhysics: { x: false, y: false, z: false } })
  natural.advance(0)
  let frame = 0
  const stages = composeMMDStages({
    body: fixture.body,
    // Same host stage as the headless runner, with fixed idle input and an explicit seed.
    host: {
      natural: ({ dt }) => {
        const seconds = ++frame * dt
        natural.setEmotionStrengths({})
        natural.setVoice({ speaking: false, speechActiveOrRecent: false, level: 0 })
        natural.setPerformance({ mode: 'idle', attention: 'camera', away: false }, 0.5, seconds)
        natural.setCursor(null, seconds)
        natural.setChat(null, seconds)
        fixture.setInput({ frame: natural.advance(seconds), intent: natural.bodyIntent() })
      },
    },
  })
  const pipeline = new MMDFramePipeline({
    mmd: fixture.mmd,
    mixer: fixture.mixer,
    poseStages: stages.pose,
    surfaceStages: stages.surface.filter(stage => stage.id !== 'motion-trace'),
  })
  const measured = { matrixWorld: 0, worldMatrix: 0, ikChains: 0, physicsUpdates: 0, physicsSubsteps: 0, stageCalls: 0 }
  const matrixWorld = Object3D.prototype.updateMatrixWorld
  const worldMatrix = Object3D.prototype.updateWorldMatrix
  // three-mmd/dist/index.js exports MMDIKSolver; solveChain is its per-link CCD solve.
  const solverPrototype = parse(custom<{ solveChain: (...args: unknown[]) => void }>(
    value => typeof value === 'object' && value !== null && 'solveChain' in value && typeof value.solveChain === 'function',
  ), MMDIKSolver.prototype)
  const ikChains = solverPrototype.solveChain
  const physicsUpdate = physics.update
  const stepSimulation = world.stepSimulation
  const stepDescriptor = Object.getOwnPropertyDescriptor(world, 'stepSimulation')
  try {
    for (let index = 0; index < budget.warmup; index++)
      pipeline.step(1 / 60)
    pipeline.metrics.drainUsage(new MMDUsageTotals())
    Object3D.prototype.updateMatrixWorld = function (...args) {
      measured.matrixWorld++
      return matrixWorld.apply(this, args)
    }
    Object3D.prototype.updateWorldMatrix = function (...args) {
      measured.worldMatrix++
      return worldMatrix.apply(this, args)
    }
    solverPrototype.solveChain = function (...args) {
      measured.ikChains++
      return ikChains.apply(this, args)
    }
    physics.update = function (...args) {
      measured.physicsUpdates++
      return physicsUpdate.apply(this, args)
    }
    world.stepSimulation = function (...args) {
      const substeps = stepSimulation.apply(this, args)
      measured.physicsSubsteps += substeps
      return substeps
    }
    for (let index = 0; index < budget.frames; index++)
      pipeline.step(1 / 60)
    const usage = new MMDUsageTotals()
    pipeline.metrics.drainUsage(usage)
    measured.stageCalls = usage.stageN.reduce((sum, count) => sum + count, 0)
  }
  finally {
    Object3D.prototype.updateMatrixWorld = matrixWorld
    Object3D.prototype.updateWorldMatrix = worldMatrix
    solverPrototype.solveChain = ikChains
    physics.update = physicsUpdate
    if (stepDescriptor)
      Object.defineProperty(world, 'stepSimulation', stepDescriptor)
    else
      Reflect.deleteProperty(world, 'stepSimulation')
    pipeline.dispose()
    if (typeof helper === 'object' && helper !== null && 'dispose' in helper && typeof helper.dispose === 'function')
      helper.dispose()
    fixture.mmd.dispose()
    fixture.mesh.geometry.dispose()
    fixture.mesh.material.dispose()
    expect(Object3D.prototype.updateMatrixWorld).toBe(matrixWorld)
    expect(Object3D.prototype.updateWorldMatrix).toBe(worldMatrix)
    expect(solverPrototype.solveChain).toBe(ikChains)
    expect(physics.update).toBe(physicsUpdate)
    expect(world.stepSimulation).toBe(stepSimulation)
    expect(Object.getOwnPropertyDescriptor(world, 'stepSimulation')).toEqual(stepDescriptor)
  }
  process.stdout.write(`Work counts (counts, not time): ${JSON.stringify(measured)}\n`)
  const printed = {
    ...budget,
    counters: Object.fromEntries(counterIds.map(id => [id, {
      max: measured[id],
      reason: budget.counters[id].reason,
    }])),
  }
  const json = JSON.stringify(printed, null, 2)
  expect(safeParse(budgetSchema, JSON.parse(json)).success).toBe(true)
  if (process.env.AIRI_WORK_BUDGET_PRINT === '1') {
    process.stdout.write(`${json}\n`)
    return
  }
  for (const id of counterIds) {
    const count = measured[id]
    const { max } = budget.counters[id]
    const change = max === 0 ? 'unbounded' : `${((count - max) / max * 100).toFixed(2)}%`
    expect.soft(count, `${id}: measured ${count}, max ${max}, +${change}\n${json}`).toBeLessThanOrEqual(max)
  }
  expect(measured.physicsSubsteps, '600 frames must simulate about 650 fixed substeps').toBeGreaterThanOrEqual(620)
  expect(measured.physicsSubsteps).toBeLessThanOrEqual(680)
})
