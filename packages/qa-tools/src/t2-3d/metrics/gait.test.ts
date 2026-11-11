import type { Vec3 } from './types'

import { describe, expect, it } from 'vitest'

import { gaitMetrics, jointPositions } from './gait'
import { DEG, multiply } from './math'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX, angleY } from './test-trace'

describe('kinematic gait measurements', () => {
  it('derives foot extrema, pitch and signed arm lag from a synthetic walk', () => {
    const bones = ['hips', 'chest', 'head', 'leftUpperArm', 'leftLowerArm', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'] as const
    const raw = analyticTrace({
      seconds: 25,
      bones,
      scenario: 'walk',
      position: t => [0, 0, 0.4 * t],
      yaw: t => 0.1 * Math.sin(2 * Math.PI * t),
      world: (b, t) => {
        const sine = Math.sin(2 * Math.PI * t)
        const yaw = 0.1 * sine
        if (b === 'hips' || b === 'head')
          return angleY(yaw)
        if (b === 'chest')
          return angleY(-yaw)
        if (b === 'leftUpperArm')
          return multiply(angleY(-yaw), angleX(0.4 * sine))
        if (b === 'leftLowerArm')
          return multiply(angleY(-yaw), angleX(0.4 * sine + 0.2 * Math.sin(2 * Math.PI * (t - 0.1))))
        if (b === 'leftFoot')
          return multiply(angleY(yaw), angleX(0.2 * sine))
        return multiply(angleY(yaw), angleX(0.4 * sine))
      },
    })
    const p = prepareTrace({ ...raw, trace: { ...raw.trace, rig: { ...raw.trace.rig, restOffsets: bones.map(b => b === 'leftLowerLeg' || b === 'leftFoot' ? [0, -0.5, 0] : [0, 0, 0]) } } })
    const m = gaitMetrics(p)
    expect(m.find(m => m.id === 'gait.heelStrikePitchDeg')?.value).toBeCloseTo(0.2 * DEG, 1)
    expect(m.find(m => m.id === 'gait.toeOffPitchDeg')?.value).toBeCloseTo(-0.2 * DEG, 1)
    expect(m.find(m => m.id === 'gait.chestCounter')?.value).toBeLessThan(-0.9)
    expect(m.find(m => m.id === 'gait.armSwingLagMs')?.value).toBeGreaterThan(80)
    expect(m.find(m => m.id === 'gait.armSwingLagMs')?.value).toBeLessThan(120)
    expect(m.find(m => m.id === 'gait.pelvisTwistDeg')?.value).toBeGreaterThan(5)
    expect(m.find(m => m.id === 'gait.headLeadMs')?.status).toBe('skipped: insufficient-turns')
  })

  it('applies parent world orientation to trace-axis bind offsets in forward kinematics', () => {
    const raw = analyticTrace({ seconds: 1, bones: ['hips', 'leftFoot'], world: () => angleY(Math.PI / 2) })
    const p = prepareTrace({ ...raw, trace: { ...raw.trace, rig: { ...raw.trace.rig, restOffsets: [[0, 0, 0], [0, 0, 1]] } } })
    const foot = jointPositions(p).leftFoot?.[0]
    expect(foot?.[0]).toBeCloseTo(1, 6)
    expect(foot?.[2]).toBeCloseTo(0, 6)
  })

  it('retains signed head lead values for ten synthetic turn episodes', () => {
    const p = prepareTrace(analyticTrace({ seconds: 42, bones: ['hips', 'head'], scenario: 'walk' }))
    const pulse = (t: number) => Array.from({ length: 10 }, (_, i) => 2 + 4 * i).reduce((s, e) => s + Math.exp(-(((t - e) / 0.15) ** 2)), 0)
    const yawRate = p.yawRate.map((_, i) => pulse(i / 60))
    const head: Vec3[] = yawRate.map((v, i) => [0, v + pulse(i / 60 + 0.2), 0])
    const m = gaitMetrics({ ...p, yawRate, worldVelocity: { ...p.worldVelocity, head } }).find(m => m.id === 'gait.headLeadMs')
    expect(m?.samples.length).toBe(10)
    expect(m?.value).toBeCloseTo(200, 6)
  })
})
