import type { BenchMetric } from '@proj-airi/stage-shared/perf/usage'

import type { BenchScenarioId } from '../bench/matrix'

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { BENCH_METRICS } from '@proj-airi/stage-shared/perf/usage'

import * as v from 'valibot'

import { BENCH_V1 } from '../bench/matrix'

/** Repository-relative path of the committed accepted costs, as git names it. */
export const ACCEPTED_COSTS_PATH = 'packages/qa-tools/perf/accepted-costs.json'

/**
 * One intended cost. The entry holds no sha and no measured value: the tracker resolves the commit that introduced it
 * from git history, so the entry still resolves when it lands in the same commit as the change it accepts, and again
 * after a rebase merge gives that commit a new sha.
 */
const AcceptedCostSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be kebab-case')),
  scenario: v.picklist(BENCH_V1.map(scenario => scenario.id)),
  metric: v.picklist(BENCH_METRICS),
  reason: v.pipe(v.string(), v.check(reason => reason.trim().length > 0, 'reason must not be empty')),
  accepted: v.pipe(v.string(), v.isoDate('accepted must be a YYYY-MM-DD date')),
})

export type AcceptedCost = v.InferOutput<typeof AcceptedCostSchema>

function duplicateIds(entries: readonly AcceptedCost[]): string[] {
  const seen = new Set<string>()
  return entries.filter(({ id }) => seen.size === seen.add(id).size).map(({ id }) => id)
}

export const AcceptedCostsSchema = v.strictObject({
  entries: v.pipe(
    v.array(AcceptedCostSchema),
    v.check(entries => duplicateIds(entries).length === 0, issue => `duplicate accepted-cost id: ${duplicateIds(issue.input).join(', ')}`),
  ),
})

export type AcceptedCosts = v.InferOutput<typeof AcceptedCostsSchema>

function parseAcceptedCosts(text: string, source: string): AcceptedCosts {
  const result = v.safeParse(AcceptedCostsSchema, JSON.parse(text))
  if (!result.success)
    throw new Error(`${source}: ${result.issues.map(issue => issue.message).join('; ')}`)
  return result.output
}

/**
 * Reads the accepted costs of the checkout at `repoRoot`. A checkout without the file accepts nothing: commits from
 * before the file existed are still valid bench subjects and baselines, so an absent file is read policy, not an error.
 */
export function readAcceptedCosts(repoRoot: string): AcceptedCosts {
  const file = join(repoRoot, ACCEPTED_COSTS_PATH)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { entries: [] }
    throw new Error(`${file}: ${errorMessageFrom(error) ?? 'could not read accepted costs'}`)
  }
  return parseAcceptedCosts(text, file)
}

/** Runs git with `args` and resolves its stdout; rejects with the `execFile` error, whose `code` is the exit code. */
export type Git = (args: readonly string[]) => Promise<string>

const execFileAsync = promisify(execFile)

/** Runs `git -C <cwd>` without a shell. */
export function defaultGit(cwd: string): Git {
  return async args => (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout
}

/**
 * The first commit reachable from `ref` whose version of the file has an entry with `id`, or `null`. Each version is
 * parsed rather than searched with `git log -S`, so reformatting the file or naming the id in another entry's reason
 * cannot move the answer. Commits that delete the file have no version to parse and are skipped.
 */
export async function introducingCommit(id: string, ref: string, git: Git): Promise<string | null> {
  const log = await git(['log', '--reverse', '--diff-filter=d', '--format=%H', ref, '--', ACCEPTED_COSTS_PATH])
  for (const sha of log.split('\n').filter(Boolean)) {
    const costs = parseAcceptedCosts(await git(['show', `${sha}:${ACCEPTED_COSTS_PATH}`]), `${sha}:${ACCEPTED_COSTS_PATH}`)
    if (costs.entries.some(entry => entry.id === id))
      return sha
  }
  return null
}

/** The part of a finding that acceptance reads: what regressed, and the commit range `baseline..subject` it regressed in. */
export interface AcceptanceFinding {
  readonly scenario: BenchScenarioId
  readonly metric: BenchMetric
  readonly baseline: string
  readonly subject: string
}

export interface AcceptancePredicates {
  /** Whether commit `a` is reachable from commit `b`; a commit is its own ancestor. */
  readonly isAncestor: (a: string, b: string) => Promise<boolean>
  /** Whether every commit of `finding.baseline..finding.subject` has a patch-equivalent in the history of `commit`. */
  readonly rangeLandedIn: (finding: AcceptanceFinding, commit: string) => Promise<boolean>
}

/** Predicates backed by `git merge-base --is-ancestor` and `git cherry`. */
export function gitAcceptancePredicates(git: Git): AcceptancePredicates {
  return {
    async isAncestor(a, b) {
      try {
        await git(['merge-base', '--is-ancestor', a, b])
        return true
      }
      catch (error) {
        // Exit code 1 means "not an ancestor"; any other failure, such as an unknown sha, is a real error.
        if (error instanceof Error && 'code' in error && error.code === 1)
          return false
        throw error
      }
    },
    async rangeLandedIn(finding, commit) {
      // `git cherry` prints `-` for a commit with a patch-equivalent upstream and `+` for one upstream lacks, read
      // the way `cherryMerged` in scripts/dev-tools/wt-plan.ts reads it.
      const output = await git(['cherry', commit, finding.subject, finding.baseline])
      return !output.split('\n').some(line => line.startsWith('+'))
    },
  }
}

/**
 * Whether `entry`, introduced by commit `introducing`, accepts `finding`. The scenario and metric must match, and the
 * introducing commit must lie in the finding's range (the entry came with the change), or come after the subject (late
 * acceptance: the nightly run flagged first and an agent committed the entry later). Late acceptance also holds when
 * the range was rewritten, for example a PR finding whose PR and entry were rebase-merged before the next tick: then
 * every commit of the range has a patch-equivalent in the introducing commit's history.
 */
export async function acceptanceFor(input: { entry: AcceptedCost, introducing: string, finding: AcceptanceFinding } & AcceptancePredicates): Promise<boolean> {
  const { entry, introducing, finding, isAncestor, rangeLandedIn } = input
  if (entry.scenario !== finding.scenario || entry.metric !== finding.metric)
    return false
  if (await isAncestor(introducing, finding.subject))
    return !(await isAncestor(introducing, finding.baseline))
  if (await isAncestor(finding.subject, introducing))
    return true
  return rangeLandedIn(finding, introducing)
}
