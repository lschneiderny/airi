import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import type { RunHandle } from '../../evidence/run'
import type { ResolvedRig } from '../../t3/args'
import type { EmotionCellPartial, LivelinessPartial, NullPartial } from './partials'
import type { GateReport } from './report'
import type { T3SessionHeader } from './t3-scenario'
import type { T3ReleaseRecord } from './t3-score'

import process, { pid, ppid } from 'node:process'

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { scoredChannels } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks, emotionGate, naturalEmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import * as v from 'valibot'

import { strayElectronProcesses } from '../../env/doctor'
import { listLiveProcesses } from '../../env/processes'
import { createRun, readGitStateFromRepo } from '../../evidence/run'
import { writeReport } from '../../report/render'
import { maxT3ScenarioSeconds, resolveRig, t3RigCatalogs, T3UsageError } from '../../t3/args'
import { runT3 } from '../../t3/run-t3'
import { scenarioEventsOf, TraceEventsSchema } from '../../t3/verify-trace'
import { aggregateLiveliness, formatSummary, hashPartials, seal } from './aggregate'
import { cellPartialName, livelinessGateFor, livelinessPartialName, nullPartialName } from './options'
import { writePartial } from './partials'
import { currentReportSchema, parseGateReport } from './report'
import { assertT3TraceHome, verifyT3Archive } from './t3-archive'
import { buildT3EmotionPlan, buildT3IdleScenario, t3PlanFromScenarios, t3ScenarioSettings, t3SessionHeaderMismatch, t3TraceMismatch } from './t3-scenario'
import { measureT3Session, scoreT3Emotion } from './t3-score'
import { trimWarmUp } from './trials'

export interface T3GateCommand {
  target: 'emotion' | 'liveliness'
  /** Run dir of the T1 emotion report the transfer ratios divide by; `null` finds the newest one at this commit. */
  t1Report: string | null
  /** An archived T3 emotion gate run dir to score again from its session traces, with no launch; `null` runs live. */
  rescore: string | null
}

const fixturesDir = resolve(import.meta.dirname, '..', '..', '..', 'fixtures')
const t1EmotionRunPattern = /-motion-gate-emotion-t1$/

/** The T1 emotion report the transfer ratio needs: same commit, and a result for every face check of the T3 cells (a missing `E` makes that ratio `n/a`). */
export function findT1Reference(repoRoot: string, gitSha: string, explicit: string | null): { dir: string, report: GateReport } | string {
  const faceKeys = buildEmotionChecks()
    .filter(check => check.cls === 'face' && naturalEmotionT3Gate.cells.some(cell => cell.emotion === check.emotion && cell.band === check.band))
    .map(check => check.key)
  const qaDir = join(repoRoot, '.temp', 'qa')
  const candidates = explicit !== null
    ? [resolve(explicit)]
    : existsSync(qaDir) ? readdirSync(qaDir).filter(name => t1EmotionRunPattern.test(name)).sort().reverse().map(name => join(qaDir, name)) : []
  const problems: string[] = []
  for (const dir of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { gitSha?: string, cache?: { hit?: boolean } }
      // A replayed result is a local check; the transfer ratios of an acceptance run divide by a computed one.
      if (manifest.cache?.hit) {
        if (explicit !== null)
          return `T1 reference ${dir} is a cached run; rerun it with --fresh`
        problems.push(`${dir}: cached run; rerun it with --fresh`)
        continue
      }
      if (manifest.gitSha !== gitSha) {
        problems.push(`${dir}: commit ${manifest.gitSha ?? 'unknown'}, not ${gitSha}`)
        continue
      }
      const report = parseGateReport(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')))
      const scored = new Set(report.results.map(result => result.key))
      const missing = faceKeys.filter(key => !scored.has(key))
      if (report.level !== 't1' || missing.length) {
        problems.push(`${dir}: ${report.level !== 't1' ? `level ${report.level}` : `no T1 result for ${missing.join(', ')}`}`)
        continue
      }
      return { dir, report }
    }
    catch (error) {
      problems.push(`${dir}: ${errorMessageFrom(error) ?? 'unreadable'}`)
    }
  }
  const cells = naturalEmotionT3Gate.cells
  const command = `pnpm qa:motion gate emotion --level t1 --emotions ${[...new Set(cells.map(cell => cell.emotion))].join(',')} --bands ${[...new Set(cells.map(cell => cell.band))].join(',')}`
  return `No T1 emotion report at commit ${gitSha} covers the T3 cells${problems.length ? ` (${problems.join('; ')})` : ''}. Run \`${command}\` first, or pass --t1-report <run dir>.`
}

interface SessionOutcome {
  scenario: MotionScenario
  runDir: string | null
  runId: string | null
  exitCode: number
  summary: string
  trace: NaturalTrace | null
}

function writeJson(run: RunHandle, name: string, value: unknown) {
  mkdirSync(join(run.path(name), '..'), { recursive: true })
  writeFileSync(run.path(name), `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Runs each scenario as one rendered T3 session (launch, capture, teardown). A failed session (for example a cursor that
 * would not park) does not stop the others; an interrupt or a refusal before launch does.
 */
async function runSessions(scenarios: readonly MotionScenario[], context: { repoRoot: string, rig: ResolvedRig, run: RunHandle, signal: AbortSignal }): Promise<SessionOutcome[]> {
  const catalog = JSON.parse(readFileSync(resolve(fixturesDir, t3RigCatalogs.forbooth), 'utf8')) as CatalogEntry[]
  const outcomes: SessionOutcome[] = []
  for (const scenario of scenarios) {
    const source = `scenarios/${scenario.id}.json`
    writeJson(context.run, source, scenario)
    context.run.addArtifact(source, 'scenario')
    console.info(`qa-tools gate t3: session ${outcomes.length + 1}/${scenarios.length} (${scenario.id}, ${scenario.durationSeconds} s)`)
    const result = await runT3({
      repoRoot: context.repoRoot,
      rig: context.rig,
      scenario,
      scenarioSource: context.run.path(source),
      catalog,
      keepOpen: false,
      signal: context.signal,
      log: line => process.stderr.write(`${line}\n`),
      selfPids: [pid, ppid],
    })
    const tracePath = result.runDir ? join(result.runDir, 'trace.json') : null
    const trace = tracePath && existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) as NaturalTrace : null
    outcomes.push({ scenario, runDir: result.runDir ?? null, runId: result.runDir ? result.runDir.split(/[\\/]/).at(-1)! : null, exitCode: result.exitCode, summary: result.summary, trace })
    if (result.exitCode === 130 || result.exitCode === 2)
      break
  }
  return outcomes
}

/** Result rows for sessions that did not verify: the gate never passes on a session whose trace the harness rejected. */
function sessionRows(outcomes: readonly SessionOutcome[], expected: number) {
  const rows = outcomes.filter(outcome => outcome.exitCode !== 0).map(outcome => ({ key: `session:${outcome.scenario.id}`, verdict: 'fail' as const, reasons: [`exit ${outcome.exitCode}: ${outcome.summary}`] }))
  if (outcomes.length < expected)
    rows.push({ key: 'session:missing', verdict: 'fail' as const, reasons: [`${expected - outcomes.length} of ${expected} sessions did not run`] })
  return rows
}

function sessionSummaries(outcomes: readonly SessionOutcome[]) {
  return outcomes.map(outcome => ({ scenarioId: outcome.scenario.id, runId: outcome.runId, runDir: outcome.runDir, exitCode: outcome.exitCode, summary: outcome.summary }))
}

function t3Settings() {
  const parsed = parseExpressionPerformanceSettings({ ...t3ScenarioSettings(emotionGate).performance, heldEmotions: true })
  if (!parsed.success)
    throw new Error('[qa-tools] The T3 scenario settings are invalid')
  return parsed.value
}

/** The committed emotion plan of a live run. */
function t3EmotionPlan() {
  return buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, t3Settings())
}

/** Writes `report.json`, `summary.txt`, `timing.json`, `run.json` and `report.html` (with the session run dirs) and returns the exit code. */
function writeGateOutputs(run: RunHandle, report: GateReport, outcomes: readonly SessionOutcome[], started: number, prefix: string): number {
  writeJson(run, 'report.json', report)
  run.addArtifact('report.json', 'report')
  const text = t3Summary(report)
  writeFileSync(run.path('summary.txt'), text)
  run.addArtifact('summary.txt', 'summary')
  console.info(text)
  const exitCode = report.pass ? 0 : 1
  const wallSeconds = Math.round((Date.now() - started) / 100) / 10
  writeJson(run, 'timing.json', { wallSeconds, sessions: outcomes.length })
  run.addArtifact('timing.json', 'timing')
  const summary = `${prefix}${report.pass ? 'all gated checks passed' : `${report.results.filter(result => result.verdict !== 'pass' && result.gated !== false).length} gated check(s) failed or incomplete`} [wall ${wallSeconds}s, ${outcomes.length} session(s): ${outcomes.map(outcome => outcome.runId ?? 'no run dir').join(', ')}]`
  run.finish({ exitCode, summary })
  const rendered = writeReport({ runDirs: [run.dir, ...outcomes.flatMap(outcome => outcome.runDir ? [outcome.runDir] : [])] })
  run.addArtifact('report.html', 'report-html')
  run.finish({ exitCode, summary })
  for (const issue of rendered.issues)
    console.error(`report input problem: ${issue.run}/${issue.file}: ${issue.problem}`)
  console.info(`run ${run.runId}: exit ${exitCode}; report ${rendered.outFile}`)
  return exitCode
}

const ArchivedSessionSchema = v.object({ scenarioId: v.string(), runId: v.nullable(v.string()), runDir: v.nullable(v.string()), exitCode: v.number(), summary: v.string() })
const ArchivedEmotionSchema = v.looseObject({
  sessions: v.array(ArchivedSessionSchema),
  t1Reference: v.looseObject({ runId: v.string(), determinismHash: v.string() }),
})

/**
 * `gate emotion --level t3 --rescore <gate run dir>`: scores an archived T3 emotion run again from its session traces with
 * the current scorer and rules, without launching anything. First every artifact it reads is checked against the sha256
 * recorded in its run dir's `run.json` at capture time (`verifyT3Archive`). It uses the T1 reference the archived run named (its
 * determinism hash must match) and the scenarios the run performed (`t3PlanFromScenarios` checks them against the
 * gate's layout rules), so it judges exactly what was captured even when the committed plan has changed since.
 * Exit codes: 0 every gated check passed, 1 a check failed, 2 the archive cannot be re-scored.
 */
function rescoreT3Emotion(source: string, repoRoot: string, gateFileSha: () => string): number {
  const sourceDir = resolve(source)
  let plan: ReturnType<typeof t3PlanFromScenarios>
  let archived: v.InferOutput<typeof ArchivedEmotionSchema>
  let t1: { dir: string, report: GateReport }
  let outcomes: SessionOutcome[]
  let sourceRunId: string
  try {
    // Before anything is parsed for scoring: every artifact the re-score reads must still match its capture digest.
    const covered = verifyT3Archive(sourceDir, repoRoot)
    console.info(`qa-tools gate t3: ${covered.length} archived artifacts match their capture digests`)
    const report = parseGateReport(JSON.parse(readFileSync(join(sourceDir, 'report.json'), 'utf8')))
    if (report.gateId !== naturalEmotionT3Gate.id)
      throw new Error(`gate ${report.gateId} is not ${naturalEmotionT3Gate.id}`)
    archived = v.parse(ArchivedEmotionSchema, report)
    const sourceManifest = JSON.parse(readFileSync(join(sourceDir, 'run.json'), 'utf8')) as { runId: string, gitSha: string }
    sourceRunId = sourceManifest.runId
    const scenarioFiles = readdirSync(join(sourceDir, 'scenarios')).filter(name => name.endsWith('.json')).sort()
    plan = t3PlanFromScenarios(naturalEmotionT3Gate, emotionGate, t3Settings(), scenarioFiles.map(name => JSON.parse(readFileSync(join(sourceDir, 'scenarios', name), 'utf8')) as MotionScenario))
    const t1Dir = join(repoRoot, '.temp', 'qa', archived.t1Reference.runId)
    const t1Report = parseGateReport(JSON.parse(readFileSync(join(t1Dir, 'report.json'), 'utf8')))
    if (t1Report.determinismHash !== archived.t1Reference.determinismHash)
      throw new Error(`T1 reference ${t1Dir} has determinismHash ${t1Report.determinismHash}, not the archived ${archived.t1Reference.determinismHash}`)
    t1 = { dir: t1Dir, report: t1Report }
    let rig: { model3: unknown, files: unknown, bytes: unknown } | undefined
    const readJsonFile = (dir: string, name: string): Record<string, unknown> => existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown> : {}
    outcomes = plan.sessions.flatMap((session) => {
      const entry = archived.sessions.find(item => item.scenarioId === session.scenario.id)
      if (!entry)
        return []
      const tracePath = entry.runDir ? join(entry.runDir, 'trace.json') : null
      const trace = tracePath && existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) as NaturalTrace : null
      if (trace && entry.runDir) {
        // The session must be the archived scenario's own capture, on the same build and the same rig as the others.
        const bridge = readJsonFile(entry.runDir, 'bridge.json') as T3SessionHeader['bridge']
        const header = t3SessionHeaderMismatch(session.scenario, { sessionScenario: readJsonFile(entry.runDir, 'scenario.json'), manifest: readJsonFile(entry.runDir, 'run.json'), trace, bridge }, { gitSha: sourceManifest.gitSha, rigName: 'forbooth', rig })
        if (header)
          throw new Error(`archive invariant "session-header": ${header}`)
        rig ??= { model3: bridge.rig?.model3, files: bridge.rig?.files, bytes: bridge.rig?.bytes }
        // A trace that recorded other events than its scenario would let one trial id select another trial's pulse or recipe.
        const mismatch = t3TraceMismatch(session.scenario, scenarioEventsOf(v.parse(TraceEventsSchema, trace)))
        if (mismatch)
          throw new Error(`archive invariant "trace-identity": ${mismatch}`)
      }
      return [{ scenario: session.scenario, runDir: entry.runDir, runId: entry.runId, exitCode: entry.exitCode, summary: entry.summary, trace }]
    })
  }
  catch (error) {
    console.error(`Cannot re-score ${sourceDir}: ${errorMessageFrom(error) ?? 'unreadable archive'}`)
    return 2
  }
  const fileSha = gateFileSha()
  const run = createRun({ tool: 'motion', label: 'gate-emotion-t3-rescore', repoRoot, gate: { id: naturalEmotionT3Gate.id, version: String(naturalEmotionT3Gate.version), fileSha } })
  console.info(`qa-tools gate t3: re-scoring ${sourceRunId} into ${run.dir}; T1 reference ${t1.dir}`)
  const started = Date.now()
  try {
    const report = scoreEmotionSessions(run, outcomes, plan, t1, fileSha)
    return writeGateOutputs(run, seal({ ...stripHash(report), rescoreOf: sourceRunId }), outcomes, started, `re-score of ${sourceRunId}: `)
  }
  catch (error) {
    const summary = `re-score broke: ${errorMessageFrom(error) ?? 'unknown error'}`
    console.error(summary)
    run.finish({ exitCode: 1, summary })
    return 1
  }
}

function stripHash(report: GateReport): Omit<GateReport, 'determinismHash'> {
  const { determinismHash: _hash, ...body } = report
  return body
}

function scoreEmotionSessions(run: RunHandle, outcomes: readonly SessionOutcome[], plan: ReturnType<typeof buildT3EmotionPlan>, t1: { dir: string, report: GateReport }, fileSha: string): GateReport {
  const parsed = parseExpressionPerformanceSettings({ ...t3ScenarioSettings(emotionGate).performance, heldEmotions: true })
  if (!parsed.success)
    throw new Error('[qa-tools] The T3 scenario settings are invalid')
  const settings = parsed.value
  const scored = outcomes.filter((outcome): outcome is SessionOutcome & { trace: NaturalTrace } => outcome.trace !== null)
  for (const outcome of scored)
    assertT3TraceHome(outcome.scenario, outcome.trace)
  // Each session is its own stratum: its trials meet only its own placebo windows (naturalEmotionT3Gate.placeboNull).
  const measures = scored.map(outcome => measureT3Session(outcome.trace, plan.sessions.find(session => session.scenario.id === outcome.scenario.id)!.pulses.map(pulse => pulse.trialId), emotionGate, settings, outcome.scenario.id))
  const records = measures.flatMap(measure => measure.records)
  const placebos = measures.flatMap(measure => measure.placebos)
  const release: T3ReleaseRecord[] = measures.flatMap(measure => measure.release)
  if (!scored.length)
    throw new Error('no session produced a trace')

  const names: string[] = [nullPartialName, 't3-release.json']
  for (const cell of naturalEmotionT3Gate.cells) {
    const name = cellPartialName(cell.emotion, cell.band, 'full')
    names.push(name)
    const partial: EmotionCellPartial = { kind: 'emotion-cell', emotion: cell.emotion, band: cell.band, variant: 'full', seeds: { start: 1, count: naturalEmotionT3Gate.trialsPerCell }, records: records.filter(record => record.emotion === cell.emotion && record.band === cell.band) }
    writePartial(run.dir, name, partial)
  }
  const ranges = scored[0].trace.ranges
  const nullPartial: NullPartial = { kind: 'null', seeds: { start: 1, count: scored.length }, ranges, records: placebos }
  writePartial(run.dir, nullPartialName, nullPartial)
  writeFileSync(run.path('partials/t3-release.json'), JSON.stringify(release))

  const t1Effects = new Map(t1.report.results.map(result => [result.key, typeof result.E === 'number' ? result.E : null]))
  const score = scoreT3Emotion({ t3: naturalEmotionT3Gate, gate: emotionGate, records, placebos, release, ranges, settings, t1Effects })
  const t1Manifest = JSON.parse(readFileSync(join(t1.dir, 'run.json'), 'utf8')) as { runId: string, gitSha: string }
  const rows = sessionRows(outcomes, plan.sessions.length)
  return seal({
    reportSchema: currentReportSchema,
    gateId: naturalEmotionT3Gate.id,
    version: naturalEmotionT3Gate.version,
    fileSha,
    inputHash: hashPartials(run.dir, names),
    level: 't3',
    limitation: naturalEmotionT3Gate.limitation,
    pass: score.pass && rows.length === 0,
    nullStats: score.nullStats,
    results: [...rows, ...score.results.map(result => ({ ...result, trajectory: null, levels: null }))],
    rules: naturalEmotionT3Gate,
    nullModel: {
      kind: naturalEmotionT3Gate.placeboNull,
      statement: 'Each trial is scored against the placebo windows of its own capture session: visibility against that session\'s q90, the effect as the mean trial-minus-own-session-null difference with a bootstrap that resamples within sessions, and significance by a permutation test that relabels trials and placebos only within each session. nullStats is pooled over sessions for display only.',
      placebosTotal: placebos.length,
      minPlacebos: naturalEmotionT3Gate.minPlacebos,
      sessions: scored.map(outcome => ({
        stratum: outcome.scenario.id,
        trials: records.filter(record => record.stratum === outcome.scenario.id).length,
        placebos: placebos.filter(placebo => placebo.stratum === outcome.scenario.id).length,
        nullStats: score.strataNullStats[outcome.scenario.id] ?? {},
      })),
    },
    windows: { gate: emotionGate.id, version: emotionGate.version },
    t1Reference: { runId: t1Manifest.runId, gitSha: t1Manifest.gitSha, determinismHash: t1.report.determinismHash },
    plan: { spacing: plan.spacing, placebos: plan.placebos, placeboWindowsScored: placebos.length, sessions: plan.sessions.map(session => ({ id: session.scenario.id, durationSeconds: session.scenario.durationSeconds, pulses: session.pulses.length, placebos: session.placebos })) },
    posture: score.posture,
    sessions: sessionSummaries(outcomes),
  })
}

function scoreLivelinessSessions(run: RunHandle, outcomes: readonly SessionOutcome[], expected: number, fileSha: string): GateReport {
  const gate = livelinessGateFor('t3')
  const scored = outcomes.filter((outcome): outcome is SessionOutcome & { trace: NaturalTrace } => outcome.trace !== null)
  for (const outcome of scored)
    assertT3TraceHome(outcome.scenario, outcome.trace)
  scored.forEach((outcome, index) => {
    const partial: LivelinessPartial = { kind: 'liveliness-trace', seed: gate.seeds[index], trace: trimWarmUp(outcome.trace, gate.warmUpSeconds) }
    writePartial(run.dir, livelinessPartialName(gate.seeds[index]), partial)
  })
  if (scored.length < gate.seeds.length) {
    // The gate aggregates exactly three captures; with fewer it has no verdict on the metrics, only the failed sessions.
    return seal({
      reportSchema: currentReportSchema,
      gateId: gate.id,
      version: gate.version,
      fileSha,
      inputHash: hashPartials(run.dir, gate.seeds.slice(0, scored.length).map(livelinessPartialName)),
      level: 't3',
      limitation: gate.limitation,
      pass: false,
      nullStats: {},
      results: [...sessionRows(outcomes, expected), { key: 'captures', verdict: 'fail', reasons: [`${scored.length} of ${gate.seeds.length} idle captures produced a trace; the metrics were not aggregated`] }],
      sessions: sessionSummaries(outcomes),
    })
  }
  const { determinismHash, ...body } = aggregateLiveliness({ runDir: run.dir, fileSha, level: 't3' }, gate)
  const rows = sessionRows(outcomes, expected)
  return seal({
    ...body,
    // The T1 aggregation sealed the metrics alone; this seal also covers the session rows.
    metricsDeterminismHash: determinismHash,
    pass: body.pass && rows.length === 0,
    results: [...rows, ...body.results],
    captures: { count: gate.seeds.length, captureSeconds: 600, warmUpSeconds: gate.warmUpSeconds, cursorAttention: false, cursor: 'parked by the harness before each capture' },
    sessions: sessionSummaries(outcomes),
  })
}

function t3Summary(report: GateReport): string {
  const lines = [formatSummary(report).trimEnd()]
  const nullModel = (report as GateReport & { nullModel?: { kind: string, placebosTotal: number, sessions: { stratum: string, trials: number, placebos: number }[] } }).nullModel
  if (nullModel)
    lines.push(`Placebo null: ${nullModel.kind}; ${nullModel.sessions.map(session => `${session.stratum} ${session.placebos} placebos / ${session.trials} trials`).join(', ')}; ${nullModel.placebosTotal} placebo windows in total`)
  if (report.gateId === naturalEmotionT3Gate.id) {
    lines.push('Transfer ratios E_T3 / E_T1 (face channels):')
    for (const result of report.results) {
      if (typeof result.channel === 'string' && scoredChannels[result.channel as ScoredChannel] === 'face')
        lines.push(`  ${String(result.key).padEnd(28)} ${typeof result.transferRatio === 'number' ? result.transferRatio.toFixed(3) : 'n/a'} (E_T3 ${String(result.E)}, E_T1 ${String(result.t1E)}, hits ${String(result.hits)}/${String(result.n)})`)
    }
    const posture = (report as GateReport & { posture?: { channel: string, checks: number, signAgrees: number, meanD: number | null }[] }).posture ?? []
    lines.push('Posture (pooled, not gated):', ...posture.map(entry => `  ${entry.channel.padEnd(12)} ${entry.signAgrees}/${entry.checks} checks in the recipe direction, mean d ${entry.meanD === null ? 'n/a' : entry.meanD.toFixed(2)}`))
  }
  return `${lines.join('\n')}\n`
}

/**
 * `qa:motion gate <emotion | liveliness> --level t3 --rig forbooth`: preflight (rig, stray Electron, T1 reference),
 * the rendered sessions, scoring through the shared scorer, `report.json`, `summary.txt` and `report.html`.
 * Exit codes: 0 every gated check passed, 1 a check failed or a session broke, 2 refused before launching, 130 interrupted.
 */
export async function runT3Gate(command: T3GateCommand, repoRoot: string, env: NodeJS.ProcessEnv, gateFileSha: () => string): Promise<number> {
  if (command.rescore !== null)
    return rescoreT3Emotion(command.rescore, repoRoot, gateFileSha)
  let rig: ResolvedRig
  try {
    rig = resolveRig('forbooth', env)
  }
  catch (error) {
    if (error instanceof T3UsageError) {
      console.error(`T3 setup failed: ${error.message}`)
      return 2
    }
    throw error
  }
  const strays = strayElectronProcesses(await listLiveProcesses(), repoRoot)
  if (strays.length) {
    console.error(`Refusing to launch (stray-electron): stage-tamagotchi electron processes from this worktree are running: PIDs ${strays.map(entry => entry.pid).join(', ')}. Stop the dev session that owns them first; the gate never kills processes it did not start.`)
    return 2
  }
  const { gitSha } = readGitStateFromRepo(repoRoot)
  let t1: { dir: string, report: GateReport } | null = null
  if (command.target === 'emotion') {
    const found = findT1Reference(repoRoot, gitSha, command.t1Report)
    if (typeof found === 'string') {
      console.error(found)
      return 2
    }
    t1 = found
  }

  const plan = command.target === 'emotion' ? t3EmotionPlan() : null
  const scenarios = plan ? plan.sessions.map(session => session.scenario) : livelinessGateFor('t3').seeds.map(seed => buildT3IdleScenario(seed, maxT3ScenarioSeconds))
  const gate = command.target === 'emotion' ? naturalEmotionT3Gate : livelinessGateFor('t3')
  const fileSha = gateFileSha()
  const run = createRun({ tool: 'motion', label: `gate-${command.target}-t3`, repoRoot, gate: { id: gate.id, version: String(gate.version), fileSha } })
  console.info(`qa-tools gate t3: run dir ${run.dir}; ${scenarios.length} session(s)${t1 ? `; T1 reference ${t1.dir}` : ''}`)

  const controller = new AbortController()
  const onInterrupt = (signal: string) => {
    if (!controller.signal.aborted) {
      process.stderr.write(`qa-tools gate t3: ${signal} received; stopping after teardown\n`)
      controller.abort(new Error(`${signal} received`))
    }
  }
  const listeners = (['SIGINT', 'SIGTERM', 'SIGBREAK'] as const).map(signal => [signal, () => onInterrupt(signal)] as const)
  for (const [signal, listener] of listeners)
    process.on(signal, listener)

  const started = Date.now()
  let exitCode = 1
  let summary = 'not scored'
  let outcomes: SessionOutcome[] = []
  let report: GateReport | null = null
  try {
    outcomes = await runSessions(scenarios, { repoRoot, rig, run, signal: controller.signal })
    if (controller.signal.aborted) {
      exitCode = 130
      summary = 'interrupted'
    }
    else {
      report = plan && t1 ? scoreEmotionSessions(run, outcomes, plan, t1, fileSha) : scoreLivelinessSessions(run, outcomes, scenarios.length, fileSha)
    }
  }
  catch (error) {
    summary = `gate run broke: ${errorMessageFrom(error) ?? 'unknown error'}`
    writeFileSync(run.path('error.txt'), `${error instanceof Error && error.stack ? error.stack : summary}\n`)
    run.addArtifact('error.txt', 'error')
    console.error(summary)
  }
  finally {
    for (const [signal, listener] of listeners)
      process.off(signal, listener)
  }
  if (report)
    return writeGateOutputs(run, report, outcomes, started, '')

  // Interrupted or broken: no report.json, but the run and its sessions still get run.json and a page.
  const wallSeconds = Math.round((Date.now() - started) / 100) / 10
  writeJson(run, 'timing.json', { wallSeconds, sessions: outcomes.length })
  run.addArtifact('timing.json', 'timing')
  const finish = () => run.finish({ exitCode, summary: `${summary} [wall ${wallSeconds}s, ${outcomes.length} session(s): ${outcomes.map(outcome => outcome.runId ?? 'no run dir').join(', ')}]` })
  finish()
  // The page needs `run.json`, so it renders after the first finish; the second finish lists it as an artifact.
  const rendered = writeReport({ runDirs: [run.dir, ...outcomes.flatMap(outcome => outcome.runDir ? [outcome.runDir] : [])] })
  run.addArtifact('report.html', 'report-html')
  finish()
  for (const issue of rendered.issues)
    console.error(`report input problem: ${issue.run}/${issue.file}: ${issue.problem}`)
  console.info(`run ${run.runId} (${wallSeconds}s): exit ${exitCode}; report ${rendered.outFile}`)
  return exitCode
}
