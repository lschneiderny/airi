import type { WindowTagSnapshot } from './window-tags'
import type { LongFrameObserverConstructor, WindowUsageSamplerOptions } from './window-usage-sampler'

import { FRAME_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'
import { MMD_FRAME_RING_SIZE } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-metrics'
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WindowUsageSampler } from './window-usage-sampler'

const tags: WindowTagSnapshot = {
  renderer: 'mmd',
  modelId: 'display-model-abc',
  modelName: 'Chisa',
  features: { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'stay', wakeWord: false, hearing: false },
  featureHash: 'f1',
  activity: 'idle',
  chatGenerating: false,
  stageHost: 'window',
  devtoolsOpen: false,
  display: { width: 1920, height: 1080, scale: 1 },
  diagnosticsTracing: false,
}

/** Bin `i` counts `[edges[i - 1], edges[i])`, so the 15-18 ms bin sits at the index of edge 18. */
const bin15To18Ms = FRAME_BINS_V1.edges.indexOf(18)

function createFrames() {
  const pending = new Map<number, (timestamp: number) => void>()
  const callbacks = new Set<(timestamp: number) => void>()
  let nextHandle = 1
  let requests = 0
  return {
    raf: (callback: (timestamp: number) => void) => {
      requests += 1
      callbacks.add(callback)
      pending.set(nextHandle, callback)
      return nextHandle++
    },
    cancelRaf: (handle: number) => {
      pending.delete(handle)
    },
    tick(timestamp: number): number {
      const due = [...pending.values()]
      pending.clear()
      for (const callback of due)
        callback(timestamp)
      return due.length
    },
    get requests() {
      return requests
    },
    get distinctCallbacks() {
      return callbacks.size
    },
  }
}

function createObserverClass(supportedEntryTypes: readonly string[]) {
  const instances: { type: string | null, connected: boolean, deliver: (durations: number[]) => void }[] = []
  const Observer: LongFrameObserverConstructor = class {
    static readonly supportedEntryTypes = supportedEntryTypes
    readonly #instance: (typeof instances)[number]

    constructor(callback: (list: { getEntries: () => readonly { duration: number }[] }) => void) {
      const instance = {
        type: null as string | null,
        connected: false,
        deliver: (durations: number[]) => {
          if (instance.connected)
            callback({ getEntries: () => durations.map(duration => ({ duration })) })
        },
      }
      this.#instance = instance
      instances.push(instance)
    }

    observe(options: { type: string }) {
      this.#instance.type = options.type
      this.#instance.connected = true
    }

    disconnect() {
      this.#instance.connected = false
    }
  }
  return { Observer, instances }
}

describe('windowUsageSampler', () => {
  let frames: ReturnType<typeof createFrames>
  let observers: ReturnType<typeof createObserverClass>
  let clockMs: number

  function createSampler(overrides: Partial<WindowUsageSamplerOptions> = {}) {
    return new WindowUsageSampler({
      window: 'stage-main',
      now: () => clockMs,
      raf: frames.raf,
      cancelRaf: frames.cancelRaf,
      PerformanceObserver: observers.Observer,
      tags: () => tags,
      paused: () => false,
      ...overrides,
    })
  }

  function runFrames(count: number, intervalMs: number) {
    for (let index = 0; index < count; index++) {
      clockMs += intervalMs
      frames.tick(clockMs)
    }
  }

  beforeEach(() => {
    frames = createFrames()
    observers = createObserverClass(['longtask', 'long-animation-frame'])
    clockMs = 1000
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports 300 frames at 16.7 ms in the 15-18 ms bin of one pull, then starts a new window', () => {
    const sampler = createSampler()
    sampler.start()
    // The first frame only sets the baseline; each later frame closes one interval.
    runFrames(301, 16.7)

    const rollup = sampler.pull()

    expect(rollup).toMatchObject({ v: 1, kind: 'window-rollup', window: 'stage-main', paused: false, frames: 300, stages: null })
    expect(rollup?.frameHist[bin15To18Ms]).toBe(300)
    expect(rollup?.frameHist).toHaveLength(FRAME_BINS_V1.edges.length + 1)
    expect(rollup?.frameSumMs).toBeCloseTo(300 * 16.7, 6)
    expect(rollup?.frameMaxMs).toBeCloseTo(16.7, 6)
    expect(rollup?.tags).toEqual({ ...tags, display: { ...tags.display, refreshHz: 60 } })
    expect(sampler.pull()).toMatchObject({ frames: 0, frameSumMs: 0, frameMaxMs: 0 })
  })

  it('counts long animation frames, and long tasks where long animation frames are unsupported', () => {
    const sampler = createSampler()
    sampler.start()
    expect(observers.instances[0].type).toBe('long-animation-frame')
    observers.instances[0].deliver([80, 120])

    expect(sampler.pull()?.longTasks).toEqual({ count: 2, maxMs: 120, sumMs: 200 })

    const fallback = createObserverClass(['longtask'])
    createSampler({ PerformanceObserver: fallback.Observer }).start()
    expect(fallback.instances[0].type).toBe('longtask')
  })

  it('takes frames and stages from an active MMD source and runs no rAF of its own', () => {
    const diagnostics = useMMDMotionDiagnostics()
    // Usage recorded before recording starts belongs to no window.
    for (let index = 0; index < 10; index++)
      diagnostics.recordFrame(0.05)
    const sampler = createSampler({
      mmdDrain: target => diagnostics.drainUsage(target),
      mmdRing: target => diagnostics.copyFrameRing(target),
    })

    sampler.start()
    for (let index = 0; index < 300; index++) {
      diagnostics.measure('physics', () => {})
      diagnostics.recordFrame(1 / 60)
    }
    const rollup = sampler.pull()

    expect(frames.requests).toBe(0)
    expect(rollup).toMatchObject({ frames: 300, stages: { physics: { n: 300 } } })
    expect(rollup?.frameHist[bin15To18Ms]).toBe(300)
    expect(rollup?.tags.display.refreshHz).toBe(60)
    const ring = sampler.frameRing()
    expect(ring?.intervalsMs).toHaveLength(310)
    expect(ring?.slowestStage.at(-1)).toBe('physics')
  })

  it('falls back to its own rAF loop once the MMD source stops producing frames', () => {
    const diagnostics = useMMDMotionDiagnostics()
    diagnostics.recordFrame(1 / 60)
    const sampler = createSampler({ mmdDrain: target => diagnostics.drainUsage(target) })
    sampler.start()
    expect(frames.requests).toBe(0)

    expect(sampler.pull()).toMatchObject({ frames: 0, stages: null })
    runFrames(31, 16.7)

    expect(sampler.pull()).toMatchObject({ frames: 30, stages: null })
  })

  it('stops the rAF loop and the observer on stop, and answers no pull afterwards', () => {
    const sampler = createSampler()
    sampler.start()
    runFrames(5, 16.7)

    sampler.stop()

    expect(frames.tick(clockMs + 16.7)).toBe(0)
    expect(observers.instances[0].connected).toBe(false)
    expect(sampler.pull()).toBeNull()
    expect(sampler.frameRing()).toBeNull()
  })

  it('keeps its preallocated storage and one frame callback through 100,000 frames', () => {
    const sampler = createSampler()
    const counts = sampler.frameHistogram.counts
    const ring = sampler.intervalRing
    sampler.start()

    runFrames(100_000, 16.7)

    expect(sampler.frameHistogram.counts).toBe(counts)
    expect(sampler.frameHistogram.counts).toHaveLength(FRAME_BINS_V1.edges.length + 1)
    expect(sampler.intervalRing).toBe(ring)
    expect(sampler.intervalRing).toHaveLength(MMD_FRAME_RING_SIZE)
    expect(frames.distinctCallbacks).toBe(1)
    expect(sampler.frameRing()?.intervalsMs).toHaveLength(MMD_FRAME_RING_SIZE)
  })

  it('starts no rAF, observer or timer before start', () => {
    vi.useFakeTimers()
    const sampler = createSampler()

    expect(frames.requests).toBe(0)
    expect(observers.instances).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(sampler.pull()).toBeNull()
  })
})
