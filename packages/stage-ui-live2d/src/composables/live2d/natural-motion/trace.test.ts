import type { ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { NaturalTrace, NaturalTraceMeta } from './trace'

import { describe, expect, it } from 'vitest'

import { scoreLiveliness } from './liveliness'
import { naturalTraceFileName, NaturalTraceRecorder } from './trace'

const meta: NaturalTraceMeta = {
  model: 'fixture',
  driver: 'natural',
  energy: 0.5,
  home: 'product',
  adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 },
  capturedAt: '2026-10-17T12:00:00.000Z',
  durationSeconds: 2,
}

/** A Cubism parameter table with two scored channels, one unrelated parameter, and no ParamAngleZ. */
const parameters = {
  ids: ['ParamAngleX', 'Unrelated', 'ParamEyeLOpen'],
  minimumValues: new Float32Array([-30, 0, 0]),
  maximumValues: new Float32Array([30, 1, 1]),
  defaultValues: new Float32Array([0, 0, 1]),
}

/** Offers frames at `hz` for `seconds` and returns the built trace. */
function record(hz: number, seconds: number, start = 12.5) {
  const recorder = new NaturalTraceRecorder(parameters)
  for (let frame = 0; frame <= hz * seconds; frame++) {
    const now = start + frame / hz
    recorder.sample(now, index => index === 0 ? 10 * Math.sin(now) : 0.9)
  }
  return recorder.build(meta)
}

describe('natural trace recorder', () => {
  it('records the resolved blush parameter under the canonical scored cheek channel', () => {
    const rig = {
      ids: ['cheekpuff', 'CustomBlush'],
      minimumValues: [0, 0],
      maximumValues: [1, 2],
      defaultValues: [0, 0.1],
    }
    const recorder = new NaturalTraceRecorder(rig, { displayInfo: { Parameters: [{ Id: 'CustomBlush', Name: 'Blush' }] } })
    recorder.sample(0, index => index === 1 ? 0.6 : 0)
    const trace = recorder.build(meta)
    expect(trace.channels).toEqual({ ParamCheek: [0.6] })
    expect(trace.ranges).toEqual({ ParamCheek: { min: 0, max: 2, default: 0.1 } })
  })

  it('stores ranges for the recorded channels only', () => {
    const trace = record(60, 1)

    expect(Object.keys(trace.channels)).toEqual(['ParamAngleX', 'ParamEyeLOpen'])
    expect(trace.ranges).toEqual({
      ParamAngleX: { min: -30, max: 30, default: 0 },
      ParamEyeLOpen: { min: 0, max: 1, default: 1 },
    })
    expect(trace.meta).toEqual(meta)
  })

  it.each([60, 144, 30])('keeps 30 Hz spacing from a %i Hz render', (hz) => {
    const trace = record(hz, 4)
    const gaps = trace.t.slice(1).map((time, index) => time - trace.t[index])

    expect(trace.t[0]).toBe(0)
    expect(trace.t.length).toBeGreaterThanOrEqual(118)
    expect(trace.t.length).toBeLessThanOrEqual(121)
    expect(Math.min(...gaps)).toBeGreaterThan(0.75 / 30)
    expect(Math.max(...gaps)).toBeLessThan(1.5 / 30)
    expect(trace.channels.ParamAngleX).toHaveLength(trace.t.length)
  })

  it('restarts the grid after a stall instead of bursting late slots', () => {
    const recorder = new NaturalTraceRecorder(parameters)
    const read = () => 0
    for (const now of [0, 1 / 30, 2 / 30, 1, 1 + 1 / 60, 1 + 2 / 60])
      recorder.sample(now, read)

    expect(recorder.build(meta).t).toEqual([0, 1 / 30, 2 / 30, 1, 1 + 2 / 60])
  })

  it('builds the scorer CLI input shape', () => {
    const trace = record(60, 3)
    const report = scoreLiveliness(trace, trace.ranges)

    expect(report.metrics['sd:ParamAngleX'].value).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
  })

  it('stamps natural and scenario events on the sample origin without changing the score', () => {
    const recorder = new NaturalTraceRecorder(parameters)
    const scenario: ScenarioEvent = { kind: 'marker', at: 0.5, label: 'pulse' }
    for (let frame = 0; frame <= 60 * 3; frame++) {
      const now = 12.5 + frame / 60
      if (frame === 30) {
        recorder.mark(now, 'scenario', scenario)
        recorder.mark(now, 'natural', { kind: 'hold', at: 4, emotion: 'angry', strength: 0.9, side: 1 })
      }
      recorder.sample(now, index => index === 0 ? 10 * Math.sin(now) : 0.9)
    }
    scenario.label = 'changed after marking'
    const trace = recorder.build(meta)

    expect(trace.version).toBe(2)
    expect(trace.events).toEqual([
      { t: 0.5, source: 'scenario', event: { kind: 'marker', at: 0.5, label: 'pulse' } },
      { t: 0.5, source: 'natural', event: { kind: 'hold', at: 4, emotion: 'angry', strength: 0.9, side: 1 } },
    ])
    const withoutEvents: NaturalTrace = { ...trace, events: [] }
    expect(scoreLiveliness(trace, trace.ranges)).toEqual(scoreLiveliness(withoutEvents, trace.ranges))
  })

  it('starts the time origin at a mark that precedes every frame', () => {
    const recorder = new NaturalTraceRecorder(parameters)
    recorder.mark(10, 'scenario', { kind: 'marker', at: 0, label: 'start' })
    recorder.sample(10.25, () => 0)

    expect(recorder.build(meta).t).toEqual([0.25])
    expect(recorder.build(meta).events[0].t).toBe(0)
  })

  it('records extra rig parameters after the standard ones', () => {
    const rig = {
      ids: ['Param60', 'ParamAngleX', 'Unrelated'],
      minimumValues: new Float32Array([0, -30, 0]),
      maximumValues: new Float32Array([1, 30, 1]),
      defaultValues: new Float32Array([0, 0, 0]),
    }
    const recorder = new NaturalTraceRecorder(rig, { extraParameterIds: ['Param60', 'ParamAngleX', 'Missing'] })
    recorder.sample(0, index => index)
    const trace = recorder.build(meta)

    expect(Object.keys(trace.channels)).toEqual(['ParamAngleX', 'Param60'])
    expect(trace.channels.Param60).toEqual([0])
    expect(trace.ranges.Param60).toEqual({ min: 0, max: 1, default: 0 })
  })

  it('names downloads without characters Windows rejects', () => {
    expect(naturalTraceFileName({ capturedAt: '2026-10-17T12:00:00.000Z', model: 'Bear/Pajama V1.1' }))
      .toBe('natural-trace-2026-10-17T12-00-00.000Z-Bear-Pajama-V1.1.json')
  })
})
