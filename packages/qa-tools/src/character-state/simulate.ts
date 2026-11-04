import type { AdvanceContext, CharacterProfile, CharacterReading, CharacterStateRecordV1, MoodAxes, RelationshipLevels, RelationshipStages } from '@proj-airi/stage-shared/character-state'

import type { PlannedStep, Scenario } from './scenario'

import {
  advance,
  applyEvent,
  CHARACTER_STATE_SETTINGS,
  CLOSENESS_STAGES,
  FAMILIARITY_STAGES,
  initialCharacterState,
  moodAt,
  rawAt,
  readCharacter,
  renderCharacterContext,
  TRUST_STAGES,
} from '@proj-airi/stage-shared/character-state'

import { DAY_MS, profileOf, ROLLOVER_MS, ScenarioPlanner, startOf } from './scenario'

const HOUR_MS = 3_600_000
const SAMPLE_OFFSET_MS = 30 * 60_000
const AXES = ['valence', 'energy', 'tension'] as const
const DIMENSIONS = ['closeness', 'trust', 'familiarity'] as const
const TOLERANCE = 1e-12
const MAX_LISTED_VIOLATIONS = 50

const { headroom, modelCue } = CHARACTER_STATE_SETTINGS.mood
/**
 * A10 model-only raw bound: the burst peak of the rolling cue budget. A full budget spent at the start of every window
 * sums to `budget / (1 - 2^(-window / halfLife))` = 0.6486 per axis, rounded up to 0.65.
 */
export const MODEL_ONLY_RAW_BOUND = Math.ceil(modelCue.budgetPerAxis / (1 - 2 ** (-modelCue.budgetWindowMs / modelCue.halfLifeMs)) * 100) / 100

/**
 * The IS-11 valence ceiling while only model cues have ever moved her mood: model cues never move temperament, so it
 * stays at resting and valence is at most `tanh(atanh(R.v) + MODEL_ONLY_RAW_BOUND)`, rounded up to two decimals
 * (0.64 for the default resting valence of 0.1).
 */
export function modelOnlyValenceBound(resting: MoodAxes): number {
  return Math.ceil(Math.tanh(Math.atanh(resting.valence) + MODEL_ONLY_RAW_BOUND) * 100) / 100
}

/** The simulator's UTC context: the logical day rolls over at 04:00 UTC. */
export function utcContext(nowMs: number): AdvanceContext {
  return {
    nowMs,
    logicalDayKeyOf: ms => new Date(ms - ROLLOVER_MS).toISOString().slice(0, 10),
    logicalDayStartOf: ms => Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS,
  }
}

export interface Violation {
  readonly day: number
  readonly at: string
  readonly invariant: string
  readonly detail: string
}

export interface DailyRow {
  readonly day: number
  readonly dayKey: string
  /** Lowest and highest valence over the hourly samples and after every event of the day. */
  readonly valence: { readonly min: number, readonly max: number }
  /** End of day (03:30 UTC sample). */
  readonly temperament: MoodAxes
  readonly levels: RelationshipLevels
  readonly stages: RelationshipStages
  readonly unlocks: readonly string[]
  /** Hourly samples whose reading was `pointed`. */
  readonly pointedHours: number
  readonly appliedEvents: number
  /** Events the reducer returned unchanged (duplicate, evicted, out of day, or malformed). */
  readonly rejectedEvents: number
  /** The `system:character` text at the end of the day. */
  readonly text: string
}

export interface SimulationResult {
  readonly scenario: string
  readonly seed: number
  readonly days: number
  readonly startDate: string
  readonly daily: readonly DailyRow[]
  readonly summary: {
    readonly valenceMin: number
    readonly valenceMax: number
    readonly maxAbsRaw: number
    readonly maxModelOnlyRaw: number
    readonly modelOnlyRawBound: number
    /**
     * The valence ceiling checked at every event and hour, or `null` when a source other than a model cue moved her
     * mood during the run, so the ceiling does not apply.
     */
    readonly modelOnlyValenceBound: number | null
    readonly pointedHours: number
    readonly firstPointedDay: number | null
    readonly appliedEvents: number
    readonly rejectedEvents: number
    readonly violationCount: number
  }
  /** The first {@link MAX_LISTED_VIOLATIONS} violations. */
  readonly violations: readonly Violation[]
}

function stageIndex(stages: RelationshipStages): Record<typeof DIMENSIONS[number], number> {
  return {
    closeness: CLOSENESS_STAGES.indexOf(stages.closeness),
    trust: TRUST_STAGES.indexOf(stages.trust),
    familiarity: FAMILIARITY_STAGES.indexOf(stages.familiarity),
  }
}

/** Drives the pure character-state core through a scenario and checks the Appendix A10 invariants. */
export class CharacterSimulation {
  private state: CharacterStateRecordV1
  private reading: CharacterReading | null = null
  private readonly profile: CharacterProfile
  private readonly startMs: number
  private readonly violations: Violation[] = []
  private violationCount = 0
  private maxAbsRaw = 0
  private maxModelOnlyRaw = 0
  /** True until a contribution from any source other than a model cue enters her mood. */
  private moodOnlyFromModel = true
  private readonly valenceBound: number
  private day = 0
  private dayValence = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
  private lastStages: RelationshipStages
  private lastStagesDayKey: string

  constructor(private readonly scenario: Scenario, private readonly seed: number) {
    this.profile = profileOf(scenario)
    this.startMs = startOf(scenario)
    this.valenceBound = modelOnlyValenceBound(this.profile.resting)
    this.state = initialCharacterState('qa-character-simulation', this.profile, utcContext(this.startMs))
    this.lastStages = this.state.relationship.stages
    this.lastStagesDayKey = utcContext(this.startMs).logicalDayKeyOf(this.startMs)
  }

  private violate(atMs: number, invariant: string, detail: string): void {
    this.violationCount++
    if (this.violations.length < MAX_LISTED_VIOLATIONS)
      this.violations.push({ day: this.day, at: new Date(atMs).toISOString(), invariant, detail })
  }

  /** Raw-scale invariants, checked after every event and at every hourly sample. */
  private checkRaw(atMs: number): void {
    const contributions = this.state.mood.contributions
    const raw = rawAt(contributions, atMs)
    const modelOnly = rawAt(contributions.filter(contribution => contribution.source === 'model-cue'), atMs)
    for (const axis of AXES) {
      this.maxAbsRaw = Math.max(this.maxAbsRaw, Math.abs(raw[axis]))
      this.maxModelOnlyRaw = Math.max(this.maxModelOnlyRaw, Math.abs(modelOnly[axis]))
      if (Math.abs(raw[axis]) > headroom + TOLERANCE)
        this.violate(atMs, 'raw-headroom', `|raw ${axis}| = ${Math.abs(raw[axis]).toFixed(4)} > ${headroom}`)
      if (Math.abs(modelOnly[axis]) > MODEL_ONLY_RAW_BOUND + TOLERANCE)
        this.violate(atMs, 'model-only-raw', `|model-only raw ${axis}| = ${Math.abs(modelOnly[axis]).toFixed(4)} > ${MODEL_ONLY_RAW_BOUND}`)
    }
    const valence = moodAt(contributions, this.state.temperament.axes, atMs).valence
    // Model cues alone can lift her mood but never her disposition, so valence stays under the model-only ceiling.
    if (this.moodOnlyFromModel && contributions.some(contribution => contribution.source !== 'model-cue'))
      this.moodOnlyFromModel = false
    if (this.moodOnlyFromModel && valence > this.valenceBound + TOLERANCE)
      this.violate(atMs, 'model-only-valence', `valence = ${valence.toFixed(4)} > ${this.valenceBound} with only model cues moving her mood`)
    this.dayValence = { min: Math.min(this.dayValence.min, valence), max: Math.max(this.dayValence.max, valence) }
  }

  private apply(step: PlannedStep): boolean {
    if ('fault' in step) {
      // Fault injection bypasses the reducer on purpose; see `fault-contribution` in scenario.ts.
      this.state = { ...this.state, mood: { ...this.state.mood, contributions: [...this.state.mood.contributions, step.fault] } }
      this.checkRaw(step.atMs)
      return true
    }
    const next = applyEvent(this.state, step.event, this.profile, utcContext(step.atMs))
    const applied = next !== this.state
    this.state = next
    this.checkRaw(Math.max(step.atMs, this.state.updatedAtMs))
    return applied
  }

  /** Advances to `atMs` and checks every A10 invariant there; returns whether the reading was pointed. */
  private sample(atMs: number, dayStartLevels: RelationshipLevels): boolean {
    const before = this.state
    const ctx = utcContext(atMs)
    const next = advance(before, this.profile, ctx)

    // Equal `advance` results for any split.
    const midMs = Math.floor((before.updatedAtMs + atMs) / 2)
    const split = advance(advance(before, this.profile, utcContext(midMs)), this.profile, ctx)
    if (JSON.stringify(split) !== JSON.stringify(next))
      this.violate(atMs, 'advance-split', `advance via ${new Date(midMs).toISOString()} differs from one advance`)

    // Pruning never changes `moodAt`.
    const unpruned = moodAt(before.mood.contributions, next.temperament.axes, atMs)
    const pruned = moodAt(next.mood.contributions, next.temperament.axes, atMs)
    for (const axis of AXES) {
      if (Math.abs(unpruned[axis] - pruned[axis]) > TOLERANCE)
        this.violate(atMs, 'prune-mood', `${axis} ${unpruned[axis]} became ${pruned[axis]} after pruning`)
    }
    this.state = next
    this.checkRaw(atMs)

    // |T - R| within the clamp.
    const { clamp } = CHARACTER_STATE_SETTINGS.temperament
    for (const axis of AXES) {
      const offset = Math.abs(next.temperament.axes[axis] - this.profile.resting[axis])
      if (offset > clamp[axis] + TOLERANCE)
        this.violate(atMs, 'temperament-clamp', `|T - R| ${axis} = ${offset.toFixed(4)} > ${clamp[axis]}`)
    }

    // Levels in [0, 1] and a daily gain within G.
    const { levels, stages } = next.relationship
    for (const dimension of DIMENSIONS) {
      const level = levels[dimension]
      if (Number.isNaN(level) || level < 0 || level > 1)
        this.violate(atMs, 'level-range', `${dimension} = ${level}`)
      const gain = level - dayStartLevels[dimension]
      const ceiling = CHARACTER_STATE_SETTINGS.relationship.dailyGain[dimension]
      if (gain > ceiling + TOLERANCE)
        this.violate(atMs, 'daily-gain', `${dimension} gained ${gain.toFixed(5)} today > ${ceiling}`)
    }

    // At most one stage-up per dimension per rollover, and none between rollovers.
    const dayKey = ctx.logicalDayKeyOf(atMs)
    const was = stageIndex(this.lastStages)
    const now = stageIndex(stages)
    for (const dimension of DIMENSIONS) {
      const step = now[dimension] - was[dimension]
      if (step > 1)
        this.violate(atMs, 'stage-up', `${dimension} rose ${step} stages at once (${this.lastStages[dimension]} -> ${stages[dimension]})`)
      else if (step === 1 && dayKey === this.lastStagesDayKey)
        this.violate(atMs, 'stage-up', `${dimension} rose to ${stages[dimension]} between rollovers`)
    }
    this.lastStages = stages
    this.lastStagesDayKey = dayKey

    // Rendered text has no digits.
    this.reading = readCharacter(next, this.profile, this.reading, ctx)
    const text = renderCharacterContext(this.reading, ctx)
    if (/\d/.test(text))
      this.violate(atMs, 'render-digits', JSON.stringify(text))
    return this.reading.pointed
  }

  run(days: number): SimulationResult {
    const planner = new ScenarioPlanner(this.scenario, this.seed)
    const daily: DailyRow[] = []
    let applied = 0
    let rejected = 0
    for (let day = 1; day <= days; day++) {
      this.day = day
      this.dayValence = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      const dayStartMs = this.startMs + (day - 1) * DAY_MS
      const steps = planner.stepsOf(day, dayStartMs)
      // The rollover runs at the day start; the day's gains are measured from the levels it leaves.
      this.sample(dayStartMs, this.state.relationship.levels)
      const dayStartLevels = this.state.relationship.levels
      let pointedHours = 0
      let dayApplied = 0
      let dayRejected = 0
      let next = 0
      const flush = (untilMs: number) => {
        while (next < steps.length && steps[next]!.atMs < untilMs) {
          if (this.apply(steps[next]!))
            dayApplied++
          else
            dayRejected++
          next++
        }
      }
      for (let hour = 0; hour < 24; hour++) {
        const sampleMs = dayStartMs + hour * HOUR_MS + SAMPLE_OFFSET_MS
        flush(sampleMs)
        if (this.sample(sampleMs, dayStartLevels))
          pointedHours++
      }
      flush(dayStartMs + DAY_MS)
      applied += dayApplied
      rejected += dayRejected
      const reading = this.reading!
      daily.push({
        day,
        dayKey: utcContext(dayStartMs).logicalDayKeyOf(dayStartMs),
        valence: this.dayValence,
        temperament: this.state.temperament.axes,
        levels: this.state.relationship.levels,
        stages: this.state.relationship.stages,
        unlocks: reading.unlocks,
        pointedHours,
        appliedEvents: dayApplied,
        rejectedEvents: dayRejected,
        text: renderCharacterContext(reading, utcContext(dayStartMs + 23 * HOUR_MS + SAMPLE_OFFSET_MS)),
      })
    }
    const firstPointed = daily.find(row => row.pointedHours > 0)
    return {
      scenario: this.scenario.name,
      seed: this.seed,
      days,
      startDate: utcContext(this.startMs).logicalDayKeyOf(this.startMs),
      daily,
      summary: {
        valenceMin: Math.min(...daily.map(row => row.valence.min)),
        valenceMax: Math.max(...daily.map(row => row.valence.max)),
        maxAbsRaw: this.maxAbsRaw,
        maxModelOnlyRaw: this.maxModelOnlyRaw,
        modelOnlyRawBound: MODEL_ONLY_RAW_BOUND,
        modelOnlyValenceBound: this.moodOnlyFromModel ? this.valenceBound : null,
        pointedHours: daily.reduce((sum, row) => sum + row.pointedHours, 0),
        firstPointedDay: firstPointed?.day ?? null,
        appliedEvents: applied,
        rejectedEvents: rejected,
        violationCount: this.violationCount,
      },
      violations: this.violations,
    }
  }
}

/** Runs `scenario` for `days` logical days with `seed`. */
export function simulate(scenario: Scenario, days: number, seed: number): SimulationResult {
  return new CharacterSimulation(scenario, seed).run(days)
}

const fixed = (value: number, digits = 3) => value.toFixed(digits)

/** The daily table and summary `simulate` prints without `--json`. */
export function formatSimulation(result: SimulationResult): string {
  const header = 'day  date        valence        T.v     close  trust  famil  stages (closeness/trust/familiarity)  pointed  applied  rejected'
  const rows = result.daily.map(row => [
    String(row.day).padStart(3),
    row.dayKey,
    `${fixed(row.valence.min)}..${fixed(row.valence.max)}`.padEnd(14),
    fixed(row.temperament.valence).padStart(6),
    fixed(row.levels.closeness).padStart(6),
    fixed(row.levels.trust).padStart(6),
    fixed(row.levels.familiarity).padStart(6),
    `${row.stages.closeness}/${row.stages.trust}/${row.stages.familiarity}`.padEnd(37),
    String(row.pointedHours).padStart(7),
    String(row.appliedEvents).padStart(8),
    String(row.rejectedEvents).padStart(9),
  ].join('  '))
  const { summary } = result
  const lines = [
    `scenario ${result.scenario}, seed ${result.seed}, ${result.days} days from ${result.startDate} (logical day rolls over at 04:00 UTC)`,
    header,
    ...rows,
    '',
    `valence range ${fixed(summary.valenceMin)}..${fixed(summary.valenceMax)}; max |raw| ${fixed(summary.maxAbsRaw, 4)} (bound ${headroom}); max model-only |raw| ${fixed(summary.maxModelOnlyRaw, 4)} (bound ${summary.modelOnlyRawBound})${summary.modelOnlyValenceBound === null ? '' : `; model-only valence bound ${summary.modelOnlyValenceBound}`}`,
    `pointed hours ${summary.pointedHours}${summary.firstPointedDay === null ? ' (never pointed)' : ` (first on day ${summary.firstPointedDay})`}; events applied ${summary.appliedEvents}, rejected ${summary.rejectedEvents}`,
    `end-of-run text: ${JSON.stringify(result.daily.at(-1)?.text ?? '')}`,
  ]
  if (summary.violationCount === 0) {
    lines.push('invariants: all A10 checks passed')
  }
  else {
    lines.push(`invariants: ${summary.violationCount} violation(s)${summary.violationCount > result.violations.length ? `, first ${result.violations.length} listed` : ''}`)
    for (const violation of result.violations)
      lines.push(`  day ${violation.day} ${violation.at} ${violation.invariant}: ${violation.detail}`)
  }
  return `${lines.join('\n')}\n`
}
