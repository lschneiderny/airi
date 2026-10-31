import { describe, expect, it } from 'vitest'

import { MMDFrameMetrics } from './frame-metrics'

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
})
