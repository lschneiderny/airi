import type { PixiLive2DInternalModel } from '../../../stage-ui-live2d/src/composables/live2d/motion-manager'
import type { Live2DNaturalMotionAttention } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion-adapter'
import type { PhysicsRigLike } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile'
import type { NaturalTrace } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion/trace'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { Live2DNaturalMotionAdapter } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion-adapter'
import { createRandomStream } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion/random'
import { readLive2DRigProfile } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile'
import { NaturalTraceRecorder } from '../../../stage-ui-live2d/src/composables/live2d/natural-motion/trace'

/** Rig files the loop needs. Node reads them from disk; the browser receives them through Vitest commands. */
export interface T2RigData {
  /** Absolute model3.json path; the SDK only uses it to resolve relative file names. */
  modelUrl: string
  modelJson: Record<string, unknown>
  moc: ArrayBuffer
  physicsJson: unknown
  poseJson: unknown
}

type InternalModel = PixiLive2DInternalModel & {
  physics?: { evaluate: (model: unknown, dt: number) => void, _physicsRig?: PhysicsRigLike }
  pose?: unknown
  update: (dtMs: number, nowMs: number) => void
}

/**
 * The part of `pixi-live2d-display/cubism4` the loop uses. The module is passed in, not imported,
 * because it throws at import time unless `Live2DCubismCore` is already global, and Node and the
 * browser load the core in different ways.
 */
export interface Cubism4Module {
  CubismFramework: { isStarted: () => boolean, startUp: (option: { logFunction: (message: string) => void, loggingLevel: number }) => boolean, initialize: () => void }
  Cubism4ModelSettings: new (json: Record<string, unknown>) => unknown
  CubismMoc: { create: (moc: ArrayBuffer) => { createModel: () => unknown } }
  Cubism4InternalModel: new (coreModel: unknown, settings: unknown, options: Record<string, unknown>) => unknown
  CubismPhysics: { create: (json: unknown) => NonNullable<InternalModel['physics']> }
  CubismPose: { create: (json: unknown) => unknown }
}

export interface T2LoopOptions {
  frames: number
  /** Fixed SDK step in seconds. */
  dt: number
  seed: number
  /** `false` keeps the rig profile's physics ownership but never evaluates physics (parity negative). */
  physics: boolean
  /** Keep every post-physics parameter of every frame (parity); off for the speed run. */
  recordParameters: boolean
  /**
   * `false` skips the core's `model.update()` (mesh deformation). Parameter values do not depend on
   * it; the spike proves that with a parity run before using it for the speed measurement.
   */
  deform: boolean
  /** Time each stage of the frame (adapter composition, physics, deformation). */
  profile: boolean
}

export interface T2StageProfile {
  composeMs: number
  physicsMs: number
  deformMs: number
}

export interface T2LoopResult {
  parameterIds: string[]
  /** `frames[f][p]`: post-physics value of parameter `p` after frame `f`, or empty when not recorded. */
  frames: number[][]
  trace: NaturalTrace
  /** Wall time of the frame loop only, excluding moc and settings parsing. */
  loopMs: number
  setupMs: number
  profile: T2StageProfile | undefined
}

/** Wraps `owner[key]` so each call adds its wall time to `profile[slot]`. */
function timeMethod<K extends string>(owner: { [P in K]: (...args: never[]) => unknown }, key: K, profile: T2StageProfile, slot: keyof T2StageProfile) {
  const original = owner[key]
  owner[key] = ((...args: never[]) => {
    const start = performance.now()
    const result = original.apply(owner, args)
    profile[slot] += performance.now() - start
    return result
  }) as typeof original
}

/** `LogLevel_Off` in the Cubism framework; the enum is not exported by pixi-live2d-display. */
const cubismLogLevelOff = 5

function idleAttention(): Live2DNaturalMotionAttention {
  return {
    driver: 'natural',
    manualActive: false,
    springActive: false,
    exclusive: false,
    // Model.vue's default `performance` prop.
    performance: { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' },
    energy: 0.5,
    voice: { speaking: false, level: 0, speechEndedAtSeconds: null },
    autoBlink: true,
    manualBreathActive: false,
    clipOwnedIds: new Set(),
    pendingEmotions: [],
    heldEmotion: null,
    emotionStrengths: {},
    cursor: null,
    cursorDismissed: false,
    placement: null,
    chat: null,
    pendingPokes: [],
    pet: null,
  }
}

/**
 * Runs AIRI's Natural composition on the real Cubism model at a fixed step, without a renderer.
 *
 * Order per frame mirrors `Cubism4InternalModel.update()` as Model.vue configures it: motion
 * manager, then `updateFocus` (which the Natural adapter replaces with its composition), then
 * physics, pose, and `model.update()`. SDK breath, SDK eye blink, and the SDK expression manager
 * are removed as Model.vue does with expressions enabled (its default). AIRI's final motion
 * plugins (expression, auto blink, lip sync, manual control) are not installed: this spike
 * measures whether the rig runs headless, not the full plugin stack.
 */
export function runT2Loop(cubism4: Cubism4Module, rig: T2RigData, options: T2LoopOptions): T2LoopResult {
  const setupStart = performance.now()
  if (!cubism4.CubismFramework.isStarted()) {
    cubism4.CubismFramework.startUp({ logFunction: () => {}, loggingLevel: cubismLogLevelOff })
    cubism4.CubismFramework.initialize()
  }
  const settings = new cubism4.Cubism4ModelSettings({ ...rig.modelJson, url: rig.modelUrl })
  const coreModel = cubism4.CubismMoc.create(rig.moc).createModel()
  const internalModel = new cubism4.Cubism4InternalModel(coreModel, settings, {}) as InternalModel
  if (rig.physicsJson)
    internalModel.physics = cubism4.CubismPhysics.create(rig.physicsJson)
  if (rig.poseJson)
    internalModel.pose = cubism4.CubismPose.create(rig.poseJson)

  // Model.vue with live2dExpressionEnabled (default true): the SDK expression manager and SDK eye
  // blink are removed, and `disableLive2DSdkBreath` deletes the SDK breath controller.
  internalModel.motionManager.expressionManager = undefined
  internalModel.eyeBlink = undefined
  delete internalModel.breath

  const parameters = internalModel.coreModel.getModel().parameters
  const rigProfile = readLive2DRigProfile(parameters, internalModel.physics?._physicsRig)
  if (!options.physics)
    internalModel.physics = undefined

  const adapter = new Live2DNaturalMotionAdapter(internalModel, rigProfile, idleAttention, undefined, createRandomStream(options.seed))
  adapter.setPerformanceSettings(defaultExpressionPerformanceSettings)

  const deformer: { update: () => void } = internalModel.coreModel
  if (!options.deform) {
    // Deformation reads parameters to compute drawable vertices and opacities; it never writes a parameter.
    deformer.update = () => {}
  }
  let profile: T2StageProfile | undefined
  if (options.profile) {
    profile = { composeMs: 0, physicsMs: 0, deformMs: 0 }
    timeMethod(internalModel, 'updateFocus', profile, 'composeMs')
    if (internalModel.physics)
      timeMethod(internalModel.physics, 'evaluate', profile, 'physicsMs')
    timeMethod(deformer, 'update', profile, 'deformMs')
  }

  const recorder = new NaturalTraceRecorder(parameters)
  const frames: number[][] = []
  let nowSeconds = 0
  // Model.vue samples on `beforeModelUpdate`: after focus (Natural), physics, and pose, before
  // `model.update()` and `loadParameters()` restore the saved pre-composition values.
  internalModel.on('beforeModelUpdate', () => {
    const values = parameters.values
    recorder.sample(nowSeconds, index => values[index])
    if (options.recordParameters)
      frames.push(Array.from(values))
  })
  const setupMs = performance.now() - setupStart

  const loopStart = performance.now()
  for (let frame = 1; frame <= options.frames; frame++) {
    nowSeconds = frame * options.dt
    // Model.vue calls `frame` from a final motion-manager plugin, which runs before `updateFocus`.
    adapter.frame(nowSeconds)
    internalModel.update(options.dt * 1000, nowSeconds * 1000)
  }
  const loopMs = performance.now() - loopStart

  const diagnostics = adapter.diagnostics
  adapter.dispose()
  return {
    parameterIds: Array.from(parameters.ids),
    frames,
    trace: recorder.build({
      model: 'forbooth',
      driver: 'natural',
      energy: 0.5,
      home: diagnostics.home,
      adapter: { weightMean: diagnostics.weightMean, bodyWrites: diagnostics.bodyWrites, physicsOutputSkips: diagnostics.physicsOutputSkips },
      capturedAt: new Date(0).toISOString(),
      durationSeconds: options.frames * options.dt,
    }),
    loopMs,
    setupMs,
    profile,
  }
}
