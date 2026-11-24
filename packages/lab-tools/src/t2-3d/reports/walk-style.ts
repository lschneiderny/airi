import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Vec3 } from '../metrics'
import type { LoadedRun } from './report'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { DEG, HZ, mean, median, norm, sub } from '@proj-airi/qa-tools/t2-3d/metrics/math'

import { jointPositions } from '../metrics/gait'
import { runs } from '../metrics/segments'
import { fixed, ReportUsageError } from './report'

export const WALK_STYLE_VERSION = 2

/** How steady straight walking is found; the measures are those of the walk style plan, section 1. */
const S = {
  /** The locomotion mode channel's `walking` value: starts, stops, turns on the spot and idle are left out. */
  walkingMode: 3,
  /** Half-width of the centred difference that gives the travel heading and speed, frames (1 s in all). */
  travelHalfWindow: 30,
  /** Travel heading rate over the same 1 s, above which a frame turns, deg/s; a step's sway reads under 7. */
  turnRate: 15,
  /** Trimmed from each end of a steady span, s, so the easing into and out of a start, stop or turn is left out. */
  trim: 0.5,
  /** Shortest steady span kept after trimming, s: about four steps. */
  minSpan: 3,
  /** A heel strike is the foot's largest forward reach within this many seconds either side. */
  peakHalfWindow: 0.25,
  /** A stance (heel strike to the same foot's toe-off) is kept between these lengths, s. */
  stance: [0.3, 1.2],
} as const

export const WALK_STYLE_KEYS = ['speed', 'cadence', 'step', 'bounce', 'pelvisTwist', 'shoulderTwist', 'pelvisList', 'width', 'armSwing', 'elbow', 'trunk', 'head', 'lift', 'kneeSwing'] as const
export type WalkStyleKey = typeof WALK_STYLE_KEYS[number]
export type WalkStyleMeasures = Readonly<Record<WalkStyleKey, number | null>>

const SET1 = 'Bandai Namco Research Motiondataset 1, walk styles (CC BY-NC 4.0), plan walk-style.md section 1'

/**
 * Each measure, its unit and the human range it is printed beside: the smallest and largest style value over acted
 * walking styles. The range is the styles' spread, not a target.
 */
export const WALK_STYLE_MEASURES: Readonly<Record<WalkStyleKey, { readonly label: string, readonly unit: string, readonly digits: number, readonly range: readonly [number, number], readonly measure: string, readonly source: string }>> = {
  speed: { label: 'speed', unit: 'L/s', digits: 3, range: [0.61, 1.92], measure: 'mean hip-midpoint ground speed over a 1 s centred difference', source: `${SET1}: sad 0.61 to active 1.92` },
  cadence: { label: 'cadence', unit: 'steps/s', digits: 3, range: [1.12, 2.15], measure: '1 / mean interval between alternating heel strikes', source: `${SET1}: sad 1.12 to angry 2.15` },
  step: { label: 'step length', unit: 'L', digits: 3, range: [0.50, 1.01], measure: 'speed / cadence', source: `${SET1}: old 0.50 to active 1.01` },
  bounce: { label: 'bounce', unit: 'L', digits: 3, range: [0.015, 0.129], measure: 'median per step of the hip midpoint\'s vertical peak-to-peak', source: `${SET1}: sad 0.015 to happy 0.129` },
  pelvisTwist: { label: 'pelvis twist', unit: 'deg', digits: 1, range: [12.5, 35.3], measure: 'P95 - P5 of the hip line\'s yaw against the travel heading', source: `${SET1}, all 15 styles measured with this report's measures on 2026-11-23: old 12.5 to sad 35.3` },
  shoulderTwist: { label: 'shoulder twist', unit: 'deg', digits: 1, range: [4.8, 31.4], measure: 'P95 - P5 of the shoulder line\'s yaw against the travel heading', source: `${SET1}, all 15 styles measured with this report's measures on 2026-11-23: masculinity 4.8 to childish 31.4` },
  pelvisList: { label: 'pelvis list', unit: 'deg', digits: 1, range: [5, 21], measure: 'P95 - P5 of the hip line\'s roll', source: `${SET1}: about 5 (chimpira, tired) to feminine 21` },
  width: { label: 'step width', unit: 'L', digits: 3, range: [0.02, 0.38], measure: 'median lateral distance between the ankles at consecutive heel strikes', source: `${SET1}: feminine 0.02 to giant 0.38` },
  armSwing: { label: 'arm swing', unit: 'deg', digits: 1, range: [8, 103], measure: 'P95 - P5 of the shoulder-to-wrist line\'s sagittal angle, mean of both arms', source: `${SET1} and set 2: not-confident 8 to 103` },
  elbow: { label: 'elbow carry', unit: 'deg', digits: 1, range: [14, 79], measure: 'mean elbow flexion, mean of both arms', source: `${SET1}: normal 14 to proud 79` },
  trunk: { label: 'trunk lean', unit: 'deg', digits: 1, range: [-2.9, 18.9], measure: 'mean pitch of the hip-midpoint-to-neck line along the travel heading, positive forward; compare within one rig only', source: `${SET1}, all 15 styles measured with this report's measures on 2026-11-24: feminine -2.9 to old 18.9` },
  head: { label: 'head carriage', unit: 'deg', digits: 1, range: [-17, 37], measure: 'mean pitch of the neck-to-head line along the travel heading, positive forward; compare within one source only', source: `${SET1}: proud -17 to tired 37` },
  lift: { label: 'foot lift', unit: 'L', digits: 3, range: [0.13, 0.20], measure: 'P97 - P3 of the ankle height, mean of both feet', source: `${SET1}: sad 0.13 to active 0.20` },
  kneeSwing: { label: 'knee swing', unit: 'deg', digits: 1, range: [70, 79], measure: 'median peak knee flexion from toe-off to the same foot\'s next heel strike', source: 'Bandai Namco Research Motiondataset 2, seven walk styles, plan walk-style.md section 1: 70 to 79' },
}

/** Linear-interpolated percentile of sorted samples, as `metrics/gait.ts` reads P5 and P95. */
function percentile(x: readonly number[], fraction: number): number {
  const a = [...x].sort((p, q) => p - q)
  const index = fraction * (a.length - 1)
  const low = Math.floor(index)
  return a[low] + (index - low) * (a[Math.ceil(index)] - a[low])
}

const spread = (x: readonly number[], low: number) => x.length ? percentile(x, 1 - low) - percentile(x, low) : null
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b) + 1e-12)))) * DEG
const wrap = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

function unwrapDeg(x: readonly number[]): number[] {
  const out: number[] = []
  for (const v of x)
    out.push(out.length ? out[out.length - 1] + wrap(v - out[out.length - 1]) : v)
  return out
}

function boxSmooth(x: readonly number[], half: number): number[] {
  return x.map((_, i) => {
    const from = Math.max(0, i - half)
    const to = Math.min(x.length, i + half + 1)
    return mean(x.slice(from, to))
  })
}

/** Frames whose value is the strict extreme of `x` within `half` frames either side, as the gait finder reads a step. */
function extremes(x: readonly number[], half: number, sign: 1 | -1): number[] {
  const found: number[] = []
  for (let i = 2; i < x.length - 2; i++) {
    const v = sign * x[i]
    if (v >= sign * x[i - 1] && v > sign * x[i + 1] && v > 0 && v === Math.max(...x.slice(Math.max(0, i - half), i + half + 1).map(y => sign * y)))
      found.push(i)
  }
  return found
}

export interface WalkStyleReading {
  readonly dir: string
  readonly scenario: string
  readonly seed: number | null
  /** The run's held overrides, as its trace source records them. */
  readonly overrides: string
  /** Steady straight spans measured, trace seconds. */
  readonly spans: readonly { readonly from: number, readonly to: number }[]
  readonly steps: number
  readonly measures: WalkStyleMeasures
}

/**
 * The walk style plan's section 1 measures over steady straight walking: frames the locomotion mode channel reads as
 * walking and the travel heading turns slower than 15 deg/s, trimmed 0.5 s at each end, in spans of at least 3 s.
 * Steps are found per span, as peaks of each foot's forward reach from the hip midpoint along the travel heading.
 */
export function walkStyleReading(run: LoadedRun): WalkStyleReading {
  const { p, input } = run
  const L = input.trace.rig.legLength
  const positions = jointPositions(p)
  const need = (bone: MotionTraceBone): readonly Vec3[] => {
    const series = positions[bone]
    if (!series)
      throw new ReportUsageError(`${run.dir}: walk-style needs the ${bone} bone`)
    return series
  }
  const J = {
    lhip: need('leftUpperLeg'),
    rhip: need('rightUpperLeg'),
    lknee: need('leftLowerLeg'),
    rknee: need('rightLowerLeg'),
    lankle: need('leftFoot'),
    rankle: need('rightFoot'),
    neck: need('neck'),
    head: need('head'),
    lsh: need('leftUpperArm'),
    rsh: need('rightUpperArm'),
    lel: need('leftLowerArm'),
    rel: need('rightLowerArm'),
    lwr: need('leftHand'),
    rwr: need('rightHand'),
  }
  const n = p.times.length
  const hips = J.lhip.map((v, i) => mid(v, J.rhip[i]))

  // Travel heading and speed from a 1 s centred difference of the hip midpoint, so a step's sway is not a turn.
  const w = S.travelHalfWindow
  const velocity = hips.map((_, f) => {
    const a = Math.max(0, f - w)
    const b = Math.min(n - 1, f + w)
    const dt = Math.max(1, b - a) / HZ
    return [(hips[b][0] - hips[a][0]) / dt, (hips[b][2] - hips[a][2]) / dt] as const
  })
  const travel = unwrapDeg(velocity.map(([x, z]) => Math.atan2(x, z) * DEG))
  const speed = velocity.map(([x, z]) => Math.hypot(x, z) / L)

  // The yaw of a joint line (right to left) against the travel heading; the side convention is fixed by the mean.
  const lineYaw = (right: readonly Vec3[], left: readonly Vec3[]) => {
    const raw = right.map((r, f) => {
      const d = sub(left[f], r)
      return wrap(Math.atan2(-d[2], d[0]) * DEG - travel[f])
    })
    const c = mean(raw.map(v => Math.cos(v / DEG)))
    return c < 0 ? raw.map(v => wrap(v + 180)) : raw
  }
  const pelvisYaw = lineYaw(J.rhip, J.lhip)
  const shoulderYaw = lineYaw(J.rsh, J.lsh)

  // Steady straight walking.
  const mode = p.channels[MOTION_TRACE_CHANNELS.indexOf('locomotionMode')]
  const turnRate = (f: number) => {
    const a = Math.max(0, f - w)
    const b = Math.min(n - 1, f + w)
    return Math.abs(travel[b] - travel[a]) * HZ / Math.max(1, b - a)
  }
  // The mode channel is interpolated onto the scored grid, so it is rounded back to its mode.
  const steadyFrame = travel.map((_, f) => Math.round(mode[f]) === S.walkingMode && turnRate(f) < S.turnRate)
  const trim = Math.round(S.trim * HZ)
  const spans = runs(steadyFrame).map(span => ({ start: span.start + trim, end: span.end - trim })).filter(span => span.end - span.start >= S.minSpan * HZ)

  const forward = (v: Vec3, f: number) => {
    const h = travel[f] / DEG
    return v[0] * Math.sin(h) + v[2] * Math.cos(h)
  }
  const lateral = (v: Vec3, f: number) => {
    const h = travel[f] / DEG
    return v[0] * Math.cos(h) - v[2] * Math.sin(h)
  }
  const knee = (side: 'l' | 'r', f: number) => angle(sub(J[`${side}knee`][f], J[`${side}hip`][f]), sub(J[`${side}ankle`][f], J[`${side}knee`][f]))

  const frames: number[] = []
  const stepIntervals: number[] = []
  const bounces: number[] = []
  const widths: number[] = []
  const kneeSwings: number[] = []
  let strikes = 0
  for (const { start, end } of spans) {
    for (let f = start; f < end; f++)
      frames.push(f)
    const events = Object.fromEntries((['l', 'r'] as const).map((side) => {
      const reach = boxSmooth(Array.from({ length: end - start }, (_, i) => forward(sub(J[`${side}ankle`][start + i], hips[start + i]), start + i)), Math.max(1, Math.round(HZ / 30)))
      const half = Math.round(HZ * S.peakHalfWindow)
      return [side, { strikes: extremes(reach, half, 1).map(i => start + i), toeOffs: extremes(reach, half, -1).map(i => start + i) }]
    })) as Record<'l' | 'r', { strikes: number[], toeOffs: number[] }>
    const heelStrikes = (['l', 'r'] as const).flatMap(side => events[side].strikes.map(f => ({ f, side }))).sort((a, b) => a.f - b.f)
    strikes += heelStrikes.length
    for (let i = 1; i < heelStrikes.length; i++) {
      const a = heelStrikes[i - 1]
      const b = heelStrikes[i]
      if (a.side !== b.side)
        stepIntervals.push((b.f - a.f) / HZ)
      const heights = hips.slice(a.f, b.f + 1).map(v => v[1] / L)
      bounces.push(Math.max(...heights) - Math.min(...heights))
      widths.push(Math.abs(lateral(sub(J[`${b.side}ankle`][b.f], J[`${a.side}ankle`][a.f]), a.f)) / L)
    }
    for (const side of ['l', 'r'] as const) {
      const { strikes: own, toeOffs } = events[side]
      for (const a of own) {
        const b = toeOffs.find(x => x > a)
        if (b === undefined || b - a < S.stance[0] * HZ || b - a > S.stance[1] * HZ)
          continue
        const next = own.find(x => x > b)
        if (next !== undefined)
          kneeSwings.push(Math.max(...Array.from({ length: next - b + 1 }, (_, k) => knee(side, b + k))))
      }
    }
  }

  const over = (value: (f: number) => number) => frames.map(value)
  const sides = (value: (side: 'l' | 'r') => number | null) => {
    const l = value('l')
    const r = value('r')
    return l === null || r === null ? null : (l + r) / 2
  }
  const speedMean = frames.length ? mean(over(f => speed[f])) : null
  const cadence = stepIntervals.length >= 3 ? 1 / mean(stepIntervals) : null
  const sagittal = (from: readonly Vec3[], to: readonly Vec3[], f: number) => {
    const d = sub(to[f], from[f])
    return Math.atan2(forward(d, f), -d[1]) * DEG
  }
  const measures: WalkStyleMeasures = {
    speed: speedMean,
    cadence,
    step: speedMean !== null && cadence !== null ? speedMean / cadence : null,
    bounce: bounces.length ? median(bounces) : null,
    pelvisTwist: spread(over(f => pelvisYaw[f]), 0.05),
    shoulderTwist: spread(over(f => shoulderYaw[f]), 0.05),
    pelvisList: spread(over((f) => {
      const d = sub(J.lhip[f], J.rhip[f])
      return Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG
    }), 0.05),
    width: widths.length ? median(widths) : null,
    armSwing: sides(side => spread(over(f => sagittal(J[`${side}sh`], J[`${side}wr`], f)), 0.05)),
    elbow: frames.length ? sides(side => mean(over(f => angle(sub(J[`${side}el`][f], J[`${side}sh`][f]), sub(J[`${side}wr`][f], J[`${side}el`][f]))))) : null,
    trunk: frames.length
      ? mean(over((f) => {
          const d = sub(J.neck[f], hips[f])
          return Math.atan2(forward(d, f), d[1]) * DEG
        }))
      : null,
    head: frames.length
      ? mean(over((f) => {
          const d = sub(J.head[f], J.neck[f])
          return Math.atan2(forward(d, f), d[1]) * DEG
        }))
      : null,
    lift: sides(side => spread(over(f => J[`${side}ankle`][f][1] / L), 0.03)),
    kneeSwing: kneeSwings.length ? median(kneeSwings) : null,
  }
  const detail = input.trace.source.detail
  const overrides = ['walkStyle', 'mood', 'energy'].flatMap(key => detail[key] === undefined ? [] : [`${key} ${String(detail[key])}`]).join('; ') || 'none'
  return {
    dir: run.dir,
    scenario: input.trace.source.scenario.id,
    seed: input.trace.source.scenario.seed,
    overrides,
    spans: spans.map(span => ({ from: p.times[span.start], to: p.times[span.end - 1] })),
    steps: strikes,
    measures,
  }
}

const value = (key: WalkStyleKey, v: number | null) => fixed(v, WALK_STYLE_MEASURES[key].digits)
function place(key: WalkStyleKey, v: number | null) {
  if (v === null)
    return '-'
  // Placed as printed, so a value shown at a range end reads inside.
  const shown = Number(value(key, v))
  const [lo, hi] = WALK_STYLE_MEASURES[key].range.map(end => Number(value(key, end)))
  return shown < lo ? 'below' : shown > hi ? 'above' : 'inside'
}

/** One run: each measure beside its human range, with how it was measured and where the range comes from. */
export function formatWalkStyle(reading: WalkStyleReading): string {
  const rows = WALK_STYLE_KEYS.map((key) => {
    const m = WALK_STYLE_MEASURES[key]
    const [lo, hi] = m.range
    return `  ${m.label.padEnd(15)}${value(key, reading.measures[key]).padStart(9)} ${m.unit.padEnd(8)} human ${value(key, lo)} to ${value(key, hi)}  ${place(key, reading.measures[key])}`
  })
  return `${[
    `walk-style version ${WALK_STYLE_VERSION}: ${reading.dir}`,
    `scenario ${reading.scenario}, seed ${reading.seed}, overrides: ${reading.overrides}`,
    `steady straight walking: ${reading.spans.map(span => `${span.from.toFixed(2)}-${span.to.toFixed(2)} s`).join(', ') || 'none'} (${reading.steps} heel strikes)`,
    'measures (L is the rig\'s leg length):',
    ...rows,
    'how each is measured, and the human range\'s source:',
    ...WALK_STYLE_KEYS.map(key => `  ${WALK_STYLE_MEASURES[key].label}: ${WALK_STYLE_MEASURES[key].measure} (${WALK_STYLE_MEASURES[key].source})`),
    'limits: ranges are the spread of acted styles, one actor per set, not targets; head carriage differs between sources by its rest pose, so compare it within one rig. Measures read the posed trace, not the style\'s inputs.',
  ].join('\n')}\n`
}

/** Several runs: one row per run, then the human range of each column. */
export function formatWalkStyleTable(readings: readonly WalkStyleReading[]): string {
  const name = (r: WalkStyleReading) => r.dir.split('/').filter(Boolean).pop() ?? r.dir
  const width = Math.max(10, ...readings.map(r => name(r).length)) + 2
  const header = `${'run'.padEnd(width)}${WALK_STYLE_KEYS.map(key => key.slice(0, 9).padStart(10)).join('')}`
  return `${[
    `walk-style version ${WALK_STYLE_VERSION}: ${readings.length} runs; lengths in L, angles in degrees, speed L/s, cadence steps/s`,
    header,
    ...readings.map(r => `${name(r).padEnd(width)}${WALK_STYLE_KEYS.map(key => value(key, r.measures[key]).padStart(10)).join('')}`),
    `${'human min'.padEnd(width)}${WALK_STYLE_KEYS.map(key => value(key, WALK_STYLE_MEASURES[key].range[0]).padStart(10)).join('')}`,
    `${'human max'.padEnd(width)}${WALK_STYLE_KEYS.map(key => value(key, WALK_STYLE_MEASURES[key].range[1]).padStart(10)).join('')}`,
    ...readings.map(r => `${name(r)}: overrides ${r.overrides}; ${r.spans.length} steady spans, ${r.steps} heel strikes`),
    'human range sources:',
    ...WALK_STYLE_KEYS.map(key => `  ${key}: ${WALK_STYLE_MEASURES[key].source}`),
    'Run one report per run for how each measure is read.',
  ].join('\n')}\n`
}
