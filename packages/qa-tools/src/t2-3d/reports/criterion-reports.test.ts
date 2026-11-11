import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'

import { fileURLToPath } from 'node:url'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { cueBodyReport } from './cue-body'
import { emotionTableReport } from './emotion-table'
import { ownershipReport } from './ownership'
import { popsReport } from './pops'
import { armWorld, gateStub, loadedRun, moves, rotX, summaryStub, trace } from './test-runs'
import { turnReport } from './turn'

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
let bands: Awaited<ReturnType<typeof loadBands>>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
})

const DEG = Math.PI / 180
const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const emotionGate = gateStub({ 'onset.attackFraction': { status: 'PASS' }, 'onset.easedOrAnticipated': { status: 'PASS' }, 'emotion.armShare': { status: 'PASS' } })

describe('emotion-table report (C002, plan 2.3)', () => {
  // Trials 12 s apart: happy and sad pitch the chest +/-10 degrees from +0.3 s, released by +8 s (or held past +11 s),
  // with 0.5 degree seeded trial noise; neutral and placebo do nothing but noise.
  function emotions(options: { amplitude?: number, release?: boolean } = {}) {
    const random = createRandomStream(3)
    const conditions = [...Array.from({ length: 3 }, () => ['happy', 'sad', 'neutral']).flat(), 'placebo', 'placebo', 'placebo', 'placebo', 'placebo']
    const trials = conditions.map((condition, i) => ({ condition, t: 2 + 12 * i, offset: (random() - 0.5) * DEG, head: (random() - 0.5) * DEG }))
    const events: MotionTraceEvent[] = trials.map((trial, i) => trial.condition === 'placebo'
      ? { t: trial.t, kind: 'emotion', emotion: 'neutral', band: 'clear', phase: 'placebo', trialId: `p${i}` }
      : { t: trial.t, kind: 'emotion', emotion: trial.condition, band: 'clear', phase: 'pulse', trialId: `e${i}` })
    const amplitude = options.amplitude ?? 10 * DEG
    const envelope = (u: number) => minJerk(u / 0.5) * (options.release === false ? 1 : 1 - minJerk((u - 6) / 2))
    const world = (bone: MotionTraceBone, t: number): Quat => {
      const trial = trials.find(x => t >= x.t && t < x.t + 12)
      if (!trial || !['chest', 'head'].includes(bone))
        return [0, 0, 0, 1]
      const sign = trial.condition === 'happy' ? 1 : trial.condition === 'sad' ? -1 : 0
      const w = envelope(t - trial.t)
      return rotX(w * (bone === 'chest' ? sign * amplitude + trial.offset : trial.head))
    }
    return loadedRun(trace({ seconds: 2 + 12 * trials.length, scenario: 'emotion', events, world }), null, emotionGate)
  }

  it('passes postures 2 SD apart with neutral-placebo printed but not required', () => {
    const report = emotionTableReport([emotions()], bands)
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.detail.separation['neutral|placebo']).toBeLessThan(2)
  })

  it('fails a posture still held outside the placebo band in the release window', () => {
    const report = emotionTableReport([emotions({ release: false })], bands)
    expect(report.requirements.find(r => r.id === 'release')?.pass).toBe(false)
  })

  it('fails the vacuous case in which no emotion has a posture', () => {
    const report = emotionTableReport([emotions({ amplitude: 0 })], bands)
    expect(report.verdict).toBe('FAIL')
    expect(report.requirements.find(r => r.id === 'not-vacuous')?.pass).toBe(false)
  })
})

describe('cue-body report (C002, plan 2.3)', () => {
  // Six events of each cue kind, 5 s apart; the moving bone oscillates 3 degrees at 4 Hz for the cue's duration.
  function cues(bone: MotionTraceBone | null) {
    const kinds = ['nod', 'shake', 'shrug', 'lean', 'glance'] as const
    const seconds = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
    const list = kinds.flatMap((kind, k) => Array.from({ length: 6 }, (_, i) => ({ kind, t: 2 + 5 * (k * 6 + i) })))
    const events: MotionTraceEvent[] = list.map(cue => ({ t: cue.t, kind: 'gesture', gesture: cue.kind }))
    const world = (b: MotionTraceBone, t: number): Quat => {
      const cue = list.find(x => t >= x.t && t < x.t + seconds[x.kind])
      return cue && b === bone ? rotX(3 * DEG * Math.sin(2 * Math.PI * 4 * (t - cue.t))) : [0, 0, 0, 1]
    }
    return loadedRun(trace({ seconds: 4 + 5 * list.length, scenario: 'emotion', events, world }), null, null)
  }

  it('passes cues that move the chest', () => {
    expect(cueBodyReport([cues('chest')], bands).verdict).toBe('PASS')
  })

  // Plan 2.3 as written cannot fail a still body: the bands-v2 shoulder emotion floor is 0, so a still shoulder meets
  // `0 >= 3 x 0` and `0 >= 2 x 0`. Kept as written until the owner decides; these cases pin today's verdict.
  it.each([['head-only', 'head'], ['still', null]] as const)('counts a still zero-floor shoulder as moving for %s cues (plan defect)', (_, bone) => {
    const report = cueBodyReport([cues(bone)], bands)
    expect(report.verdict).toBe('PASS')
    expect(report.detail.events.every(e => e.moved.every(b => b === 'leftShoulder' || b === 'rightShoulder'))).toBe(true)
  })
})

describe('ownership report (C004, plan 2.5)', () => {
  // The gesture-under-clip layout: claim 3 s, full 3.3 to 14 s, release 14 s, poke 12.05 s, peaks every 1.5 s from
  // 1 s. The left arm strokes on each peak; `stale` adds one right stroke at 14.8 s, 300 ms from a peak.
  function clip(options: { left?: boolean, stale?: boolean, deviation?: number } = {}) {
    const peaks = Array.from({ length: 18 }, (_, i) => 1 + 1.5 * i)
    const events: MotionTraceEvent[] = [
      ...peaks.map(t => ({ t, kind: 'emphasis', strength: 0.8, source: 'scenario' }) as const),
      { t: 3, kind: 'marker', label: 'clip-claim' },
      { t: 12.05, kind: 'touch', touch: 'poke', region: 'body' },
      { t: 14, kind: 'marker', label: 'clip-release' },
    ]
    const strokes = (ends: readonly number[]) => moves(ends.flatMap(end => [{ start: end - 0.15, duration: 0.15, by: 0.1 }, { start: end, duration: 0.3, by: 0.002 }, { start: end + 0.4, duration: 0.3, by: -0.102 }]))
    const input = trace({ seconds: 30, scenario: 'talk', events, world: armWorld({ upper: options.left === false ? undefined : strokes(peaks) }, { upper: options.stale ? strokes([14.8]) : undefined }) })
    const base = summaryStub(input)
    const owned = (k: number) => k / 60 >= 3.3 && k / 60 < 14 ? 1 : k / 60 >= 3 && k / 60 < 14.3 ? 0.5 : 0
    const summary = {
      ...base,
      owned: { ...base.owned, perFrame: base.owned.perFrame.map((row, k) => row.map((v, g) => base.owned.groups[g] === 'rightArm' || base.owned.groups[g] === 'rightFingers' ? owned(k) : v)) },
      ownership: {
        ...base.ownership,
        deviationRad: base.ownership.deviationRad.map((row, k) => row.map((v, g) => base.ownership.groups[g] === 'rightArm' && owned(k) === 1 ? options.deviation ?? 0 : v)),
        armDeg: { left: base.ownership.deviationRad.map(() => Array.from<number>({ length: 9 }).fill(0)), right: base.ownership.deviationRad.map(() => Array.from<number>({ length: 9 }).fill(0)) },
        restArmDeg: { left: Array.from<number>({ length: 9 }).fill(0), right: Array.from<number>({ length: 9 }).fill(0) },
      },
      clip: { bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'], expected: base.perFrame.t_ms.map((_, k) => owned(k) > 0 ? [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] : null) },
    }
    const gate = gateStub({ 'smooth.armL.spikeRate': { status: 'PASS', value: 0 }, 'smooth.armR.spikeRate': { status: 'PASS', value: 0 } })
    return loadedRun(input, summary, gate)
  }

  it('passes an owned right arm left untouched while the left arm gestures and resumes after the poke', () => {
    const report = ownershipReport(clip(), bands)
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
  })

  it('fails a write deviation of 0.002 rad on a fully owned arm', () => {
    expect(ownershipReport(clip({ deviation: 0.002 }), bands).requirements.find(r => r.id === 'owned-arm-untouched')?.pass).toBe(false)
  })

  it('fails a stale right-arm stroke after the release', () => {
    expect(ownershipReport(clip({ stale: true }), bands).requirements.find(r => r.id === 'no-stale-stroke')?.pass).toBe(false)
  })

  it('fails the vacuous case in which no arm gestures', () => {
    const report = ownershipReport(clip({ left: false }), bands)
    expect(report.requirements.find(r => r.id === 'left-arm-gestures')?.pass).toBe(false)
    expect(report.requirements.find(r => r.id === 'resume-after-cancel')?.pass).toBe(false)
  })
})

describe('turn report (C003, plan 2.4)', () => {
  // Speech from 10 to 30 s with a right-arm stroke at 15 s; a happy hold starts at 20 s and the chest pitches 8 degrees.
  function turn(moving: boolean) {
    const events: MotionTraceEvent[] = [{ t: 20, kind: 'emotion', emotion: 'happy', band: 'clear', phase: 'hold-start' }]
    const extra = (bone: MotionTraceBone, t: number): Quat | null => bone === 'chest' && moving ? rotX(8 * DEG * minJerk((t - 20.3) / 0.6)) : null
    const input = trace({ seconds: 30, scenario: 'talk', events, speaking: t => t >= 10 ? 1 : 0, world: armWorld({}, { upper: moving ? moves([{ start: 14.85, duration: 0.15, by: 0.1 }, { start: 15, duration: 0.3, by: 0.002 }]) : undefined }, extra) })
    return loadedRun(input, null, gateStub({}, 'PASS'))
  }

  it('passes a stroke in speech and a posture change after the cue', () => {
    expect(turnReport(turn(true)).requirements.filter(r => !r.pass)).toEqual([])
  })

  it('fails the vacuous case in which nothing moves', () => {
    const report = turnReport(turn(false))
    expect(report.requirements.find(r => r.id === 'stroke-in-speech')?.pass).toBe(false)
    expect(report.requirements.find(r => r.id === 'posture-after-cue')?.pass).toBe(false)
  })
})

describe('pops report (plan 2.6)', () => {
  it('passes smooth strokes and the still case, and fails a one-frame arm step', () => {
    const smooth = trace({ seconds: 3, scenario: 'talk', world: armWorld({ upper: moves([{ start: 1, duration: 0.2, by: 0.2 }]) }, {}) })
    expect(popsReport(loadedRun(smooth, null, null)).verdict).toBe('PASS')
    expect(popsReport(loadedRun(trace({ seconds: 3, scenario: 'talk' }), null, null)).verdict).toBe('PASS')
    const step = trace({ seconds: 3, scenario: 'talk', world: armWorld({}, { elbow: t => t >= 1.5 ? 2.3 * DEG : 0 }) })
    expect(popsReport(loadedRun(step, null, null)).detail.arm).toMatchObject([{ bone: 'rightLowerArm', kind: 'position-step' }])
  })
})
