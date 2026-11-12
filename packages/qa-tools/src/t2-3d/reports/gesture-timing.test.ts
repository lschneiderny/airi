import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'
import type { FormFeatures } from './gesture-timing'

import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { multiply } from '../metrics/math'
import { formsDiffer, gestureTimingReport, largestDistinctSet } from './gesture-timing'
import { ReportUsageError } from './report'
import { armWorld, gateStub, loadedRun, moves, rotY, summaryStub, trace } from './test-runs'

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
let bands: Awaited<ReturnType<typeof loadBands>>
let calmIdle: ReturnType<typeof companions>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
  calmIdle = companions()
})

const FORMS = ['beat', 'palm-up', 'press', 'chop'] as const
const IDLE = 50
/** Talk metrics gate version 3 keeps gated; the bilateral metrics are report-only there. */
const TALK_GATED = ['smooth.head.ldlj', 'onset.attackFraction', 'onset.easedOrAnticipated', 'gesture.strokeP', 'gesture.strokeLagMs', 'coverage.fingers', 'fingers.frozen'] as const
/** Bones the upper torso carries in the synthetic rig. */
const ABOVE_TORSO = new Set(['neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'])

/** Every `spacing` s from 3 s, a 0.2 s upper-torso yaw of `degrees`, alternating in sign, that carries the arms. */
function trunkSway(degrees: number, count: number, spacing = 2) {
  return moves(Array.from({ length: count }, (_, i) => ({ start: 3 + spacing * i, duration: 0.2, by: (i % 2 ? -1 : 1) * degrees * Math.PI / 180 })))
}

/**
 * A synthetic speaker on the left arm: three 8 s utterances, each one unit of four strokes, one stroke apex on each
 * labelled peak (shifted by `apexOffset`), each form at its own forearm twist, and preparations whose upper arm, elbow
 * and hand twist start 0, 60 and 120 ms apart (`order` reverses that). With each stroke the upper torso turns 2 deg
 * against the hips, as plan 3.1's torso participation (`torso: false` drops it); `silent` leaves one utterance's unit out.
 * `silentTrunk` turns the upper torso by that many degrees in the silent lead, every `silentSpacing` s from 3 s to 43 s;
 * `earlyMove` adds an arm movement without a trunk turn whose apex lands 50 ms before each peak, nearer the peak than
 * the stroke's own apex.
 */
function speaker(options: { apexOffset?: number, order?: 'proximal' | 'distal', markerOffset?: number, still?: boolean, torso?: boolean, silent?: number, idleSway?: number, strokeSeconds?: number, strokeSize?: number, silentTrunk?: number, silentSpacing?: number, earlyMove?: boolean } = {}) {
  const events: MotionTraceEvent[] = []
  const upper: { start: number, duration: number, by: number }[] = []
  const elbow: { start: number, duration: number, by: number }[] = []
  const twist: { start: number, duration: number, by: number }[] = []
  const torso: { start: number, duration: number, by: number }[] = []
  const lag = options.order === 'distal' ? [0.12, 0.06, 0] : [0, 0.06, 0.12]
  let form = 0
  let twistNow = 0
  // A silent lead of idle sway: slow 0.03 rad swings, 2 s apart, each with an apex, so the run has its own idle speed bar.
  for (let i = 0; i < (options.idleSway ?? 25); i++)
    upper.push({ start: 2 + 2 * i, duration: 0.4, by: (i % 2 ? -1 : 1) * 0.03 })
  for (let unit = 0; unit < 3; unit++) {
    const begin = IDLE + 1 + unit * 9
    events.push({ t: begin, kind: 'marker', label: 'voice-start' }, { t: begin + 8, kind: 'marker', label: 'voice-end' })
    if (unit === options.silent) {
      for (let k = 0; k < 4; k++)
        events.push({ t: begin + 1.5 + 1.5 * k, kind: 'emphasis', strength: 0.8, source: 'scenario' })
      continue
    }
    events.push({ t: begin, kind: 'marker', label: 'gesture-unit:start' })
    upper.push({ start: begin + lag[0], duration: 0.4, by: 0.3 }, { start: begin + 7.5, duration: 0.5, by: -0.3 })
    elbow.push({ start: begin + lag[1], duration: 0.4, by: 0.3 }, { start: begin + 7.5, duration: 0.5, by: -0.3 })
    twist.push({ start: begin + lag[2], duration: 0.4, by: 0.3 })
    twistNow += 0.3
    for (let k = 0; k < 4; k++) {
      const peak = begin + 1.5 + 1.5 * k
      const end = peak + (options.apexOffset ?? 0)
      const target = [0, 30, 60, 90][form] * Math.PI / 180 + 0.3
      const stroke = options.strokeSeconds ?? 0.15
      const size = options.strokeSize ?? 0.1
      upper.push({ start: end - stroke, duration: stroke, by: size }, { start: end, duration: 0.3, by: 0.002 }, { start: end + 0.5, duration: 0.3, by: -size - 0.002 })
      if (options.earlyMove)
        upper.push({ start: peak - 0.15, duration: 0.1, by: 0.05 }, { start: end + 0.5, duration: 0.3, by: -0.05 })
      twist.push({ start: end - 0.15, duration: 0.15, by: target - twistNow })
      twistNow = target
      torso.push({ start: end - 0.15, duration: 0.15, by: 2 * Math.PI / 180 }, { start: end + 0.5, duration: 0.3, by: -2 * Math.PI / 180 })
      events.push({ t: peak, kind: 'emphasis', strength: 0.8, source: 'scenario' })
      events.push({ t: end + (options.markerOffset ?? 0), kind: 'marker', label: `gesture-stroke:${FORMS[form]}:left:${unit + 1}` })
      form = (form + 1) % FORMS.length
    }
    events.push({ t: begin + 8, kind: 'marker', label: 'gesture-unit:end' })
  }
  const input = trace({
    seconds: IDLE + 29,
    scenario: 'talk',
    events,
    world: options.still ? undefined : withTrunk(armWorld({ upper: moves(upper), elbow: moves(elbow), twist: moves(twist) }, {}, (bone, t) => bone === 'upperChest' && options.torso !== false ? rotY(moves(torso)(t)) : null), trunkSway(options.silentTrunk ?? 0, Math.floor(40 / (options.silentSpacing ?? 2)), options.silentSpacing)),
  })
  const passing = Object.fromEntries(TALK_GATED.map(id => [id, { status: 'PASS' as const }]))
  const reportOnly = Object.fromEntries(['bilateral.upperArm.peakCorr', 'coverage.arms', 'smooth.armL.ldlj', 'smooth.armR.ldlj'].map(id => [id, { status: 'REPORT' as const, value: id.includes('ldlj') ? -8 : 0.5, gated: false }]))
  const gate = gateStub({ ...passing, ...reportOnly })
  return { input, gate }
}

/** Adds an upper-torso yaw that carries the bones above it, so the hand path in the torso frame does not change. */
function withTrunk(world: (bone: MotionTraceBone, t: number) => Quat, yaw: (t: number) => number) {
  return (bone: MotionTraceBone, t: number): Quat => bone === 'upperChest' || ABOVE_TORSO.has(bone) ? multiply(rotY(yaw(t)), world(bone, t)) : world(bone, t)
}

interface IdleOptions { swings?: number, seconds?: number, scenario?: string, gitSha?: string, assetSha256?: string, trunkDegrees?: number }

/**
 * A companion idle run of the same synthetic rig (scenario `idle`, 120 s scored unless stated): slow 0.03 rad upper-arm
 * swings 2 s apart, each with an apex, and `trunkDegrees` of upper-torso turns every 2 s from 3 s to 119 s.
 */
function idleRun(seed: number, options: IdleOptions = {}) {
  const swings = options.swings ?? 25
  const sway = Array.from({ length: swings }, (_, i) => ({ start: 2 + 2 * i, duration: 0.4, by: (i % 2 ? -1 : 1) * 0.03 }))
  const input = trace({ seconds: options.seconds ?? 120, scenario: 'talk', world: withTrunk(armWorld({ upper: moves(sway) }, {}), trunkSway(options.trunkDegrees ?? 0, 59)) })
  const { rig, source } = input.trace
  const changed = { ...input, trace: { ...input.trace, rig: { ...rig, assetSha256: options.assetSha256 ?? rig.assetSha256 }, source: { ...source, scenario: { id: options.scenario ?? 'idle', class: 'idle' as const, seed }, gitSha: options.gitSha ?? source.gitSha } } }
  return loadedRun(changed, null, null, `idle-companion-${seed}`)
}

/** The companion set the report accepts: idle seeds 1, 2 and 3; `last` changes only the seed-3 run. */
function companions(options: IdleOptions = {}, last: IdleOptions = {}) {
  return [idleRun(1, options), idleRun(2, options), idleRun(3, { ...options, ...last })]
}

describe('gesture-timing report (C001, plan 2.2)', () => {
  it('passes a speaker whose apexes hit the peaks with four forms, ordered preparations and clean summaries', () => {
    const { input, gate } = speaker()
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.verdict).toBe('PASS')
  })

  it('fails the vacuous case in which nothing moves', () => {
    const { input, gate } = speaker({ still: true })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.verdict).toBe('FAIL')
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(false)
  })

  it.each([[0.19, true], [-0.19, true], [0.25, false]] as const)('counts an apex %s s from its peak as a hit: %s', (offset, hit) => {
    const { input, gate } = speaker({ apexOffset: offset })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(hit)
  })

  it('fails markers that no kinematic apex confirms within 50 ms', () => {
    const { input, gate } = speaker({ markerOffset: 0.1 })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'markers-confirmed')?.pass).toBe(false)
  })

  it('fails reversed preparation order', () => {
    const { input, gate } = speaker({ order: 'distal' })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'preparation-order')?.pass).toBe(false)
  })

  it.each([
    ['19 pooled idle apexes', () => [idleRun(1, { swings: 7 }), idleRun(2, { swings: 6 }), idleRun(3, { swings: 6 })]],
    ['a companion of another model', () => companions({}, { assetSha256: 'other-model' })],
    ['a companion at another commit', () => companions({}, { gitSha: 'f'.repeat(40) })],
  ] as const)('refuses %s', (_, idle) => {
    const { input, gate } = speaker()
    expect(() => gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, idle())).toThrow(ReportUsageError)
  })

  it.each([
    ['idle seeds 1 and 2 only', () => [idleRun(1), idleRun(2)]],
    ['idle seed 2 twice', () => [idleRun(1), idleRun(2), idleRun(2)]],
    ['idle runs of 60 s scored', () => companions({ seconds: 60 })],
    ['a companion of another scenario', () => companions({}, { scenario: 'speak' })],
  ] as const)('refuses a trunk bar from %s: only idle seeds 1, 2 and 3 of 120 s scored (revision 2)', (_, idle) => {
    const { input, gate } = speaker()
    expect(() => gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, idle())).toThrow(ReportUsageError)
  })

  it('does not count strokes slower than the run\'s own idle sway (unit M3 item 1)', () => {
    const { input, gate } = speaker({ strokeSeconds: 0.4, strokeSize: 0.02, torso: false })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.value).toMatch(/^0\/12/)
    expect(report.requirements.find(r => r.id === 'utterances')?.pass).toBe(false)
  })

  it('fails an utterance without a stroke (R2 a)', () => {
    const { input, gate } = speaker({ silent: 1 })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'utterances')).toMatchObject({ pass: false, value: '2/3' })
  })

  it('fails strokes without upper-torso participation against the placebo windows (R2 b)', () => {
    const { input, gate } = speaker({ torso: false })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'trunk-participation')?.pass).toBe(false)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(true)
  })

  it('sets the trunk bar from the companion idle runs\' trunk turns, not from the speak run\'s silent stretches (lane T)', () => {
    const { input, gate } = speaker({ silentTrunk: 6 })
    const run = loadedRun(input, summaryStub(input), gate)
    const line = (idle: ReturnType<typeof companions>) => gestureTimingReport(run, bands, idle).requirements.filter(r => r.id === 'peaks-hit' || r.id === 'trunk-participation').map(r => r.pass)
    expect(line(calmIdle)).toEqual([true, true])
    expect(line(companions({ trunkDegrees: 6 }))).toEqual([true, false])
  })

  it('fails a run whose own peak-free trunk turns exceed the idle bar on more than the locking share (revision 2)', () => {
    const line = (silentSpacing: number) => {
      const { input, gate } = speaker({ silentTrunk: 6, silentSpacing })
      const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
      return report.requirements.filter(r => r.id === 'peaks-hit' || r.id === 'trunk-participation').map(r => r.pass)
    }
    expect(line(2)).toEqual([true, true])
    expect(line(0.5)).toEqual([true, false])
  })

  it('judges the trunk over the stroke whose apex confirms its marker, not over a nearer apex (lane T)', () => {
    const { input, gate } = speaker({ apexOffset: 0.15, earlyMove: true })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(true)
    expect(report.requirements.find(r => r.id === 'trunk-participation')?.pass).toBe(true)
  })

  it('counts a hit peak whose stroke marker no apex confirms as a trunk miss (lane T)', () => {
    const { input, gate } = speaker({ markerOffset: 0.1 })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(true)
    expect(report.requirements.find(r => r.id === 'trunk-participation')).toMatchObject({ pass: false, value: expect.stringMatching(/^0\/12;/) })
  })

  it('fails a gated talk FAIL whatever its id, and ignores report-only values', () => {
    const { input, gate } = speaker()
    const failing = { ...gate, metrics: gate.metrics.map(m => m.id === 'coverage.fingers' ? { ...m, status: 'FAIL' as const } : m.id === 'coverage.arms' ? { ...m, status: 'FAIL' as const } : m) }
    expect(gestureTimingReport(loadedRun(input, summaryStub(input), failing), bands, calmIdle).requirements.find(r => r.id === 'gate-talk')?.pass).toBe(false)
    const reportOnlyFail = { ...gate, metrics: gate.metrics.map(m => m.id === 'coverage.arms' ? { ...m, status: 'FAIL' as const } : m) }
    expect(gestureTimingReport(loadedRun(input, summaryStub(input), reportOnlyFail), bands, calmIdle).requirements.find(r => r.id === 'gate-talk')?.pass).toBe(true)
  })

  it('fails mirrored arms through the gated bilateral metrics', () => {
    const { input, gate } = speaker()
    const mirrored = { ...gate, metrics: gate.metrics.map(m => m.id.startsWith('bilateral.') ? { ...m, status: 'FAIL' as const, band: m.band && { ...m.band, status: 'GATED' as const } } : m) }
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), mirrored), bands, calmIdle)
    expect(report.requirements.find(r => r.id === 'bilateral')?.pass).toBe(false)
  })

  it('counts forms as distinct only when a median apex feature differs by 10 degrees', () => {
    const at = (pronationDeg: number): FormFeatures => ({ pronationDeg, wristFlexDeg: 0, indexCurlDeg: 0, direction: [0, -1, 0] })
    expect(formsDiffer(at(0), at(9.9))).toBe(false)
    expect(largestDistinctSet({ a: at(0), b: at(9), c: at(30), d: at(60) })).toHaveLength(3)
    expect(largestDistinctSet({ a: at(0), b: at(10), c: at(30), d: at(60) })).toHaveLength(4)
  })
})
