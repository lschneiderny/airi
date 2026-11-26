import { Live2DFactory } from 'pixi-live2d-display/cubism4'

import { evaluatePhysicsAtFixedRate, physicsFps } from '../composables/live2d/fixed-rate-physics'

const installed = new WeakSet<object>()

/**
 * Every Cubism 4 physics the factory creates runs at the rate its file declares. A file without `Meta.Fps` keeps the
 * runtime's own evaluation, one step of the frame time.
 */
for (const runtime of Live2DFactory.runtimes) {
  if (runtime.version !== 4 || installed.has(runtime))
    continue
  installed.add(runtime)
  const createPhysics = runtime.createPhysics.bind(runtime)
  runtime.createPhysics = (coreModel, data) => {
    const physics = createPhysics(coreModel, data)
    const fps = physicsFps(data)
    return fps === undefined ? physics : evaluatePhysicsAtFixedRate(physics, fps)
  }
}
