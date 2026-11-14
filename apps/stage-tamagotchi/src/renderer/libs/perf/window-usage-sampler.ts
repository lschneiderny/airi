import type { PerfFrameRing, PerfWindowRollup } from '../../../shared/eventa/perf-recording'
import type { WindowTagSnapshot } from './window-tags'

import { FixedHistogram, FRAME_BINS_V1, PERF_RECORD_VERSION } from '@proj-airi/stage-shared/perf/usage'
import { MMD_FRAME_RING_SIZE, MMDFrameRing, MMDUsageTotals } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-metrics'

/** The part of the `PerformanceObserver` constructor that the sampler uses. */
export interface LongFrameObserverConstructor {
  readonly supportedEntryTypes: readonly string[]
  new (callback: (list: { getEntries: () => readonly { duration: number }[] }) => void): {
    observe: (options: { type: string }) => void
    disconnect: () => void
  }
}

export interface WindowUsageSamplerOptions {
  /** The window's label in records: `stage-main` or `stage`. */
  window: string
  /** Milliseconds on the clock that animation-frame timestamps use. */
  now: () => number
  raf: (callback: (timestamp: number) => void) => number
  cancelRaf: (handle: number) => void
  PerformanceObserver?: LongFrameObserverConstructor
  /** Replaces `target` with the MMD scene's usage since the last drain and resets it; true when the scene drew a frame. */
  mmdDrain?: (target: MMDUsageTotals) => boolean
  /** Copies the MMD scene's frame ring into `target`; true when it holds a frame. */
  mmdRing?: (target: MMDFrameRing) => boolean
  tags: () => WindowTagSnapshot
  paused: () => boolean
}

/**
 * Samples one stage window's frames and long frames between two pulls of the perf recorder.
 *
 * While an MMD scene draws, its own frame metrics are the source and the sampler schedules no animation frame; otherwise
 * one animation-frame loop records the intervals. The frame callback allocates nothing: it writes into the preallocated
 * histogram and ring. `pull` builds the rollup once per recorder tick and starts the next window.
 */
export class WindowUsageSampler {
  /** Frame intervals of the own loop in the current window. */
  readonly frameHistogram = new FixedHistogram(FRAME_BINS_V1)
  /** The own loop's last {@link MMD_FRAME_RING_SIZE} frame intervals; `ringCursor` is the next write. */
  readonly intervalRing = new Float32Array(MMD_FRAME_RING_SIZE)
  private readonly options: WindowUsageSamplerOptions
  private readonly mmdTotals = new MMDUsageTotals()
  private readonly mmdRingCopy = new MMDFrameRing()
  private readonly medianScratch = new Float32Array(MMD_FRAME_RING_SIZE)
  private running = false
  private mmdSource = false
  private rafHandle: number | null = null
  private observer: InstanceType<LongFrameObserverConstructor> | null = null
  private lastFrameAt = -1
  private frameSumMs = 0
  private frameMaxMs = 0
  private ringCursor = 0
  private ringCount = 0
  private longFrames = 0
  private longFrameSumMs = 0
  private longFrameMaxMs = 0
  private recorderMs = 0

  private readonly onFrame = (timestamp: number): void => {
    const startedAt = this.options.now()
    if (this.lastFrameAt >= 0) {
      const intervalMs = timestamp - this.lastFrameAt
      this.frameHistogram.add(intervalMs)
      this.frameSumMs += intervalMs
      this.frameMaxMs = Math.max(this.frameMaxMs, intervalMs)
      this.intervalRing[this.ringCursor] = intervalMs
      this.ringCursor = (this.ringCursor + 1) % MMD_FRAME_RING_SIZE
      this.ringCount = Math.min(this.ringCount + 1, MMD_FRAME_RING_SIZE)
    }
    this.lastFrameAt = timestamp
    this.rafHandle = this.options.raf(this.onFrame)
    this.recorderMs += this.options.now() - startedAt
  }

  private readonly onLongFrames = (list: { getEntries: () => readonly { duration: number }[] }): void => {
    const startedAt = this.options.now()
    for (const entry of list.getEntries()) {
      this.longFrames += 1
      this.longFrameSumMs += entry.duration
      this.longFrameMaxMs = Math.max(this.longFrameMaxMs, entry.duration)
    }
    this.recorderMs += this.options.now() - startedAt
  }

  constructor(options: WindowUsageSamplerOptions) {
    this.options = options
  }

  /** Starts a window. Usage the MMD scene recorded before this call is drained and dropped. */
  start(): void {
    if (this.running)
      return
    this.running = true
    this.resetWindow()
    this.mmdSource = this.options.mmdDrain?.(this.mmdTotals) ?? false
    if (!this.mmdSource)
      this.startFrameLoop()
    this.startObserver()
  }

  /** Cancels the frame loop and disconnects the observer; nothing runs until the next `start`. */
  stop(): void {
    this.running = false
    this.stopFrameLoop()
    this.observer?.disconnect()
    this.observer = null
  }

  /** The rollup of the window since the last pull or start, or null while stopped. Starts the next window. */
  pull(): PerfWindowRollup | null {
    if (!this.running)
      return null
    const startedAt = this.options.now()
    const fromMmd = this.options.mmdDrain?.(this.mmdTotals) ?? false
    // The source can change between pulls: an MMD scene mounts, unmounts or stops drawing while paused.
    if (fromMmd && !this.mmdSource)
      this.stopFrameLoop()
    else if (!fromMmd && this.mmdSource)
      this.startFrameLoop()
    this.mmdSource = fromMmd

    const frames = fromMmd ? this.mmdTotals.frames : this.frameHistogram.count
    const tags = this.options.tags()
    const rollup: PerfWindowRollup = {
      v: PERF_RECORD_VERSION,
      kind: 'window-rollup',
      window: this.options.window,
      paused: this.options.paused(),
      tags: { ...tags, display: { ...tags.display, refreshHz: this.refreshHz(fromMmd, frames) } },
      frames,
      frameHist: fromMmd ? this.mmdTotals.frameHist.toArray() : this.frameHistogram.toArray(),
      frameSumMs: fromMmd ? this.mmdTotals.frameSumMs : this.frameSumMs,
      frameMaxMs: fromMmd ? this.mmdTotals.frameMaxMs : this.frameMaxMs,
      longTasks: { count: this.longFrames, maxMs: this.longFrameMaxMs, sumMs: this.longFrameSumMs },
      stages: fromMmd ? this.mmdStages() : null,
      recorderUs: 0,
    }
    rollup.recorderUs = Math.round((this.recorderMs + this.options.now() - startedAt) * 1000)
    this.resetWindow()
    return rollup
  }

  /**
   * The last frames oldest first, or null while stopped. Stage times and slowest stages come from an MMD scene; the
   * own loop has none, so those arrays are empty.
   */
  frameRing(): PerfFrameRing | null {
    if (!this.running)
      return null
    if (this.mmdSource && this.options.mmdRing?.(this.mmdRingCopy)) {
      const ring = this.mmdRingCopy
      return {
        intervalsMs: Array.from(ring.intervalsMs.subarray(0, ring.count)),
        stageMs: Array.from(ring.stageTotalMs.subarray(0, ring.count)),
        slowestStage: Array.from(ring.slowestStage.subarray(0, ring.count), index => index === MMDFrameRing.noStage ? '' : ring.stageIds[index] ?? ''),
      }
    }
    const intervalsMs: number[] = []
    const oldest = (this.ringCursor - this.ringCount + MMD_FRAME_RING_SIZE) % MMD_FRAME_RING_SIZE
    for (let offset = 0; offset < this.ringCount; offset++)
      intervalsMs.push(this.intervalRing[(oldest + offset) % MMD_FRAME_RING_SIZE])
    return { intervalsMs, stageMs: [], slowestStage: [] }
  }

  private startFrameLoop(): void {
    this.stopFrameLoop()
    this.lastFrameAt = -1
    this.ringCount = 0
    this.rafHandle = this.options.raf(this.onFrame)
  }

  private stopFrameLoop(): void {
    if (this.rafHandle !== null)
      this.options.cancelRaf(this.rafHandle)
    this.rafHandle = null
  }

  private startObserver(): void {
    const Observer = this.options.PerformanceObserver
    if (!Observer)
      return
    // Long animation frames include rendering work that long tasks miss; Chromium in Electron supports both.
    const type = Observer.supportedEntryTypes.includes('long-animation-frame')
      ? 'long-animation-frame'
      : Observer.supportedEntryTypes.includes('longtask') ? 'longtask' : null
    if (type === null)
      return
    this.observer = new Observer(this.onLongFrames)
    this.observer.observe({ type })
  }

  private mmdStages(): PerfWindowRollup['stages'] {
    const totals = this.mmdTotals
    const stages: NonNullable<PerfWindowRollup['stages']> = {}
    for (let index = 0; index < totals.stageIds.length; index++) {
      if (totals.stageN[index] === 0)
        continue
      stages[totals.stageIds[index]] = {
        n: totals.stageN[index],
        sumMs: totals.stageSumMs[index],
        maxMs: totals.stageMaxMs[index],
        hist: totals.stageHists[index].toSparse(),
      }
    }
    return stages
  }

  /**
   * The display rate implied by the median interval of this window's frames, in whole hertz; 0 without frames.
   * A window that cannot keep up reports its achieved rate, which is what its frames were measured against.
   */
  private refreshHz(fromMmd: boolean, frames: number): number {
    let count: number
    if (fromMmd) {
      if (!this.options.mmdRing?.(this.mmdRingCopy))
        return 0
      count = Math.min(frames, this.mmdRingCopy.count)
      this.medianScratch.set(this.mmdRingCopy.intervalsMs.subarray(this.mmdRingCopy.count - count, this.mmdRingCopy.count))
    }
    else {
      count = Math.min(frames, this.ringCount)
      for (let offset = 0; offset < count; offset++)
        this.medianScratch[offset] = this.intervalRing[(this.ringCursor - 1 - offset + MMD_FRAME_RING_SIZE) % MMD_FRAME_RING_SIZE]
    }
    if (count === 0)
      return 0
    const sorted = this.medianScratch.subarray(0, count).sort()
    const median = sorted[count >> 1]
    return median > 0 ? Math.round(1000 / median) : 0
  }

  private resetWindow(): void {
    this.frameHistogram.reset()
    this.frameSumMs = 0
    this.frameMaxMs = 0
    this.longFrames = 0
    this.longFrameSumMs = 0
    this.longFrameMaxMs = 0
    this.recorderMs = 0
  }
}
