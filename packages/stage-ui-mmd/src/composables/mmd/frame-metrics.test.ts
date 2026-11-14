import { FRAME_BINS_V1, STAGE_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'
import { describe, expect, it } from 'vitest'

import { MMD_FRAME_RING_SIZE, MMDFrameMetrics, MMDFrameRing, MMDUsageTotals } from './frame-metrics'

/** Every typed array, array and Map reachable from `root`, by property path, so a test can see identity and growth. */
function collections(root: object): Map<string, ArrayBufferView | unknown[] | Map<unknown, unknown>> {
  const found = new Map<string, ArrayBufferView | unknown[] | Map<unknown, unknown>>()
  const seen = new Set<object>()
  const visit = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null || seen.has(value))
      return
    seen.add(value)
    if (ArrayBuffer.isView(value)) {
      found.set(path, value)
      return
    }
    if (value instanceof Map) {
      found.set(path, value)
      value.forEach((entry, key) => visit(entry, `${path}.get(${String(key)})`))
      return
    }
    if (Array.isArray(value))
      found.set(path, value)
    Object.entries(value).forEach(([key, entry]) => visit(entry, `${path}.${key}`))
  }
  visit(root, 'metrics')
  return found
}

function sizeOf(collection: ArrayBufferView | unknown[] | Map<unknown, unknown>): number {
  if (collection instanceof Map)
    return collection.size
  return Array.isArray(collection) ? collection.length : collection.byteLength
}

describe('mmd frame metrics', () => {
  it('retains an early spike across all 3600 measured frames after rolling buffers expire', () => {
    const metrics = new MMDFrameMetrics()
    metrics.startMeasurement()
    for (let frame = 0; frame < 3600; frame++) {
      metrics.recordStage('pose', frame === 30 ? 50 : 1)
      metrics.recordFrame(1 / 60)
    }
    metrics.stopMeasurement()
    const measurement = metrics.measurement()
    expect(measurement?.state).toBe('done')
    expect(measurement?.frames).toBe(3600)
    expect(measurement?.durationMs).toBeCloseTo(60000)
    expect(measurement?.fps).toBeCloseTo(60)
    expect(measurement?.stages.pose.maxMs).toBeGreaterThanOrEqual(50)
    expect(measurement?.stages.pose.p95Ms).toBe(1)
    expect(measurement?.stages.pose.meanMs).toBeCloseTo(1 + 49 / 3600)
    expect(metrics.timings().pose).toEqual({ lastMs: 1, p95Ms: 1 })
  })

  it('computes full-interval percentiles independently of rolling samples and restarts captures', () => {
    const metrics = new MMDFrameMetrics()
    metrics.startMeasurement()
    for (let frame = 0; frame < 3600; frame++) {
      metrics.recordStage('pose', frame < 300 ? 10 : 1)
      metrics.recordFrame(1 / 60)
    }
    metrics.stopMeasurement()
    expect(metrics.measurement()?.stages.pose.p95Ms).toBe(10)
    expect(metrics.timings().pose.p95Ms).toBe(1)
    metrics.recordStage('pose', 100)
    metrics.recordFrame(0.2)
    expect(metrics.measurement()?.frames).toBe(3600)
    expect(metrics.measurement()?.stages.pose.maxMs).toBe(10)
    metrics.startMeasurement()
    metrics.recordFrame(0.1)
    metrics.stopMeasurement()
    expect(metrics.measurement()?.frames).toBe(1)
    expect(metrics.measurement()?.stages).toEqual({})
    expect(metrics.measurement()?.fps).toBe(10)
  })

  it('reports the rolling 600-frame p95 while a measurement runs and the full-run p95 once it stops', () => {
    const metrics = new MMDFrameMetrics()
    metrics.startMeasurement()
    for (let frame = 0; frame < 900; frame++) {
      metrics.recordStage('pose', frame < 300 ? 10 : 1)
      metrics.recordFrame(1 / 60)
    }
    expect(metrics.measurement()?.stages.pose).toEqual({ meanMs: (300 * 10 + 600) / 900, p95Ms: 1, maxMs: 10 })
    metrics.stopMeasurement()
    expect(metrics.measurement()?.stages.pose.p95Ms).toBe(10)
  })

  it('reports the alpha readback mean and max over the last second, and omits the field without samples', () => {
    const metrics = new MMDFrameMetrics()
    metrics.startMeasurement()
    metrics.recordFrame(1 / 60)
    expect(metrics.measurement()).not.toHaveProperty('readbackMs')

    metrics.recordReadback(5, 0)
    expect(metrics.measurement()?.readbackMs).toEqual({ meanMs: 5, maxMs: 5 })

    metrics.recordReadback(0.2, 1500)
    metrics.recordReadback(0.4, 1600)
    expect(metrics.measurement()?.readbackMs?.meanMs).toBeCloseTo(0.3)
    expect(metrics.measurement()?.readbackMs?.maxMs).toBe(0.4)

    metrics.recordReadback(0.1, 2700)
    expect(metrics.measurement()?.readbackMs).toEqual({ meanMs: 0.1, maxMs: 0.1 })
  })
})

describe('mmd frame usage accumulators', () => {
  const stageIds = Array.from({ length: 12 }, (_, index) => `stage-${index}`)

  it('drains frame and per-stage totals keyed by stage id, then reports zeros', () => {
    const metrics = new MMDFrameMetrics()
    metrics.recordStage('pose', 0.3)
    metrics.recordStage('physics.update', 2)
    metrics.recordFrame(0.016)
    metrics.recordStage('pose', 0.6)
    metrics.recordFrame(0.025)

    const usage = new MMDUsageTotals()
    expect(metrics.drainUsage(usage)).toBe(true)
    expect(usage.frames).toBe(2)
    expect(usage.frameSumMs).toBeCloseTo(41)
    expect(usage.frameMaxMs).toBeCloseTo(25)
    expect(usage.frameHist.toSparse()).toEqual([[FRAME_BINS_V1.edges.indexOf(15) + 1, 1], [FRAME_BINS_V1.edges.indexOf(25) + 1, 1]])
    const pose = usage.stageIds.indexOf('pose')
    expect(usage.stageN[pose]).toBe(2)
    expect(usage.stageSumMs[pose]).toBeCloseTo(0.9)
    expect(usage.stageMaxMs[pose]).toBeCloseTo(0.6)
    expect(usage.stageHists[pose].toSparse()).toEqual([[STAGE_BINS_V1.edges.indexOf(0.2) + 1, 1], [STAGE_BINS_V1.edges.indexOf(0.5) + 1, 1]])
    expect(usage.stageN[usage.stageIds.indexOf('physics.update')]).toBe(1)

    const again = new MMDUsageTotals()
    expect(metrics.drainUsage(again)).toBe(false)
    expect(again.frames).toBe(0)
    expect(again.frameSumMs).toBe(0)
    expect(again.frameHist.count).toBe(0)
    expect(Array.from(again.stageN).every(n => n === 0)).toBe(true)
  })

  it('leaves rolling timings, fps and the measurement unchanged when drained', () => {
    const metrics = new MMDFrameMetrics()
    metrics.startMeasurement()
    for (let frame = 0; frame < 120; frame++) {
      metrics.recordStage('pose', frame === 3 ? 9 : 1)
      metrics.recordFrame(1 / 60)
    }
    const before = { timings: metrics.timings(), fps: metrics.fps(), measurement: metrics.measurement() }
    metrics.drainUsage(new MMDUsageTotals())
    expect({ timings: metrics.timings(), fps: metrics.fps(), measurement: metrics.measurement() }).toEqual(before)
  })

  it('copies the per-frame ring oldest first with each frame interval, stage total and slowest stage', () => {
    const metrics = new MMDFrameMetrics()
    const frames = MMD_FRAME_RING_SIZE + 3
    for (let frame = 0; frame < frames; frame++) {
      metrics.recordStage('pose', 1)
      metrics.recordStage('physics.update', frame === frames - 1 ? 0.5 : 2)
      metrics.recordFrame((frame + 1) / 1000)
    }
    metrics.recordFrame(0.05)

    const ring = new MMDFrameRing()
    expect(metrics.copyFrameRing(ring)).toBe(true)
    expect(ring.count).toBe(MMD_FRAME_RING_SIZE)
    expect(ring.intervalsMs[0]).toBeCloseTo(5)
    expect(ring.intervalsMs[MMD_FRAME_RING_SIZE - 2]).toBeCloseTo(frames)
    expect(ring.stageTotalMs[MMD_FRAME_RING_SIZE - 3]).toBeCloseTo(3)
    expect(ring.stageIds[ring.slowestStage[MMD_FRAME_RING_SIZE - 3]]).toBe('physics.update')
    expect(ring.stageIds[ring.slowestStage[MMD_FRAME_RING_SIZE - 2]]).toBe('pose')
    expect(ring.intervalsMs[MMD_FRAME_RING_SIZE - 1]).toBeCloseTo(50)
    expect(ring.stageTotalMs[MMD_FRAME_RING_SIZE - 1]).toBe(0)
    expect(ring.slowestStage[MMD_FRAME_RING_SIZE - 1]).toBe(MMDFrameRing.noStage)
    expect(metrics.copyFrameRing(new MMDFrameRing())).toBe(true)
    expect(new MMDFrameMetrics().copyFrameRing(new MMDFrameRing())).toBe(false)
  })

  it('records 100,000 stages and frames without replacing or growing any collection', () => {
    const metrics = new MMDFrameMetrics()
    const accumulators = [...collections(metrics)].filter(([, collection]) => ArrayBuffer.isView(collection))
    for (const id of stageIds)
      metrics.recordStage(id, 1)
    for (let frame = 0; frame < 600; frame++)
      metrics.recordFrame(1 / 60)
    const warm = new Map([...collections(metrics)].map(([path, collection]) => [path, sizeOf(collection)]))

    for (let call = 0; call < 100_000; call++) {
      metrics.recordStage(stageIds[call % stageIds.length], (call % 400) / 100)
      metrics.recordFrame(1 / 60)
    }

    const after = collections(metrics)
    expect(accumulators.length).toBeGreaterThan(0)
    for (const [path, collection] of accumulators)
      expect(after.get(path), path).toBe(collection)
    expect(new Map([...after].map(([path, collection]) => [path, sizeOf(collection)]))).toEqual(warm)
    expect(Math.max(...[...after.values()].filter(collection => collection instanceof Map).map(sizeOf))).toBe(12)
  })
})
