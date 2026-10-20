import type { EmotionCellPartial } from '../motion/gate/partials'
import type { GateReport } from '../motion/gate/report'

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { parseGateReport } from '../motion/gate/report'

/** One file the report wanted and could not use, named so the page can say what is missing. */
export interface InputIssue {
  file: string
  problem: string
}

const manifestSchema = v.looseObject({
  runId: v.string(),
  tool: v.string(),
  label: v.string(),
  gitSha: v.string(),
  dirty: v.boolean(),
  startedAt: v.string(),
  endedAt: v.string(),
  env: v.record(v.string(), v.string()),
  gate: v.optional(v.looseObject({ id: v.string(), version: v.string(), fileSha: v.string() })),
  result: v.looseObject({ exitCode: v.number(), summary: v.string() }),
})
export type ReportManifest = v.InferOutput<typeof manifestSchema>

const scenarioEventSchema = v.looseObject({
  kind: v.string(),
  at: v.number(),
  emotion: v.optional(v.string()),
  band: v.optional(v.string()),
  marker: v.optional(v.string()),
  expressionId: v.optional(v.string()),
  on: v.optional(v.boolean()),
})
export type ScenarioEvent = v.InferOutput<typeof scenarioEventSchema>

const scenarioSchema = v.looseObject({
  id: v.string(),
  durationSeconds: v.number(),
  events: v.array(scenarioEventSchema),
})
export type ReportScenario = v.InferOutput<typeof scenarioSchema>

const screenshotSchema = v.looseObject({
  at: v.number(),
  file: v.string(),
  actualAt: v.optional(v.number()),
  traceT: v.optional(v.number()),
})
export interface ScreenshotInput extends v.InferOutput<typeof screenshotSchema> {
  /** Raw PNG bytes, or `null` with an issue when the file is unreadable. */
  png: Uint8Array | null
}

const bridgeSchema = v.looseObject({
  rig: v.optional(v.looseObject({ name: v.string() })),
})

const verificationSchema = v.looseObject({ ok: v.boolean(), failures: v.array(v.string()) })

const testTargetSchema = v.looseObject({ package: v.string(), project: v.string() })
const testResultSchema = v.looseObject({ package: v.string(), project: v.string(), file: v.string(), name: v.string(), firstError: v.optional(v.string()) })
const testEntrySchema = v.looseObject({ package: v.string(), project: v.string(), file: v.string(), name: v.string(), reason: v.optional(v.string()), flaky: v.optional(v.literal(true)) })
/** `summary.json` of a `qa:test` run (`bin/test.ts`); only what the known-failures section shows. */
const testSummarySchema = v.looseObject({
  registry: v.string(),
  exitCode: v.number(),
  counts: v.array(v.looseObject({ target: testTargetSchema, passed: v.number(), failed: v.number(), skipped: v.number() })),
  suiteErrors: v.array(v.looseObject({ target: testTargetSchema, error: v.string() })),
  diff: v.looseObject({
    newFailures: v.array(testResultSchema),
    knownFailing: v.array(v.looseObject({ entry: testEntrySchema })),
    fixedKnown: v.array(v.looseObject({ entry: testEntrySchema, observed: v.string() })),
    flakyPassed: v.array(testEntrySchema),
  }),
})
export type TestSummary = v.InferOutput<typeof testSummarySchema>

export interface GateFacet {
  report: GateReport
  /** Emotion-cell partials when the run dir still holds them; the trajectory overlay needs their 30 Hz grids. */
  partials: EmotionCellPartial[]
}

export interface T3Facet {
  scenario: ReportScenario
  screenshots: ScreenshotInput[]
  rig: string | null
  verification: v.InferOutput<typeof verificationSchema> | null
}

/** Everything one run dir contributes. A dir can be a gate run, a T3 run, a `qa:test` run, or several at once. */
export interface RunInput {
  dir: string
  name: string
  manifest: ReportManifest | null
  gate: GateFacet | null
  t3: T3Facet | null
  /** A T3 session that failed before it captured anything (no trace, no screenshots), with its own failure summary. */
  uncaptured: { reason: string } | null
  test: TestSummary | null
  issues: InputIssue[]
}

type Loaded<T> = { ok: true, value: T } | { ok: false, problem: string }

function readJson(file: string): Loaded<unknown> {
  if (!existsSync(file))
    return { ok: false, problem: 'missing' }
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) }
  }
  catch (error) {
    return { ok: false, problem: `not valid JSON (${errorMessageFrom(error) ?? 'parse error'})` }
  }
}

function readSchema<TSchema extends v.GenericSchema>(file: string, schema: TSchema): Loaded<v.InferOutput<TSchema>> {
  const json = readJson(file)
  if (!json.ok)
    return json
  const parsed = v.safeParse(schema, json.value)
  if (!parsed.success)
    return { ok: false, problem: `unexpected shape: ${parsed.issues.map(issue => `${v.getDotPath(issue) ?? '(root)'} ${issue.message}`).join('; ')}` }
  return { ok: true, value: parsed.output }
}

function loadPartials(dir: string, issues: InputIssue[]): EmotionCellPartial[] {
  const partialsDir = join(dir, 'partials')
  if (!existsSync(partialsDir))
    return []
  const partials: EmotionCellPartial[] = []
  for (const name of readdirSync(partialsDir).filter(name => name.startsWith('emotion-') && name.endsWith('.json')).sort()) {
    const json = readJson(join(partialsDir, name))
    if (!json.ok) {
      issues.push({ file: `partials/${name}`, problem: json.problem })
      continue
    }
    const partial = json.value as EmotionCellPartial
    if (partial.kind === 'emotion-cell' && Array.isArray(partial.records))
      partials.push(partial)
  }
  return partials
}

function loadGate(dir: string, issues: InputIssue[]): GateFacet | null {
  const json = readJson(join(dir, 'report.json'))
  if (!json.ok) {
    if (json.problem !== 'missing')
      issues.push({ file: 'report.json', problem: json.problem })
    return null
  }
  try {
    return { report: parseGateReport(json.value), partials: loadPartials(dir, issues) }
  }
  catch (error) {
    issues.push({ file: 'report.json', problem: `unexpected shape: ${errorMessageFrom(error) ?? 'schema error'}` })
    return null
  }
}

function loadT3(dir: string, manifest: ReportManifest | null, issues: InputIssue[]): T3Facet | null {
  const scenario = readSchema(join(dir, 'scenario.json'), scenarioSchema)
  const index = readSchema(join(dir, 'screenshots.json'), v.array(screenshotSchema))
  if (!scenario.ok && !index.ok && scenario.problem === 'missing' && index.problem === 'missing')
    return null
  if (!scenario.ok) {
    issues.push({ file: 'scenario.json', problem: scenario.problem })
    return null
  }
  if (!index.ok) {
    issues.push({ file: 'screenshots.json', problem: index.problem })
    return null
  }
  const screenshots = index.value.map((shot): ScreenshotInput => {
    const file = join(dir, 'screenshots', shot.file)
    try {
      return { ...shot, png: new Uint8Array(readFileSync(file)) }
    }
    catch (error) {
      issues.push({ file: `screenshots/${shot.file}`, problem: errorMessageFrom(error) ?? 'unreadable' })
      return { ...shot, png: null }
    }
  })
  const bridge = readSchema(join(dir, 'bridge.json'), bridgeSchema)
  const verification = readSchema(join(dir, 'verification.json'), verificationSchema)
  if (!verification.ok && verification.problem !== 'missing')
    issues.push({ file: 'verification.json', problem: verification.problem })
  return {
    scenario: scenario.value,
    screenshots,
    rig: bridge.ok ? bridge.value.rig?.name ?? null : rigFromEnv(manifest),
    verification: verification.ok ? verification.value : null,
  }
}

/** Rig named by the run's `AIRI_QA_RIG_<NAME>` environment, lower-cased, when the run recorded one. */
export function rigFromEnv(manifest: ReportManifest | null): string | null {
  const key = manifest ? Object.keys(manifest.env).find(key => key.startsWith('AIRI_QA_RIG_')) : undefined
  return key ? key.slice('AIRI_QA_RIG_'.length).toLowerCase() : null
}

function loadTest(dir: string, issues: InputIssue[]): TestSummary | null {
  const summary = readSchema(join(dir, 'summary.json'), testSummarySchema)
  if (summary.ok)
    return summary.value
  if (summary.problem !== 'missing')
    issues.push({ file: 'summary.json', problem: summary.problem })
  return null
}

/**
 * Reads one run dir. Nothing here throws for a bad file: every missing or corrupt input becomes an issue the
 * page lists, and a dir that is not a run dir at all reports the files it would have needed.
 */
export function loadRunInput(dir: string): RunInput {
  const issues: InputIssue[] = []
  const name = basename(dir)
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    return { dir, name, manifest: null, gate: null, t3: null, uncaptured: null, test: null, issues: [{ file: '.', problem: 'run directory does not exist' }] }

  const manifest = readSchema(join(dir, 'run.json'), manifestSchema)
  if (!manifest.ok)
    issues.push({ file: 'run.json', problem: manifest.problem })
  const manifestValue = manifest.ok ? manifest.value : null
  const gate = loadGate(dir, issues)
  const uncaptured = uncapturedSession(dir, manifestValue)
  const t3 = uncaptured ? null : loadT3(dir, manifestValue, issues)
  const test = loadTest(dir, issues)
  if (!gate && !t3 && !test && !uncaptured) {
    issues.push(
      { file: 'report.json', problem: 'missing (a gate run needs it)' },
      { file: 'scenario.json, screenshots.json', problem: 'missing (a T3 run needs them)' },
      { file: 'summary.json', problem: 'missing (a qa:test run needs it)' },
    )
  }
  return { dir, name, manifest: manifestValue, gate, t3, uncaptured, test, issues: dedupeIssues(issues) }
}

/**
 * A T3 session run dir (`qa:motion t3`, label `t3-<scenario id>`) whose run failed before it wrote a trace or a
 * screenshot index, for example when the cursor would not park. It has nothing to show, which is a session outcome,
 * not a missing input.
 */
function uncapturedSession(dir: string, manifest: ReportManifest | null): { reason: string } | null {
  if (!manifest || manifest.tool !== 'motion' || !manifest.label.startsWith('t3-') || manifest.result.exitCode === 0)
    return null
  if (existsSync(join(dir, 'trace.json')) || existsSync(join(dir, 'screenshots.json')))
    return null
  return { reason: manifest.result.summary }
}

function dedupeIssues(issues: InputIssue[]): InputIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.file}\0${issue.problem}`
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}
