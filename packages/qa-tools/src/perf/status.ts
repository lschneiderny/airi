import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { BenchHistoryHost } from '../bench/history'
import type { AcceptedCost, Git } from '../track/accepted-costs'
import type { BaselineResetEvent, ClosedFinding, FindingResolution, OpenFinding, TrackEvent } from '../track/findings'
import type { PerfFileCounts } from './read'

import { median } from '@proj-airi/stage-shared/perf/usage'

import { benchHistoryPath, readBenchHistory } from '../bench/history'
import { introducingCommit, readAcceptedCosts } from '../track/accepted-costs'
import { foldFindings, readTrackEvents, trackHistoryPath } from '../track/findings'

const HOUR_MS = 3_600_000
/** A tracker without a tick-start in this window is stale: the nightly timer stopped or keeps failing to start. */
const STALE_AFTER_MS = 48 * HOUR_MS
/** Closed findings and baseline resets older than this window are history, not status. */
const RECENT_MS = 14 * 24 * HOUR_MS
/** Below this many distinct clean commits in the bench history, pooled noise is a weak estimate. */
const CONFIDENT_COMMITS = 10

export interface StatusInputs {
  readonly runs: readonly BenchRunRecord[]
  readonly events: readonly TrackEvent[]
  /** The checkout's accepted costs, each with the commit that introduced it (`null` when not committed yet). */
  readonly accepted: readonly (AcceptedCost & { readonly commit: string | null })[]
  /** `origin/main`, or `null` when git could not resolve it. */
  readonly mainTip: string | null
  readonly now: number
}

export interface StageCost {
  readonly id: string
  readonly msPerFrame: number
}

export interface PerfStatus {
  readonly lastTick: { readonly tickId: string, readonly startedAt: number, readonly ageHours: number, readonly exitCode: number | null } | null
  readonly trackerStale: boolean
  readonly mainTip: { readonly sha: string, readonly benched: boolean, readonly benchedAt: number | null } | null
  readonly lowConfidence: boolean
  readonly open: readonly OpenFinding[]
  readonly recentlyClosed: readonly ClosedFinding[]
  readonly outcomes: Readonly<Record<FindingResolution, number>> & { readonly noiseShare: number | null }
  readonly accepted: readonly { readonly id: string, readonly scenario: string, readonly metric: string, readonly reason: string, readonly commit: string | null }[]
  readonly baselineResets: readonly BaselineResetEvent[]
  readonly ghFailureStreak: number
  /** Per scenario, the stage costs of the latest benched main tip, costliest first. */
  readonly stages: readonly { readonly scenario: string, readonly sha: string, readonly stages: readonly StageCost[] }[]
}

/**
 * The latest benched main tip per scenario: the current main tip where it has clean runs of the scenario, otherwise
 * the newest main tip the tracker's `subject` events record as benched.
 */
function latestBenchedMainTips(events: readonly TrackEvent[], clean: readonly BenchRunRecord[], mainTip: string | null): Map<string, string> {
  const tips = new Map<string, string>()
  for (const event of events) {
    if (event.event !== 'subject' || event.subject.kind !== 'main' || (event.outcome !== 'benched' && event.outcome !== 'already-benched'))
      continue
    for (const scenario of event.scenarios)
      tips.set(scenario, event.subject.sha)
  }
  for (const run of clean) {
    if (run.sha === mainTip)
      tips.set(run.scenario, mainTip)
  }
  return tips
}

/** Median `msPerFrame` per stage over the runs that recorded stages; runs without `stages` did not record them. */
function stageMedians(runs: readonly BenchRunRecord[]): StageCost[] {
  const costs = new Map<string, number[]>()
  for (const run of runs) {
    for (const [id, stage] of Object.entries(run.stages ?? {}))
      costs.set(id, [...(costs.get(id) ?? []), stage.msPerFrame])
  }
  return [...costs].map(([id, values]) => ({ id, msPerFrame: median(values) })).sort((left, right) => right.msPerFrame - left.msPerFrame)
}

export function buildStatus(inputs: StatusInputs): PerfStatus {
  const { runs, events, accepted, mainTip, now } = inputs
  const fold = foldFindings(events)
  const clean = runs.filter(run => !run.dirty && run.valid)
  const tipRuns = mainTip === null ? [] : clean.filter(run => run.sha === mainTip)
  const resolved = fold.outcomes.fixed + fold.outcomes.accepted + fold.outcomes.noise

  return {
    lastTick: fold.lastTick && {
      tickId: fold.lastTick.tickId,
      startedAt: fold.lastTick.startT,
      ageHours: (now - fold.lastTick.startT) / HOUR_MS,
      exitCode: fold.lastTick.exitCode,
    },
    trackerStale: fold.lastTick === null || now - fold.lastTick.startT > STALE_AFTER_MS,
    mainTip: mainTip === null
      ? null
      : {
          sha: mainTip,
          benched: tipRuns.length > 0,
          benchedAt: tipRuns.length > 0 ? Math.max(...tipRuns.map(run => run.t)) : null,
        },
    lowConfidence: new Set(clean.map(run => run.sha)).size < CONFIDENT_COMMITS,
    open: fold.open,
    recentlyClosed: fold.closed.filter(finding => finding.close.t >= now - RECENT_MS),
    outcomes: { ...fold.outcomes, noiseShare: resolved > 0 ? fold.outcomes.noise / resolved : null },
    accepted: accepted.map(({ id, scenario, metric, reason, commit }) => ({ id, scenario, metric, reason, commit })),
    baselineResets: fold.baselineResets.filter(reset => reset.t >= now - RECENT_MS),
    ghFailureStreak: fold.ghFailureStreak,
    stages: [...latestBenchedMainTips(events, clean, mainTip)].sort(([left], [right]) => left.localeCompare(right)).map(([scenario, sha]) => ({
      scenario,
      sha,
      stages: stageMedians(clean.filter(run => run.scenario === scenario && run.sha === sha)),
    })),
  }
}

export interface StatusRead {
  readonly inputs: Omit<StatusInputs, 'now'>
  readonly counts: readonly PerfFileCounts[]
}

/**
 * Reads the inputs of `buildStatus` without writing anything: the bench history, the tracker log beside it, the
 * accepted costs of the checkout at `repoRoot`, and `origin/main` through `git`.
 */
export async function readStatusInputs(host: BenchHistoryHost, repoRoot: string, git: Git): Promise<StatusRead> {
  const [history, track] = await Promise.all([readBenchHistory(benchHistoryPath(host)), readTrackEvents(trackHistoryPath(host))])
  const accepted = await Promise.all(readAcceptedCosts(repoRoot).entries.map(async entry => ({ ...entry, commit: await introducingCommit(entry.id, 'HEAD', git) })))
  let mainTip: string | null
  try {
    mainTip = (await git(['rev-parse', '--verify', '--quiet', 'origin/main'])).trim() || null
  }
  catch {
    // A checkout without an `origin/main` (no remote, never fetched) has no main tip to report.
    mainTip = null
  }
  return { inputs: { runs: history.runs, events: track.events, accepted, mainTip }, counts: [history.counts, track.counts] }
}
