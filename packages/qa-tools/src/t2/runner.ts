import type { CatalogEntry, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { ExpressionDefinition } from '@proj-airi/stage-ui-live2d/composables/live2d/expression/compose'
import type { PhysicsRigLike } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'
import type { CubismParameterTable, NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'
import type { SlotLeases } from '@proj-airi/stage-ui-live2d/stores/expression-slot-leases'

import type { ScenarioHost } from '../motion/scenario-sink'
import type { T2RigData } from './rig'

import process from 'node:process'

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseExp3Expression } from '@proj-airi/stage-shared/expression-performance'
import { ExpressionComposer } from '@proj-airi/stage-ui-live2d/composables/live2d/expression/compose'
import { readLive2DRigProfile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'
import { NaturalTraceRecorder } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'
import { createSlotLeases, emptyLeases } from '@proj-airi/stage-ui-live2d/stores/expression-slot-leases'
import { resolve } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { computed, ref } from 'vue'

import { runScenarioSink } from '../motion/scenario-sink'
import { defaultCorePath, installWindowShim, loadCubismCoreInNode } from './core-node'
import { T2SetupError } from './errors'
import { readRig } from './rig'

/** Fixed SDK step in seconds: T2 simulates at 60 Hz whatever the render rate would be. */
export const t2Step = 1 / 60
const t2Hz = 60

/** `LogLevel_Off` in the Cubism framework; the enum is not exported by pixi-live2d-display. */
const cubismLogLevelOff = 5

/** Default wall-clock bound of one run, in seconds; a run at the measured speed needs a small fraction of it. */
const defaultMaxWallSeconds = 900

interface CubismCoreModel {
  getModel: () => { parameters: Omit<CubismParameterTable, 'ids'> & { ids: string[], values: Float32Array } }
  getParameterValueByIndex: (index: number) => number
  setParameterValueByIndex: (index: number, value: number) => void
  getParameterValueById: (id: string) => number
  setParameterValueById: (id: string, value: number) => void
  getParameterIndex: (id: string) => number
  getParameterMinimumValue: (index: number) => number
  getParameterMaximumValue: (index: number) => number
  update: () => void
}

interface InternalModel {
  coreModel: CubismCoreModel
  motionManager: { expressionManager?: unknown }
  eyeBlink?: unknown
  breath?: unknown
  physics?: { evaluate: (model: unknown, dt: number) => void, _physicsRig?: PhysicsRigLike }
  pose?: unknown
  updateFocus: () => void
  update: (dtMs: number, nowMs: number) => void
  destroy: () => void
  on: (event: 'beforeModelUpdate' | 'afterMotionUpdate', listener: () => void) => void
}

/**
 * The part of `pixi-live2d-display/cubism4` the runner uses. The module is passed around, not imported
 * statically, because it throws at import time unless `Live2DCubismCore` is already global.
 */
export interface Cubism4Module {
  CubismFramework: { isStarted: () => boolean, startUp: (option: { logFunction: (message: string) => void, loggingLevel: number }) => boolean, initialize: () => void }
  Cubism4ModelSettings: new (json: Record<string, unknown>) => unknown
  CubismMoc: { create: (moc: ArrayBuffer) => { createModel: () => CubismCoreModel, release: () => void } }
  Cubism4InternalModel: new (coreModel: CubismCoreModel, settings: unknown, options: Record<string, unknown>) => InternalModel
  CubismPhysics: { create: (json: unknown) => NonNullable<InternalModel['physics']> }
  CubismPose: { create: (json: unknown) => unknown }
}

/** The rig, the Cubism core, and the SDK module: everything a run needs that is not the scenario. */
export interface T2Runtime {
  cubism4: Cubism4Module
  rig: T2RigData
  core: { version: string, shims: string[] }
}

export interface LoadT2RuntimeOptions {
  /** @default process.env.AIRI_QA_RIG_FORBOOTH */
  rigRoot?: string
  /** @default process.env.AIRI_QA_CUBISM_CORE, else the current checkout's gitignored copy */
  corePath?: string
}

/**
 * Reads the rig, evaluates the core, and imports the SDK. Throws `T2SetupError` (exit code 2) for a missing,
 * empty, or unreadable rig and for a missing core. The rig is checked first.
 */
export async function loadT2Runtime(options: LoadT2RuntimeOptions = {}): Promise<T2Runtime> {
  const rig = readRig(options.rigRoot ?? process.env.AIRI_QA_RIG_FORBOOTH)
  const core = await loadCubismCoreInNode(options.corePath ?? process.env.AIRI_QA_CUBISM_CORE ?? defaultCorePath)
  const windowShims = installWindowShim()
  // The package's `import` export condition points at dist/cubism4.es.js; load that file directly,
  // so the same ES module is used under tsx and under Vitest.
  const cjsEntry = createRequire(import.meta.url).resolve('pixi-live2d-display/cubism4')
  const cubism4 = await import(/* @vite-ignore */ pathToFileURL(join(dirname(cjsEntry), 'cubism4.es.js')).href) as Cubism4Module
  return { cubism4, rig, core: { version: core.version, shims: [...core.shims, ...windowShims] } }
}

export interface RunT2Options {
  /** Expression catalog the conductor resolves against; its expression files are read from the rig. @default [] */
  catalog?: CatalogEntry[]
  /**
   * Run the core's mesh deformation (`model.update()`). It reads parameters and never writes them, and it takes
   * about 90% of a frame, so it is off by default. @default false
   */
  deform?: boolean
  /** Called with the live parameter values every frame at the sample point, before deformation. For identity checks. */
  observe?: (values: ArrayLike<number>, simTime: number) => void
  /** Wall-clock bound in seconds; the run throws when it is exceeded. @default 900 */
  maxWallSeconds?: number
}

function readCatalogDefinitions(rig: T2RigData, catalog: CatalogEntry[]): ExpressionDefinition[] {
  return catalog.map((entry) => {
    const path = join(rig.dir, entry.fileName)
    let file: ReturnType<typeof parseExp3Expression>
    try {
      file = parseExp3Expression(JSON.parse(readFileSync(path, 'utf8')))
    }
    catch (error) {
      throw new T2SetupError(`Catalog expression ${entry.id} cannot be read from the rig: ${path}`, { cause: error })
    }
    return {
      id: entry.id,
      fadeIn: file.FadeInTime,
      fadeOut: file.FadeOutTime,
      parameters: file.Parameters.map(parameter => ({
        id: parameter.Id,
        value: parameter.Value,
        blend: parameter.Blend === 'Multiply' || parameter.Blend === 'Overwrite' ? parameter.Blend : 'Add',
      })),
    }
  })
}

/** Channels whose recorded value changes at all: a trace with none is a rig that did not run. */
function countMovingChannels(trace: NaturalTrace) {
  return Object.values(trace.channels).filter(values => Math.max(...values) - Math.min(...values) > 0).length
}

/**
 * Runs one motion scenario on the real ForBOOTH model at a fixed 1/60 s step, without a renderer or GPU.
 * The scenario sink is the one T1 uses (conductor, scene, hold performer, Natural adapter); the model is a real
 * `Cubism4InternalModel` with the rig's moc, physics and pose, built fresh for every call, so equal scenarios
 * serialize to equal bytes. The trace records the rig's own parameter ranges plus the catalog's switch parameters.
 *
 * Per frame, in the order of Model.vue: expression bases restored, SDK motion manager, expression composed,
 * Natural's `frame`, Natural's late composition in place of `updateFocus`, physics, pose, the trace
 * sample before deformation, and `loadParameters`.
 *
 * Not reproduced from the stage: the SDK breath, eye blink and expression manager are removed as Model.vue removes
 * them; auto blink, lip sync and breath come from the Natural adapter's attention (`autoBlink`, the scenario's
 * speech level); manual motion control and the manual breath curve are inactive, as in an unattended stage; the
 * beat-sync, idle-focus and light-squint plugins are not installed; expression group conflicts and rest-set
 * entries are not modelled (slot leases and fades are). `observe` and `deform` exist for the parameter-identity check.
 */
export function runT2(input: MotionScenario, runtime: T2Runtime, options: RunT2Options = {}): NaturalTrace {
  const { catalog = [], deform = false, maxWallSeconds = defaultMaxWallSeconds } = options
  const { cubism4, rig } = runtime
  const trace = runScenarioSink(input, {
    level: 't2',
    simHz: t2Hz,
    catalog,
    createHost: ({ settings }): ScenarioHost => {
      if (!cubism4.CubismFramework.isStarted()) {
        cubism4.CubismFramework.startUp({ logFunction: () => {}, loggingLevel: cubismLogLevelOff })
        cubism4.CubismFramework.initialize()
      }
      const modelSettings = new cubism4.Cubism4ModelSettings({ ...rig.modelJson, url: rig.modelUrl })
      const moc = cubism4.CubismMoc.create(rig.moc)
      const coreModel = moc.createModel()
      const internalModel = new cubism4.Cubism4InternalModel(coreModel, modelSettings, {})
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
      const rigProfile = readLive2DRigProfile(parameters, internalModel.physics?._physicsRig, rig.displayInfoJson)

      if (!deform) {
        // Deformation reads parameters to compute drawable vertices and opacities; it never writes a parameter.
        internalModel.coreModel.update = () => {}
      }

      // The expression stack: the stage's composer and slot-lease logic on the sim clock.
      const definitions = readCatalogDefinitions(rig, catalog)
      const composer = new ExpressionComposer()
      composer.define(definitions)
      let claimSeq = 0
      const leases = ref<SlotLeases>(emptyLeases())
      const muted = ref(false)
      const slotSettings = ref({ speechGrace: settings.slots.speechGrace, unstartedExpiry: settings.slots.unstartedExpiry, holdCap: settings.slots.holdCap })
      const slots = createSlotLeases({
        catalog: computed(() => catalog),
        manualActive: ref<string[]>([]),
        leases,
        muted,
        slotSettings,
        composer,
        nextClaimSequence: () => ++claimSeq,
        reconcile: (now) => {
          const claims = [...new Map(Object.values(leases.value).flatMap(lease => lease ? [[lease.expressionId, { expressionId: lease.expressionId, layer: 1, seq: lease.claimSequence }] as const] : [])).values()]
          composer.setTargets(resolve(claims, catalog).targets, now)
        },
      })
      slots.setSlotSettings(settings.slots)

      const switchParameterIds = [...new Set(definitions.flatMap(definition => definition.parameters.map(parameter => parameter.id)))]
      const recorder = new NaturalTraceRecorder(parameters, { extraParameterIds: switchParameterIds, displayInfo: rig.displayInfoJson })

      // Model.vue samples on `beforeModelUpdate`: after focus (Natural), physics, and pose, before
      // `model.update()` and `loadParameters()` restore the saved pre-composition values.
      let nowSeconds = 0
      internalModel.on('beforeModelUpdate', () => {
        recorder.sample(nowSeconds, index => parameters.values[index])
        options.observe?.(parameters.values, nowSeconds)
      })

      const core = internalModel.coreModel
      const clampOf = (id: string): [number, number] => {
        const index = core.getParameterIndex(id)
        return [core.getParameterMinimumValue(index), core.getParameterMaximumValue(index)]
      }
      const deadline = performance.now() + maxWallSeconds * 1000
      let currentAdapter: Parameters<ScenarioHost['frame']>[0]
      internalModel.on('afterMotionUpdate', () => {
        composer.compose(nowSeconds, id => core.getParameterValueById(id), (id, value) => core.setParameterValueById(id, value), clampOf)
        currentAdapter.frame(nowSeconds)
      })

      return {
        model: internalModel,
        rigProfile,
        recorder,
        modelId: 'forbooth',
        applySlots: (commands: SlotCommand[], now) => slots.applySlots(commands, now),
        onSpeech: (event, turnId, now) => slots.onSpeech(event, turnId, now),
        setMuted: value => slots.setMuted(value),
        frame: (adapter, simTime) => {
          if (performance.now() > deadline)
            throw new Error(`[qa-tools] T2 run exceeded its ${maxWallSeconds} s wall-clock bound at simulated ${simTime.toFixed(1)} s`)
          nowSeconds = simTime
          currentAdapter = adapter
          slots.tickLeases(simTime)
          composer.restoreBases((id, value) => core.setParameterValueById(id, value))
          internalModel.update(t2Step * 1000, simTime * 1000)
        },
        dispose: () => {
          composer.define([])
          leases.value = emptyLeases()
          internalModel.destroy()
          moc.release()
        },
      }
    },
  })
  if (countMovingChannels(trace) === 0)
    throw new Error(`[qa-tools] T2 run of ${input.id} recorded no moving parameter; the rig did not run`)
  return trace
}
