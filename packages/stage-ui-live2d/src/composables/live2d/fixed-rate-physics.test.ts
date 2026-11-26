import type { FixedRatePhysics, FixedRatePhysicsModel } from './fixed-rate-physics'

import { describe, expect, it } from 'vitest'

import { evaluatePhysicsAtFixedRate, physicsFps } from './fixed-rate-physics'

/**
 * A pendulum in the shape of Cubism physics: it reads parameter 0, integrates one explicit step of the given time, and
 * writes parameter 1. Like the SDK's, its swing depends on the step.
 */
function pendulum() {
  let position = 0
  let velocity = 0
  const steps: number[] = []
  const physics: FixedRatePhysics = {
    _physicsRig: { outputs: [{ destinationParameterIndex: -1 }] },
    evaluate(model, dt) {
      const values = model.getModel().parameters.values
      this._physicsRig!.outputs[0].destinationParameterIndex = 1
      steps.push(dt)
      const acceleration = 400 * (values[0] - position) - 8 * velocity
      position += velocity * dt
      velocity += acceleration * dt
      values[1] = position
    },
  }
  return { physics, steps }
}

function model(values = new Float32Array([0, 0, 7])) {
  const parameters = { values }
  const core: FixedRatePhysicsModel = { getModel: () => ({ parameters }) }
  return { core, values }
}

/** The pendulum's output every sixth of a second while parameter 0 swings at 1.5 Hz, drawn at `hz` frames a second. */
function swing(hz: number, fixedFps?: number) {
  const { physics } = pendulum()
  if (fixedFps)
    evaluatePhysicsAtFixedRate(physics, fixedFps)
  const { core, values } = model()
  const samples: number[] = []
  for (let frame = 1; frame <= 4 * hz; frame++) {
    // The SDK restores the saved parameters before each frame, so physics never reads its own output as a base.
    values[1] = 0
    values[0] = Math.sin(2 * Math.PI * 1.5 * frame / hz)
    physics.evaluate(core, 1 / hz)
    if (frame % (hz / 6) === 0)
      samples.push(values[1])
  }
  return samples
}

const furthest = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))

describe('fixed-rate physics', () => {
  it('reads the rate a physics file declares', () => {
    expect(physicsFps({ Version: 3, Meta: { Fps: 60 } })).toBe(60)
    for (const json of [{ Meta: {} }, { Meta: { Fps: 0 } }, { Meta: { Fps: '60' } }, {}, null, undefined])
      expect(physicsFps(json)).toBeUndefined()
  })

  it('simulates only whole steps of the declared rate, at any frame time', () => {
    const { physics, steps } = pendulum()
    evaluatePhysicsAtFixedRate(physics, 60)
    const { core } = model()
    let elapsed = 0
    for (const dt of [1 / 144, 1 / 30, 0.004, 0.05, 1 / 60, 0.11, 1 / 144]) {
      physics.evaluate(core, dt)
      elapsed += dt
    }
    expect(new Set(steps)).toEqual(new Set([1 / 60]))
    expect(steps).toHaveLength(Math.floor(elapsed * 60))
  })

  it('swings the same at 30, 60 and 144 frames a second', () => {
    const at60 = swing(60, 60)
    expect(furthest(swing(30, 60), at60)).toBeLessThan(0.05)
    expect(furthest(swing(144, 60), at60)).toBeLessThan(0.05)
    // Without the fixed rate the same pendulum swings visibly differently per frame rate.
    expect(furthest(swing(30), swing(144))).toBeGreaterThan(0.3)
  })

  it('leaves the frame\'s other values alone, and holds the outputs on a frame without time', () => {
    const { physics, steps } = pendulum()
    evaluatePhysicsAtFixedRate(physics, 60)
    const { core, values } = model()
    values[0] = 1
    physics.evaluate(core, 1 / 30)
    physics.evaluate(core, 1 / 30)
    const output = values[1]
    expect(output).not.toBe(0)
    // The step ran on eased inputs; the frame keeps the value it came with.
    expect([values[0], values[2]]).toEqual([1, 7])
    values[1] = 0
    physics.evaluate(core, 0)
    expect(values[1]).toBe(output)
    expect(steps).toHaveLength(4)
  })

  it('leaves the parameter of a zero-weight output to the frame', () => {
    const { physics } = pendulum()
    // Cubism resolves the index of a disabled output too, and writes its parameter back unchanged.
    physics._physicsRig!.outputs.push({ destinationParameterIndex: 2, weight: 0 })
    evaluatePhysicsAtFixedRate(physics, 60)
    const { core, values } = model()
    physics.evaluate(core, 1 / 30)
    // Another writer moves the parameter this frame; the steps ran on an eased copy of it.
    values[2] = 9
    physics.evaluate(core, 1 / 144)
    physics.evaluate(core, 1 / 30)
    expect(values[2]).toBe(9)
  })

  it('drops a gap longer than five seconds instead of simulating it', () => {
    const { physics, steps } = pendulum()
    evaluatePhysicsAtFixedRate(physics, 60)
    const { core } = model()
    physics.evaluate(core, 6)
    expect(steps).toHaveLength(0)
    physics.evaluate(core, 1 / 60)
    expect(steps).toHaveLength(1)
  })
})
