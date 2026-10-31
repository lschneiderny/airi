import type { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { referenceStats } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/reference-stats'
import { readLive2DRigProfile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'
import { naturalTraceParameterIds, NaturalTraceRecorder } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { runScenarioSink } from '../scenario-sink'

export interface RunT1Options {
  /** Simulation steps per second. @default 120 */
  simHz?: number
  /** Samples kept per second; the trace recorder keeps a 30 Hz grid, so only 30 is supported. @default 30 */
  sampleHz?: number
  /** Expression catalog the conductor and the `expression` events resolve against. @default [] */
  catalog?: CatalogEntry[]
  /** Emotion table seam of the Natural controller, for scorer mutation runs. @default naturalEmotions */
  emotionTable?: typeof naturalEmotions
}

/** Ranges for ids that the reference statistics lack; the stage reads the real rig's table for these. */
const fallbackRanges: Record<string, { min: number, max: number, default: number }> = {
  ParamEyeLSmile: { min: 0, max: 1, default: 0 },
  ParamEyeRSmile: { min: 0, max: 1, default: 0 },
  ParamBrowLAngle: { min: -1, max: 1, default: 0 },
  ParamBrowRAngle: { min: -1, max: 1, default: 0 },
  ParamBrowRY: { min: -1, max: 1, default: 0 },
  ParamCheek: { min: 0, max: 1, default: 0 },
}

/** The Cubism parameter table the stub model exposes: every Natural trace id, with the rig's reference ranges. */
function buildParameterTable() {
  const ids = [...naturalTraceParameterIds] as string[]
  const ranges = ids.map((id) => {
    const range = referenceStats.ranges[id] ?? fallbackRanges[id]
    if (!range)
      throw new Error(`[qa-tools] No T1 range for parameter ${id}`)
    return range
  })
  const minimumValues = ranges.map(range => range.min)
  const maximumValues = ranges.map(range => range.max)
  const defaultValues = ranges.map(range => range.default)
  // The post-motion base the SDK restores every frame: defaults, with open lids.
  const base = Float32Array.from(ids.map((id, index) => /^ParamEye[LR]Open$/.test(id) ? Math.min(maximumValues[index], Math.max(minimumValues[index], 1)) : defaultValues[index]))
  return { ids, minimumValues, maximumValues, defaultValues, base }
}

/**
 * Runs one motion scenario through the real stage pipeline without a renderer: the performance conductor
 * (decider, hold lease), the hold performer, and the Natural controller behind its adapter, each fresh per call
 * (the shared scenario sink, `../scenario-sink`). The trace is deterministic: equal scenarios and options give
 * byte-identical JSON.
 *
 * The scenario is validated with the shared schema, so an unknown emotion or band, an unsorted timeline, or a
 * scenario without level `t1` throws. A run that records no frame throws too, so an empty trace is never a pass.
 *
 * Slot commands (expression files) are decided but not applied, because T1 has no rig to show them; the trace
 * records what Natural performed.
 */
export function runT1(input: MotionScenario, options: RunT1Options = {}): NaturalTrace {
  const { simHz = 120, sampleHz = 30, catalog = [], emotionTable } = options
  if (sampleHz !== 30)
    throw new Error(`[qa-tools] T1 samples at 30 Hz only, got ${sampleHz}`)
  if (!Number.isInteger(simHz) || simHz < sampleHz)
    throw new Error(`[qa-tools] simHz must be an integer of at least ${sampleHz}, got ${simHz}`)

  return runScenarioSink(input, {
    level: 't1',
    simHz,
    catalog,
    emotionTable,
    createHost: () => {
      const table = buildParameterTable()
      const values = Float32Array.from(table.base)
      const model = {
        coreModel: {
          getParameterValueByIndex: (index: number) => values[index],
          setParameterValueByIndex: (index: number, value: number) => { values[index] = value },
        },
        updateFocus: () => {},
      }
      const recorder = new NaturalTraceRecorder({ ids: table.ids, minimumValues: table.minimumValues, maximumValues: table.maximumValues, defaultValues: table.defaultValues })
      return {
        model,
        rigProfile: readLive2DRigProfile(table, undefined),
        recorder,
        modelId: null,
        applySlots: () => {},
        onSpeech: () => {},
        setMuted: () => {},
        frame: (adapter, simTime) => {
          // The SDK restores the post-motion values before each late composition.
          values.set(table.base)
          adapter.frame(simTime)
          model.updateFocus()
          recorder.sample(simTime, index => values[index])
        },
        dispose: () => {},
      }
    },
  })
}
