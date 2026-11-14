import type { PerfWindowRollup } from '../../../shared/eventa/perf-recording'

import { FRAME_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'
import { describe, expect, it } from 'vitest'

import { WindowPerfEvents } from './window-events'
import { resolveWindowTags } from './window-tags'

function rollup(features: { speechMuted?: boolean, mmdPhysics?: boolean } = {}): PerfWindowRollup {
  const tags = resolveWindowTags({
    stageHost: 'window',
    renderer: 'mmd',
    model: { id: 'model-1', fileName: 'chisa.pmx' },
    speechMuted: features.speechMuted ?? false,
    mmd: { physicsEnabled: features.mmdPhysics ?? true, naturalDriver: true, roamMode: 'stay' },
    live2dNaturalDriver: false,
    wakeWordRunning: false,
    hearing: false,
    performanceMode: 'idle',
    chatGenerating: false,
    screen: { width: 1920, height: 1080, scale: 1 },
    diagnosticsTracing: false,
  })
  return {
    v: 1,
    kind: 'window-rollup',
    window: 'stage-main',
    paused: false,
    tags: { ...tags, display: { ...tags.display, refreshHz: 60 } },
    frames: 300,
    frameHist: Array.from<number>({ length: FRAME_BINS_V1.edges.length + 1 }).fill(0),
    frameSumMs: 5000,
    frameMaxMs: 20,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages: null,
    recorderUs: 0,
  }
}

const chisaLoad = { name: 'model-load', detail: { renderer: 'mmd', modelId: 'model-1', modelName: 'chisa' } }

describe('windowPerfEvents', () => {
  it('drains a queued model load once main accepts the pull that carried it', () => {
    const events = new WindowPerfEvents()
    events.modelLoaded({ renderer: 'mmd', modelId: 'model-1', modelName: 'chisa' })
    events.modelLoaded({ renderer: 'mmd', modelId: 'model-1', modelName: 'chisa' })

    expect(events.attach(rollup(), { tick: 4, acceptedTick: 3 }).events).toEqual([chisaLoad, chisaLoad])
    expect(events.attach(rollup(), { tick: 5, acceptedTick: 4 }).events).toEqual([])
  })

  it('resends events from a pull whose answer main dropped, without repeating them after it accepts', () => {
    const events = new WindowPerfEvents()
    events.modelLoaded({ renderer: 'mmd', modelId: 'model-1', modelName: 'chisa' })

    expect(events.attach(rollup(), { tick: 1, acceptedTick: null }).events).toEqual([chisaLoad])
    // Main timed out on tick 1, so tick 2 still names no accepted tick.
    expect(events.attach(rollup(), { tick: 2, acceptedTick: null }).events).toEqual([chisaLoad])
    expect(events.attach(rollup(), { tick: 3, acceptedTick: 2 }).events).toEqual([])
  })

  it('queues a feature change with the changed features when the feature hash differs from the previous pull', () => {
    const events = new WindowPerfEvents()
    const first = rollup()
    const muted = rollup({ speechMuted: true, mmdPhysics: false })

    expect(events.attach(first, { tick: 1, acceptedTick: null }).events).toEqual([])
    expect(events.attach(rollup(), { tick: 2, acceptedTick: 1 }).events).toEqual([])
    expect(events.attach(muted, { tick: 3, acceptedTick: 2 }).events).toEqual([{
      name: 'feature-change',
      detail: { previousFeatureHash: first.tags.featureHash, featureHash: muted.tags.featureHash, speechMuted: true, mmdPhysics: false },
    }])
    expect(events.attach(muted, { tick: 4, acceptedTick: 3 }).events).toEqual([])
  })

  it('forgets queued events and the last feature hash on clear', () => {
    const events = new WindowPerfEvents()
    events.attach(rollup(), { tick: 1, acceptedTick: null })
    events.modelLoaded({ renderer: 'mmd', modelId: 'model-1', modelName: 'chisa' })

    events.clear()

    expect(events.attach(rollup({ speechMuted: true }), { tick: 1, acceptedTick: null }).events).toEqual([])
  })
})
