import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'

import { fileURLToPath } from 'node:url'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { emotionTrials, prepareTrace } from '../metrics'
import { cueBodyReport } from './cue-body'
import { C002_REQUIRED, emotionTableReport, separationTable } from './emotion-table'
import { ownershipReport } from './ownership'
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
const emotionGate = { ...gateStub({ 'onset.attackFraction': { status: 'PASS' }, 'onset.easedOrAnticipated': { status: 'PASS' }, 'emotion.armShare': { status: 'PASS' }, 'emotion.minSeparationFromNeutral': { status: 'PASS' } }), requirements: { metrics: [...C002_REQUIRED], passed: true } }

describe('emotion-table report (C002, plan 2.3)', () => {
  // Trials 12 s apart: happy and sad pitch the chest +/-10 and the head +/-20 degrees (an onset over the gate's head
  // speed threshold), released by +8 s or held, with seeded trial noise. `sadLike` gives sad another posture.
  function emotions(options: { amplitude?: number, release?: boolean, sadLike?: 'happy' | 'neutral' } = {}) {
    const random = createRandomStream(3)
    const conditions = [...Array.from({ length: 5 }, () => ['happy', 'sad', 'neutral']).flat(), 'placebo', 'placebo', 'placebo', 'placebo', 'placebo']
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
      const as = trial.condition === 'sad' && options.sadLike ? options.sadLike : trial.condition
      const sign = as === 'happy' ? 1 : as === 'sad' ? -1 : 0
      const w = envelope(t - trial.t)
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
  // seeded 0.3 degree noise; the cued bone adds a 3 degree, 4 Hz oscillation for the cue's duration.
  function cues(bone: MotionTraceBone | null, noise = 0.3 * DEG, onlyFirst?: number) {
    const kinds = ['nod', 'shake', 'shrug', 'lean', 'glance'] as const
    const seconds = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
    const list = kinds.flatMap((kind, k) => Array.from({ length: 6 }, (_, i) => ({ kind, t: 152 + 5 * (k * 6 + i) })))
    const events: MotionTraceEvent[] = list.map(cue => ({ t: cue.t, kind: 'gesture', gesture: cue.kind }))
    const random = createRandomStream(5)
    const phases = new Map(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'].map(b => [b, [0, 1, 2].map(() => [2 * Math.PI * random(), 0.3 + 0.7 * random()])]))
    const world = (b: MotionTraceBone, t: number): Quat => {
      const sway = (phases.get(b) ?? []).reduce((sum, [phase, hz]) => sum + noise / 3 * Math.sin(2 * Math.PI * hz * t + phase), 0)
      const cue = list.find(x => t >= x.t && t < x.t + seconds[x.kind])
      const amplitude = onlyFirst === undefined ? 3 * DEG : list.indexOf(cue ?? list[0]) % 6 === 0 ? onlyFirst : 0
      return rotX(sway + (cue && b === bone ? amplitude * Math.sin(2 * Math.PI * 4 * (t - cue.t)) : 0))
    }
    return loadedRun(trace({ seconds: 154 + 5 * list.length, scenario: 'emotion', events, world }), null, null)
  }

  it('passes cues that move the chest', () => {
    expect(cueBodyReport([cues('chest')]).verdict).toBe('PASS')
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

describe('ownership report (C004, plan 2.5; version 2, E/g3/own2/rules-v2.md)', () => {
  // Version 3 layout: peaks every 1.5 s to 19 s, then C; the clip holds the right upper arm 0.6 rad, full 3.3 to
  // 20 s; the poke at 4.05 s; the left arm strokes each peak inside one unit, 0.5 to 19.5 s.
  interface Clip {
    readonly seed?: number
    readonly left?: 'strokes' | 'none' | 'stalls-at-poke'
    readonly pokeOutsideUnit?: boolean
    readonly rightAtClaim?: 'idle' | 'yields' | 'keeps-gesturing'
    readonly rightAfterRelease?: 'none' | 'activation' | 'stroke-after-fade'
    readonly leftUnitAtRest?: boolean
    readonly rest?: { readonly left: readonly number[], readonly right: readonly number[] }
    readonly spikes?: { readonly left?: 'PASS' | 'SKIPPED', readonly right?: 'PASS' | 'SKIPPED' }
    readonly deviation?: number
    readonly commit?: string
    readonly version?: number
  }
  const PEAKS = [...Array.from({ length: 13 }, (_, i) => 1 + 1.5 * i), 23, 24.5, 26]
  const POKE = 4.05
  const RAISED = 0.6
  const between = (from: number, to: number) => (t: number) => t >= from && t < to ? 1 : 0

  function clip(options: Clip = {}) {
    const seed = options.seed ?? 1
    const events: MotionTraceEvent[] = [
      ...PEAKS.map(t => ({ t, kind: 'emphasis', strength: 0.8, source: 'scenario' }) as const),
      { t: 0.5, kind: 'marker', label: 'gesture-unit:start' },
      { t: 3, kind: 'marker', label: 'clip-claim' },
      { t: POKE, kind: 'touch', touch: 'poke', region: 'body' },
      { t: 20, kind: 'marker', label: 'clip-release' },
      { t: 23, kind: 'marker', label: 'gesture-unit:start' },
    ]
    const strokes = (ends: readonly number[]) => moves(ends.flatMap(end => [{ start: end - 0.15, duration: 0.15, by: 0.1 }, { start: end, duration: 0.3, by: 0.002 }, { start: end + 0.4, duration: 0.3, by: -0.102 }]))
    const left = options.left ?? 'strokes'
    const leftStrokes = left === 'none' ? undefined : strokes(PEAKS.filter(t => t <= 19 && (left === 'strokes' || t < POKE)))
    const clipPose = moves([{ start: 3, duration: 0.3, by: RAISED }, { start: 20, duration: 0.3, by: -RAISED }])
    const stale = options.rightAfterRelease === 'stroke-after-fade' ? strokes([20.65]) : () => 0
    const input = trace({ seconds: 30, scenario: 'talk', events, world: armWorld({ upper: leftStrokes }, { upper: t => clipPose(t) + stale(t) }) })
    const sourced = { ...input, trace: { ...input.trace, source: { ...input.trace.source, scenario: { id: 'gesture-under-clip', class: 'talk' as const, seed }, gitSha: options.commit ?? 'test-commit', detail: { scenarioVersion: options.version ?? 3 } } } }
    const base = summaryStub(sourced)
    const time = base.perFrame.t_ms.map((_, k) => k / 60)
    const owned = (t: number) => t >= 3.3 && t < 20 ? 1 : t >= 3 && t < 20.3 ? 0.5 : 0
    const leftUnit = left === 'none' ? () => 0 : left === 'stalls-at-poke' ? between(0.5, POKE + 0.1) : options.pokeOutsideUnit ? between(8.5, 19.5) : between(0.5, options.leftUnitAtRest ? 21 : 19.5)
    const claim = options.rightAtClaim ?? 'idle'
    const rightUnit = (t: number) => (claim === 'yields' ? between(0.5, 3) : claim === 'keeps-gesturing' ? between(0.5, 20) : () => 0)(t) || (options.rightAfterRelease === 'activation' ? between(20.5, 21)(t) : 0)
    const angles = (side: 'left' | 'right') => time.map(t => t >= 20 && options.rest ? [...options.rest[side]] : Array.from<number>({ length: 9 }).fill(0))
    const summary = {
      ...base,
      owned: { ...base.owned, perFrame: base.owned.perFrame.map((row, k) => row.map((v, g) => base.owned.groups[g] === 'rightArm' || base.owned.groups[g] === 'rightFingers' ? owned(time[k]) : v)) },
      ownership: {
        ...base.ownership,
        deviationRad: base.ownership.deviationRad.map((row, k) => row.map((v, g) => base.ownership.groups[g] === 'rightArm' && owned(time[k]) === 1 ? options.deviation ?? 0 : v)),
        activation: { left: time.map(leftUnit), right: time.map(rightUnit) },
        armDeg: { left: angles('left'), right: angles('right') },
        restArmDeg: { left: Array.from<number>({ length: 9 }).fill(0), right: Array.from<number>({ length: 9 }).fill(0) },
      },
      clip: { bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'], expected: time.map(t => owned(t) > 0 ? [...rotX(RAISED), 0, 0, 0, 1, 0, 0, 0, 1] : null) },
    }
    const spike = (status: 'PASS' | 'SKIPPED' = 'PASS') => status === 'PASS' ? { status, value: 0 } : { status, value: null }
    const gate = gateStub({ 'smooth.armL.spikeRate': spike(options.spikes?.left), 'smooth.armR.spikeRate': spike(options.spikes?.right) })
    return loadedRun(sourced, summary, gate, `clip-${seed}`)
  }

  const status = (report: ReturnType<typeof ownershipReport>, id: string, run = 0) => report.detail.runs[run].requirements.find(r => r.id === id)?.status
  const pooled = (report: ReturnType<typeof ownershipReport>, id: string) => report.requirements.find(r => r.id === id)?.pass
  // Seeds 1 to 3 keep the right arm idle at the claim; seeds 4 to 6 are gesturing with it and yield.
  const pool = (overrides: (seed: number) => Clip = () => ({})) => [1, 2, 3, 4, 5, 6].map(seed => clip({ seed, rightAtClaim: seed > 3 ? 'yields' : 'idle', ...overrides(seed) }))

  it('passes a pool of six runs built to satisfy every requirement, each case exercised at least twice', () => {
    const report = ownershipReport(pool(), bands)
    expect(report.detail.verdict).toBe('PASS')
    expect(report.requirements.filter(r => !r.pass)).toEqual([])
    expect(report.detail.runs.map(run => status(report, 'performer-yields', report.detail.runs.indexOf(run)))).toEqual(['NOT-EXERCISED', 'NOT-EXERCISED', 'NOT-EXERCISED', 'PASS', 'PASS', 'PASS'])
  })

  it.each([
    ['five runs', () => pool().slice(0, 5)],
    ['one run', () => [clip()]],
    ['runs of two commits', () => pool(seed => seed === 6 ? { commit: 'other-commit' } : {})],
    ['a run of scenario version 2', () => pool(seed => seed === 6 ? { version: 2 } : {})],
    ['two runs of one seed', () => pool(seed => seed === 6 ? { seed: 3 } : {})],
  ])('refuses a pool of %s and still prints every run', (_, runs) => {
    const report = ownershipReport(runs(), bands)
    expect(report.detail.verdict).toBe('REFUSED')
    expect(report.verdict).toBe('FAIL')
    expect(report.detail.runs).toHaveLength(runs().length)
  })

  it.each([[0, false], [1, false], [2, true]] as const)('with %i runs exercising performer-yields, its pooled line passes: %s', (count, pass) => {
    const report = ownershipReport(pool(seed => ({ rightAtClaim: seed <= count ? 'yields' : 'idle' })), bands)
    expect(pooled(report, 'performer-yields')).toBe(pass)
  })

  it('judges performer-yields only when the right arm gestures at the claim, and fails one that keeps gesturing while owned', () => {
    expect(status(ownershipReport([clip({ rightAtClaim: 'idle' })], bands), 'performer-yields')).toBe('NOT-EXERCISED')
    expect(status(ownershipReport([clip({ rightAtClaim: 'yields' })], bands), 'performer-yields')).toBe('PASS')
    expect(status(ownershipReport([clip({ rightAtClaim: 'keeps-gesturing' })], bands), 'performer-yields')).toBe('FAIL')
    const mixed = ownershipReport(pool(seed => seed === 4 ? { rightAtClaim: 'keeps-gesturing' } : {}), bands)
    expect(mixed.detail.verdict).toBe('FAIL')
    expect(pooled(mixed, 'performer-yields')).toBe(false)
  })

  it('judges resume-after-cancel only for a poke inside a gesture unit, and fails a unit that stalls at the poke', () => {
    const outside = ownershipReport([clip({ pokeOutsideUnit: true })], bands)
    expect(status(outside, 'resume-after-cancel')).toBe('NOT-EXERCISED')
    expect(status(outside, 'poke-continuous')).toBe('NOT-EXERCISED')
    expect(status(ownershipReport([clip()], bands), 'resume-after-cancel')).toBe('PASS')
    const stalled = ownershipReport([clip({ left: 'stalls-at-poke' })], bands)
    expect(stalled.detail.runs[0].requirements.find(r => r.id === 'resume-after-cancel')).toMatchObject({ status: 'FAIL', value: expect.stringContaining('missed') })
  })

  it('judges the spike rate only on arms free at the poke, and fails a skipped rate on a free arm', () => {
    expect(status(ownershipReport([clip({ spikes: { right: 'SKIPPED' } })], bands), 'poke-continuous')).toBe('PASS')
    expect(status(ownershipReport([clip({ spikes: { left: 'SKIPPED' } })], bands), 'poke-continuous')).toBe('FAIL')
  })

  it('does not count the clip\'s release fade from a raised pose as a stale stroke, and fails activation or a stroke after it', () => {
    expect(status(ownershipReport([clip()], bands), 'no-stale-stroke')).toBe('PASS')
    expect(status(ownershipReport([clip({ rightAfterRelease: 'activation' })], bands), 'no-stale-stroke')).toBe('FAIL')
    expect(status(ownershipReport([clip({ rightAfterRelease: 'stroke-after-fade' })], bands), 'no-stale-stroke')).toBe('FAIL')
  })

  it('takes the free left arm\'s posture into the rest band, fails a stroke pose and refuses while the left arm is in a unit', () => {
    // The surprised posture both arms take after the poke (review section 4): clavicle +4.5, flexion -2.8, abduction +7, elbow +8.7 degrees.
    const surprised = [4.5, 0, -2.8, 7, 0, 8.7, 0, 0, 0]
    expect(status(ownershipReport([clip({ rest: { left: surprised, right: surprised } })], bands), 'rest-band')).toBe('PASS')
    expect(status(ownershipReport([clip({ rest: { left: surprised, right: [0, 0, 0, 0, 0, 77, 0, 0, 0] } })], bands), 'rest-band')).toBe('FAIL')
    expect(status(ownershipReport([clip({ leftUnitAtRest: true })], bands), 'rest-band')).toBe('REFUSED')
  })

  it('fails a write deviation of 0.002 rad on a fully owned arm', () => {
    expect(status(ownershipReport([clip({ deviation: 0.002 })], bands), 'owned-arm-untouched')).toBe('FAIL')
  })

  it('fails the vacuous case in which no arm gestures', () => {
    const report = ownershipReport([clip({ left: 'none' })], bands)
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
