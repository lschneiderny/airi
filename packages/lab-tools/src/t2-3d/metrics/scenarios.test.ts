import type { Vec3 } from './types'

import { describe, expect, it } from 'vitest'

import { gazeMetrics } from './gaze'
import { idleMetrics } from './idle'
import { onsetMetrics } from './onset'
import { prepareTrace } from './prepare'
import { smoothMetrics } from './smooth'
import { analyticTrace, angleX, detectors } from './test-trace'

const bones = ['hips', 'chest', 'neck', 'head'] as const
const times = Array.from({ length: 10 }, (_, i) => 2 + 4 * i)
const turn = (t: number, delay = 0) => times.reduce((s, e) => s + 0.3 * Math.tanh((t - e - delay) / 0.15), 0)
function turns() {
  return prepareTrace(analyticTrace({
    seconds: 42,
    bones,
    scenario: 'gaze',
    world: (b, t) => angleX(b === 'head' ? turn(t) : b === 'chest' || b === 'neck' ? 0.25 * turn(t, 0.12) : 0),
  }))
}

describe('kinematic episode metrics', () => {
  it('detects head turns without gaze events and reports chest following the head', () => {
    const m = gazeMetrics(turns(), detectors(bones))
    const lag = m.find(m => m.id === 'gaze.chestLagMs')
    expect(lag?.samples.length).toBe(10)
    expect(lag?.value).toBeGreaterThan(50)
    expect(m.find(m => m.id === 'gaze.orderRate')?.value).toBe(1)
    expect(m.find(m => m.id === 'gaze.eyeLeadMs')?.status).toBe('skipped: eye-bones-absent')
    expect(m.find(m => m.id === 'gaze.overshootPct')?.value).toBeCloseTo(0, 2)
    expect(m.find(m => m.id === 'gaze.settleMs')?.value).toBeGreaterThan(0)
  })

  it('excludes gaze amplitudes outside the supplied range and lists their amplitudes', () => {
    const m = gazeMetrics(turns(), { ...detectors(bones), acceptedHeadRotationDeg: [1, 5] })
    const lag = m.find(m => m.id === 'gaze.chestLagMs')
    expect(lag?.samples).toEqual([])
    expect(lag?.status).toBe('skipped: insufficient-episodes')
    expect(lag?.detail).toContain('outside accepted head rotation')
    expect(lag?.detail.match(/deg/g)?.length).toBe(10)
  })

  it('reports positive eye lead when eye turns precede the head turns', () => {
    const rig = [...bones, 'leftEye', 'rightEye'] as const
    const p = prepareTrace(analyticTrace({
      seconds: 42,
      bones: rig,
      scenario: 'gaze',
      world: (b, t) => angleX(b === 'head' ? turn(t) : b === 'leftEye' || b === 'rightEye' ? turn(t) + 0.3 * turn(t, -0.15) : b === 'chest' || b === 'neck' ? 0.25 * turn(t, 0.12) : 0),
    }))
    const m = gazeMetrics(p, detectors(rig))
    expect(m.find(m => m.id === 'gaze.eyeLeadMs')?.samples.length).toBe(10)
    expect(m.find(m => m.id === 'gaze.eyeLeadMs')?.value).toBeGreaterThan(100)
  })

  it('retains per-episode attack and eased indicators for smooth turns', () => {
    const m = onsetMetrics(turns(), detectors(bones))
    const attack = m.find(m => m.id === 'onset.attackFraction')
    expect(attack?.samples.length).toBe(10)
    expect(attack?.value).toBeGreaterThan(0.3)
    expect(attack?.value).toBeLessThan(0.7)
    expect(m.find(m => m.id === 'onset.easedOrAnticipated')?.value).toBe(1)
    expect(m.find(m => m.id === 'onset.anticipationRate')?.value).toBe(0)
  })

  it('counts idle head acts by net rotation and keeps regional entropy at zero', () => {
    const p = prepareTrace(analyticTrace({ seconds: 42, bones, world: (b, t) => angleX(b === 'head' ? turn(t) : 0) }))
    const m = idleMetrics(p, detectors(bones))
    expect(m.find(m => m.id === 'idle.actsPerMin')?.value).toBeCloseTo(10 * 60 / 42, 8)
    expect(m.find(m => m.id === 'idle.regionEntropy')?.value).toBeCloseTo(0, 12)
    expect(m.find(m => m.id === 'idle.intervalCv')?.value).toBeLessThan(0.01)
  })

  it('detects opposing motion before an episode as anticipation', () => {
    const p = turns()
    const vector: Vec3[] = p.bodySpeed.map((_, i) => {
      const t = i / 60
      const value = times.reduce((s, e) => s + 2 * Math.exp(-(((t - e) / 0.12) ** 2)) - 0.2 * Math.exp(-(((t - e + 0.38) / 0.06) ** 2)), 0)
      return [value, 0, 0]
    })
    const m = onsetMetrics({ ...p, o15: { ...p.o15, head: vector, neck: vector.map(() => [0, 0, 0]) } }, { ...detectors(bones), moveSpeed: { ...detectors(bones).moveSpeed, head: 0.2 } })
    expect(m.find(m => m.id === 'onset.anticipationRate')?.value).toBe(1)
  })

  it('retains finite smoothness samples and measures spikes per moving minute', () => {
    const m = smoothMetrics(turns(), detectors(bones))
    const ldlj = m.find(m => m.id === 'smooth.head.ldlj')
    expect(ldlj?.samples.length).toBe(10)
    expect(ldlj?.value).toBeLessThan(-1)
    expect(ldlj?.value).toBeGreaterThan(-20)
    expect(m.find(m => m.id === 'smooth.head.spikeRate')?.value).toBe(0)
  })

  it('uses moving time rather than total clip time to normalise velocity spikes', () => {
    function popped(seconds: number) {
      const p = prepareTrace(analyticTrace({ seconds, bones }))
      const head: Vec3[] = p.bodySpeed.map((_, i) => [i < 300 ? 1 : i < 600 ? 2 : 0, 0, 0])
      return smoothMetrics({
        ...p,
        worldVelocity: { ...p.worldVelocity, head },
        regionSpeed: { ...p.regionSpeed, head: p.bodySpeed.map((_, i) => i < 600 ? 1 : 0) },
      }, detectors(bones)).find(m => m.id === 'smooth.head.spikeRate')?.value
    }
    const short = popped(20)
    expect(short).toBeGreaterThan(0)
    expect(popped(40)).toBe(short)
  })
})
