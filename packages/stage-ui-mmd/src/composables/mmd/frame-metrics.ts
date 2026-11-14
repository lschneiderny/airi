import { FixedHistogram, FRAME_BINS_V1, STAGE_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'

export interface StageTiming {
  lastMs: number
  p95Ms: number
}

export interface FrameMeasurement {
  state: 'idle' | 'running' | 'done'
  durationMs: number
  frames: number
  fps: number
  stages: Record<string, { meanMs: number, p95Ms: number, maxMs: number }>
  /** The host's alpha-readback hit test over the last second; absent when the host reported none. */
  readbackMs?: { meanMs: number, maxMs: number }
  /** Physics resets that a caller requested during the run; resets on an animation loop wrap are not counted. */
  physicsResets: number
}

const readbackWindowMs = 1000
const ringSize = 600

/** Sorts in place; callers pass a copy they own. */
function sortedPercentile95(sorted: Float64Array) {
  sorted.sort()
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

/** Stage ids a usage accumulator tracks; the pipeline times about 25. Ids seen after the table is full go untracked. */
export const MMD_USAGE_STAGE_CAPACITY = 64
/** About 30 s of frames at 60 fps. */
export const MMD_FRAME_RING_SIZE = 2048

/**
 * Frame and per-stage usage totals over the stage bins, in preallocated storage.
 *
 * A stage keeps its index once seen, also across `reset`, so entries whose `stageN` is 0 had no samples in this window.
 * Callers own one instance as a reusable drain target; the metrics keep one as the live accumulator.
 */
export class MMDUsageTotals {
  frames = 0
  frameSumMs = 0
  frameMaxMs = 0
  readonly frameHist = new FixedHistogram(FRAME_BINS_V1)
  /** Stage id per stage index. */
  readonly stageIds: string[] = []
  readonly stageN = new Uint32Array(MMD_USAGE_STAGE_CAPACITY)
  readonly stageSumMs = new Float64Array(MMD_USAGE_STAGE_CAPACITY)
  readonly stageMaxMs = new Float64Array(MMD_USAGE_STAGE_CAPACITY)
  readonly stageHists: readonly FixedHistogram[] = Array.from({ length: MMD_USAGE_STAGE_CAPACITY }, () => new FixedHistogram(STAGE_BINS_V1))
  private readonly stageIndexes = new Map<string, number>()

  /** The index of `id`, assigned on first sight; -1 once the table is full. */
  stageIndex(id: string): number {
    const known = this.stageIndexes.get(id)
    if (known !== undefined)
      return known
    if (this.stageIds.length === MMD_USAGE_STAGE_CAPACITY)
      return -1
    this.stageIndexes.set(id, this.stageIds.length)
    this.stageIds.push(id)
    return this.stageIds.length - 1
  }

  addFrame(ms: number): void {
    this.frames += 1
    this.frameSumMs += ms
    this.frameMaxMs = Math.max(this.frameMaxMs, ms)
    this.frameHist.add(ms)
  }

  addStage(index: number, ms: number): void {
    this.stageN[index] += 1
    this.stageSumMs[index] += ms
    this.stageMaxMs[index] = Math.max(this.stageMaxMs[index], ms)
    this.stageHists[index].add(ms)
  }

  /** Adds another accumulator's totals, matching stages by id, since two metrics instances can index them differently. */
  addFrom(source: MMDUsageTotals): void {
    this.frames += source.frames
    this.frameSumMs += source.frameSumMs
    this.frameMaxMs = Math.max(this.frameMaxMs, source.frameMaxMs)
    this.frameHist.mergeFrom(source.frameHist.counts)
    for (let from = 0; from < source.stageIds.length; from++) {
      if (source.stageN[from] === 0)
        continue
      const to = this.stageIndex(source.stageIds[from])
      if (to === -1)
        continue
      this.stageN[to] += source.stageN[from]
      this.stageSumMs[to] += source.stageSumMs[from]
      this.stageMaxMs[to] = Math.max(this.stageMaxMs[to], source.stageMaxMs[from])
      this.stageHists[to].mergeFrom(source.stageHists[from].counts)
    }
  }

  /** Zeroes every total and keeps the stage indexes. */
  reset(): void {
    this.frames = 0
    this.frameSumMs = 0
    this.frameMaxMs = 0
    this.frameHist.reset()
    this.stageN.fill(0)
    this.stageSumMs.fill(0)
    this.stageMaxMs.fill(0)
    for (const histogram of this.stageHists)
      histogram.reset()
  }
}

/**
 * The last {@link MMD_FRAME_RING_SIZE} frames: the interval that ended each frame, the summed stage time recorded in it,
 * and its slowest tracked stage. A copy holds the frames oldest first in `[0, count)`, with the stage ids they index.
 */
export class MMDFrameRing {
  /** `slowestStage` value of a frame without a tracked stage. */
  static readonly noStage = 255
  readonly intervalsMs = new Float32Array(MMD_FRAME_RING_SIZE)
  readonly stageTotalMs = new Float32Array(MMD_FRAME_RING_SIZE)
  readonly slowestStage = new Uint8Array(MMD_FRAME_RING_SIZE)
  /** Filled by a copy; the live ring resolves indexes through its metrics' usage totals. */
  readonly stageIds: string[] = []
  count = 0
  /** The next write position. */
  cursor = 0

  push(intervalMs: number, stageTotalMs: number, slowestStage: number): void {
    this.intervalsMs[this.cursor] = intervalMs
    this.stageTotalMs[this.cursor] = stageTotalMs
    this.slowestStage[this.cursor] = slowestStage
    this.cursor = (this.cursor + 1) % MMD_FRAME_RING_SIZE
    this.count = Math.min(this.count + 1, MMD_FRAME_RING_SIZE)
  }

  /** Copies the frames oldest first into `target`; the stage ids are left to the caller. */
  copyTo(target: MMDFrameRing): void {
    const oldest = (this.cursor - this.count + MMD_FRAME_RING_SIZE) % MMD_FRAME_RING_SIZE
    for (let offset = 0; offset < this.count; offset++) {
      const from = (oldest + offset) % MMD_FRAME_RING_SIZE
      target.intervalsMs[offset] = this.intervalsMs[from]
      target.stageTotalMs[offset] = this.stageTotalMs[from]
      target.slowestStage[offset] = this.slowestStage[from]
    }
    target.count = this.count
    target.cursor = this.count % MMD_FRAME_RING_SIZE
  }
}

/** `usageIndex` is the stage's index in the usage totals, or -1 when it is untracked. */
interface StageRing { samples: Float64Array, count: number, cursor: number, lastMs: number, usageIndex: number }
interface MeasuredStage { samples: number[], sumMs: number, maxMs: number, fullP95Ms?: number }

/**
 * Rolling readouts and full-run captures have independent storage and lifetimes. Diagnostics read both at 10 Hz, so a
 * read sorts a 600-sample window in a reused buffer, and the full-run p95 is sorted once, when the measurement stops.
 * Usage totals and the frame ring are a third, independent store for perf recording: recording into them allocates
 * nothing, and only `drainUsage` resets them.
 */
export class MMDFrameMetrics {
  private readonly stageSamples = new Map<string, StageRing>()
  private readonly scratch = new Float64Array(ringSize)
  private readonly frameIntervals: number[] = []
  private frameCursor = 0
  private readonly measuredIntervals: number[] = []
  private readonly measuredStages = new Map<string, MeasuredStage>()
  private durationMs = 0
  private state: FrameMeasurement['state'] = 'idle'
  private readonly readbacks: { atMs: number, ms: number }[] = []
  private physicsResets = 0
  private readonly usage = new MMDUsageTotals()
  private readonly frameRing = new MMDFrameRing()
  private frameStageMs = 0
  private frameSlowestMs = -1
  private frameSlowestStage = MMDFrameRing.noStage

  measure(id: string, run: () => void): void {
    const start = performance.now()
    run()
    this.recordStage(id, performance.now() - start)
  }

  recordStage(id: string, ms: number): void {
    let ring = this.stageSamples.get(id)
    if (!ring) {
      ring = { samples: new Float64Array(ringSize), count: 0, cursor: 0, lastMs: 0, usageIndex: this.usage.stageIndex(id) }
      this.stageSamples.set(id, ring)
    }
    this.frameStageMs += ms
    if (ring.usageIndex !== -1) {
      this.usage.addStage(ring.usageIndex, ms)
      if (ms > this.frameSlowestMs) {
        this.frameSlowestMs = ms
        this.frameSlowestStage = ring.usageIndex
      }
    }
    ring.samples[ring.cursor] = ms
    ring.cursor = (ring.cursor + 1) % ringSize
    ring.count = Math.min(ring.count + 1, ringSize)
    ring.lastMs = ms
    if (this.state === 'running') {
      let measured = this.measuredStages.get(id)
      if (!measured) {
        measured = { samples: [], sumMs: 0, maxMs: 0 }
        this.measuredStages.set(id, measured)
      }
      measured.samples.push(ms)
      measured.sumMs += ms
      measured.maxMs = Math.max(measured.maxMs, ms)
    }
  }

  /** The p95 of a stage's rolling window, sorted in the shared scratch buffer. */
  private ringPercentile95(ring: StageRing | undefined) {
    if (!ring)
      return 0
    const window = this.scratch.subarray(0, ring.count)
    window.set(ring.samples.subarray(0, ring.count))
    return sortedPercentile95(window)
  }

  /** RAF interval in seconds, before the simulation's 50 ms clamp. */
  recordFrame(delta: number): void {
    this.frameIntervals[this.frameCursor] = delta
    this.frameCursor = (this.frameCursor + 1) % 600
    const intervalMs = delta * 1000
    this.usage.addFrame(intervalMs)
    this.frameRing.push(intervalMs, this.frameStageMs, this.frameSlowestStage)
    this.frameStageMs = 0
    this.frameSlowestMs = -1
    this.frameSlowestStage = MMDFrameRing.noStage
    if (this.state === 'running') {
      this.measuredIntervals.push(delta)
      this.durationMs += delta * 1000
    }
  }

  /** One alpha readback that took `ms`, at `atMs` on the caller's clock. Samples older than one second drop out. */
  recordReadback(ms: number, atMs: number): void {
    this.readbacks.push({ atMs, ms })
    while (this.readbacks[0].atMs <= atMs - readbackWindowMs)
      this.readbacks.shift()
  }

  /** One physics reset that a caller requested, applied this frame. */
  recordPhysicsReset(): void {
    if (this.state === 'running')
      this.physicsResets += 1
  }

  timings(): Record<string, StageTiming> {
    const timings: Record<string, StageTiming> = {}
    this.stageSamples.forEach((ring, id) => {
      timings[id] = { lastMs: ring.lastMs, p95Ms: this.ringPercentile95(ring) }
    })
    return timings
  }

  fps() {
    const total = this.frameIntervals.reduce((sum, value) => sum + value, 0)
    const last = this.frameIntervals[(this.frameCursor + 599) % 600] ?? 0
    return {
      last: last > 0 ? 1 / last : 0,
      mean60s: total > 0 ? this.frameIntervals.length / total : 0,
    }
  }

  /**
   * Adds the usage totals since the previous drain into `target` and resets them. Returns whether that window held a frame.
   * Rolling readouts and the measurement are not touched.
   */
  drainUsage(target: MMDUsageTotals): boolean {
    const hadFrames = this.usage.frames > 0
    target.addFrom(this.usage)
    this.usage.reset()
    return hadFrames
  }

  /** Copies the frame ring oldest first into `target`, with the stage ids its `slowestStage` indexes. Returns whether it held a frame. */
  copyFrameRing(target: MMDFrameRing): boolean {
    this.frameRing.copyTo(target)
    target.stageIds.length = 0
    target.stageIds.push(...this.usage.stageIds)
    return target.count > 0
  }

  startMeasurement(): void {
    this.measuredIntervals.length = 0
    this.measuredStages.clear()
    this.durationMs = 0
    this.physicsResets = 0
    this.state = 'running'
  }

  stopMeasurement(): void {
    if (this.state === 'running')
      this.state = 'done'
  }

  /** While running, a stage's `p95Ms` covers its last 600 frames; once stopped, it covers the whole run. */
  measurement(): FrameMeasurement | null {
    if (this.state === 'idle')
      return null
    const frames = this.measuredIntervals.length
    const stages: FrameMeasurement['stages'] = {}
    this.measuredStages.forEach((measured, id) => {
      let p95Ms: number
      if (this.state === 'done')
        p95Ms = measured.fullP95Ms ??= sortedPercentile95(Float64Array.from(measured.samples))
      else
        p95Ms = this.ringPercentile95(this.stageSamples.get(id))
      stages[id] = { meanMs: measured.sumMs / measured.samples.length, p95Ms, maxMs: measured.maxMs }
    })
    return {
      state: this.state,
      durationMs: this.durationMs,
      frames,
      fps: this.durationMs > 0 ? frames / (this.durationMs / 1000) : 0,
      physicsResets: this.physicsResets,
      stages,
      ...(this.readbacks.length > 0
        ? {
            readbackMs: {
              meanMs: this.readbacks.reduce((sum, sample) => sum + sample.ms, 0) / this.readbacks.length,
              maxMs: this.readbacks.reduce((max, sample) => Math.max(max, sample.ms), 0),
            },
          }
        : {}),
    }
  }
}
