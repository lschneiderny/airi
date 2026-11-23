import type { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

import { Application } from '@pixi/app'
import { BatchRenderer, extensions, Renderer } from '@pixi/core'
import { TickerPlugin } from '@pixi/ticker'
import { Live2DFactory, Live2DModel } from 'pixi-live2d-display/cubism4'

import '@proj-airi/stage-ui-live2d/utils/live2d-zip-loader'

/**
 * The preset Live2D model that `display-models.ts` ships. It is gitignored; the browser
 * project's `Download` plugin copies it from `.cache/live2d/models`, downloading it into
 * that cache first when the cache has no copy.
 */
const presetModelUrl = new URL('../../../../packages/stage-ui/src/assets/live2d/models/hiyori_free_zh.zip', import.meta.url).href
const zipSignature = [0x50, 0x4B, 0x03, 0x04]

/** A Pixi stage that the test renders frame by frame, with the preset model loaded on demand. */
export interface Live2DModelFixture {
  app: Application
  gl: WebGLRenderingContext
  /** Loads another instance of the preset model. It updates only through `model.update(ms)`. */
  loadModel: () => Promise<Live2DModel<Cubism4InternalModel>>
  /** The preset model's zip, for a test that loads it through a component or edits it first. */
  presetModel: () => Promise<File>
  renderFrame: () => void
  /** Reads the whole drawing buffer as RGBA, bottom row first. */
  readPixels: () => Uint8Array
  destroy: () => void
}

let presetModel: Promise<File> | undefined

/**
 * Fails, never skips, when the model is missing: the Vite server answers a missing file
 * with 404 or with its HTML fallback, so the check reads the zip signature.
 */
async function fetchPresetModel(): Promise<File> {
  const response = await fetch(presetModelUrl)
  const bytes = new Uint8Array(response.ok ? await response.arrayBuffer() : new ArrayBuffer(0))
  if (!zipSignature.every((byte, index) => bytes[index] === byte)) {
    throw new Error(
      `The Live2D fixture model is missing: packages/stage-ui/src/assets/live2d/models/hiyori_free_zh.zip `
      + `(GET ${presetModelUrl} answered ${response.status} without a zip). The Download plugin of the `
      + `browser project in apps/stage-tamagotchi/vitest.config.ts fetches it when Vitest starts; run `
      + `"pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser <test>" with network access.`,
    )
  }
  return new File([bytes], 'hiyori_free_zh.zip')
}

export function createLive2DModelFixture(size: { width: number, height: number }): Live2DModelFixture {
  // As `Canvas.vue` does for the stage: inserted sprites draw through the batch renderer.
  extensions.add(BatchRenderer)
  // As `Canvas.vue` does: stage items run their clock on `app.ticker`. With `autoStart` off,
  // the ticker advances only through explicit `app.ticker.update(time)` calls.
  extensions.add(TickerPlugin)
  const app = new Application({
    width: size.width,
    height: size.height,
    backgroundAlpha: 0,
    antialias: false,
    resolution: 1,
    autoStart: false,
    // Pixel reads run right after a synchronous render, but a kept buffer makes
    // that independent of when the browser composites.
    preserveDrawingBuffer: true,
  })
  document.body.appendChild(app.view)
  if (!(app.renderer instanceof Renderer))
    throw new Error('The Live2D fixture needs a WebGL renderer.')
  const gl = app.renderer.gl
  const models: Live2DModel<Cubism4InternalModel>[] = []

  return {
    app,
    gl,
    presetModel() {
      presetModel ??= fetchPresetModel()
      return presetModel
    },
    async loadModel() {
      presetModel ??= fetchPresetModel()
      const file = await presetModel
      const model = new Live2DModel<Cubism4InternalModel>({ autoUpdate: false, autoInteract: false })
      await Live2DFactory.setupLive2DModel(model, [file], { autoInteract: false })
      // An update starts a random idle motion and loads it asynchronously, so frames would
      // differ between runs and a load could finish after `destroy`.
      model.internalModel.motionManager.state.shouldRequestIdleMotion = () => false
      models.push(model)
      return model
    },
    renderFrame() {
      app.renderer.render(app.stage)
    },
    readPixels() {
      const pixels = new Uint8Array(size.width * size.height * 4)
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    },
    destroy() {
      for (const model of models)
        model.destroy({ children: true, texture: true, baseTexture: true })
      app.destroy(true)
    },
  }
}
