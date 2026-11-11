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

interface StageRing { samples: Float64Array, count: number, cursor: number, lastMs: number }
interface MeasuredStage { samples: number[], sumMs: number, maxMs: number, fullP95Ms?: number }

/**
 * Rolling readouts and full-run captures have independent storage and lifetimes. Diagnostics read both at 10 Hz, so a
 * read sorts a 600-sample window in a reused buffer, and the full-run p95 is sorted once, when the measurement stops.
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

  measure(id: string, run: () => void): void {
    const start = performance.now()
    run()
    this.recordStage(id, performance.now() - start)
  }

  recordStage(id: string, ms: number): void {
    let ring = this.stageSamples.get(id)
    if (!ring) {
      ring = { samples: new Float64Array(ringSize), count: 0, cursor: 0, lastMs: 0 }
      this.stageSamples.set(id, ring)
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
