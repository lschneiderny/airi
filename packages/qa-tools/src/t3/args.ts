import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { safeParse } from 'valibot'

/** Rigs the T3 harness knows, and the environment variable that points at each. */
export const t3Rigs = { forbooth: 'AIRI_QA_RIG_FORBOOTH' } as const
export type T3RigName = keyof typeof t3Rigs

/** The expression catalog fixture of each rig in `packages/qa-tools/fixtures/`; T1 and T3 resolve scenario expression ids against it. */
export const t3RigCatalogs: Record<T3RigName, string> = { forbooth: 'forbooth-catalog.json' }

/** The capture store caps captures at 600 s and the harness captures one second more than the scenario. */
export const maxT3ScenarioSeconds = 599

export interface T3CliOptions {
  rig: T3RigName
  scenario: string
  keepOpen: boolean
}

/** A usage problem: the CLI prints it with the usage text and exits 2 before launching anything. */
export class T3UsageError extends Error {}

export const t3Usage = `Usage: qa:motion t3 --rig forbooth --scenario <file | builtin:<name>> [--keep-open]

Launches the Electron app with a fresh profile, imports the rig, runs the scenario through the dev-only motion QA
bridge, captures a Natural trace and screenshots into .temp/qa/<runId>/, and tears every process down.
  --rig        rig name; forbooth reads AIRI_QA_RIG_FORBOOTH
  --scenario   a scenario JSON file, or builtin:<name> from packages/qa-tools/fixtures/scenarios/
  --keep-open  after the run, keep the app open until Ctrl+C, then tear down
Exit codes: 0 pass, 1 run or verification failure, 2 usage or environment error before launch, 3 no exclusive CPU
lease within 30 min (see pnpm slots status), 130 interrupted.
`

export function parseT3Args(argv: readonly string[]): T3CliOptions {
  let values: { 'rig'?: string, 'scenario'?: string, 'keep-open'?: boolean }
  try {
    values = parseArgs({
      args: [...argv],
      options: { 'rig': { type: 'string' }, 'scenario': { type: 'string' }, 'keep-open': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    }).values
  }
  catch (error) {
    throw new T3UsageError(errorMessageFrom(error) ?? 'invalid arguments')
  }
  if (!values.rig)
    throw new T3UsageError('--rig is required')
  if (!(values.rig in t3Rigs))
    throw new T3UsageError(`Unknown rig "${values.rig}"; known rigs: ${Object.keys(t3Rigs).join(', ')}`)
  if (!values.scenario)
    throw new T3UsageError('--scenario is required')
  return { rig: values.rig as T3RigName, scenario: values.scenario, keepOpen: values['keep-open'] ?? false }
}

export interface ResolvedRig {
  name: T3RigName
  /** The rig directory from the environment. */
  root: string
  /** The directory that holds the rig's `*.model3.json`; the harness zips this directory. */
  modelDir: string
  model3: string
}

/** Resolves a rig from its environment variable; throws `T3UsageError` when it is unset, missing, or has no `*.model3.json` at depth <= 2. */
export function resolveRig(name: T3RigName, env: Record<string, string | undefined>): ResolvedRig {
  const variable = t3Rigs[name]
  const root = env[variable]
  if (!root)
    throw new T3UsageError(`${variable} is not set; point it at the ${name} rig directory`)
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new T3UsageError(`${variable}=${root} is not a directory`)
  const queue: { dir: string, depth: number }[] = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    const model = entries.find(entry => entry.isFile() && entry.name.endsWith('.model3.json'))
    if (model)
      return { name, root, modelDir: dir, model3: join(dir, model.name) }
    if (depth < 2)
      queue.push(...entries.filter(entry => entry.isDirectory()).map(entry => ({ dir: join(dir, entry.name), depth: depth + 1 })))
  }
  throw new T3UsageError(`${variable}=${root} has no *.model3.json at depth <= 2`)
}

/**
 * Loads a scenario from `builtin:<name>` (a file in `fixturesDir`) or a path, validates it with the shared schema,
 * and checks the T3 limits: level `t3` and at most `maxT3ScenarioSeconds`.
 */
export function loadT3Scenario(spec: string, options: { fixturesDir: string, cwd: string }): { scenario: MotionScenario, source: string } {
  const builtin = /^builtin:([\w-]+)$/.exec(spec)
  if (spec.startsWith('builtin:') && !builtin)
    throw new T3UsageError(`Invalid builtin scenario name "${spec}"`)
  const file = builtin ? join(options.fixturesDir, `${builtin[1]}.json`) : resolve(options.cwd, spec)
  if (!existsSync(file))
    throw new T3UsageError(builtin ? `No builtin scenario "${builtin[1]}" (expected ${file})` : `Scenario file ${file} does not exist`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  }
  catch (error) {
    throw new T3UsageError(`Scenario ${file} is not JSON: ${errorMessageFrom(error) ?? 'parse error'}`)
  }
  const parsed = safeParse(MotionScenarioSchema, json)
  if (!parsed.success)
    throw new T3UsageError(`Scenario ${file} is invalid: ${parsed.issues.map(issue => issue.message).join('; ')}`)
  const scenario = parsed.output
  if (!scenario.levels.includes('t3'))
    throw new T3UsageError(`Scenario ${scenario.id} does not list level "t3"`)
  if (scenario.durationSeconds > maxT3ScenarioSeconds)
    throw new T3UsageError(`Scenario ${scenario.id} lasts ${scenario.durationSeconds} s; T3 scenarios are limited to ${maxT3ScenarioSeconds} s because captures stop at 600 s`)
  return { scenario, source: file }
}
