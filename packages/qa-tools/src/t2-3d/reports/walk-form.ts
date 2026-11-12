import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Vec3 } from '../metrics'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { stageGateThresholds } from '../../stage/gates'
import { butterworth } from '../metrics/filter'
import { jointPositions } from '../metrics/gait'
import { DEG, heading, HZ, median, norm, rotate, sub } from '../metrics/math'
import { peaks, runs } from '../metrics/segments'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, ReportUsageError, requireSummary } from './report'

export const WALK_FORM_VERSION = 1

const C = {
  walkingSpeed: 0.2,
  minStrides: 10,
  heelPitchDeg: 5.48,
  toePitchDeg: -7.79,
  lagFrames: 15,
  minLagMs: 33,
  minR: 0.5,
  minWindows: 3,
  turnBefore: 1,
  turnAfter: 1.5,
  minLeadMs: 33,
} as const

export const WALK_FORM_CONSTANTS: readonly ReportConstant[] = [
  { name: 'walking', value: C.walkingSpeed, unit: 'L/s root speed', source: 'gate walk eligibility, metrics/prepare.ts' },
  { name: 'strides', value: C.minStrides, unit: 'per foot (max over feet)', source: 'gate gait stride minimum, metrics/gait.ts' },
  { name: 'heel-strike pitch', value: C.heelPitchDeg, unit: 'deg, at least, every heel strike', source: 'plan R2a: 0.5 x bands-v3 walk gait.heelStrikePitchDeg p5 10.95' },
  { name: 'toe-off pitch', value: C.toePitchDeg, unit: 'deg, at most, every toe-off', source: 'plan R2a: 0.5 x bands-v3 walk gait.toeOffPitchDeg p95 -15.57' },
  { name: 'skate', value: stageGateThresholds.walkSkateMax, unit: 'model units, exclusive', source: 'stage-walk-skate, stage/gates.ts' },
  { name: 'feet error', value: stageGateThresholds.walkFeetErrorMax, unit: 'model units, exclusive', source: 'stage-walk-skate, stage/gates.ts' },
  { name: 'forearm lag', value: C.minLagMs, unit: 'ms, median over windows, at least', source: 'plan R2c: two 60 Hz frames' },
  { name: 'lag search', value: C.lagFrames, unit: '+- frames', source: 'gate gait.armSwingLagMs range, metrics/gait.ts' },
  { name: 'lag correlation', value: C.minR, unit: 'median signed r, at least', source: 'plan R2c' },
  { name: 'windows', value: C.minWindows, unit: 'walk windows, at least', source: 'gate character window minimum, metrics/result.ts' },
  { name: 'turn window', value: `-${C.turnBefore}..+${C.turnAfter}`, unit: 's around each turning span', source: 'plan R2d' },
  { name: 'head lead', value: C.minLeadMs, unit: 'ms, every turn, at least', source: 'plan R2d, D2; architecture 9.3' },
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

function unwrap(x: readonly number[]): number[] {
  let offset = 0
  return x.map((v, i) => {
    if (i > 0)
      offset -= Math.round((v - x[i - 1]) / (2 * Math.PI)) * 2 * Math.PI
    return v + offset
  })
}

/** Yaw of a world orientation's forward axis about +Y, radians, as `metrics/gait.ts` measures twist. */
function forwardYaw(q: readonly [number, number, number, number]): number {
  const f = rotate(q, [0, 0, 1])
  return Math.atan2(f[0], f[2])
}

/** The unfiltered root yaw at each prepared sample, interpolated on the trace's time channel as prepareTrace does. */
function rawRootYaw(run: LoadedRun): number[] {
  const { input, p } = run
  const stride = MOTION_TRACE_CHANNELS.length
  const times = Array.from({ length: input.trace.frames }, (_, i) => input.channels[i * stride])
  const yaw = unwrap(Array.from({ length: input.trace.frames }, (_, i) => input.root[i * 4 + 3]))
  let left = 0
  return p.times.map((t) => {
    while (left + 1 < times.length - 1 && times[left + 1] <= t)
      left++
    const right = Math.min(left + 1, times.length - 1)
    const u = right === left || times[right] === times[left] ? 0 : Math.min(1, Math.max(0, (t - times[left]) / (times[right] - times[left])))
    return yaw[left] + (yaw[right] - yaw[left]) * u
  })
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
  readonly skateField: 'skateContact' | 'skate'
  readonly skate: number | null
  readonly feetError: number | null
  readonly lags: Readonly<Record<'left' | 'right', readonly { readonly start: number, readonly lagMs: number, readonly r: number }[]>>
  readonly turns: readonly { readonly start: number, readonly end: number, readonly rootDeg: number, readonly headDeg: number, readonly leadMs: number | null }[]
  readonly counterCorrelation: number | null
}

/** C002 and C003 (plan R2): roll on every step, contact skate, forearm lag and a head that leads every turn. */
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

  // (a) Steps as metrics/gait.ts detects them: peaks of the foot's fore-aft displacement from the root.
  const heel: number[] = []
  const toe: number[] = []
  const strideCounts = SIDES.map((side) => {
    const { series, q } = need(`${side}Foot`)
    const d = butterworth(series.slice(0, walking.length).map((v, i) => heading(sub(v, p.rootPosition[i]), p.yaw[i])[2] / legLength), 6)
    const heels = peaks(d, Number.NEGATIVE_INFINITY).filter(i => walking[i])
    const toes = peaks(d.map(v => -v), Number.NEGATIVE_INFINITY).filter(i => walking[i])
    heel.push(...heels.map(i => pitch(q, i)))
    toe.push(...toes.map(i => pitch(q, i)))
    return walkingSpans.reduce((n, span) => n + Math.max(0, heels.filter(i => i >= span.start && i < span.end).length - 1), 0)
  })
  const strides = Math.max(...strideCounts)
  const flatHeels = heel.filter(v => v < C.heelPitchDeg).length
  const flatToes = toe.filter(v => v > C.toePitchDeg).length
  const rollRule = `every heel strike >= ${C.heelPitchDeg} deg and every toe-off <= ${C.toePitchDeg} deg`

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

  // (d) Every turning span: head world yaw reaches half its change before the unfiltered root yaw.
  const rootYaw = rawRootYaw(run)
  const headYaw = unwrap(need('head').q.map(forwardYaw))
  const turning = runs(p.channels[7].map(mode => mode === 1))
  const last = p.times.length - 1
  const turns = turning.map((span) => {
    const from = Math.max(0, span.start - Math.round(C.turnBefore * HZ))
    const to = Math.min(last, span.end - 1 + Math.round(C.turnAfter * HZ))
    const root = halfway(rootYaw, from, to)
    const head = halfway(headYaw, from, to)
    return {
      start: p.times[span.start],
      end: p.times[span.end - 1],
      rootDeg: (rootYaw[to] - rootYaw[from]) * DEG,
      headDeg: (headYaw[to] - headYaw[from]) * DEG,
      leadMs: root === null || head === null ? null : (root - head) * 1000 / HZ,
    }
  })
  const late = turns.filter(turn => turn.leadMs === null || turn.leadMs < C.minLeadMs)
  const turnRule = `in every turning span (-${C.turnBefore} to +${C.turnAfter} s), head world yaw reaches 50 % of its change >= ${C.minLeadMs} ms before root yaw`

  // (e) Informative: pelvis twist against chest-on-pelvis yaw over walking frames.
  const hips = unwrap(need('hips').q.map(forwardYaw))
  const chest = unwrap(need('chest').q.map(forwardYaw))
  const walkingFrames = walking.flatMap((on, i) => on ? [i] : [])
  const counterCorrelation = pearson(walkingFrames.map(i => hips[i] - p.yaw[i]), walkingFrames.map(i => chest[i] - hips[i]))

  const requirements: CaseRequirement[] = [
    strides < C.minStrides
      ? notExercised('roll-every-step', rollRule, `${strides} strides on the busier foot, fewer than ${C.minStrides}`)
      : judged('roll-every-step', rollRule, `${heel.length - flatHeels} of ${heel.length} heel strikes and ${toe.length - flatToes} of ${toe.length} toe-offs rolled; heel median ${fixed(heel.length ? median(heel) : null, 2)} deg, toe median ${fixed(toe.length ? median(toe) : null, 2)} deg`, flatHeels === 0 && flatToes === 0 && heel.length > 0 && toe.length > 0),
    !walkedRows || skate === null || feetError === null
      ? notExercised('skate', `max ${skateField} and max feetMaxError < ${stageGateThresholds.walkSkateMax} over walking, starting and stopping rows`, 'no walking row in summary.json')
      : judged('skate', `max ${skateField} and max feetMaxError < ${stageGateThresholds.walkSkateMax} over walking, starting and stopping rows`, `max ${skateField} ${skate.toExponential(3)}, max feetMaxError ${feetError.toExponential(3)} over ${moving.length} rows`, skate < stageGateThresholds.walkSkateMax && feetError < stageGateThresholds.walkFeetErrorMax),
    p.windows.length < C.minWindows
      ? notExercised('wrist-lags', lagRule, `${p.windows.length} walk windows, fewer than ${C.minWindows}`)
      : judged('wrist-lags', lagRule, sideResults.map(({ side, value }) => `${side} ${value ? `${value.lag.toFixed(1)} ms, r ${value.r.toFixed(3)}` : 'no window'}`).join('; '), sideResults.every(({ value }) => value !== null && value.lag >= C.minLagMs && value.r >= C.minR)),
    turns.length === 0
      ? notExercised('head-leads-turns', turnRule, 'no turning span')
      : judged('head-leads-turns', turnRule, `${turns.length - late.length} of ${turns.length} turns led by the head`, late.length === 0),
  ]
  return caseReport('walk-form', WALK_FORM_VERSION, [run.dir], WALK_FORM_CONSTANTS, requirements, {
    strides,
    heel,
    toe,
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
    ...(['left', 'right'] as const).map(side => `${side} forearm lag per window: ${d.lags[side].map(l => `${l.start.toFixed(1)} s ${l.lagMs.toFixed(1)} ms r ${l.r.toFixed(3)}`).join('; ') || 'none'}`),
    `turns (${d.turns.length}):`,
    ...d.turns.map(turn => `  ${turn.start.toFixed(3)}-${turn.end.toFixed(3)} s\troot ${turn.rootDeg.toFixed(1)} deg\thead ${turn.headDeg.toFixed(1)} deg\tlead ${turn.leadMs === null ? 'no head turn' : `${turn.leadMs.toFixed(1)} ms`}`),
    `counter-rotation (informative, expected <= -0.3): corr(pelvis twist, chest-on-pelvis yaw) ${fixed(d.counterCorrelation)}`,
  ])
}
