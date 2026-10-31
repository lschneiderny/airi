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
}

function percentile95(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

/** Rolling readouts and full-run captures have independent storage and lifetimes. */
export class MMDFrameMetrics {
  private readonly stageSamples = new Map<string, { samples: number[], cursor: number, lastMs: number }>()
  private readonly frameIntervals: number[] = []
  private frameCursor = 0
  private readonly measuredIntervals: number[] = []
  private readonly measuredStages = new Map<string, number[]>()
  private durationMs = 0
  private state: FrameMeasurement['state'] = 'idle'

  measure(id: string, run: () => void): void {
    const start = performance.now()
    run()
    this.recordStage(id, performance.now() - start)
  }

  recordStage(id: string, ms: number): void {
    let ring = this.stageSamples.get(id)
    if (!ring) {
      ring = { samples: [], cursor: 0, lastMs: 0 }
      this.stageSamples.set(id, ring)
    }
    ring.samples[ring.cursor] = ms
    ring.cursor = (ring.cursor + 1) % 600
    ring.lastMs = ms
    if (this.state === 'running') {
      let samples = this.measuredStages.get(id)
      if (!samples) {
        samples = []
        this.measuredStages.set(id, samples)
      }
      samples.push(ms)
    }
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

  timings(): Record<string, StageTiming> {
    return Object.fromEntries([...this.stageSamples].map(([id, ring]) => [
      id,
      { lastMs: ring.lastMs, p95Ms: percentile95(ring.samples) },
    ]))
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
    this.state = 'running'
  }

  stopMeasurement(): void {
    if (this.state === 'running')
      this.state = 'done'
  }

  measurement(): FrameMeasurement | null {
    if (this.state === 'idle')
      return null
    const frames = this.measuredIntervals.length
    return {
      state: this.state,
      durationMs: this.durationMs,
      frames,
      fps: this.durationMs > 0 ? frames / (this.durationMs / 1000) : 0,
      stages: Object.fromEntries([...this.measuredStages].map(([id, samples]) => [
        id,
        {
          meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
          p95Ms: percentile95(samples),
          maxMs: samples.reduce((max, value) => Math.max(max, value), 0),
        },
      ])),
    }
  }
}
