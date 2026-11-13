import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'

import { fileURLToPath } from 'node:url'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { emotionTrials, prepareTrace } from '../metrics'
import { multiply } from '../metrics/math'
import { cueBodyReport, cueFalsePositives, formatCueBody } from './cue-body'
import { C002_REQUIRED, emotionTableReport, formatEmotionTable, separationTable } from './emotion-table'
import { formatOwnership, ownershipReport } from './ownership'
import { popsReport, upperBodyPopBones } from './pops'
import { overlayPostures } from './posture-scale'
import { armWorld, gateStub, loadedRun, moves, rotX, rotY, summaryStub, trace } from './test-runs'
import { turnReport } from './turn'

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
let bands: Awaited<ReturnType<typeof loadBands>>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
})

const DEG = Math.PI / 180
const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const rotZ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]
const emotionGate = { ...gateStub({ 'onset.attackFraction': { status: 'PASS' }, 'onset.easedOrAnticipated': { status: 'PASS' }, 'emotion.armShare': { status: 'PASS' }, 'emotion.minSeparationFromNeutral': { status: 'PASS' } }), requirements: { metrics: [...C002_REQUIRED], passed: true } }

describe('emotion-table report (C002, plan 2.3)', () => {
  // Trials 12 s apart: happy and sad pitch the chest +/-10 and the head +/-20 degrees (an onset over the gate's head
  // speed threshold), released by +8 s or held, with seeded trial noise. `sadLike` gives sad another posture;
  // `placeboTurn` turns the chest of every placebo trial about its vertical axis, which widens the placebo band; `late`
  // holds every posture through the release window and lets it go from +10.4 s, before the next trial's baseline.
  function emotions(options: { amplitude?: number, release?: boolean, sadLike?: 'happy' | 'neutral', placeboTurn?: number, late?: boolean } = {}) {
    const random = createRandomStream(3)
    const conditions = [...Array.from({ length: 5 }, () => ['happy', 'sad', 'neutral']).flat(), 'placebo', 'placebo', 'placebo', 'placebo', 'placebo']
    const trials = conditions.map((condition, i) => ({ condition, t: 2 + 12 * i, offset: (random() - 0.5) * DEG, head: (random() - 0.5) * DEG }))
    const events: MotionTraceEvent[] = trials.map((trial, i) => trial.condition === 'placebo'
      ? { t: trial.t, kind: 'emotion', emotion: 'neutral', band: 'clear', phase: 'placebo', trialId: `p${i}` }
      : { t: trial.t, kind: 'emotion', emotion: trial.condition, band: 'clear', phase: 'pulse', trialId: `e${i}` })
    const amplitude = options.amplitude ?? 10 * DEG
    const envelope = (u: number) => minJerk(u / 0.5) * (options.release === false ? 1 : options.late ? 1 - minJerk((u - 10.4) / 0.5) : 1 - minJerk((u - 6) / 2))
    const world = (bone: MotionTraceBone, t: number): Quat => {
      const trial = trials.find(x => t >= x.t && t < x.t + 12)
      if (!trial || !['chest', 'head'].includes(bone))
        return [0, 0, 0, 1]
      const as = trial.condition === 'sad' && options.sadLike ? options.sadLike : trial.condition
      const sign = as === 'happy' ? 1 : as === 'sad' ? -1 : 0
      const w = envelope(t - trial.t)
      if (trial.condition === 'placebo' && options.placeboTurn)
        return bone === 'chest' ? rotY(w * (options.placeboTurn + trial.offset)) : rotX(w * trial.head)
      return rotX(w * (bone === 'chest' ? sign * amplitude + trial.offset : 2 * sign * amplitude + trial.head))
    }
    return loadedRun(trace({ seconds: 2 + 12 * trials.length, scenario: 'emotion', events, world }), null, emotionGate)
  }

  it('passes postures 2 SD apart with neutral-placebo printed but not required', () => {
    const report = emotionTableReport([emotions()], bands)
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.detail.separation['neutral|placebo']).toBeLessThan(2)
  })

  it('fails an emotion whose posture equals neutral, and passes two emotions that share one posture clear of neutral', () => {
    const neutralSad = emotionTableReport([emotions({ sadLike: 'neutral' })], bands)
    expect(neutralSad.requirements.find(r => r.id === 'pairs-from-neutral')?.pass).toBe(false)
    expect(neutralSad.detail.failingPairs).toEqual(expect.arrayContaining(['neutral|sad', 'placebo|sad']))
    const twins = emotionTableReport([emotions({ sadLike: 'happy' })], bands)
    expect(twins.requirements.find(r => r.id === 'pairs-from-neutral')?.pass).toBe(true)
    expect(twins.detail.separation['happy|sad']).toBeLessThan(2)
  })

  it('reports the gate value it would require and agrees with emotion.minSeparationFromNeutral', () => {
    const report = emotionTableReport([emotions()], bands)
    const required = report.detail.requiredPairs.map(pair => report.detail.separation[pair])
    expect(report.detail.requiredPairs).toHaveLength(4)
    expect(Math.min(...required)).toBeCloseTo(report.detail.minSeparationFromNeutral ?? Number.NaN, 9)
  })

  it.each([
    ['no --require', { ...emotionGate, requirements: undefined }, 'gate-required'],
    ['a failed --require', { ...emotionGate, requirements: { metrics: [...C002_REQUIRED], passed: false } }, 'gate-required'],
    ['skipped onset metrics', { ...emotionGate, metrics: emotionGate.metrics.map(m => m.id.startsWith('onset.') ? { ...m, status: 'SKIPPED' as const } : m) }, 'onset-not-vacuous'],
  ] as const)('fails a pooled gate with %s', (_, gate, id) => {
    const run = emotions()
    const report = emotionTableReport([{ ...run, gate }], bands)
    expect(report.requirements.find(r => r.id === id)?.pass).toBe(false)
  })

  it('fails the onset guard when the runs hold fewer onset episodes than the gate minimum', () => {
    const report = emotionTableReport([emotions({ amplitude: 0 })], bands)
    expect(report.requirements.find(r => r.id === 'onset-not-vacuous')?.pass).toBe(false)
  })

  it('prints for each emotion the first 4c table scale at which it clears 2 SD on the designed overlay', () => {
    const run = emotions({ amplitude: 0 })
    const scales = emotionTableReport([run], bands).detail.clearingScales
    const separate = (scale: number) => separationTable(emotionTrials(prepareTrace(overlayPostures(run.input, scale)))).separation
    for (const emotion of ['happy', 'sad']) {
      const scale = scales[emotion]
      expect(scale, emotion).not.toBeNull()
      const clears = (at: number) => Math.min(separate(at)[`${emotion}|neutral`] ?? separate(at)[`neutral|${emotion}`], separate(at)[`${emotion}|placebo`] ?? separate(at)[`placebo|${emotion}`]) >= 2
      expect(clears(scale ?? 0), emotion).toBe(true)
      if ((scale ?? 0) > 0.25)
        expect(clears((scale ?? 0) - 0.25), emotion).toBe(false)
    }
  })

  it('fails a posture still held outside the placebo band in the release window', () => {
    const report = emotionTableReport([emotions({ release: false })], bands)
    expect(report.requirements.find(r => r.id === 'release')?.pass).toBe(false)
  })

  // Owner decision 2026-11-12 (E/g3/s/rules.md 14): release, onset-not-vacuous and not-vacuous are printed with their
  // readings but left out of the verdict.
  it.each([
    ['release', () => emotions({ late: true })],
    ['onset-not-vacuous', () => ({ ...emotions(), gate: { ...emotionGate, metrics: emotionGate.metrics.map(m => m.id.startsWith('onset.') ? { ...m, status: 'SKIPPED' as const } : m) } })],
    ['not-vacuous', () => emotions({ placeboTurn: 15 * DEG })],
  ] as const)('passes a pooled set whose %s line alone misses its bar, printing that line as report only', (id, run) => {
    const report = emotionTableReport([run()], bands)
    expect(report.requirements.filter(r => !r.pass).map(r => r.id)).toEqual([id])
    expect(report.requirements.find(r => r.id === id)?.status).toBe('REPORT')
    expect(report.verdict).toBe('PASS')
    expect(formatEmotionTable(report)).toMatch(new RegExp(`^ {2}REPORT ${id}: `, 'm'))
  })

  it('still fails when a deciding line misses its bar beside a report-only one', () => {
    const report = emotionTableReport([emotions({ sadLike: 'neutral', late: true })], bands)
    expect(report.requirements.find(r => r.id === 'pairs-from-neutral')?.status).toBe('FAIL')
    expect(report.verdict).toBe('FAIL')
  })

  it('fails the vacuous case in which no emotion has a posture', () => {
    const report = emotionTableReport([emotions({ amplitude: 0 })], bands)
    expect(report.verdict).toBe('FAIL')
    expect(report.requirements.find(r => r.id === 'not-vacuous')?.pass).toBe(false)
  })
})

// Each cueBodyReport call spends about 2 s on its fixed 1000-draw nulls and split-half control, whatever the trace.
// The two-call test measured 5.6 s under load and timed out at the 5 s default; 20 s leaves 3.5 times that.
describe('cue-body report (C002, unit M2 R3)', { timeout: 20_000 }, () => {
  // 150 s of placebo, then six events of each cue kind 5 s apart. Every bone below the neck and the head sways with
  // seeded 0.3 degree noise; the cued bone adds a 3 degree, 4 Hz oscillation for the cue's duration. `sided` turns the
  // cued bone about its vertical axis toward alternating sides, as Natural's shake goes to a random side, and keeps only
  // the chest's sway, moved to that axis, where mirroring flips it. `posed` adds emotion trials 24 s apart, each followed
  // 12 s later by a placebo trial; every posed trial turns the chest toward alternating sides by `posed`, held 5 s, then
  // released over 1 s, as a sided arm form is. The kinds in `quiet` carry no cue motion.
  function cues(bone: MotionTraceBone | null, noise = 0.3 * DEG, onlyFirst?: number, sided = false, posed = 0, quiet: readonly string[] = []) {
    const kinds = ['nod', 'shake', 'shrug', 'lean', 'glance'] as const
    const seconds = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
    const list = kinds.flatMap((kind, k) => Array.from({ length: 6 }, (_, i) => ({ kind, t: 152 + 5 * (k * 6 + i) })))
    const trials = posed ? Array.from({ length: 6 }, (_, i) => 2 + 24 * i) : []
    const events: MotionTraceEvent[] = [
      ...trials.flatMap((t, i): MotionTraceEvent[] => [
        { t, kind: 'emotion', emotion: 'sad', band: 'clear', phase: 'pulse', trialId: `e${i}` },
        { t: t + 12, kind: 'emotion', emotion: 'neutral', band: 'clear', phase: 'placebo', trialId: `p${i}` },
      ]),
      ...list.map((cue): MotionTraceEvent => ({ t: cue.t, kind: 'gesture', gesture: cue.kind })),
    ]
    const pose = (t: number) => trials.reduce((sum, start, i) => sum + (i % 2 ? -1 : 1) * posed * minJerk((t - start) / 0.5) * (1 - minJerk(t - start - 5)), 0)
    const random = createRandomStream(5)
    const phases = new Map(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'].map(b => [b, [0, 1, 2].map(() => [2 * Math.PI * random(), 0.3 + 0.7 * random()])]))
    const world = (b: MotionTraceBone, t: number): Quat => {
      const sway = (phases.get(b) ?? []).reduce((sum, [phase, hz]) => sum + noise / 3 * Math.sin(2 * Math.PI * hz * t + phase), 0)
      const cue = list.find(x => t >= x.t && t < x.t + seconds[x.kind])
      const amplitude = onlyFirst === undefined ? 3 * DEG : list.indexOf(cue ?? list[0]) % 6 === 0 ? onlyFirst : 0
      const turn = cue && b === bone && !quiet.includes(cue.kind) ? amplitude * Math.sin(2 * Math.PI * 4 * (t - cue.t)) : 0
      if (sided)
        return b === 'chest' ? rotY(sway + (cue && list.indexOf(cue) % 2 === 1 ? -turn : turn)) : [0, 0, 0, 1]
      return b === 'chest' && posed ? multiply(rotX(sway + turn), rotZ(pose(t))) : rotX(sway + turn)
    }
    return loadedRun(trace({ seconds: 154 + 5 * list.length, scenario: 'emotion', events, world }), null, null)
  }

  it('passes cues that move the chest', () => {
    expect(cueBodyReport([cues('chest')]).verdict).toBe('PASS')
  })

  // Version 5 (E/g3/s/rules.md 6.4): a response toward the left and the same response toward the right are one response.
  it('passes cues that turn the chest toward alternating sides', () => {
    expect(cueBodyReport([cues('chest', 0.3 * DEG, undefined, true)]).verdict).toBe('PASS')
  })

  // The nulls are mirrored like the events: mirroring only the events aligns their noise, and the all-events average
  // alone then clears its null on 8 to 37 % of the pseudo-events of this fixture instead of 1 to 2.5 %.
  it('keeps the split-half false positives within 5 % on a body that sways about its vertical axis', () => {
    for (const share of Object.values(cueFalsePositives([cues(null, 0.3 * DEG, undefined, true)]))) {
      expect(share.flagged / share.total).toBeLessThanOrEqual(0.05)
      expect(share.averageOnly / share.total).toBeLessThanOrEqual(0.05)
    }
  })

  // Version 5 (E/g3/s/rules.md 12.2): placebo windows are drawn clear of every posed emotion's hold and release, which
  // consensus mirroring would otherwise align into the null.
  it('passes cues whose placebo span holds posed emotions released toward alternating sides', () => {
    expect(cueBodyReport([cues('chest', 0.3 * DEG, undefined, false, 30 * DEG)]).requirements.find(r => r.id === 'cue-nod')?.pass).toBe(true)
  })

  // Owner decision 2026-11-12 (E/g3/s/rules.md 14): cue-lean is printed with its reading but left out of the verdict.
  it('passes cues whose lean alone shows no response, printing the lean line as report only', () => {
    const report = cueBodyReport([cues('chest', 0.3 * DEG, undefined, false, 0, ['lean'])])
    expect(report.verdict).toBe('PASS')
    expect(report.requirements.find(r => r.id === 'cue-lean')).toMatchObject({ status: 'REPORT', pass: false })
    expect(formatCueBody(report)).toMatch(/^ {2}REPORT cue-lean: /m)
  })

  it('still fails when another cue shows no response beside a quiet lean', () => {
    const report = cueBodyReport([cues('chest', 0.3 * DEG, undefined, false, 0, ['lean', 'nod'])])
    expect(report.verdict).toBe('FAIL')
    expect(report.requirements.find(r => r.id === 'cue-nod')).toMatchObject({ status: 'FAIL', pass: false })
  })

  it.each([['head-only', 'head'], ['no cue motion', null]] as const)('fails %s cues against the placebo windows', (_, bone) => {
    const report = cueBodyReport([cues(bone)])
    expect(report.verdict).toBe('FAIL')
    expect(report.requirements.every(r => !r.pass)).toBe(true)
  })

  // Unit M3 item 7: leaving the moving event out leaves five quiet ones, so no single event carries a kind, however large.
  it.each([0.5, 3, 30])('does not pass a kind on one moving event of six at %s degrees', (degrees) => {
    const report = cueBodyReport([cues('chest', 0.3 * DEG, degrees * DEG)])
    expect(report.requirements.every(r => !r.pass)).toBe(true)
  })

  it('fails a body that never moves, with no placebo spread to beat', () => {
    expect(cueBodyReport([cues('chest', 0)]).requirements.every(r => r.pass)).toBe(true)
    expect(cueBodyReport([cues(null, 0)]).verdict).toBe('FAIL')
  })
})

describe('ownership report (C004, plan 2.5; version 2 revision B, E/g3/own2/rules-v2.md)', () => {
  // Version 3 layout: peaks every 1.5 s to 19 s, then C's four; the clip holds the right upper arm 0.6 rad, fully owned
  // 3.3 to 20 s and again 23.3 to 26.05 s (claimed 50 ms after C's first peak, released 50 ms after its third); the poke
  // at 4.05 s; the left arm strokes each peak inside unit A/B, 0.5 to 19.5 s, and unit C, 23 to 29.5 s.
  interface Clip {
    readonly seed?: number
    readonly left?: 'strokes' | 'none' | 'stalls-at-poke'
    readonly pokeOutsideUnit?: boolean
    readonly cUnit?: boolean
    readonly rightAtClaim?: 'idle' | 'yields' | 'keeps-gesturing'
    readonly rightAfterRelease?: 'none' | 'activation' | 'stroke-after-fade' | 'idle-sway'
    readonly rightAfterSecondRelease?: 'none' | 'joins-before-free' | 'unmatched-stroke' | 'joins-at-peak'
    readonly leftUnitAtRest?: boolean
    /** The clip never lets go after the second release: the pose stays and owned.rightArm stays 1. */
    readonly secondReleaseHeld?: boolean
    /** Arm angles in degrees from each side's rest; zero unless given. */
    readonly angles?: (side: 'left' | 'right', t: number) => readonly number[] | null
    /** The right arm's recorded rest, degrees; zero unless given (each side draws its own rest). */
    readonly restRight?: readonly number[]
    /** Idle-sized left upper-arm bumps (0.02 rad over 0.4 s) whose apexes land at these times. */
    readonly leftBumps?: readonly number[]
    readonly jitter?: boolean
    readonly spikes?: { readonly left?: 'PASS' | 'SKIPPED', readonly right?: 'PASS' | 'SKIPPED' }
    readonly deviation?: number
    readonly commit?: string
    readonly version?: number
  }
  const C_PEAKS = [23, 24.5, 26, 27.5]
  const PEAKS = [...Array.from({ length: 13 }, (_, i) => 1 + 1.5 * i), ...C_PEAKS]
  const POKE = 4.05
  const RAISED = 0.6
  const SECOND = { claim: C_PEAKS[0] + 0.05, release: C_PEAKS[2] + 0.05 }
  const between = (from: number, to: number) => (t: number) => t >= from && t < to ? 1 : 0
  const strokes = (ends: readonly number[]) => moves(ends.flatMap(end => [{ start: end - 0.15, duration: 0.15, by: 0.1 }, { start: end, duration: 0.3, by: 0.002 }, { start: end + 0.4, duration: 0.3, by: -0.102 }]))
  // Idle-sized: two thirds of the companion idle runs' 0.03 rad sway, so below their speed bar.
  const bumps = (apexes: readonly number[]) => moves(apexes.map((t, i) => ({ start: t - 0.4, duration: 0.4, by: (i % 2 ? -1 : 1) * 0.02 })))
  const none = () => 0

  /** A companion idle run of the same synthetic rig and commit: 0.03 rad upper-arm swings 2 s apart, arms at rest. */
  function idle(seconds = 54) {
    const sway = Array.from({ length: Math.floor((seconds - 4) / 2) }, (_, i) => ({ start: 2 + 2 * i, duration: 0.4, by: (i % 2 ? -1 : 1) * 0.03 }))
    const input = trace({ seconds, scenario: 'talk', world: armWorld({ upper: moves(sway) }, {}) })
    const sourced = { ...input, trace: { ...input.trace, source: { ...input.trace.source, gitSha: 'test-commit' } } }
    const base = summaryStub(sourced)
    const zeros = () => Array.from<number>({ length: 9 }).fill(0)
    const summary = { ...base, ownership: { ...base.ownership, armDeg: { left: base.perFrame.t_ms.map(zeros), right: base.perFrame.t_ms.map(zeros) }, restArmDeg: { left: zeros(), right: zeros() } } }
    return loadedRun(sourced, summary, null, 'idle-companion')
  }

  function clip(options: Clip = {}) {
    const seed = options.seed ?? 1
    const events: MotionTraceEvent[] = [
      ...PEAKS.map(t => ({ t, kind: 'emphasis', strength: 0.8, source: 'scenario' }) as const),
      { t: 0.5, kind: 'marker', label: 'gesture-unit:start' },
      { t: 3, kind: 'marker', label: 'clip-claim' },
      { t: POKE, kind: 'touch', touch: 'poke', region: 'body' },
      { t: 20, kind: 'marker', label: 'clip-release' },
      { t: 23, kind: 'marker', label: 'gesture-unit:start' },
      { t: SECOND.claim, kind: 'marker', label: 'clip-claim' },
      { t: SECOND.release, kind: 'marker', label: 'clip-release' },
    ]
    const left = options.left ?? 'strokes'
    const cUnit = left !== 'none' && options.cUnit !== false
    const leftPeaks = left === 'none' ? [] : [...PEAKS.filter(t => t <= 19 && (left === 'strokes' || t < POKE)), ...(cUnit ? C_PEAKS : [])]
    const leftStrokes = strokes(leftPeaks)
    const leftBumps = bumps(options.leftBumps ?? [])
    const jitter = (t: number) => options.jitter && t >= POKE + 0.2 && t < POKE + 0.7 ? 2 * DEG * Math.sin(2 * Math.PI * 15 * (t - POKE - 0.2)) : 0
    const held = options.secondReleaseHeld === true
    const clipPose = moves([{ start: 3, duration: 0.3, by: RAISED }, { start: 20, duration: 0.3, by: -RAISED }, { start: SECOND.claim, duration: 0.25, by: RAISED }, ...(held ? [] : [{ start: SECOND.release, duration: 0.3, by: -RAISED }])])
    const after = options.rightAfterRelease
    const afterSecond = options.rightAfterSecondRelease
    const stale = after === 'stroke-after-fade' ? strokes([20.65]) : after === 'idle-sway' ? bumps([20.85]) : none
    const rejoin = afterSecond === 'unmatched-stroke' ? strokes([SECOND.release + 0.7]) : afterSecond === 'joins-at-peak' ? strokes([C_PEAKS[3]]) : none
    const world = armWorld({ upper: t => leftStrokes(t) + leftBumps(t) + jitter(t) }, { upper: t => clipPose(t) + stale(t) + rejoin(t) })
    const input = trace({ seconds: 30, scenario: 'talk', events, world })
    const sourced = { ...input, trace: { ...input.trace, source: { ...input.trace.source, scenario: { id: 'gesture-under-clip', class: 'talk' as const, seed }, gitSha: options.commit ?? 'test-commit', detail: { scenarioVersion: options.version ?? 3 } } } }
    const base = summaryStub(sourced)
    const time = base.perFrame.t_ms.map((_, k) => k / 60)
    const owned = (t: number) => (t >= 3.3 && t < 20) || (t >= SECOND.claim + 0.25 && (held || t < SECOND.release)) ? 1 : (t >= 3 && t < 20.3) || (t >= SECOND.claim && t < SECOND.release + 0.3) ? 0.5 : 0
    const unitA = left === 'none' ? none : left === 'stalls-at-poke' ? between(0.5, POKE + 0.1) : options.pokeOutsideUnit ? between(8.5, 19.5) : between(0.5, options.leftUnitAtRest ? 21 : 19.5)
    const leftUnit = (t: number) => unitA(t) || (cUnit ? between(23, 29.5)(t) : 0)
    const claim = options.rightAtClaim ?? 'idle'
    const claimUnit = claim === 'yields' ? between(0.5, 3) : claim === 'keeps-gesturing' ? between(0.5, 20) : none
    const releaseUnit = after === 'activation' ? between(20.5, 21) : none
    const secondUnit = afterSecond === 'joins-before-free' ? between(SECOND.release + 0.1, 29.5) : afterSecond === 'joins-at-peak' ? between(C_PEAKS[3] - 0.3, 29.5) : none
    const rightUnit = (t: number) => claimUnit(t) || releaseUnit(t) || secondUnit(t)
    const angles = (side: 'left' | 'right') => time.map(t => [...options.angles?.(side, t) ?? Array.from<number>({ length: 9 }).fill(0)])
    const summary = {
      ...base,
      owned: { ...base.owned, perFrame: base.owned.perFrame.map((row, k) => row.map((v, g) => base.owned.groups[g] === 'rightArm' || base.owned.groups[g] === 'rightFingers' ? owned(time[k]) : v)) },
      ownership: {
        ...base.ownership,
        deviationRad: base.ownership.deviationRad.map((row, k) => row.map((v, g) => base.ownership.groups[g] === 'rightArm' && owned(time[k]) === 1 ? options.deviation ?? 0 : v)),
        activation: { left: time.map(leftUnit), right: time.map(rightUnit) },
        armDeg: { left: angles('left'), right: angles('right') },
        restArmDeg: { left: Array.from<number>({ length: 9 }).fill(0), right: [...options.restRight ?? Array.from<number>({ length: 9 }).fill(0)] },
      },
      clip: { bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'], expected: time.map(t => owned(t) > 0 ? [...rotX(RAISED), 0, 0, 0, 1, 0, 0, 0, 1] : null) },
    }
    const spike = (status: 'PASS' | 'SKIPPED' = 'PASS') => status === 'PASS' ? { status, value: 0 } : { status, value: null }
    const gate = gateStub({ 'smooth.armL.spikeRate': spike(options.spikes?.left), 'smooth.armR.spikeRate': spike(options.spikes?.right) })
    return loadedRun(sourced, summary, gate, `clip-${seed}`)
  }

  const judge = (runs: ReturnType<typeof clip>[]) => ownershipReport(runs, [idle()])
  const one = (options: Clip = {}) => judge([clip(options)])
  const line = (report: ReturnType<typeof ownershipReport>, id: string, run = 0) => report.detail.runs[run].requirements.find(r => r.id === id)
  const status = (report: ReturnType<typeof ownershipReport>, id: string, run = 0) => line(report, id, run)?.status
  const pooled = (report: ReturnType<typeof ownershipReport>, id: string) => report.requirements.find(r => r.id === id)?.pass
  // Seeds 1 to 3 keep the right arm idle at the claim; seeds 4 to 6 are gesturing with it and yield.
  const pool = (overrides: (seed: number) => Clip = () => ({})) => [1, 2, 3, 4, 5, 6].map(seed => clip({ seed, rightAtClaim: seed > 3 ? 'yields' : 'idle', ...overrides(seed) }))

  it('passes a pool of six runs built to satisfy every requirement, each case exercised at least twice', () => {
    const report = judge(pool())
    expect(report.detail.verdict).toBe('PASS')
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.detail.runs.map((_, i) => status(report, 'performer-yields', i))).toEqual(['NOT-EXERCISED', 'NOT-EXERCISED', 'NOT-EXERCISED', 'PASS', 'PASS', 'PASS'])
    expect(report.detail.exercised['no-stale-stroke']).toBe(6)
  })

  it.each([
    ['five runs', () => pool().slice(0, 5)],
    ['one run', () => [clip()]],
    ['runs of two commits', () => pool(seed => seed === 6 ? { commit: 'other-commit' } : {})],
    ['a run of scenario version 2', () => pool(seed => seed === 6 ? { version: 2 } : {})],
    ['two runs of one seed', () => pool(seed => seed === 6 ? { seed: 3 } : {})],
  ])('refuses a pool of %s and still prints every run', (_, runs) => {
    const report = judge(runs())
    expect(report.detail.verdict).toBe('REFUSED')
    expect(report.verdict).toBe('FAIL')
    expect(report.detail.runs).toHaveLength(runs().length)
  })

  it('refuses a pool judged without companion idle runs, and refuses each stroke clause on every run', () => {
    const report = ownershipReport(pool(), [])
    expect(report.detail.verdict).toBe('REFUSED')
    expect(report.detail.refusals.join('; ')).toContain('idle speed bar')
    for (const id of ['left-arm-gestures', 'resume-after-cancel'])
      expect(status(report, id)).toBe('REFUSED')
    expect(status(report, 'no-stale-stroke')).toBe('PASS')
    expect(status(report, 'owned-arm-untouched')).toBe('PASS')
  })

  it.each([[0, false], [1, false], [2, true]] as const)('with %i runs exercising performer-yields, its pooled line passes: %s', (count, pass) => {
    const report = judge(pool(seed => ({ rightAtClaim: seed <= count ? 'yields' : 'idle' })))
    expect(pooled(report, 'performer-yields')).toBe(pass)
  })

  it.each([[1, false], [2, true]] as const)('with %i runs holding a unit at the second release, the pooled no-stale-stroke line passes: %s', (count, pass) => {
    const report = judge(pool(seed => ({ cUnit: seed <= count })))
    expect(report.detail.exercised['no-stale-stroke']).toBe(count)
    expect(pooled(report, 'no-stale-stroke')).toBe(pass)
  })

  it('judges performer-yields only when the right arm gestures at the claim, and fails one that keeps gesturing while owned', () => {
    expect(status(one({ rightAtClaim: 'idle' }), 'performer-yields')).toBe('NOT-EXERCISED')
    expect(status(one({ rightAtClaim: 'yields' }), 'performer-yields')).toBe('PASS')
    expect(status(one({ rightAtClaim: 'keeps-gesturing' }), 'performer-yields')).toBe('FAIL')
    const mixed = judge(pool(seed => seed === 4 ? { rightAtClaim: 'keeps-gesturing' } : {}))
    expect(mixed.detail.verdict).toBe('FAIL')
    expect(pooled(mixed, 'performer-yields')).toBe(false)
    // The run that keeps gesturing held the case and failed it: it counts as exercised.
    expect(mixed.detail.exercised['performer-yields']).toBe(3)
  })

  it('judges resume-after-cancel only for a poke inside a gesture unit, and fails a unit that stalls at the poke', () => {
    const outside = one({ pokeOutsideUnit: true })
    expect(status(outside, 'resume-after-cancel')).toBe('NOT-EXERCISED')
    expect(status(outside, 'poke-continuous')).toBe('NOT-EXERCISED')
    expect(status(one(), 'resume-after-cancel')).toBe('PASS')
    expect(line(one({ left: 'stalls-at-poke' }), 'resume-after-cancel')).toMatchObject({ status: 'FAIL', value: expect.stringContaining('missed') })
  })

  it('does not take an idle-sized apex near the resume peak for a resumed stroke', () => {
    // The first peak at least 1 s after the poke is 5.5 s; the bump's apex lands 50 ms after it.
    expect(line(one({ left: 'stalls-at-poke', leftBumps: [5.55] }), 'resume-after-cancel')).toMatchObject({ status: 'FAIL', value: expect.stringContaining('missed') })
  })

  it('does not count idle-sized apexes on the owned peaks as left-arm gestures', () => {
    expect(status(one({ left: 'none', leftBumps: [4.1, 5.6, 7.1] }), 'left-arm-gestures')).toBe('FAIL')
  })

  it('judges the poke by pops alone: a skipped spike rate on a free arm passes, a sustained jitter fails', () => {
    expect(status(one({ spikes: { left: 'SKIPPED' } }), 'poke-continuous')).toBe('PASS')
    expect(line(one({ jitter: true }), 'poke-continuous')).toMatchObject({ status: 'FAIL', value: expect.not.stringContaining(' 0 pops') })
  })

  it('judges stale strokes by activation only and reports the kinematic apexes after each release, not judged', () => {
    expect(status(one(), 'no-stale-stroke')).toBe('PASS')
    expect(status(one({ rightAfterRelease: 'activation' }), 'no-stale-stroke')).toBe('FAIL')
    // A stroke only in the bones, activation 0: not caught (stated limit), but reported with its speed against the bar.
    const bones = one({ rightAfterRelease: 'stroke-after-fade' })
    expect(status(bones, 'no-stale-stroke')).toBe('PASS')
    expect(bones.detail.runs[0].staleReport.filter(a => a.release === 1 && a.overBar !== null && a.overBar > 1).map(a => Math.round(a.t * 10) / 10)).toContain(20.7)
  })

  it('judges the release inside a running unit by activation: the right arm may join once ownership reaches 0', () => {
    expect(status(one({ rightAfterSecondRelease: 'joins-at-peak' }), 'no-stale-stroke')).toBe('PASS')
    expect(status(one({ rightAfterSecondRelease: 'joins-before-free' }), 'no-stale-stroke')).toBe('FAIL')
    expect(status(one({ rightAfterSecondRelease: 'unmatched-stroke' }), 'no-stale-stroke')).toBe('PASS')
    expect(line(one({ cUnit: false }), 'no-stale-stroke')).toMatchObject({ status: 'NOT-EXERCISED', exercised: false })
    expect(status(one({ cUnit: false, rightAfterSecondRelease: 'joins-before-free' }), 'no-stale-stroke')).toBe('FAIL')
  })

  it('reports each arm\'s offset from its own rest across the arms at release + 0.5 s without judging it', () => {
    const held = one({ angles: (side, t) => side === 'right' && t >= 20 && t < 21 ? [5, 0, 0, 40, 0, 60, 0, 10, 0] : null })
    expect(line(held, 'rest-band')).toBeUndefined()
    expect(held.detail.runs[0].restReport.joints.map(j => j.difference)).toEqual([5, 0, 0, 40, 0, 60, 0, 10, 0])
    expect(held.detail.runs[0].restReport.idleFrames).toBeGreaterThan(0)
    // Revision C2.1 (X2): the numbers are the performer's channels, not the posed arm, and the printed line says so.
    expect(formatOwnership(held)).toContain('performer arm channels at release + 0.5 s (not the posed arm; not judged)')
    // Each side draws its own rest: a right arm that sits 6 deg more abducted at its own rest differs by nothing.
    const drawn = one({ angles: side => side === 'right' ? [0, 0, 0, 6, 0, 0, 0, 0, 0] : null, restRight: [0, 0, 0, 6, 0, 0, 0, 0, 0] })
    expect(drawn.detail.runs[0].restReport.joints.map(j => j.difference)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('fails a run whose clip never lets go after a release, and passes releases that reach owned 0 within 1 s', () => {
    expect(status(one(), 'clip-releases')).toBe('PASS')
    const held = one({ secondReleaseHeld: true })
    expect(held.detail.runs[0].requirements.filter(r => r.status === 'FAIL').map(r => r.id)).toEqual(['clip-releases'])
    const pooledHeld = judge(pool(seed => seed === 2 ? { secondReleaseHeld: true } : {}))
    expect(pooled(pooledHeld, 'clip-releases')).toBe(false)
    expect(pooledHeld.detail.verdict).toBe('FAIL')
  })

  it('refuses an idle companion long enough for the performer to redraw its rest', () => {
    const report = ownershipReport(pool(), [idle(), idle(75)])
    expect(report.detail.verdict).toBe('REFUSED')
    expect(report.detail.refusals.join('; ')).toContain('redraw')
  })

  it('fails a write deviation of 0.002 rad on a fully owned arm', () => {
    expect(status(one({ deviation: 0.002 }), 'owned-arm-untouched')).toBe('FAIL')
  })

  it('fails the vacuous case in which no arm gestures', () => {
    const report = one({ left: 'none' })
    expect(status(report, 'left-arm-gestures')).toBe('FAIL')
    expect(status(report, 'resume-after-cancel')).toBe('NOT-EXERCISED')
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
    expect(popsReport(loadedRun(step, null, null)).detail.upperBody).toMatchObject([{ bone: 'rightLowerArm', kind: 'position-step' }])
  })

  // A one-frame 1 degree step of one bone carries its descendants with it; only the bone that stepped is charged.
  it.each(upperBodyPopBones)('finds an injected 1 degree one-frame step on %s and on no other bone', (stepped) => {
    const { bones, parents } = trace({ seconds: 1, scenario: 'talk' }).trace.rig
    const carried = (bone: MotionTraceBone): boolean => bone === stepped || (parents[bones.indexOf(bone)] >= 0 && carried(bones[parents[bones.indexOf(bone)]]))
    const input = trace({ seconds: 3, scenario: 'talk', world: (bone, t) => rotX(carried(bone) && t >= 1.5 ? DEG : 0) })
    expect(popsReport(loadedRun(input, null, null)).detail.upperBody.map(pop => pop.bone)).toEqual([stepped])
  })

  // As measured on the goal-2 gaze trace: the chest steps, the upper chest takes back half and its children re-add it.
  it('charges a chest step to the chest, not to the upper chest, neck and shoulders that carry it on', () => {
    const below = (bone: MotionTraceBone) => !['hips', 'spine', 'chest', 'upperChest'].includes(bone) && !bone.includes('Leg') && !bone.includes('Foot')
    const input = trace({ seconds: 3, scenario: 'talk', world: (bone, t) => rotY(t < 1.5 ? 0 : bone === 'chest' || below(bone) ? 2 * DEG : bone === 'upperChest' ? DEG : 0) })
    expect(popsReport(loadedRun(input, null, null)).detail.upperBody.map(pop => pop.bone)).toEqual(['chest'])
  })
})
