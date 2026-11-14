import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Vec3 } from '../metrics'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { stageGateThresholds } from '../../stage/gates'
import { butterworth } from '../metrics/filter'
import { jointPositions } from '../metrics/gait'
import { DEG, heading, HZ, median, norm, rotate, sub, unwrap } from '../metrics/math'
import { peaks, runs } from '../metrics/segments'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, ReportUsageError, requireSummary } from './report'

export const WALK_FORM_VERSION = 4

const C = {
  walkingSpeed: 0.2,
  minStrides: 10,
  heelPitchDeg: 5.48,
  toePitchDeg: -7.79,
  contactFrames: 8,
  minReach: 0.25,
  lagFrames: 15,
  minLagMs: 33,
  minR: 0.5,
  minWindows: 3,
  turnBefore: 1,
  turnAfter: 1.5,
  minLeadMs: 33,
  turnRate: 0.5,
  walkingSpan: 20,
  minTurns: 8,
  turnAround: 135,
} as const

export const WALK_FORM_CONSTANTS: readonly ReportConstant[] = [
  { name: 'walking', value: C.walkingSpeed, unit: 'L/s root speed', source: 'gate walk eligibility, metrics/prepare.ts' },
  { name: 'strides', value: C.minStrides, unit: 'per foot (max over feet)', source: 'gate gait stride minimum, metrics/gait.ts' },
  { name: 'heel-strike pitch', value: C.heelPitchDeg, unit: 'deg, at least, every heel strike', source: 'plan R2a: 0.5 x bands-v3 walk gait.heelStrikePitchDeg p5 10.95' },
  { name: 'toe-off pitch', value: C.toePitchDeg, unit: 'deg, at most, every toe-off', source: 'plan R2a: 0.5 x bands-v3 walk gait.toeOffPitchDeg p95 -15.57' },
  { name: 'contact window', value: C.contactFrames, unit: '+- frames (133 ms) around each step, read at its most rolled frame', source: 'gait review 3 ruling 5: the step finder samples steps 67 to 133 ms before heel contact' },
  { name: 'short step', value: C.minReach, unit: 'of the foot\'s median reach for the event, under which a step is not judged', source: 'gait review 3 ruling 5: a closing step is set down near flat beside the other foot; in the labelled base runs closing and planted steps reach 0.00 to 0.09 and full steps 0.57 or more' },
  { name: 'skate', value: stageGateThresholds.walkSkateMax, unit: 'model units, exclusive', source: 'stage-walk-skate, stage/gates.ts' },
  { name: 'feet error', value: stageGateThresholds.walkFeetErrorMax, unit: 'model units, exclusive', source: 'stage-walk-skate, stage/gates.ts' },
  { name: 'forearm lag', value: C.minLagMs, unit: 'ms, median over windows, at least', source: 'plan R2c: two 60 Hz frames' },
  { name: 'lag search', value: C.lagFrames, unit: '+- frames', source: 'gate gait.armSwingLagMs range, metrics/gait.ts' },
  { name: 'lag correlation', value: C.minR, unit: 'median signed r, at least', source: 'plan R2c' },
  { name: 'windows', value: C.minWindows, unit: 'walk windows, at least', source: 'gate character window minimum, metrics/result.ts' },
  { name: 'turn window', value: `-${C.turnBefore}..+${C.turnAfter}`, unit: 's around each turning span', source: 'plan R2d' },
  { name: 'head lead', value: C.minLeadMs, unit: 'ms, printed per turn, not judged: inside the noise of a product with no designed lead', source: 'plan R2d; rules.md revision 2, B3' },
  { name: 'turn', value: C.turnRate, unit: 'rad/s, travel heading rate above which a frame turns; the travel heading is the root yaw low-passed at 0.5 Hz, without the pelvis twist of each stride', source: 'gate turn peaks on the same series, metrics/gait.ts; goal 4 unit M2 rules section 5' },
  { name: 'walking span', value: C.walkingSpan, unit: 's of continuous walking, at least (W1)', source: 'three 10 s gate windows, metrics/prepare.ts' },
  { name: 'turns', value: C.minTurns, unit: 'turns in the travel heading, at least (W3)', source: 'gait.headLeadMs episode minimum (O5)' },
  { name: 'turn-around', value: C.turnAround, unit: 'deg of travel heading in one turn, more than (W4)', source: 'C002 "a turn-around"' },
]

const SIDES = ['left', 'right'] as const

function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length
  if (n < 2)
    return null
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null
}

/** Yaw of a world orientation's forward axis about +Y, radians, as `metrics/gait.ts` measures twist. */
function forwardYaw(q: readonly [number, number, number, number]): number {
  const f = rotate(q, [0, 0, 1])
  return Math.atan2(f[0], f[2])
}

/** The first sample in [from, to] at which `y` has covered half its change over that span; null without a change. */
function halfway(y: readonly number[], from: number, to: number): number | null {
  const change = y[to] - y[from]
  if (Math.abs(change) < 1e-6)
    return null
  for (let i = from; i <= to; i++) {
    if ((y[i] - y[from]) / change >= 0.5)
      return i
  }
  return to
}

export interface WalkFormDetail {
  readonly strides: number
  readonly heel: readonly number[]
  readonly toe: readonly number[]
  /** Every heel strike and toe-off that fails the roll rule, in time order; printed, so the review can find each step. */
  readonly flatSteps: readonly { readonly t: number, readonly foot: 'left' | 'right', readonly event: 'heel-strike' | 'toe-off', readonly pitch: number }[]
  /** Steps under the short-step reach, not judged, with their reach as a share of the foot's median, in time order. */
  readonly shortSteps: readonly { readonly t: number, readonly foot: 'left' | 'right', readonly event: 'heel-strike' | 'toe-off', readonly reach: number }[]
  readonly skateField: 'skateContact' | 'skate'
  readonly skate: number | null
  readonly feetError: number | null
  readonly lags: Readonly<Record<'left' | 'right', readonly { readonly start: number, readonly lagMs: number, readonly r: number }[]>>
  readonly turns: readonly { readonly start: number, readonly end: number, readonly rootDeg: number, readonly headDeg: number, readonly leadMs: number | null }[]
  readonly counterCorrelation: number | null
}

/**
 * C002 and C003 (plan R2, revision 2): the scenario's walking span, strides, turns and turn-around (W1 to W4, read as not
 * exercised when missing), roll on every step, contact skate and forearm lag; turns come from the travel heading (the root
 * yaw low-passed at 0.5 Hz, so the pelvis twist of each stride is not a turn), and each turn's head lead is printed, not
 * judged.
 */
export function walkFormReport(run: LoadedRun): CaseReport<WalkFormDetail> {
  const { p, input } = run
  if (input.trace.source.scenario.class !== 'walk')
    throw new ReportUsageError(`${run.dir}: walk-form judges a walk-class run, not ${input.trace.source.scenario.class}`)
  const summary = requireSummary(run)
  const positions = jointPositions(p)
  const need = (bone: MotionTraceBone) => {
    const series = positions[bone]
    const q = p.orientations[bone]
    if (!series || !q)
      throw new ReportUsageError(`${run.dir}: walk-form needs the ${bone} bone`)
    return { series, q }
  }
  const legLength = input.trace.rig.legLength
  const walking = p.rootVelocity.map(v => norm(v) > C.walkingSpeed)
  const walkingSpans = runs(walking)
  const pitch = (q: readonly (readonly [number, number, number, number])[], i: number) => Math.asin(Math.max(-1, Math.min(1, rotate(q[i], [0, 0, 1])[1]))) * DEG

  // (a) Steps as metrics/gait.ts detects them: peaks of the foot's fore-aft displacement from the root. That frame comes
  // before contact, so a step is read at its most rolled frame in the contact window; a short step (a closing step, a
  // planted foot's blip) is not judged.
  const heel: number[] = []
  const toe: number[] = []
  const flatSteps: { t: number, foot: 'left' | 'right', event: 'heel-strike' | 'toe-off', pitch: number }[] = []
  const shortSteps: { t: number, foot: 'left' | 'right', event: 'heel-strike' | 'toe-off', reach: number }[] = []
  const strideCounts = SIDES.map((side) => {
    const { series, q } = need(`${side}Foot`)
    const d = butterworth(series.slice(0, walking.length).map((v, i) => heading(sub(v, p.rootPosition[i]), p.yaw[i])[2] / legLength), 6)
    const heels = peaks(d, Number.NEGATIVE_INFINITY).filter(i => walking[i])
    const toes = peaks(d.map(v => -v), Number.NEGATIVE_INFINITY).filter(i => walking[i])
    const contact = (i: number) => Array.from({ length: 2 * C.contactFrames + 1 }, (_, k) => i - C.contactFrames + k).filter(k => k >= 0 && k < q.length).map(k => pitch(q, k))
    const judge = (event: 'heel-strike' | 'toe-off', steps: readonly number[]) => {
      const sign = event === 'heel-strike' ? 1 : -1
      const typical = median(steps.map(i => sign * d[i]))
      for (const i of steps) {
        const reach = sign * d[i] / typical
        if (reach < C.minReach) {
          shortSteps.push({ t: p.times[i], foot: side, event, reach })
          continue
        }
        const rolled = sign > 0 ? Math.max(...contact(i)) : Math.min(...contact(i))
        const list = sign > 0 ? heel : toe
        list.push(rolled)
        if (sign > 0 ? rolled < C.heelPitchDeg : rolled > C.toePitchDeg)
          flatSteps.push({ t: p.times[i], foot: side, event, pitch: rolled })
      }
    }
    judge('heel-strike', heels)
    judge('toe-off', toes)
    return walkingSpans.reduce((n, span) => n + Math.max(0, heels.filter(i => i >= span.start && i < span.end).length - 1), 0)
  })
  const strides = Math.max(...strideCounts)
  const flatHeels = heel.filter(v => v < C.heelPitchDeg).length
  const flatToes = toe.filter(v => v > C.toePitchDeg).length
  const rollRule = `every heel strike >= ${C.heelPitchDeg} deg and every toe-off <= ${C.toePitchDeg} deg at its most rolled frame within ${C.contactFrames} frames; a step reaching under ${C.minReach} of its foot's median reach is not judged`

  // (b) The summary's per-frame series over walking, starting and stopping frames.
  const { columns, rows } = summary.perFrameSeries
  const column = (name: string) => columns.indexOf(name)
  if (column('mode') < 0 || column('skate') < 0 || column('feetMaxError') < 0)
    throw new ReportUsageError(`${run.dir}: summary.json perFrameSeries needs mode, skate and feetMaxError`)
  const skateField = column('skateContact') >= 0 ? 'skateContact' : 'skate'
  const moving = rows.filter(row => ['walking', 'starting', 'stopping'].includes(String(row[column('mode')])))
  const maxOf = (name: string) => moving.length ? Math.max(...moving.map(row => Number(row[column(name)]))) : null
  const skate = maxOf(skateField)
  const feetError = maxOf('feetMaxError')
  const walkedRows = moving.some(row => row[column('mode')] === 'walking')

  // (c) World sagittal swing angles of the upper-arm and forearm segments in the heading frame.
  const sagittal = (from: readonly Vec3[], to: readonly Vec3[]) => from.map((v, i) => {
    const h = heading(sub(to[i], v), p.yaw[Math.min(i, p.yaw.length - 1)])
    return Math.atan2(h[2], -h[1])
  })
  const lags = Object.fromEntries(SIDES.map((side) => {
    const upper = sagittal(need(`${side}UpperArm`).series, need(`${side}LowerArm`).series)
    const fore = sagittal(need(`${side}LowerArm`).series, need(`${side}Hand`).series)
    return [side, p.windows.flatMap((w) => {
      let best: { lag: number, r: number } | null = null
      for (let k = -C.lagFrames; k <= C.lagFrames; k++) {
        const a: number[] = []
        const b: number[] = []
        for (let t = w.start; t < w.end; t++) {
          if (t + k >= w.start && t + k < w.end) {
            a.push(upper[t])
            b.push(fore[t + k])
          }
        }
        const r = pearson(a, b)
        if (r !== null && (best === null || r > best.r))
          best = { lag: k, r }
      }
      return best ? [{ start: p.times[w.start], lagMs: best.lag * 1000 / HZ, r: best.r }] : []
    })]
  })) as Record<'left' | 'right', { start: number, lagMs: number, r: number }[]>
  const sideLine = (side: 'left' | 'right') => {
    const list = lags[side]
    return list.length ? { lag: median(list.map(l => l.lagMs)), r: median(list.map(l => l.r)) } : null
  }
  const sideResults = SIDES.map(side => ({ side, value: sideLine(side) }))
  const lagRule = `per side, median over walk windows of the forearm swing lag behind the upper arm >= ${C.minLagMs} ms at the lag of maximum signed r, median r >= ${C.minR}`

  // (d) Turns from the travel heading (not the product's mode channel); the head lead is printed for each.
  const travel = p.yaw
  const headYaw = unwrap(need('head').q.map(forwardYaw))
  const turning = runs(travel.map((yaw, i) => i > 0 && Math.abs(yaw - travel[i - 1]) * HZ > C.turnRate))
  const last = p.times.length - 1
  const turns = turning.map((span) => {
    const from = Math.max(0, span.start - Math.round(C.turnBefore * HZ))
    const to = Math.min(last, span.end - 1 + Math.round(C.turnAfter * HZ))
    const root = halfway(travel, from, to)
    const head = halfway(headYaw, from, to)
    return {
      start: p.times[span.start],
      end: p.times[span.end - 1],
      rootDeg: (travel[span.end - 1] - travel[Math.max(0, span.start - 1)]) * DEG,
      headDeg: (headYaw[to] - headYaw[from]) * DEG,
      leadMs: root === null || head === null ? null : (root - head) * 1000 / HZ,
    }
  })
  const turnAround = turns.some(turn => Math.abs(turn.rootDeg) > C.turnAround)
  const longestWalk = walkingSpans.reduce((longest, span) => Math.max(longest, (span.end - span.start) / HZ), 0)
  const fewestStrides = Math.min(...strideCounts)
  const scenario = (id: string, rule: string, value: string, met: boolean) => met ? judged(id, rule, value, true) : notExercised(id, rule, value)

  // (e) Informative: pelvis twist against chest-on-pelvis yaw over walking frames.
  const hips = unwrap(need('hips').q.map(forwardYaw))
  const chest = unwrap(need('chest').q.map(forwardYaw))
  const walkingFrames = walking.flatMap((on, i) => on ? [i] : [])
  const counterCorrelation = pearson(walkingFrames.map(i => hips[i] - p.yaw[i]), walkingFrames.map(i => chest[i] - hips[i]))

  const requirements: CaseRequirement[] = [
    scenario('scenario-walking-span', `one continuous walking span of at least ${C.walkingSpan} s (W1)`, `longest ${longestWalk.toFixed(2)} s`, longestWalk >= C.walkingSpan),
    scenario('scenario-strides', `at least ${C.minStrides} strides on each foot inside walking spans (W2)`, `${strideCounts.join(' and ')} strides`, fewestStrides >= C.minStrides),
    scenario('scenario-turns', `at least ${C.minTurns} turns in the travel heading (W3)`, `${turns.length} turns`, turns.length >= C.minTurns),
    scenario('scenario-turn-around', `one turn of more than ${C.turnAround} deg (W4)`, `largest ${turns.length ? Math.max(...turns.map(turn => Math.abs(turn.rootDeg))).toFixed(1) : '-'} deg`, turnAround),
    strides < C.minStrides
      ? notExercised('roll-every-step', rollRule, `${strides} strides on the busier foot, fewer than ${C.minStrides}`)
      : judged('roll-every-step', rollRule, `${heel.length - flatHeels} of ${heel.length} heel strikes and ${toe.length - flatToes} of ${toe.length} toe-offs rolled, ${shortSteps.length} short steps not judged; heel median ${fixed(heel.length ? median(heel) : null, 2)} deg, toe median ${fixed(toe.length ? median(toe) : null, 2)} deg`, flatHeels === 0 && flatToes === 0 && heel.length > 0 && toe.length > 0),
    !walkedRows || skate === null || feetError === null
      ? notExercised('skate', `max ${skateField} and max feetMaxError < ${stageGateThresholds.walkSkateMax} over walking, starting and stopping rows`, 'no walking row in summary.json')
      : judged('skate', `max ${skateField} and max feetMaxError < ${stageGateThresholds.walkSkateMax} over walking, starting and stopping rows`, `max ${skateField} ${skate.toExponential(3)}, max feetMaxError ${feetError.toExponential(3)} over ${moving.length} rows`, skate < stageGateThresholds.walkSkateMax && feetError < stageGateThresholds.walkFeetErrorMax),
    p.windows.length < C.minWindows
      ? notExercised('wrist-lags', lagRule, `${p.windows.length} walk windows, fewer than ${C.minWindows}`)
      : judged('wrist-lags', lagRule, sideResults.map(({ side, value }) => `${side} ${value ? `${value.lag.toFixed(1)} ms, r ${value.r.toFixed(3)}` : 'no window'}`).join('; '), sideResults.every(({ value }) => value !== null && value.lag >= C.minLagMs && value.r >= C.minR)),
  ]
  return caseReport('walk-form', WALK_FORM_VERSION, [run.dir], WALK_FORM_CONSTANTS, requirements, {
    strides,
    heel,
    toe,
    flatSteps: flatSteps.sort((x, y) => x.t - y.t),
    shortSteps: shortSteps.sort((x, y) => x.t - y.t),
    skateField,
    skate,
    feetError,
    lags,
    turns,
    counterCorrelation,
  })
}

export function formatWalkForm(report: CaseReport<WalkFormDetail>): string {
  const d = report.detail
  const range = (x: readonly number[]) => x.length ? `min ${Math.min(...x).toFixed(2)}, median ${median(x).toFixed(2)}, max ${Math.max(...x).toFixed(2)} deg (${x.length})` : 'none'
  return formatCaseReport(report, [
    `strides on the busier foot: ${d.strides}`,
    `heel-strike pitch: ${range(d.heel)}`,
    `toe-off pitch: ${range(d.toe)}`,
    `steps that fail the roll rule (${d.flatSteps.length}): ${d.flatSteps.map(step => `${step.t.toFixed(3)} s ${step.foot} ${step.event} ${step.pitch.toFixed(2)} deg`).join('; ') || 'none'}`,
    `short steps not judged (${d.shortSteps.length}): ${d.shortSteps.map(step => `${step.t.toFixed(3)} s ${step.foot} ${step.event} reach ${step.reach.toFixed(2)}`).join('; ') || 'none'}`,
    `limit: read at the most rolled frame within ${C.contactFrames} frames, the bars (half the reference's P5 and P95 at the displacement peak) are looser than at that peak; a closing or planted step is not judged, so a missing roll on it is not seen.`,
    ...(['left', 'right'] as const).map(side => `${side} forearm lag per window: ${d.lags[side].map(l => `${l.start.toFixed(1)} s ${l.lagMs.toFixed(1)} ms r ${l.r.toFixed(3)}`).join('; ') || 'none'}`),
    `turns in the travel heading (${d.turns.length}); head lead printed, not judged (a ${C.minLeadMs} ms bar sits inside the 0 to 100 ms noise of a product with no designed lead): ${d.turns.filter(turn => turn.leadMs !== null && turn.leadMs >= C.minLeadMs).length} of ${d.turns.length} at least ${C.minLeadMs} ms`,
    ...d.turns.map(turn => `  ${turn.start.toFixed(3)}-${turn.end.toFixed(3)} s\troot ${turn.rootDeg.toFixed(1)} deg\thead ${turn.headDeg.toFixed(1)} deg\tlead ${turn.leadMs === null ? 'no head turn' : `${turn.leadMs.toFixed(1)} ms`}`),
    `counter-rotation (informative, expected <= -0.3): corr(pelvis twist, chest-on-pelvis yaw) ${fixed(d.counterCorrelation)}`,
    'limit (measured by the unit M2 review): the travel heading reads a turn 7 to 9 % small (90 deg reads about 82, 180 about 174), so a 140 deg turn-around reads about 133, under the 135 deg turn-around bar; a turn slower than 0.5 rad/s of travel heading is not a turn.',
  ])
}
