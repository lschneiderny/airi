import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyActId, BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Region } from '../metrics'
import type { CaseReport, CaseRequirement } from './case-report'
import type { LoadedRun, ReportConstant } from './report'

import { percentile } from '../gate/bands'
import { REGIONS } from '../metrics/bones'
import { cv } from '../metrics/math'
import { regionSpeed } from '../metrics/prepare'
import { caseReport, formatCaseReport, judged, notExercised } from './case-report'
import { fixed, gateStatus, markers, ReportUsageError } from './report'

export const IDLE_ACTS_VERSION = 1

/**
 * The gate regions (`metrics/bones.ts`) each act moves, from the channels its phases name in architecture 4e. An act
 * is confirmed on the region speed of the union of these regions' bones.
 */
export const ACT_REGIONS = {
  'sigh': ['trunk', 'head', 'armL', 'armR'],
  'shoulder-roll': ['armL', 'armR', 'head'],
  'foot-replant': ['legs', 'trunk'],
  'look-around': ['head', 'trunk'],
  'hand-inspect': ['armL', 'armR'],
  'clasp-rock': ['armL', 'armR', 'trunk', 'legs'],
  'arm-swing': ['armL', 'armR'],
  'hair-tuck': ['armL', 'armR', 'head'],
  'yawn': ['head', 'trunk', 'armL', 'armR'],
  'peek-chat': ['trunk', 'head'],
  'heel-raise': ['legs', 'trunk'],
  'wave': ['armL', 'armR'],
} as const satisfies Record<BodyActId, readonly Region[]>

/** The acts allowed while the rest state is `rest` (plan D3); data, so a restricted set is passed, not coded. */
export const REST_ACT_SET: readonly BodyActId[] = ['sigh', 'yawn', 'foot-replant', 'look-around', 'shoulder-roll', 'hand-inspect']

const C = { distinct: 6, confirmFrames: 18, percentile: 0.95 } as const
const ACT_STATES: readonly string[] = ['playing', 'finished', 'cancelled']
const REST_STATES: readonly BodyRest[] = ['none', 'rest', 'doze']
const O2_METRICS = ['inter.burstCv', 'inter.holdFraction', 'inter.movesPerMin'] as const

export const IDLE_ACTS_CONSTANTS: readonly ReportConstant[] = [
  { name: 'distinct acts', value: C.distinct, unit: 'counted, confirmed ids', source: 'C001' },
  { name: 'confirmation run', value: C.confirmFrames, unit: 'consecutive 60 Hz frames (0.3 s)', source: 'plan R1' },
  { name: 'confirmation level', value: C.percentile, unit: 'quantile of the run\'s non-act idle region speed', source: 'plan R1' },
]

export function isActId(id: string): id is BodyActId {
  return Object.hasOwn(ACT_REGIONS, id)
}

export interface ActSpan {
  readonly id: BodyActId
  readonly start: number
  /** The closing marker's time, or null while unclosed at the end of the trace. */
  readonly end: number | null
  readonly closedBy: 'finished' | 'cancelled' | null
  readonly rest: BodyRest
  readonly confirmed: boolean
  /** The longest run of frames inside the act with the region speed above the non-act idle P95. */
  readonly longestRun: number
}

export interface IdleActsDetail {
  readonly acts: readonly ActSpan[]
  readonly restSet: readonly BodyActId[]
  readonly intervals: readonly number[]
  readonly intervalCv: number | null
  readonly restSeconds: Readonly<Record<BodyRest, number>>
  readonly intermittency: readonly { readonly id: string, readonly status: string, readonly value: number | null }[] | null
}

/** The rest state at `t`: the latest `rest:` marker at or before it, `none` before any. */
export function restStates(run: LoadedRun): (t: number) => BodyRest {
  const changes = markers(run, 'rest:').map(({ t, parts }) => {
    const state = REST_STATES.find(s => s === parts[0])
    if (!state || parts.length !== 1)
      throw new ReportUsageError(`${run.dir}: malformed rest marker at ${t.toFixed(3)} s: rest:${parts.join(':')}`)
    return { t, state }
  })
  return (t) => {
    let state: BodyRest = 'none'
    for (const change of changes) {
      if (change.t > t)
        break
      state = change.state
    }
    return state
  }
}

function actSpans(run: LoadedRun, restAt: (t: number) => BodyRest): Omit<ActSpan, 'confirmed' | 'longestRun'>[] {
  const spans: Omit<ActSpan, 'confirmed' | 'longestRun'>[] = []
  const open = new Map<BodyActId, number>()
  for (const { t, parts } of markers(run, 'act:')) {
    const [id, state] = parts
    if (parts.length !== 2 || !isActId(id) || !ACT_STATES.includes(state))
      throw new ReportUsageError(`${run.dir}: malformed act marker at ${t.toFixed(3)} s: act:${parts.join(':')}`)
    if (state === 'playing') {
      open.set(id, spans.length)
      spans.push({ id, start: t, end: null, closedBy: null, rest: restAt(t) })
      continue
    }
    const index = open.get(id)
    if (index === undefined)
      throw new ReportUsageError(`${run.dir}: act:${id}:${state} at ${t.toFixed(3)} s has no playing marker before it`)
    spans[index] = { ...spans[index], end: t, closedBy: state === 'finished' ? 'finished' : 'cancelled' }
    open.delete(id)
  }
  return spans
}

/** C001 (plan R1): distinct confirmed acts, no immediate repeat, and only rest-set acts while resting. */
export function idleActsReport(run: LoadedRun, restSet: readonly BodyActId[] = REST_ACT_SET): CaseReport<IdleActsDetail> {
  const { p, input } = run
  if (input.trace.source.scenario.class !== 'idle')
    throw new ReportUsageError(`${run.dir}: idle-acts judges an idle-class run, not ${input.trace.source.scenario.class}`)
  const restAt = restStates(run)
  const raw = actSpans(run, restAt)
  const frames = p.rootVelocity.length
  const inAct = (t: number) => raw.some(span => t >= span.start && t <= (span.end ?? Number.POSITIVE_INFINITY))
  const idle = Array.from({ length: frames }, (_, i) => p.channels[7][i] === 0 && p.channels[3][i] === 0 && !inAct(p.times[i]))
  if (!idle.some(Boolean))
    throw new ReportUsageError(`${run.dir}: no non-act idle frame to set the confirmation level`)
  const levels = new Map<string, { speed: readonly number[], level: number }>()
  const levelOf = (id: BodyActId) => {
    const key = ACT_REGIONS[id].join('+')
    const cached = levels.get(key)
    if (cached)
      return cached
    const bones: MotionTraceBone[] = ACT_REGIONS[id].flatMap(region => [...REGIONS[region]])
    const speed = regionSpeed(p.o6, bones, frames)
    const entry = { speed, level: percentile(speed.filter((_, i) => idle[i]), C.percentile) }
    levels.set(key, entry)
    return entry
  }
  const acts: ActSpan[] = raw.map((span) => {
    const { speed, level } = levelOf(span.id)
    let run = 0
    let longest = 0
    for (let i = 0; i < frames; i++) {
      const inside = p.times[i] >= span.start && p.times[i] <= (span.end ?? Number.POSITIVE_INFINITY)
      run = inside && speed[i] > level ? run + 1 : 0
      longest = Math.max(longest, run)
    }
    return { ...span, longestRun: longest, confirmed: longest >= C.confirmFrames }
  })
  const counted = acts.filter(act => act.closedBy === 'finished')
  const confirmed = counted.filter(act => act.confirmed)
  const distinct = new Set(confirmed.map(act => act.id))
  const repeats = acts.slice(1).flatMap((act, i) => act.id === acts[i].id ? [`${act.id} at ${act.start.toFixed(3)} s`] : [])
  const resting = acts.filter(act => act.rest !== 'none')
  const disallowed = resting.filter(act => act.rest === 'doze' || !restSet.includes(act.id))
  const restRule = `every act started while resting is in the rest set {${restSet.join(', ')}}, and none starts while dozing`
  const requirements: CaseRequirement[] = [
    judged('distinct-acts', `at least ${C.distinct} distinct ids among acts closed by finished and confirmed by motion`, `${distinct.size} distinct (${confirmed.length} confirmed of ${counted.length} finished, ${acts.length} started)`, distinct.size >= C.distinct),
    acts.length < 2
      ? notExercised('no-repeat', 'no two consecutive started acts share an id, cancelled ones included', `${acts.length} act started: no consecutive pair`)
      : judged('no-repeat', 'no two consecutive started acts share an id, cancelled ones included', repeats.length ? `repeated: ${repeats.join(', ')}` : `${acts.length - 1} consecutive pairs, none repeated`, repeats.length === 0),
    resting.length === 0
      ? notExercised('rest-set', restRule, 'no act started while resting or dozing')
      : judged('rest-set', restRule, disallowed.length ? `not allowed: ${disallowed.map(act => `${act.id} in ${act.rest} at ${act.start.toFixed(3)} s`).join(', ')}` : `${resting.length} acts started while resting, all allowed`, disallowed.length === 0),
  ]
  const intervals = counted.slice(1).map((act, i) => act.start - counted[i].start)
  const restSeconds = { none: 0, rest: 0, doze: 0 }
  for (const t of p.times)
    restSeconds[restAt(t)] += 1 / 60
  const gate = run.gate
  const intermittency = gate ? ['inter.speedCv', ...O2_METRICS].map(id => ({ id, ...gateStatus(gate, id) })) : null
  return caseReport('idle-acts', IDLE_ACTS_VERSION, [run.dir], IDLE_ACTS_CONSTANTS, requirements, {
    acts,
    restSet,
    intervals,
    intervalCv: intervals.length >= 2 ? cv(intervals) : null,
    restSeconds,
    intermittency,
  })
}

export function formatIdleActs(report: CaseReport<IdleActsDetail>): string {
  const d = report.detail
  return formatCaseReport(report, [
    `act timeline (${d.acts.length} started):`,
    ...d.acts.map(act => `  ${act.start.toFixed(3)}\t${act.id}\t${act.closedBy ?? 'unclosed'}${act.end === null ? '' : ` at ${act.end.toFixed(3)}`}\t${act.rest}\t${act.confirmed ? 'confirmed' : 'not confirmed'} (longest run above P95 ${act.longestRun} frames)`),
    d.intervals.length ? `intervals between finished acts (s): ${d.intervals.map(v => v.toFixed(2)).join(', ')}; CV ${fixed(d.intervalCv)}` : 'intervals: fewer than 2 finished acts, no interval',
    `scored seconds by rest state: none ${d.restSeconds.none.toFixed(1)}, rest ${d.restSeconds.rest.toFixed(1)}, doze ${d.restSeconds.doze.toFixed(1)}`,
    ...d.intermittency
      ? d.intermittency.map(m => `${m.id}: ${m.status} ${fixed(m.value)}${m.id === 'inter.speedCv' ? ' (gated)' : ' (REPORT, not judged)'}`)
      : ['intermittency: no gate.json; run qa:motion3d gate on this run to print inter.speedCv and the O2 values'],
    'inter.burstCv, inter.holdFraction and inter.movesPerMin: no long-idle human band exists (owner decision O2); they are printed, not judged.',
  ])
}
