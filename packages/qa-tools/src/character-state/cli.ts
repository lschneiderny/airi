import type { CharacterReading, ClosenessStage, MoodBuckets, RelationshipStages } from '@proj-airi/stage-shared/character-state'

import process from 'node:process'

import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { bucketsOf, CHARACTER_STATE_SETTINGS, CLOSENESS_STAGES, DEFAULT_CHARACTER_PROFILE, renderCharacterContext, unlocksOf } from '@proj-airi/stage-shared/character-state'

import { BUILTIN_SCENARIOS, loadScenario, startOf } from './scenario'
import { formatSimulation, simulate, utcContext } from './simulate'

export const characterUsage = `Usage: pnpm qa:character <command> [options]

Commands:
  simulate --scenario <name|file.json> [--days <n>] [--seed <n>] [--json]
      Drive the pure character-state core through a scenario with a UTC logical day (04:00 rollover), check every
      Appendix A10 invariant after each event and at each simulated hour, and print a daily table (or JSON).
      Built-in scenarios: ${BUILTIN_SCENARIOS.join(', ')}. --days defaults to the scenario's days, --seed to 1.
  render --stage <${CLOSENESS_STAGES.join('|')}> [--mood <bucket words>]
      Print the exact system:character text for a stage. --mood takes comma-separated bucket words, at most one per
      axis (for example "good,lively,a little on edge"); unnamed axes stay at the resting disposition's bucket.
  help
      Print this usage.

Exit codes: 0 success, 1 an invariant was violated or the command failed, 2 invalid arguments or scenario.
`

export interface CharacterCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  /** Base for relative scenario paths. */
  cwd?: string
}

type Output = (text: string) => void

function parsePositiveInteger(raw: string | undefined, name: string, allowZero = false): number | null | string {
  if (raw === undefined)
    return null
  const value = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && (allowZero || value > 0) ? value : `--${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer, got ${JSON.stringify(raw)}`
}

function runSimulate(rest: string[], stdout: Output, stderr: Output, cwd: string): number {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { scenario: { type: 'string' }, days: { type: 'string' }, seed: { type: 'string' }, json: { type: 'boolean' } },
    strict: true,
    allowPositionals: true,
  })
  if (positionals.length > 0)
    return usageError(stderr, `unexpected argument ${JSON.stringify(positionals[0])}`)
  if (values.scenario === undefined)
    return usageError(stderr, '--scenario is required')
  const days = parsePositiveInteger(values.days, 'days')
  if (typeof days === 'string')
    return usageError(stderr, days)
  if (days !== null && days > 400)
    return usageError(stderr, '--days must be at most 400')
  const seed = parsePositiveInteger(values.seed, 'seed', true)
  if (typeof seed === 'string')
    return usageError(stderr, seed)

  const loaded = loadScenario(values.scenario, cwd)
  if (!loaded.ok) {
    stderr(`qa-tools character: ${loaded.message}\n`)
    return 2
  }
  const started = performance.now()
  const result = simulate(loaded.scenario, days ?? loaded.scenario.days, seed ?? 1)
  stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatSimulation(result))
  stderr(`simulated ${result.days} days in ${Math.round(performance.now() - started)} ms; ${result.summary.violationCount === 0 ? 'all invariants held' : `${result.summary.violationCount} invariant violation(s)`}\n`)
  return result.summary.violationCount === 0 ? 0 : 1
}

/** Trust and familiarity stages paired with each closeness stage, and the shared milestones, for `render`. */
const STAGE_PRESETS: Record<ClosenessStage, { stages: RelationshipStages, milestones: number }> = {
  stranger: { stages: { closeness: 'stranger', trust: 'guarded', familiarity: 'new' }, milestones: 0 },
  friendly: { stages: { closeness: 'friendly', trust: 'open', familiarity: 'new' }, milestones: 0 },
  close: { stages: { closeness: 'close', trust: 'open', familiarity: 'knows-you' }, milestones: 1 },
  intimate: { stages: { closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' }, milestones: 3 },
}

/** Parses `--mood` bucket words onto the resting buckets, or returns a message. */
function moodBuckets(raw: string | undefined): MoodBuckets | string {
  const buckets: Record<keyof MoodBuckets, string> = { ...bucketsOf(DEFAULT_CHARACTER_PROFILE.resting, null) }
  if (raw === undefined)
    return buckets as MoodBuckets
  const named = new Set<string>()
  const rendering = CHARACTER_STATE_SETTINGS.rendering
  for (const word of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    const axis = (['valence', 'energy', 'tension'] as const).find(candidate => (rendering[candidate].words as readonly string[]).includes(word))
    if (axis === undefined)
      return `unknown mood bucket ${JSON.stringify(word)}. Valence: ${rendering.valence.words.join(', ')}; energy: ${rendering.energy.words.join(', ')}; tension: ${rendering.tension.words.join(', ')}`
    if (named.has(axis))
      return `--mood names two ${axis} buckets`
    named.add(axis)
    buckets[axis] = word
  }
  if (named.size === 0)
    return '--mood is empty'
  return buckets as MoodBuckets
}

/** The exact `system:character` text of a stage preset with the given buckets and no reasons. */
export function renderStage(stage: ClosenessStage, buckets: MoodBuckets): string {
  const { stages, milestones } = STAGE_PRESETS[stage]
  const thresholds = CHARACTER_STATE_SETTINGS.relationship.stages
  const resting = DEFAULT_CHARACTER_PROFILE.resting
  const reading: Omit<CharacterReading, 'renderKey'> = {
    mood: resting,
    resting,
    temperament: resting,
    buckets,
    reasons: [],
    levels: {
      closeness: stage === 'stranger' ? 0 : thresholds.closeness[stage].up,
      trust: stages.trust === 'guarded' ? 0 : thresholds.trust[stages.trust].up,
      familiarity: stages.familiarity === 'new' ? 0 : thresholds.familiarity['knows-you'].up,
    },
    stages,
    unlocks: unlocksOf(stages, milestones),
    urgeFactor: 1,
    pointed: false,
    lastInteractionAtMs: null,
  }
  const nowMs = startOf({ name: 'render', description: '', days: 1, routines: [] })
  return renderCharacterContext(reading, utcContext(nowMs))
}

function runRender(rest: string[], stdout: Output, stderr: Output): number {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { stage: { type: 'string' }, mood: { type: 'string' } },
    strict: true,
    allowPositionals: true,
  })
  if (positionals.length > 0)
    return usageError(stderr, `unexpected argument ${JSON.stringify(positionals[0])}`)
  const stage = CLOSENESS_STAGES.find(candidate => candidate === values.stage)
  if (stage === undefined)
    return usageError(stderr, values.stage === undefined ? '--stage is required' : `unknown stage ${JSON.stringify(values.stage)}`)
  const buckets = moodBuckets(values.mood)
  if (typeof buckets === 'string')
    return usageError(stderr, buckets)
  const text = renderStage(stage, buckets)
  if (text === '')
    stderr('(at rest: the app sends no system:character text)\n')
  else
    stdout(`${text}\n`)
  return 0
}

function usageError(stderr: Output, message: string): number {
  stderr(`qa-tools character: ${message}\n\n${characterUsage}`)
  return 2
}

/**
 * Dispatches `qa:character` subcommands.
 *
 * Returns:
 * - 0 on success, 1 when a simulation violates an invariant or a command throws, 2 with usage on stderr for invalid
 *   arguments or an invalid scenario.
 */
export function runCharacterCli(argv: string[], io: CharacterCliIo = {}): number {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  const cwd = io.cwd ?? process.env.INIT_CWD ?? process.cwd()
  const [command, ...rest] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    stdout(characterUsage)
    return 0
  }
  if (command !== 'simulate' && command !== 'render')
    return usageError(stderr, command === undefined ? 'missing command' : `unknown command ${JSON.stringify(command)}`)
  try {
    return command === 'simulate' ? runSimulate(rest, stdout, stderr, cwd) : runRender(rest, stdout, stderr)
  }
  catch (error) {
    // `parseArgs` throws a TypeError with a code for unknown or malformed flags.
    if (error instanceof TypeError && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))
      return usageError(stderr, errorMessageFrom(error) ?? 'invalid arguments')
    stderr(`qa-tools character ${command}: ${errorMessageFrom(error) ?? 'command failed'}\n`)
    return 1
  }
}
