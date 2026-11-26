import { number, object, safeParse } from 'valibot'

/** The part of a Cubism physics instance that the fixed-rate evaluation uses. */
export interface FixedRatePhysics {
  evaluate: (model: FixedRatePhysicsModel, deltaTimeSeconds: number) => void
  /** Parsed rig. An output's parameter index is -1 until the first evaluation resolves it. */
  _physicsRig?: { outputs: { destinationParameterIndex?: number, weight?: number }[] }
}

/** The part of a Cubism core model that physics reads and writes. */
export interface FixedRatePhysicsModel {
  getModel: () => { parameters: { values: Float32Array } }
}

/** Seconds: a longer accumulated time is dropped, not simulated. The Cubism 5 SDK uses the same limit. */
const maxDeltaSeconds = 5

const physicsMeta = object({ Meta: object({ Fps: number() }) })

/** The rate a `physics3.json` declares in `Meta.Fps`, or `undefined` when it declares none. */
export function physicsFps(json: unknown): number | undefined {
  const parsed = safeParse(physicsMeta, json)
  return parsed.success && Number.isFinite(parsed.output.Meta.Fps) && parsed.output.Meta.Fps > 0 ? parsed.output.Meta.Fps : undefined
}

/**
 * Makes `physics.evaluate` simulate in steps of `1 / fps` seconds, whatever the frame time, and returns `physics`.
 *
 * Each frame adds its time to a remainder. While a whole step fits, the inputs move toward the frame's values by the
 * step's share of the remainder and the rig simulates one step. The frame then shows the outputs of the two latest
 * steps, blended by the remainder left over, so the outputs trail the simulation by up to one step.
 *
 * The blend is over parameter values. The SDK blends raw outputs; the two differ only for an output weight below 100.
 */
export function evaluatePhysicsAtFixedRate<T extends FixedRatePhysics>(physics: T, fps: number): T {
  // NOTICE:
  // The vendored Cubism 4 physics steps by the frame time, so a rig swings differently per frame rate.
  // Root cause: it predates the Cubism 5 SDK's fixed-rate `evaluate` and `interpolate`, ported here.
  // Source: node_modules/pixi-live2d-display/dist/cubism4.es.js `CubismPhysics.evaluate`.
  // Remove when the Live2D runtime evaluates physics at `Meta.Fps` itself.
  const simulate = physics.evaluate.bind(physics)
  const step = 1 / fps
  let remain = 0
  let inputs: Float32Array | undefined
  let frame = new Float32Array(0)
  let outputs: { index: number, previous: number, current: number }[] | undefined

  physics.evaluate = (model, deltaTimeSeconds) => {
    const values = model.getModel().parameters.values
    if (inputs?.length !== values.length) {
      inputs = Float32Array.from(values)
      frame = new Float32Array(values.length)
      outputs = undefined
      remain = 0
    }
    if (deltaTimeSeconds > 0) {
      remain += deltaTimeSeconds
      if (remain > maxDeltaSeconds)
        remain = 0
      frame.set(values)
      while (remain >= step) {
        const share = step / remain
        for (let index = 0; index < inputs.length; index++)
          inputs[index] += (frame[index] - inputs[index]) * share
        // The rig reads its inputs from the model and chains settings through it, so the step runs on the model.
        values.set(inputs)
        simulate(model, step)
        outputs ??= outputIndices(physics).map(index => ({ index, previous: values[index], current: values[index] }))
        for (const output of outputs) {
          output.previous = output.current
          output.current = values[output.index]
        }
        remain -= step
      }
      values.set(frame)
    }
    // Also on a frame without time: the outputs hold, as the frame's other values were restored before physics.
    if (outputs) {
      const blend = remain / step
      for (const output of outputs)
        values[output.index] = output.previous + (output.current - output.previous) * blend
    }
  }
  return physics
}

/** The parameters physics writes. An output of weight 0 leaves its parameter to the frame's other writers. */
function outputIndices(physics: FixedRatePhysics) {
  return [...new Set(physics._physicsRig?.outputs.flatMap(({ destinationParameterIndex: index, weight }) => index !== undefined && index >= 0 && weight !== 0 ? [index] : []))]
}
