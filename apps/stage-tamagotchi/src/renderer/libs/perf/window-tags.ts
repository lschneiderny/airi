import type { UsageFeatures, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'
import type { StageModelRenderer } from '@proj-airi/stage-ui/stores/settings/stage-model'

import { sanitizeModelName, USAGE_FEATURE_KEYS } from '@proj-airi/stage-shared/perf/usage'

type WindowTags = WindowRollupRecord['tags']

/** A stage window's tags before the sampler adds the refresh rate that it measured. */
export type WindowTagSnapshot = Omit<WindowTags, 'display'> & { display: Omit<WindowTags['display'], 'refreshHz'> }

/** What a stage window's stores report, read once per rollup. Never chat text or a model path. */
export interface WindowTagInputs {
  stageHost: WindowTags['stageHost']
  renderer: StageModelRenderer
  /** The selected display model; `fileName` is reduced to a sanitized stem. */
  model: { id: string, fileName: string } | null
  speechMuted: boolean
  mmd: { physicsEnabled: boolean, naturalDriver: boolean, roamMode: string }
  live2dNaturalDriver: boolean
  wakeWordRunning: boolean
  /** The hearing input mode while hearing is enabled, or false. */
  hearing: string | false
  /** The mode the stage last resolved, or null when no stage in this window resolves one. */
  performanceMode: PerformanceMode | null
  chatGenerating: boolean
  screen: { width: number, height: number, scale: number }
  diagnosticsTracing: boolean
}

function usageRenderer(renderer: StageModelRenderer): WindowTags['renderer'] {
  switch (renderer) {
    case 'live2d':
    case 'mmd':
    case 'vrm':
    case 'spine':
    case 'tachie':
    case 'godot':
      return renderer
    case 'disabled':
    case undefined:
      return 'none'
    default:
      return renderer satisfies never
  }
}

/** FNV-1a over the features in their fixed key order, so equal features hash equal in every session. */
function hashFeatures(features: UsageFeatures): string {
  let hash = 0x811C9DC5
  for (const key of USAGE_FEATURE_KEYS) {
    const text = `${key}=${JSON.stringify(features[key])};`
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Resolves the tags of one stage-window rollup. MMD-only features are null on other renderers. */
export function resolveWindowTags(inputs: WindowTagInputs): WindowTagSnapshot {
  const renderer = usageRenderer(inputs.renderer)
  const mmd = renderer === 'mmd'
  const features: UsageFeatures = {
    speechMuted: inputs.speechMuted,
    mmdPhysics: mmd ? inputs.mmd.physicsEnabled : null,
    naturalMotion: mmd ? inputs.mmd.naturalDriver : renderer === 'live2d' ? inputs.live2dNaturalDriver : null,
    mmdRoam: mmd ? inputs.mmd.roamMode : null,
    wakeWord: inputs.wakeWordRunning,
    hearing: inputs.hearing,
  }
  const model = renderer === 'none' ? null : inputs.model
  return {
    renderer,
    modelId: model?.id ?? null,
    modelName: model ? sanitizeModelName(model.fileName) : null,
    features,
    featureHash: hashFeatures(features),
    activity: inputs.performanceMode ?? 'unknown',
    chatGenerating: inputs.chatGenerating,
    stageHost: inputs.stageHost,
    // Main knows whether DevTools are open on this window and sets it when it writes the record.
    devtoolsOpen: false,
    display: {
      width: Math.round(inputs.screen.width),
      height: Math.round(inputs.screen.height),
      scale: inputs.screen.scale,
    },
    diagnosticsTracing: inputs.diagnosticsTracing,
  }
}
