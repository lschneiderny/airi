import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { BenchScenarioId } from '../bench/matrix'
import type { HostLoad } from '../host-quiet/wait'
import type { BenchScenarioAttribution, BenchScenarioComparison, BenchSide } from '../perf/bench'
import type { AcceptedCost, Git } from './accepted-costs'
import type { FindingOpenEvent, TrackEvent } from './findings'
import type { BenchStep, Candidate, MetricBaseline, SubjectPlan } from './plan'

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { TZDate } from '@date-fns/tz'
import { errorMessageFrom } from '@moeru/std'
import { decideHostContended } from '@proj-airi/stage-shared/perf/usage'
import { addDays, format, formatISO, isBefore, set } from 'date-fns'
import { array, number, object, parse, pipe, safeInteger, string } from 'valibot'

import { readBenchHistory } from '../bench/history'
import { BENCH_V1 } from '../bench/matrix'
import { loadQaEnv } from '../env/load'
import { formatHostLoad } from '../host-quiet/wait'
import { compareBenchRefs } from '../perf/bench'
import { ACCEPTED_COSTS_PATH, AcceptedCostsSchema, gitAcceptancePredicates, introducingCommit } from './accepted-costs'
import { TrackUsageError } from './args'
import { appendTrackEvent, foldFindings, readTrackEvents } from './findings'
import { touchesRenderLoop } from './paths'
import { acceptedCloses, buildFinding, confirmCandidates, confirmSteps, eligibleRuns, fixedCloses, judgeComparison, matchOpen, planSubjects } from './plan'

/**
 * Every effect a tick has outside its state directory. The state directory itself (`bench.jsonl`, `track.jsonl`,
 * `track.lock`, `runs/`, `tmp/`) and the app worktree are real files, so a test replays a tick in a temp directory.
 */
export interface TrackHost {
  /** The checkout that holds this code: its harness benches every subject. */
  readonly toolRoot: string
  /** The directory of `bench.jsonl` and `track.jsonl`. */
  readonly stateDir: string
  /** Passed to every child, with `TMPDIR` pointed at the `tmp` directory inside `stateDir`. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** IANA name of the zone the 01:00 to 06:30 window and the deadline are read in. */
  readonly timeZone: string
  readonly pid: number
  /** Aborted on SIGINT or SIGTERM; no bench starts after it. */
  readonly signal: AbortSignal
  /** Runs `git -C <cwd>`; rejects with the exit code as `code`, the way `defaultGit` does. */
  git: (cwd: string, args: readonly string[]) => Promise<string>
  gh: (args: readonly string[]) => Promise<string>
  /** Runs a child with inherited output and resolves its exit code. */
  spawn: (command: string, args: readonly string[], options: { readonly cwd: string, readonly env: Readonly<Record<string, string | undefined>> }) => Promise<number>
  sampleHost: () => Promise<HostLoad>
  notify: (title: string, body: string) => Promise<void>
  now: () => number
  pidAlive: (pid: number) => boolean
  print: (line: string) => void
  log: (line: string) => void
}

export interface TickOptions {
  readonly manual: { readonly subject: string, readonly baseline: string } | null
  readonly scenario: string | null
  readonly runs: number
  /** Local `HH:MM` after which no bench starts, as given; `null` gives a manual pair none and any other tick 06:30. */
  readonly deadline: string | null
  readonly planOnly: boolean
  readonly trigger: 'timer' | 'manual'
}

/** A timer tick benches only inside this local window, so a missed run fired at a daytime wake does nothing. */
const WINDOW = { start: { hours: 1, minutes: 0 }, end: { hours: 6, minutes: 30 } } as const
/** Run directories of older ticks are deleted past this count; their records live on in `bench.jsonl`. */
const KEPT_TICK_RUNS = 7
/** The end of the nightly window, so a non-manual tick stops starting benches before the day begins. */
const DEFAULT_DEADLINE = '06:30'
const DISPLAY_NAME = 'perf-track'
/** The file `pnpm qa:setup cubism` writes; see the qa-tools README "Fresh worktree Cubism setup". */
const CUBISM_CORE = 'apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js'
const QA_ENV_KEYS = ['AIRI_QA_MMD_MODEL', 'AIRI_QA_RIG_FORBOOTH'] as const

const PrListSchema = array(object({ number: pipe(number(), safeInteger()), headRefOid: string(), baseRefName: string() }))

type Subject = FindingOpenEvent['subject']
type SubjectOutcome = Extract<TrackEvent, { event: 'subject' }>['outcome']
/** How a run of bench steps ended; anything but `ok` ends the subject with that outcome. */
type StepResult = { readonly outcome: 'ok' } | { readonly outcome: Exclude<SubjectOutcome, 'benched' | 'already-benched'>, readonly reason: string }

class Interrupted extends Error {}

const OK: StepResult = { outcome: 'ok' }
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean)
const sha7 = (sha: string) => sha.slice(0, 7)

/** Whether a bench that exited 1 recorded clean runs of `sha`, its only failures being runs marked invalid. */
function onlyInvalidRuns(records: readonly BenchRunRecord[], sha: string): boolean {
  return records.some(record => !record.valid)
    && records.every(record => record.sha === sha && !record.dirty && (record.valid || record.invalidReason !== undefined))
}

/**
 * A side whose recorded runs were all invalid has no eligible run, so `compareBenchRefs` cannot resolve it. This is
 * the `no-runs` refusal `judgeComparison` rebenches; `undefined` when both sides have eligible runs.
 */
function noRunsComparison(scenario: string, a: string, b: string, eligible: readonly BenchRunRecord[]): BenchScenarioComparison | undefined {
  const missing = [a, b].filter(sha => !eligible.some(run => run.sha === sha && run.scenario === scenario))
  if (missing.length === 0)
    return undefined
  const side = (sha: string): BenchSide => ({ ref: sha, group: { sha, diffHash: null }, excluded: [] })
  return { scenario, a: side(a), b: side(b), status: 'refused', refusals: missing.map(sha => ({ reason: 'no-runs', detail: `${sha7(sha)} has no eligible runs` })) }
}

/** Takes `<stateDir>/track.lock` (O_EXCL) for this pid; a lock whose pid is dead is stale and removed. */
function takeLock(path: string, host: TrackHost): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, `${host.pid}\n`, { flag: 'wx', mode: 0o600 })
      return true
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
        throw error
      const holder = Number.parseInt(readFileSync(path, 'utf8'), 10)
      if (Number.isSafeInteger(holder) && host.pidAlive(holder))
        return false
      rmSync(path, { force: true })
    }
  }
  return false
}

function insideWindow(local: TZDate): boolean {
  const start = set(local, { ...WINDOW.start, seconds: 0, milliseconds: 0 })
  const end = set(local, { ...WINDOW.end, seconds: 0, milliseconds: 0 })
  return !isBefore(local, start) && isBefore(local, end)
}

/** The next `HH:MM` after the tick started: the same day before it, the next day once it has passed. */
function deadlineAfter(local: TZDate, hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const sameDay = set(local, { hours, minutes, seconds: 0, milliseconds: 0 })
  return (isBefore(local, sameDay) ? sameDay : addDays(sameDay, 1)).getTime()
}

function pruneRuns(runsDir: string): void {
  if (!existsSync(runsDir))
    return
  const ticks = readdirSync(runsDir).sort()
  for (const old of ticks.slice(0, Math.max(0, ticks.length - KEPT_TICK_RUNS)))
    rmSync(join(runsDir, old), { recursive: true, force: true })
}

/**
 * Runs one tracker tick: lock, window and host checks, discovery, planning, benching each subject in the app
 * worktree with this checkout's harness, judging and confirming, findings and closes, and the notification. Returns
 * 0 when the tick finished (skips included), 1 when a step broke or the app worktree could not be prepared, 130 when
 * interrupted.
 * @throws {TrackUsageError} for an unknown `--scenario`, before anything is written.
 */
export async function runTick(host: TrackHost, options: TickOptions): Promise<number> {
  const scenario = options.scenario === null ? undefined : BENCH_V1.find(row => row.id === options.scenario)?.id
  if (options.scenario !== null && scenario === undefined)
    throw new TrackUsageError(`Unknown scenario "${options.scenario}"; expected one of ${BENCH_V1.map(row => row.id).join(', ')}`)

  const lockPath = join(host.stateDir, 'track.lock')
  if (!takeLock(lockPath, host)) {
    host.print('already running')
    return 0
  }
  const tick = new Tick(host, options, scenario)
  let exitCode = 1
  try {
    // Every child gets this as TMPDIR, and pnpm exits when it is missing.
    mkdirSync(tick.tmpDir, { recursive: true, mode: 0o700 })
    tick.append({ v: 1, t: host.now(), event: 'tick-start', tickId: tick.id, trigger: options.trigger })
    exitCode = await tick.run()
  }
  catch (error) {
    if (error instanceof Interrupted) {
      exitCode = 130
    }
    else {
      host.log(errorMessageFrom(error) ?? 'tick failed')
      exitCode = 1
    }
  }
  finally {
    try {
      tick.append({ v: 1, t: host.now(), event: 'tick-end', tickId: tick.id, exitCode, durationMs: Math.max(0, host.now() - tick.startT) })
    }
    finally {
      rmSync(lockPath, { force: true })
      rmSync(tick.tmpDir, { recursive: true, force: true })
      mkdirSync(tick.tmpDir, { recursive: true, mode: 0o700 })
      pruneRuns(join(host.stateDir, 'runs'))
    }
  }
  host.print(`tick ${tick.id} exited ${exitCode}`)
  return exitCode
}

/** One tick's state: its events, the app worktree, the deadline, and the per-tick bench invocation counter. */
class Tick {
  readonly id: string
  readonly startT: number
  readonly tmpDir: string
  private readonly trackPath: string
  private readonly benchPath: string
  private readonly local: TZDate
  private events: TrackEvent[] = []
  private seq = 0
  private deadline: number | null = null
  /** Set when the deadline or a busy host ends all launching for this tick. */
  private stopped: Exclude<StepResult, { outcome: 'ok' }> | null = null
  private mainRoot = ''
  private appWorktree = ''
  private preparedSha: string | null = null
  private qaEnv = ''

  constructor(private readonly host: TrackHost, private readonly options: TickOptions, private readonly scenario: BenchScenarioId | undefined) {
    this.startT = host.now()
    this.local = new TZDate(this.startT, host.timeZone)
    this.id = format(this.local, 'yyyyMMdd-HHmmss')
    this.tmpDir = join(host.stateDir, 'tmp')
    this.trackPath = join(host.stateDir, 'track.jsonl')
    this.benchPath = join(host.stateDir, 'bench.jsonl')
  }

  append(event: TrackEvent): void {
    appendTrackEvent(this.trackPath, event)
    this.events.push(event)
  }

  private git(args: readonly string[], cwd = this.mainRoot): Promise<string> {
    return this.host.git(cwd, args)
  }

  private get mainGit(): Git {
    return args => this.git(args)
  }

  private async resolve(ref: string): Promise<string> {
    return (await this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
  }

  private async skip(reason: string): Promise<number> {
    const manual = this.options.manual
    const subject: Subject = manual ? { kind: 'manual', sha: await this.resolve(manual.subject) } : { kind: 'main', sha: await this.resolve('origin/main') }
    this.recordSubject(subject, null, [], 'skipped', reason)
    return 0
  }

  private recordSubject(subject: Subject, baseline: MetricBaseline | null, scenarios: readonly string[], outcome: SubjectOutcome, reason?: string): void {
    this.append({
      v: 1,
      t: this.host.now(),
      event: 'subject',
      tickId: this.id,
      subject,
      baseline: baseline && { kind: baseline.kind, sha: baseline.sha },
      scenarios: [...scenarios],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    })
    const pr = subject.kind === 'pr' ? ` #${subject.pr}` : ''
    this.host.print(`${subject.kind}${pr} ${sha7(subject.sha)}: ${outcome}${reason === undefined ? '' : ` (${reason})`}`)
  }

  async run(): Promise<number> {
    const { host, options } = this
    // The main checkout is the parent of the common git dir; the tick only fetches and reads git there.
    this.mainRoot = dirname((await host.git(host.toolRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
    this.events = [...(await readTrackEvents(this.trackPath)).events]

    if (options.trigger === 'timer' && !insideWindow(this.local))
      return this.skip('outside-window')
    if (!options.planOnly) {
      const load = await host.sampleHost()
      if (decideHostContended(load))
        return this.skip(`host-busy: ${formatHostLoad(load)}`)
    }

    await this.git(['fetch', '--quiet', 'origin'])
    const mainTip = await this.resolve('origin/main')
    const manual = options.manual && { subjectSha: await this.resolve(options.manual.subject), baselineSha: await this.resolve(options.manual.baseline) }
    const prs = manual ? [] : await this.discover(mainTip)

    const deadline = options.deadline ?? (options.manual ? null : DEFAULT_DEADLINE)
    if (deadline !== null)
      this.deadline = deadlineAfter(this.local, deadline)
    // Each subject's own tree says which costs it accepts, so an entry that lands with a change, in a PR or after a
    // rebase merge, counts before the tool checkout has it.
    const subjectShas = [...new Set(manual ? [manual.subjectSha] : [mainTip, ...(prs ?? []).map(pr => pr.head)])]
    const acceptedBySubject = new Map<string, AcceptedCost[]>()
    for (const sha of subjectShas)
      acceptedBySubject.set(sha, await this.acceptedIn(sha))
    const accepted = [...new Map([...acceptedBySubject.values()].flat().map(entry => [entry.id, entry])).values()]
    const predicates = gitAcceptancePredicates(this.mainGit)
    const plans = await planSubjects({
      mainTip,
      prs,
      runs: (await readBenchHistory(this.benchPath)).runs,
      events: this.events,
      now: this.startT,
      tickId: this.id,
      ...(this.deadline === null ? {} : { deadline: this.deadline }),
      ...(manual ? { manual: { ...manual, runs: options.runs, ...(this.scenario ? { scenario: this.scenario } : {}) } } : {}),
      accepted,
      introducing: (id, subjectSha) => introducingCommit(id, subjectSha, this.mainGit),
      isAncestor: predicates.isAncestor,
    })

    if (options.planOnly) {
      for (const plan of plans)
        this.recordSubject(plan.subject, plan.baselines[0] ?? null, plan.scenarios, plan.outcome === 'deferred' ? 'deferred' : 'skipped', plan.outcome === 'deferred' ? plan.reason : 'plan-only')
      return 0
    }

    const opened: string[] = []
    const compared: Candidate[] = []
    for (const plan of plans)
      await this.runSubject(plan, opened, compared)

    await this.closeFindings(acceptedBySubject, predicates, compared)

    // QA runs set AIRI_PERF_TRACK_NOTIFY=0, so a test tick never reaches the user's desktop.
    if (opened.length > 0 && host.env.AIRI_PERF_TRACK_NOTIFY !== '0') {
      try {
        await host.notify('AIRI perf', `${opened.length} new finding(s): ${opened.join(', ')}. Run pnpm perf status`)
      }
      catch (error) {
        host.log(`notification failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
      }
    }
    return 0
  }

  /** Lists open PRs and their merge-base baselines; a `gh` failure leaves the main tip as the only subject. */
  private async discover(mainTip: string) {
    let prs: { number: number, head: string, baselineSha: string, baseRef: string, changedPaths: string[] }[] | null = null
    let ghError: string | undefined
    try {
      const listed = parse(PrListSchema, JSON.parse(await this.host.gh(['pr', 'list', '--repo', 'lschneiderny/airi', '--state', 'open', '--json', 'number,headRefOid,baseRefName,updatedAt', '--limit', '50'])))
      prs = []
      for (const pr of listed) {
        await this.git(['fetch', '--quiet', 'origin', `pull/${pr.number}/head`])
        const baselineSha = (await this.git(['merge-base', pr.headRefOid, `origin/${pr.baseRefName}`])).trim()
        const changedPaths = lines(await this.git(['diff', '--name-only', baselineSha, pr.headRefOid]))
        prs.push({ number: pr.number, head: pr.headRefOid, baselineSha, baseRef: pr.baseRefName, changedPaths })
      }
    }
    catch (error) {
      prs = null
      ghError = errorMessageFrom(error) ?? 'gh failed'
    }
    this.append({
      v: 1,
      t: this.host.now(),
      event: 'discovery',
      tickId: this.id,
      mainTip,
      prs: prs && prs.map(({ changedPaths: _changedPaths, ...pr }) => pr),
      ...(ghError === undefined ? {} : { ghError }),
    })
    return prs
  }

  private async runSubject(plan: SubjectPlan, opened: string[], compared: Candidate[]): Promise<void> {
    const regular = plan.baselines[0] ?? null
    const resets = [...plan.resets]
    // The planner's environment resets describe history already read, so they persist even when no step runs.
    const stop = (outcome: SubjectOutcome, reason?: string) => {
      this.recordSubject(plan.subject, regular, plan.scenarios, outcome, reason)
      for (const reset of resets)
        this.append(reset)
    }
    if (plan.outcome === 'deferred') {
      stop('deferred', plan.reason)
      return
    }
    const initial = await this.runSteps(plan.steps)
    if (initial.outcome !== 'ok') {
      stop(initial.outcome, initial.reason)
      return
    }

    const candidates: { candidate: Candidate, attribution: BenchScenarioAttribution['regression'] }[] = []
    let rebenched = false
    for (const baseline of plan.baselines) {
      const ref = { kind: baseline.kind, sha: baseline.sha }
      for (;;) {
        const runs = (await readBenchHistory(this.benchPath)).runs
        const eligible = eligibleRuns(runs, runs.filter(run => run.t >= this.startT))
        const result = compareBenchRefs({
          runs: eligible,
          a: { kind: 'sha', text: baseline.sha, prefix: baseline.sha },
          b: { kind: 'sha', text: plan.subject.sha, prefix: plan.subject.sha },
          local: null,
          scenario: baseline.scenario,
          metric: null,
        })
        const scenarioComparison = result.ok ? result.scenarios[0] : noRunsComparison(baseline.scenario, baseline.sha, plan.subject.sha, eligible)
        if (!scenarioComparison) {
          this.host.log(`${baseline.scenario} ${sha7(baseline.sha)}..${sha7(plan.subject.sha)}: ${result.ok ? 'no comparison' : result.message}`)
          break
        }
        const scoped = scenarioComparison.status === 'compared'
          ? { ...scenarioComparison, comparisons: scenarioComparison.comparisons.filter(row => baseline.metrics.includes(row.metric)) }
          : scenarioComparison
        const judged = judgeComparison({ scenarioComparison: scoped, subject: plan.subject, baseline: ref, events: this.events, tickId: this.id, now: this.host.now(), rebenched })
        resets.push(...judged.resets)
        if (judged.outcome === 'rebench') {
          rebenched = true
          const step = (sha: string): BenchStep => ({ kind: 'bench', sha, scenarios: [baseline.scenario], runs: plan.runs })
          const again = await this.runSteps([step(baseline.sha), step(plan.subject.sha)])
          if (again.outcome !== 'ok') {
            stop(again.outcome, again.reason)
            return
          }
          continue
        }
        if (scoped.status === 'compared') {
          compared.push(...scoped.comparisons.map(comparison => ({ scenario: scoped.scenario, metric: comparison.metric, subject: plan.subject, baseline: ref, comparison })))
          candidates.push(...judged.candidates.map(candidate => ({ candidate, attribution: scoped.attribution.regression })))
        }
        break
      }
    }

    let confirmed: Awaited<ReturnType<typeof confirmCandidates>> = []
    if (candidates.length > 0) {
      const confirmStartT = this.host.now()
      const pairs = new Map(candidates.map(({ candidate }) => [`${candidate.baseline.sha}:${candidate.scenario}`, candidate]))
      const confirmation = await this.runSteps([...pairs.values()].flatMap(candidate => confirmSteps(candidate, plan.runs)), { cached: false })
      if (confirmation.outcome !== 'ok') {
        stop(confirmation.outcome, confirmation.reason)
        return
      }
      const runs = (await readBenchHistory(this.benchPath)).runs
      confirmed = confirmCandidates({ candidates: candidates.map(row => row.candidate), runs, confirmStartT, history: runs.filter(run => run.t < confirmStartT) })
    }

    stop(plan.steps.length > 0 ? 'benched' : 'already-benched')
    for (const candidate of confirmed) {
      const match = await matchOpen({ candidate, open: foldFindings(this.events).open, rangesOverlap: (finding, other) => this.rangesOverlap(finding, other) })
      if (match) {
        this.append({ v: 1, t: this.host.now(), event: 'observed-again', id: match.id, tickId: this.id, subject: candidate.subject, baselineSha: candidate.baseline.sha, difference: candidate.comparison.difference })
        this.host.print(`observed again: ${match.id}`)
        continue
      }
      const range = `${candidate.baseline.sha}..${candidate.subject.sha}`
      const attribution = candidates.find(row => row.candidate.scenario === candidate.scenario && row.candidate.metric === candidate.metric && row.candidate.baseline.sha === candidate.baseline.sha)?.attribution
      const finding = buildFinding({
        candidate,
        attribution: attribution ?? { stages: [], timed: false, noStageMoved: true },
        rangeCommits: Number((await this.git(['rev-list', '--count', range])).trim()),
        renderLoopCommits: await this.renderLoopCommits(range),
        tickId: this.id,
        now: this.host.now(),
      })
      this.append(finding)
      opened.push(finding.id)
      this.host.print(`finding opened: ${finding.id}`)
    }
  }

  private async renderLoopCommits(range: string): Promise<FindingOpenEvent['renderLoopCommits']> {
    const commits: FindingOpenEvent['renderLoopCommits'] = []
    for (const line of lines(await this.git(['log', '--format=%H %s', range]))) {
      const [sha, ...words] = line.split(' ')
      if (touchesRenderLoop(lines(await this.git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]))))
        commits.push({ sha, subject: words.join(' ') })
    }
    return commits
  }

  /**
   * Whether an open finding's range shares a commit with the candidate's, by sha or, after a rebase merge, by patch:
   * a finding commit whose patch is in the candidate subject's history but not in its baseline's.
   */
  private async rangesOverlap(finding: { baseline: { sha: string }, subject: { sha: string } }, candidate: Candidate): Promise<boolean> {
    const own = lines(await this.git(['rev-list', `${finding.baseline.sha}..${finding.subject.sha}`]))
    const other = new Set(lines(await this.git(['rev-list', `${candidate.baseline.sha}..${candidate.subject.sha}`])))
    if (own.some(sha => other.has(sha)))
      return true
    const equivalent = async (upstream: string) => new Set(lines(await this.git(['cherry', upstream, finding.subject.sha, finding.baseline.sha])).filter(line => line.startsWith('-')).map(line => line.slice(2)))
    const inSubject = await equivalent(candidate.subject.sha)
    if (inSubject.size === 0)
      return false
    const inBaseline = await equivalent(candidate.baseline.sha)
    return [...inSubject].some(sha => !inBaseline.has(sha))
  }

  /** The accepted costs committed in `sha`'s tree; a subject from before the file existed accepts nothing. */
  private async acceptedIn(sha: string): Promise<AcceptedCost[]> {
    if (!(await this.git(['ls-tree', '--name-only', sha, '--', ACCEPTED_COSTS_PATH])).trim())
      return []
    return parse(AcceptedCostsSchema, JSON.parse(await this.git(['show', `${sha}:${ACCEPTED_COSTS_PATH}`]))).entries
  }

  /** Each subject's entries resolve their introducing commit in that subject's own history. */
  private async closeFindings(acceptedBySubject: ReadonlyMap<string, readonly AcceptedCost[]>, predicates: ReturnType<typeof gitAcceptancePredicates>, compared: readonly Candidate[]): Promise<void> {
    const resolved: { entry: AcceptedCost, introducing: string }[] = []
    for (const [sha, entries] of acceptedBySubject) {
      for (const entry of entries) {
        const introducing = await introducingCommit(entry.id, sha, this.mainGit)
        if (introducing && !resolved.some(row => row.entry.id === entry.id && row.introducing === introducing))
          resolved.push({ entry, introducing })
      }
    }
    const open = foldFindings(this.events).open
    const { closes, steps } = await acceptedCloses({ open, accepted: resolved, isAncestor: predicates.isAncestor, inRange: predicates.rangeLandedIn, now: this.host.now() })
    const closedIds = new Set(closes.map(close => close.id))
    for (const close of [...closes, ...fixedCloses({ open: open.filter(finding => !closedIds.has(finding.id)), comparisons: compared, now: this.host.now() })]) {
      this.append(close)
      this.host.print(`finding closed: ${close.id} as ${close.resolution}`)
    }
    // The accepted cost's introducing commit becomes the new baseline when its bench still fits before the deadline.
    const rebaseline = await this.runSteps(steps)
    if (rebaseline.outcome !== 'ok')
      this.host.log(`rebaseline: ${rebaseline.outcome} (${rebaseline.reason})`)
  }

  /** Runs each step's scenarios as one bench invocation each; the first result other than `ok` ends the run. */
  private async runSteps(steps: readonly BenchStep[], options: { cached: boolean } = { cached: true }): Promise<StepResult> {
    for (const step of steps) {
      for (const scenario of step.scenarios) {
        const result = await this.bench(step.sha, scenario, step.runs, options.cached)
        if (result.outcome !== 'ok')
          return result
      }
    }
    return OK
  }

  /**
   * Checked before every child the tick starts, preparation included: an interrupt throws, and once the deadline or a
   * busy host has stopped the tick, nothing else launches. Teardown (`qa:display down`) is not a launch.
   */
  private launchBlocked(): Exclude<StepResult, { outcome: 'ok' }> | null {
    if (this.host.signal.aborted)
      throw new Interrupted()
    if (!this.stopped && this.deadline !== null && this.host.now() >= this.deadline)
      this.stopped = { outcome: 'deferred', reason: 'deadline' }
    return this.stopped
  }

  /** `rebench` allows one more invocation of the same side when an exit 1 left it short of `runs` valid runs. */
  private async bench(sha: string, scenario: BenchScenarioId, runs: number, cached: boolean, rebench = true): Promise<StepResult> {
    const prepared = this.launchBlocked() ?? await this.prepare(sha, cached)
    if (prepared.outcome !== 'ok')
      return prepared
    const blocked = this.launchBlocked()
    if (blocked)
      return blocked

    this.seq += 1
    const out = join(this.host.stateDir, 'runs', this.id, `${String(this.seq).padStart(3, '0')}-${sha7(sha)}-${scenario}`)
    const before = (await readBenchHistory(this.benchPath)).runs.length
    const notAfter = this.deadline === null ? [] : ['--not-after', formatISO(new TZDate(this.deadline, this.host.timeZone))]
    const spawnOptions = { cwd: this.host.toolRoot, env: { ...this.host.env, TMPDIR: this.tmpDir } }
    let code: number
    try {
      code = await this.host.spawn('pnpm', ['qa:display', 'run', '--name', DISPLAY_NAME, '--', 'pnpm', 'qa:bench', '--repo-root', this.appWorktree, '--scenario', scenario, '--runs', String(runs), '--out', out, ...notAfter], spawnOptions)
    }
    finally {
      const down = await this.host.spawn('pnpm', ['qa:display', 'down', '--name', DISPLAY_NAME], spawnOptions)
      if (down !== 0)
        this.host.log(`qa:display down --name ${DISPLAY_NAME} exited ${down}`)
    }

    switch (code) {
      case 0:
        return this.checkRecords((await readBenchHistory(this.benchPath)).runs.slice(before), sha)
      case 1: {
        // qa:bench also exits 1 when a run is only invalid (host-contended, excluded-window); its valid runs still count.
        const records = (await readBenchHistory(this.benchPath)).runs.slice(before)
        if (!onlyInvalidRuns(records, sha))
          return { outcome: 'broken', reason: 'bench-exit-1' }
        if (rebench && records.filter(record => record.valid).length < runs)
          return this.bench(sha, scenario, runs, cached, false)
        return OK
      }
      case 2:
        return { outcome: 'skipped', reason: 'subject-unsupported' }
      case 3:
        this.stopped = { outcome: 'deferred', reason: 'host-busy' }
        return this.stopped
      case 4:
        this.stopped = { outcome: 'deferred', reason: 'deadline' }
        return this.stopped
      case 130:
        throw new Interrupted()
      default:
        return { outcome: 'broken', reason: `bench-exit-${code}` }
    }
  }

  /** A bench that exited 0 must have recorded clean runs of exactly the commit it was given. */
  private checkRecords(records: readonly BenchRunRecord[], sha: string): StepResult {
    if (records.length === 0)
      return { outcome: 'broken', reason: 'no-records' }
    if (records.some(record => record.sha !== sha))
      return { outcome: 'broken', reason: 'sha-mismatch' }
    if (records.some(record => record.dirty))
      return { outcome: 'broken', reason: 'subject-dirty' }
    return OK
  }

  /**
   * Checks out `sha` in the app worktree and installs it; `subject-dirty` when tracked files differ afterwards, and the
   * stop result when a step would start past the deadline. A cached prepare of the same sha is reused within the tick.
   * Throws when the worktree cannot be prepared, which fails the tick.
   */
  private async prepare(sha: string, cached: boolean): Promise<StepResult> {
    const wt = await this.ensureAppWorktree()
    const run = async (args: readonly string[], cwd: string, what: string): Promise<StepResult> => {
      const blocked = this.launchBlocked()
      if (blocked)
        return blocked
      const code = await this.host.spawn('pnpm', args, { cwd, env: { ...this.host.env, TMPDIR: this.tmpDir } })
      if (code !== 0)
        throw new Error(`${what} in the app worktree exited ${code}`)
      return OK
    }
    if (!cached || this.preparedSha !== sha) {
      this.preparedSha = null
      await this.git(['checkout', '--quiet', '--force', '--detach', sha], wt)
      // Cubism Core is an ignored download, kept so each step does not fetch it again.
      await this.git(['clean', '-fdxq', '-e', '.env.qa', '-e', 'node_modules', '-e', `/${dirname(dirname(CUBISM_CORE))}/`], wt)
      const install = await run(['-C', wt, 'install', '--frozen-lockfile'], this.host.toolRoot, 'pnpm install --frozen-lockfile')
      if (install.outcome !== 'ok')
        return install
      // git clean removed every ignored package build, and an install that finds node_modules current skips the
      // postinstall that builds them, so build explicitly.
      const build = await run(['-C', wt, 'run', 'build:packages'], this.host.toolRoot, 'pnpm run build:packages')
      if (build.outcome !== 'ok')
        return build
    }
    if ((await this.git(['status', '--porcelain', '--untracked-files=no'], wt)).trim())
      return { outcome: 'broken', reason: 'subject-dirty' }
    writeFileSync(join(wt, '.env.qa'), this.qaEnv)
    if (!existsSync(join(wt, CUBISM_CORE))) {
      const setup = await run(['qa:setup', 'cubism'], wt, 'pnpm qa:setup cubism')
      if (setup.outcome !== 'ok')
        return setup
    }
    this.preparedSha = sha
    return OK
  }

  private async ensureAppWorktree(): Promise<string> {
    if (this.appWorktree)
      return this.appWorktree
    // The same directory rule as `pnpm wt new` in scripts/dev-tools/wt.ts: `<parent>/<main checkout name>-wt/<name>`.
    const wt = join(dirname(this.mainRoot), `${basename(this.mainRoot)}-wt`, DISPLAY_NAME)
    if (!existsSync(join(wt, '.git'))) {
      await this.git(['worktree', 'add', '--detach', wt, 'origin/main'])
      // Locked, so `pnpm wt gc` leaves the tracker's persistent worktree alone.
      await this.git(['worktree', 'lock', '--reason', 'perf tracker', wt])
    }
    // The main checkout's model paths, unchanged, so the bench's model fingerprint matches the history.
    const values: Record<string, string | undefined> = {}
    loadQaEnv(this.mainRoot, values)
    this.qaEnv = QA_ENV_KEYS.flatMap((key) => {
      const value = values[key]
      if (value === undefined)
        return []
      if (/["\n]/.test(value))
        throw new Error(`${key} in the main checkout's .env.qa holds a quote or newline the app worktree copy cannot keep`)
      return [`${key}="${value}"\n`]
    }).join('')
    this.appWorktree = wt
    return wt
  }
}
