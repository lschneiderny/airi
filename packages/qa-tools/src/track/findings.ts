import type { InferOutput } from 'valibot'

import type { BenchHistoryHost } from '../bench/history'
import type { PerfFileCounts } from '../perf/read'

import { readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

import { BENCH_METRICS } from '@proj-airi/stage-shared/perf/usage'
import {
  array,
  boolean,
  finite,
  literal,
  minLength,
  minValue,
  nullable,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  regex,
  safeInteger,
  safeParse,
  string,
  variant,
} from 'valibot'

import { appendBenchLine, benchHistoryPath } from '../bench/history'

/** The format version of every `track.jsonl` event. Readers skip and count lines of any other version. */
export const TRACK_EVENT_VERSION = 1

const epochMs = pipe(number(), safeInteger(), minValue(0))
const count = pipe(number(), safeInteger(), minValue(0))
const amount = pipe(number(), finite(), minValue(0))
const signed = pipe(number(), finite())
const label = pipe(string(), minLength(1))
/** A full or abbreviated commit id; SHA-256 repositories use 64 hex digits. */
const sha = pipe(string(), regex(/^[0-9a-f]{7,64}$/))
const prNumber = pipe(number(), safeInteger(), minValue(1))
const metric = picklist(BENCH_METRICS)

const subjectRef = object({ kind: picklist(['main', 'pr', 'manual']), sha, pr: optional(prNumber) })
const baselineRef = object({ kind: picklist(['previous', 'anchor', 'merge-base', 'manual', 'accepted']), sha })

const header = { v: literal(TRACK_EVENT_VERSION), t: epochMs }

/**
 * One line of the append-only tracker log. The discriminator is `event`, not `kind`, because `subject`, `baseline`
 * and `baseline-reset` carry a `kind` of their own.
 */
export const TrackEventSchema = variant('event', [
  object({ ...header, event: literal('tick-start'), tickId: label, trigger: picklist(['timer', 'manual']) }),
  object({
    ...header,
    event: literal('discovery'),
    tickId: label,
    mainTip: nullable(sha),
    /** `null` when the `gh` query failed; `ghError` then says why. */
    prs: nullable(array(object({ number: prNumber, head: sha, baselineSha: sha, baseRef: label }))),
    ghError: optional(label),
  }),
  object({
    ...header,
    event: literal('subject'),
    tickId: label,
    subject: subjectRef,
    baseline: nullable(baselineRef),
    scenarios: array(label),
    outcome: picklist(['benched', 'already-benched', 'deferred', 'skipped', 'broken']),
    /**
     * Why a subject was not benched: `deadline`, `capacity`, `plan-only`, `host-busy`, `outside-window`,
     * `another-tick`, `subject-dirty`, `subject-unsupported`, `sha-mismatch` or `bench-exit-<code>`. Open-ended so a
     * new reason needs no format version.
     */
    reason: optional(label),
  }),
  object({
    ...header,
    event: literal('baseline-reset'),
    tickId: label,
    subjectSha: sha,
    baselineSha: sha,
    scenario: label,
    /**
     * `environment`: a side had runs only under an older host or model key, and is rebenched. `not-comparable`: the
     * code states differ in Electron version, build mode or scenario version; recorded once per subject, baseline and
     * scenario, and never retried.
     */
    kind: picklist(['environment', 'not-comparable']),
    reasons: array(label),
  }),
  object({
    ...header,
    event: literal('finding-open'),
    id: label,
    tickId: label,
    scenario: label,
    metric,
    subject: subjectRef,
    baseline: baselineRef,
    medianA: signed,
    medianB: signed,
    difference: signed,
    practicalFloor: amount,
    sigma: nullable(amount),
    lowConfidence: boolean(),
    topStages: array(object({ id: label, deltaMsPerFrame: signed, z: signed })),
    noStageMoved: boolean(),
    rangeCommits: count,
    renderLoopCommits: array(object({ sha, subject: string() })),
    reproduce: label,
    closeCheck: label,
  }),
  object({
    ...header,
    event: literal('finding-close'),
    id: label,
    resolution: picklist(['fixed', 'accepted', 'noise']),
    at: nullable(sha),
    note: string(),
    by: picklist(['tracker', 'manual']),
  }),
  object({ ...header, event: literal('observed-again'), id: label, tickId: label, subject: subjectRef, baselineSha: sha, difference: signed }),
  object({ ...header, event: literal('tick-end'), tickId: label, exitCode: pipe(number(), safeInteger()), durationMs: amount }),
])

export type TrackEvent = InferOutput<typeof TrackEventSchema>
type TrackEventOf<Name extends TrackEvent['event']> = Extract<TrackEvent, { event: Name }>
export type FindingOpenEvent = TrackEventOf<'finding-open'>
export type FindingCloseEvent = TrackEventOf<'finding-close'>
export type BaselineResetEvent = TrackEventOf<'baseline-reset'>
export type FindingResolution = FindingCloseEvent['resolution']

/** The tracker log, `track.jsonl` beside `bench.jsonl`, so `AIRI_PERF_BENCH_DIR` moves both. */
export function trackHistoryPath(host: BenchHistoryHost): string {
  const path = host.platform === 'win32' ? win32 : posix
  return path.join(path.dirname(benchHistoryPath(host)), 'track.jsonl')
}

/** Validates the event and appends it as one line; a new file is readable by its owner only. Throws on an invalid event. */
export function appendTrackEvent(path: string, event: TrackEvent): void {
  appendBenchLine(path, JSON.stringify(parse(TrackEventSchema, event)))
}

export interface TrackEvents {
  readonly events: readonly TrackEvent[]
  readonly counts: PerfFileCounts
  readonly found: boolean
}

/** Reads the log without writing to it; a missing file is empty. Malformed and other-version lines are counted, not thrown. */
export async function readTrackEvents(path: string): Promise<TrackEvents> {
  const counts = { path, malformed: 0, unknownVersion: 0 }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { events: [], counts, found: false }
    throw error
  }
  const events: TrackEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim())
      continue
    let value: unknown
    try {
      value = JSON.parse(line)
    }
    catch (error) {
      if (!(error instanceof SyntaxError))
        throw error
      counts.malformed += 1
      continue
    }
    if (typeof value === 'object' && value !== null && 'v' in value && value.v !== TRACK_EVENT_VERSION) {
      counts.unknownVersion += 1
      continue
    }
    const result = safeParse(TrackEventSchema, value)
    if (result.success)
      events.push(result.output)
    else
      counts.malformed += 1
  }
  return { events, counts, found: true }
}

/** A finding's id names its comparison, so the same regression seen by a later tick maps to the same id. */
export function findingId(finding: Pick<FindingOpenEvent, 'scenario' | 'metric' | 'baseline' | 'subject'>): string {
  return `${finding.scenario}:${finding.metric}:${finding.baseline.sha.slice(0, 7)}..${finding.subject.sha.slice(0, 7)}`
}

/** Repo-relative text only: a finding never stores a local path. */
export function reproduceCommand(scenario: string, baselineSha: string, subjectSha: string): string {
  return `pnpm perf:track tick --baseline ${baselineSha} --subject ${subjectSha} --scenario ${scenario}`
}

/** The check that proves a fix; `<fix sha>` is filled in by whoever closes the finding. */
export function closeCheck(finding: Pick<FindingOpenEvent, 'scenario' | 'metric' | 'baseline'>): string {
  return `pnpm perf compare --bench ${finding.baseline.sha} <fix sha> --scenario ${finding.scenario} --metric ${finding.metric} shows within-noise or improvement`
}

export type OpenFinding = FindingOpenEvent & { readonly observedAgain: number, readonly lastSeenT: number }
export type ClosedFinding = FindingOpenEvent & { readonly close: FindingCloseEvent }

export interface TrackFold {
  /** In open order. */
  readonly open: readonly OpenFinding[]
  /** In close order. */
  readonly closed: readonly ClosedFinding[]
  readonly outcomes: Readonly<Record<FindingResolution, number>>
  readonly lastTick: { tickId: string, startT: number, endT: number | null, exitCode: number | null } | null
  readonly baselineResets: readonly BaselineResetEvent[]
  /** How many of the latest `discovery` events in a row carry `ghError`. */
  readonly ghFailureStreak: number
}

/**
 * Folds the log into the current findings. A `finding-open` for an id that is already open is ignored, an open after
 * a close starts a new entry, and `finding-close` or `observed-again` for an id that is not open is ignored. The fold
 * tolerates these so a log stays readable; the CLI refuses them before they are written.
 */
export function foldFindings(events: readonly TrackEvent[]): TrackFold {
  const open = new Map<string, OpenFinding>()
  const closed: ClosedFinding[] = []
  const outcomes: Record<FindingResolution, number> = { fixed: 0, accepted: 0, noise: 0 }
  const baselineResets: BaselineResetEvent[] = []
  const tickEnds = new Map<string, TrackEventOf<'tick-end'>>()
  let lastStart: TrackEventOf<'tick-start'> | undefined
  let ghFailureStreak = 0

  for (const event of events) {
    switch (event.event) {
      case 'tick-start':
        lastStart = event
        break
      case 'tick-end':
        tickEnds.set(event.tickId, event)
        break
      case 'discovery':
        ghFailureStreak = event.ghError ? ghFailureStreak + 1 : 0
        break
      case 'baseline-reset':
        baselineResets.push(event)
        break
      case 'finding-open':
        if (!open.has(event.id))
          open.set(event.id, { ...event, observedAgain: 0, lastSeenT: event.t })
        break
      case 'observed-again': {
        const finding = open.get(event.id)
        if (finding)
          open.set(event.id, { ...finding, observedAgain: finding.observedAgain + 1, lastSeenT: event.t })
        break
      }
      case 'finding-close': {
        const finding = open.get(event.id)
        if (!finding)
          break
        open.delete(event.id)
        const { observedAgain: _observedAgain, lastSeenT: _lastSeenT, ...opened } = finding
        closed.push({ ...opened, close: event })
        outcomes[event.resolution] += 1
        break
      }
      case 'subject':
        break
    }
  }

  const lastEnd = lastStart && tickEnds.get(lastStart.tickId)
  const lastTick = lastStart
    ? { tickId: lastStart.tickId, startT: lastStart.t, endT: lastEnd?.t ?? null, exitCode: lastEnd?.exitCode ?? null }
    : null
  return { open: [...open.values()], closed, outcomes, lastTick, baselineResets, ghFailureStreak }
}
