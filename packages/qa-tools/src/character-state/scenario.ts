import type { CharacterEvent, CharacterProfile, MoodAxes, MoodContribution } from '@proj-airi/stage-shared/character-state'
import type { InferOutput } from 'valibot'

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { CHARACTER_STATE_SETTINGS, CharacterProfileSchema, DEFAULT_CHARACTER_PROFILE, parseMoodCue } from '@proj-airi/stage-shared/character-state'
import { nextRandom, seedRng } from '@proj-airi/stage-shared/situation'
import { array, boolean, finite, integer, maxValue, minLength, minValue, number, optional, picklist, pipe, regex, safeParse, strictObject, string, union } from 'valibot'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
/** The logical day rolls over at 04:00 UTC in the simulator. */
export const ROLLOVER_MS = 4 * HOUR_MS
/** A user turn after a gap longer than this is preceded by a generated `return` event. */
const RETURN_GAP_MS = DAY_MS

/** Built-in scenarios, stored next to this file as `scenarios/<name>.json`. */
export const BUILTIN_SCENARIOS = ['typical-month', 'model-spam', 'absence', 'hurt'] as const

/**
 * Scenario event kinds. `user-turn` gets its `exchange` and `reach-out-unanswered` its `consecutive` from the
 * simulated history; `return` is generated. `fault-contribution` is a simulator-only fault injection: it puts a mood
 * contribution into the state directly, bypassing the reducer, so a test can prove the invariant checks fire.
 */
const EVENT_KINDS = [
  'model-cue',
  'touch-pleasant',
  'touch-unwelcome',
  'reach-out-unanswered',
  'late-reply',
  'reach-out-reply',
  'ritual-reciprocated',
  'user-turn',
  'character-spoke',
  'disclosure',
  'kept-promise',
  'milestone',
  'significant-positive',
  'significant-negative',
  'unkind',
  'hurtful',
  'fault-contribution',
] as const

const positiveInteger = pipe(number(), integer(), minValue(1))
const weight = pipe(number(), finite(), minValue(0))

const ScenarioEventSchema = strictObject({
  /** UTC clock time inside the logical day; times before 04:00 belong to the end of that logical day. */
  at: pipe(string(), regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'at must be HH:MM')),
  kind: picklist(EVENT_KINDS),
  repeat: optional(strictObject({ count: pipe(positiveInteger, maxValue(10_000)), everyMinutes: pipe(number(), finite(), minValue(0.001)) })),
  reason: optional(string()),
  /** `model-cue` only: a MOOD cue body (`brighter: reason`), or weighted bodies picked with the seeded random source. */
  cue: optional(union([string(), pipe(array(strictObject({ cue: string(), weight })), minLength(1))])),
  /** `fault-contribution` only: the raw step to inject. */
  delta: optional(strictObject({ valence: pipe(number(), finite()), energy: pipe(number(), finite()), tension: pipe(number(), finite()) })),
  halfLifeMinutes: optional(pipe(number(), finite(), minValue(1))),
})

const DaySelectorSchema = strictObject({
  from: optional(positiveInteger),
  to: optional(positiveInteger),
  every: optional(positiveInteger),
  only: optional(array(positiveInteger)),
})

export const ScenarioSchema = strictObject({
  name: pipe(string(), minLength(1)),
  description: string(),
  /** Default `--days`. */
  days: positiveInteger,
  /** First logical day, `YYYY-MM-DD` (default 2026-11-03). */
  startDate: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'))),
  profile: optional(CharacterProfileSchema),
  /** Days with no events at all. */
  awayDays: optional(array(positiveInteger)),
  /** Generate a `return` event before a user turn that follows a gap of more than a day (default true). */
  autoReturn: optional(boolean()),
  routines: array(strictObject({ days: optional(DaySelectorSchema), events: array(ScenarioEventSchema) })),
})

export type Scenario = InferOutput<typeof ScenarioSchema>
type ScenarioEvent = InferOutput<typeof ScenarioEventSchema>
type DaySelector = InferOutput<typeof DaySelectorSchema>

/** One step of a simulated day: a reducer event, or a fault injected around the reducer. */
export type PlannedStep
  = | { readonly atMs: number, readonly event: CharacterEvent }
    | { readonly atMs: number, readonly fault: MoodContribution }

export type LoadedScenario = { ok: true, scenario: Scenario } | { ok: false, message: string }

const DEFAULT_REASONS: Partial<Record<ScenarioEvent['kind'], string>> = {
  'disclosure': 'he told you something personal',
  'kept-promise': 'he kept his promise',
  'milestone': 'you shared a special moment',
  'significant-positive': 'he made your day',
  'significant-negative': 'something he said stung',
  'unkind': 'he was short with you',
  'hurtful': 'he said something hurtful',
}

function scenarioProblems(scenario: Scenario): string | null {
  for (const [routineIndex, routine] of scenario.routines.entries()) {
    for (const [eventIndex, event] of routine.events.entries()) {
      const where = `routines[${routineIndex}].events[${eventIndex}]`
      if (event.kind === 'model-cue') {
        const cues = typeof event.cue === 'string' ? [event.cue] : event.cue?.map(option => option.cue)
        if (cues === undefined)
          return `${where}: model-cue needs cue`
        const bad = cues.find(cue => parseMoodCue(cue) === null)
        if (bad !== undefined)
          return `${where}: ${JSON.stringify(bad)} is not a valid MOOD cue body (grammar "w1[ w2]: reason")`
        if (Array.isArray(event.cue) && event.cue.every(option => option.weight === 0))
          return `${where}: cue weights are all 0`
      }
      else if (event.cue !== undefined) {
        return `${where}: cue applies to model-cue only`
      }
      if (event.kind === 'fault-contribution' && event.delta === undefined)
        return `${where}: fault-contribution needs delta`
      if (event.kind !== 'fault-contribution' && (event.delta !== undefined || event.halfLifeMinutes !== undefined))
        return `${where}: delta and halfLifeMinutes apply to fault-contribution only`
    }
  }
  return null
}

/** Validates parsed JSON as a scenario. */
export function parseScenario(json: unknown, label: string): LoadedScenario {
  const parsed = safeParse(ScenarioSchema, json)
  if (!parsed.success) {
    const issue = parsed.issues[0]
    const path = issue.path?.map(item => String(item.key)).join('.') ?? ''
    return { ok: false, message: `Scenario ${label} is invalid${path ? ` at ${path}` : ''}: ${issue.message}` }
  }
  const problem = scenarioProblems(parsed.output)
  return problem === null ? { ok: true, scenario: parsed.output } : { ok: false, message: `Scenario ${label} is invalid: ${problem}` }
}

/** Loads a built-in scenario by name, or a scenario file resolved against `cwd`. */
export function loadScenario(nameOrPath: string, cwd: string): LoadedScenario {
  const builtin = (BUILTIN_SCENARIOS as readonly string[]).includes(nameOrPath)
  const file = builtin ? join(import.meta.dirname, 'scenarios', `${nameOrPath}.json`) : resolve(cwd, nameOrPath)
  if (!builtin && !existsSync(file))
    return { ok: false, message: `Unknown scenario ${JSON.stringify(nameOrPath)}: no built-in scenario has that name and ${file} does not exist. Built-in scenarios: ${BUILTIN_SCENARIOS.join(', ')}` }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  }
  catch (error) {
    return { ok: false, message: `Cannot read scenario ${file}: ${errorMessageFrom(error) ?? 'unknown error'}` }
  }
  return parseScenario(json, file)
}

export function profileOf(scenario: Scenario): CharacterProfile {
  return scenario.profile ?? DEFAULT_CHARACTER_PROFILE
}

/** Epoch ms of the start (04:00 UTC) of logical day 1. */
export function startOf(scenario: Scenario): number {
  const [year, month, day] = (scenario.startDate ?? '2026-11-03').split('-').map(Number)
  return Date.UTC(year!, month! - 1, day!) + ROLLOVER_MS
}

function selects(selector: DaySelector | undefined, day: number): boolean {
  if (selector === undefined)
    return true
  if (selector.from !== undefined && day < selector.from)
    return false
  if (selector.to !== undefined && day > selector.to)
    return false
  if (selector.every !== undefined && day % selector.every !== 0)
    return false
  return selector.only === undefined || selector.only.includes(day)
}

function offsetOf(at: string): number {
  const [hours, minutes] = at.split(':').map(Number)
  return ((hours! - 4 + 24) % 24) * HOUR_MS + minutes! * MINUTE_MS
}

/**
 * Expands a scenario into per-day steps, in time order. The seeded random source only picks weighted model cues, so
 * the same scenario and seed always give the same plan.
 */
export class ScenarioPlanner {
  private rng: number
  private lastUserTurnMs: number | null = null
  private unansweredInARow = 0

  constructor(private readonly scenario: Scenario, seed: number) {
    this.rng = seedRng(seed)
  }

  private pickCue(cue: NonNullable<ScenarioEvent['cue']>): string {
    if (typeof cue === 'string')
      return cue
    const total = cue.reduce((sum, option) => sum + option.weight, 0)
    const [value, next] = nextRandom(this.rng)
    this.rng = next
    let ticket = value * total
    for (const option of cue) {
      ticket -= option.weight
      if (ticket < 0)
        return option.cue
    }
    return cue[cue.length - 1]!.cue
  }

  /** The steps of logical day `day` (1-based), starting at `dayStartMs`. Call once per day, in order. */
  stepsOf(day: number, dayStartMs: number): PlannedStep[] {
    if (this.scenario.awayDays?.includes(day))
      return []
    const timed: { atMs: number, order: number, id: string, spec: ScenarioEvent }[] = []
    for (const [routineIndex, routine] of this.scenario.routines.entries()) {
      if (!selects(routine.days, day))
        continue
      for (const [eventIndex, spec] of routine.events.entries()) {
        const count = spec.repeat?.count ?? 1
        for (let repeat = 0; repeat < count; repeat++) {
          const atMs = dayStartMs + offsetOf(spec.at) + Math.round(repeat * (spec.repeat?.everyMinutes ?? 0) * MINUTE_MS)
          if (atMs >= dayStartMs + DAY_MS)
            break
          timed.push({ atMs, order: timed.length, id: `d${day}-r${routineIndex}-e${eventIndex}-${repeat}`, spec })
        }
      }
    }
    timed.sort((a, b) => a.atMs - b.atMs || a.order - b.order)

    const steps: PlannedStep[] = []
    let userTurns = 0
    for (const { atMs, id, spec } of timed) {
      const reason = spec.reason ?? DEFAULT_REASONS[spec.kind] ?? ''
      switch (spec.kind) {
        case 'fault-contribution': {
          const delta: MoodAxes = spec.delta!
          const halfLifeMs = (spec.halfLifeMinutes ?? 60) * MINUTE_MS
          const size = Math.max(Math.abs(delta.valence), Math.abs(delta.energy), Math.abs(delta.tension))
          const expiresAtMs = atMs + halfLifeMs * Math.max(1, Math.log2(size / CHARACTER_STATE_SETTINGS.mood.epsilon))
          steps.push({ atMs, fault: { id, source: 'significant', reason: reason || 'injected fault', atMs, halfLifeMs, delta, expiresAtMs } })
          continue
        }
        case 'user-turn': {
          if ((this.scenario.autoReturn ?? true) && this.lastUserTurnMs !== null && atMs - this.lastUserTurnMs > RETURN_GAP_MS)
            steps.push({ atMs, event: { kind: 'return', id: `${id}-return`, atMs, gapMs: atMs - this.lastUserTurnMs } })
          userTurns++
          this.lastUserTurnMs = atMs
          this.unansweredInARow = 0
          steps.push({ atMs, event: { kind: 'user-turn', id, atMs, exchange: userTurns < 3 ? 'early' : userTurns === 3 ? 'first-real' : 'later' } })
          continue
        }
        case 'late-reply':
        case 'reach-out-reply':
          this.unansweredInARow = 0
          steps.push({ atMs, event: { kind: spec.kind, id, atMs } })
          continue
        case 'reach-out-unanswered':
          this.unansweredInARow = Math.min(2, this.unansweredInARow + 1)
          steps.push({ atMs, event: { kind: 'reach-out-unanswered', id, atMs, consecutive: this.unansweredInARow === 1 ? 1 : 2 } })
          continue
        case 'model-cue': {
          const cue = parseMoodCue(this.pickCue(spec.cue!))!
          steps.push({ atMs, event: { kind: 'model-cue', id, atMs, turnId: id, directions: cue.directions, reason: cue.reason } })
          continue
        }
        case 'milestone':
          steps.push({ atMs, event: { kind: 'milestone', id, atMs, reason, memoryId: `memory-${id}` } })
          continue
        case 'disclosure':
        case 'kept-promise':
        case 'significant-positive':
        case 'significant-negative':
        case 'unkind':
        case 'hurtful':
          steps.push({ atMs, event: { kind: spec.kind, id, atMs, reason } })
          continue
        case 'touch-pleasant':
        case 'touch-unwelcome':
        case 'ritual-reciprocated':
        case 'character-spoke':
          steps.push({ atMs, event: { kind: spec.kind, id, atMs } })
          continue
      }
    }
    return steps
  }
}
