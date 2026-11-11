import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { FormFeatures } from './gesture-timing'

import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { formsDiffer, gestureTimingReport, largestDistinctSet } from './gesture-timing'
import { ReportUsageError } from './report'
import { armWorld, gateStub, loadedRun, moves, rotY, summaryStub, trace } from './test-runs'

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
let bands: Awaited<ReturnType<typeof loadBands>>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
})

const FORMS = ['beat', 'palm-up', 'press', 'chop'] as const
const IDLE = 50
/** Talk metrics gate version 3 keeps gated; the bilateral metrics are report-only there. */
const TALK_GATED = ['smooth.head.ldlj', 'onset.attackFraction', 'onset.easedOrAnticipated', 'gesture.strokeP', 'gesture.strokeLagMs', 'coverage.fingers', 'fingers.frozen'] as const

/**
 * A synthetic speaker on the left arm: three 8 s utterances, each one unit of four strokes, one stroke apex on each
 * labelled peak (shifted by `apexOffset`), each form at its own forearm twist, and preparations whose upper arm, elbow
 * and hand twist start 0, 60 and 120 ms apart (`order` reverses that). With each stroke the upper torso turns 2 deg
 * against the hips, as plan 3.1's torso participation (`torso: false` drops it); `silent` leaves one utterance's unit out.
 */
function speaker(options: { apexOffset?: number, order?: 'proximal' | 'distal', markerOffset?: number, still?: boolean, torso?: boolean, silent?: number, idleSway?: number, strokeSeconds?: number, strokeSize?: number } = {}) {
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
    world: options.still ? undefined : armWorld({ upper: moves(upper), elbow: moves(elbow), twist: moves(twist) }, {}, (bone, t) => bone === 'upperChest' && options.torso !== false ? rotY(moves(torso)(t)) : null),
  })
  const passing = Object.fromEntries(TALK_GATED.map(id => [id, { status: 'PASS' as const }]))
  const reportOnly = Object.fromEntries(['bilateral.upperArm.peakCorr', 'coverage.arms', 'smooth.armL.ldlj', 'smooth.armR.ldlj'].map(id => [id, { status: 'REPORT' as const, value: id.includes('ldlj') ? -8 : 0.5, gated: false }]))
  const gate = gateStub({ ...passing, ...reportOnly })
  return { input, gate }
}

describe('gesture-timing report (C001, plan 2.2)', () => {
  it('passes a speaker whose apexes hit the peaks with four forms, ordered preparations and clean summaries', () => {
    const { input, gate } = speaker()
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.verdict).toBe('PASS')
  })

  it('refuses the vacuous case in which nothing moves: no idle, no speed bar, never a pass', () => {
    const { input, gate } = speaker({ still: true })
    expect(() => gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)).toThrow(ReportUsageError)
  })

  it.each([[0.19, true], [-0.19, true], [0.25, false]] as const)('counts an apex %s s from its peak as a hit: %s', (offset, hit) => {
    const { input, gate } = speaker({ apexOffset: offset })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(hit)
  })

  it('fails markers that no kinematic apex confirms within 50 ms', () => {
    const { input, gate } = speaker({ markerOffset: 0.1 })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'markers-confirmed')?.pass).toBe(false)
  })

  it('fails reversed preparation order', () => {
    const { input, gate } = speaker({ order: 'distal' })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'preparation-order')?.pass).toBe(false)
  })

  it('refuses a run whose silent spans hold fewer than 20 idle apexes', () => {
    const { input, gate } = speaker({ idleSway: 19 })
    expect(() => gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)).toThrow(ReportUsageError)
  })

  it('does not count strokes slower than the run\'s own idle sway (unit M3 item 1)', () => {
    const { input, gate } = speaker({ strokeSeconds: 0.4, strokeSize: 0.02, torso: false })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.value).toMatch(/^0\/12/)
    expect(report.requirements.find(r => r.id === 'utterances')?.pass).toBe(false)
  })

  it('fails an utterance without a stroke (R2 a)', () => {
    const { input, gate } = speaker({ silent: 1 })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'utterances')).toMatchObject({ pass: false, value: '2/3' })
  })

  it('fails strokes without upper-torso participation against the placebo windows (R2 b)', () => {
    const { input, gate } = speaker({ torso: false })
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), gate), bands)
    expect(report.requirements.find(r => r.id === 'trunk-participation')?.pass).toBe(false)
    expect(report.requirements.find(r => r.id === 'peaks-hit')?.pass).toBe(true)
  })

  it('fails a gated talk FAIL whatever its id, and ignores report-only values', () => {
    const { input, gate } = speaker()
    const failing = { ...gate, metrics: gate.metrics.map(m => m.id === 'coverage.fingers' ? { ...m, status: 'FAIL' as const } : m.id === 'coverage.arms' ? { ...m, status: 'FAIL' as const } : m) }
    expect(gestureTimingReport(loadedRun(input, summaryStub(input), failing), bands).requirements.find(r => r.id === 'gate-talk')?.pass).toBe(false)
    const reportOnlyFail = { ...gate, metrics: gate.metrics.map(m => m.id === 'coverage.arms' ? { ...m, status: 'FAIL' as const } : m) }
    expect(gestureTimingReport(loadedRun(input, summaryStub(input), reportOnlyFail), bands).requirements.find(r => r.id === 'gate-talk')?.pass).toBe(true)
  })

  it('fails mirrored arms through the gated bilateral metrics', () => {
    const { input, gate } = speaker()
    const mirrored = { ...gate, metrics: gate.metrics.map(m => m.id.startsWith('bilateral.') ? { ...m, status: 'FAIL' as const, band: m.band && { ...m.band, status: 'GATED' as const } } : m) }
    const report = gestureTimingReport(loadedRun(input, summaryStub(input), mirrored), bands)
    expect(report.requirements.find(r => r.id === 'bilateral')?.pass).toBe(false)
  })

  it('counts forms as distinct only when a median apex feature differs by 10 degrees', () => {
    const at = (pronationDeg: number): FormFeatures => ({ pronationDeg, wristFlexDeg: 0, indexCurlDeg: 0, direction: [0, -1, 0] })
    expect(formsDiffer(at(0), at(9.9))).toBe(false)
    expect(largestDistinctSet({ a: at(0), b: at(9), c: at(30), d: at(60) })).toHaveLength(3)
    expect(largestDistinctSet({ a: at(0), b: at(10), c: at(30), d: at(60) })).toHaveLength(4)
  })
})
