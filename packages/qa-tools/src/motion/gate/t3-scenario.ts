import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { EmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { EmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { isDeepStrictEqual } from 'node:util'

import { MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { hashSeed, naturalEmotionLifetime } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { createRandomStream } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/random'
import { parse, safeParse } from 'valibot'

import { maxEventLagSeconds } from '../../t3/verify-trace'

/**
 * Generated scenarios of the T3 emotion gate. One capture holds at most `maxSessionSeconds`, so the pulses are split
 * over the fewest sessions that fit, at least `minSessions`; every session lasts as long as the longest. Each session is: warm-up, lead placebos on the idle null spacing, then pulses. After
 * every pulse comes one placebo whose windows lie between that pulse's lifetime and the next pulse:
 *
 *   pulse ... lifetime | placebo baseline [-1, 0] | placebo scored window | guard | next pulse
 *
 * so `spacing = ceil(lifetime + placebo span + guard)`, never below `minSpacingSeconds` or `lifetime + lifetimeMarginSeconds`.
 * The guard is the latest a scenario event may be stamped after its time (`maxEventLagSeconds`).
 */

export interface T3PulseSlot {
  emotion: PerformanceEmotion
  band: Band
  trialId: string
  /** Seconds from the session start. */
  at: number
  /** Seconds to the next pulse slot. */
  spacing: number
  placeboAt: number
}

export interface T3EmotionSession {
  scenario: MotionScenario
  pulses: T3PulseSlot[]
  placebos: number
}

export interface T3EmotionPlan {
  sessions: T3EmotionSession[]
  /** Spacing per band actually used, with the lifetime it was derived from. */
  spacing: Partial<Record<Band, { lifetime: number, spacing: number }>>
  placebos: number
}

/** Settings the rendered app performs with: the defaults, with the gate's turnless hold. Only `heldEmotions` reaches the bridge, so T3 runs the defaults. */
export function t3ScenarioSettings(gate: EmotionGate) {
  return { heldEmotions: true, cursorAttention: false, expressionEnabled: true, performance: { held: { turnlessSeconds: gate.scenario.hold } } }
}

/** Seconds between a pulse and the next one for a band; see the module comment. */
export function t3PulseSpacing(t3: EmotionT3Gate, gate: EmotionGate, settings: ExpressionPerformanceSettings, band: Band): { lifetime: number, spacing: number } {
  const lifetime = naturalEmotionLifetime(settings, band)
  const placeboSpan = gate.windows.face[1] - gate.windows.baseline[0]
  const spacing = Math.max(t3.minSpacingSeconds, lifetime + t3.lifetimeMarginSeconds, Math.ceil(lifetime + placeboSpan + maxEventLagSeconds))
  return { lifetime, spacing }
}

/**
 * Pulse order: `trialsPerCell` blocks, each a seeded permutation of the cells. A block never starts with the cell the
 * previous block ended with, so the same emotion never repeats back to back (that would add habituation the T1 trials
 * do not have).
 */
export function t3PulseOrder(t3: EmotionT3Gate, seed: number): { emotion: PerformanceEmotion, band: Band }[][] {
  const random = createRandomStream(seed)
  const blocks: { emotion: PerformanceEmotion, band: Band }[][] = []
  for (let block = 0; block < t3.trialsPerCell; block++) {
    const cells = [...t3.cells]
    for (let index = cells.length - 1; index > 0; index--) {
      const pick = Math.floor(random() * (index + 1))
      ;[cells[index], cells[pick]] = [cells[pick], cells[index]]
    }
    const previous = blocks.at(-1)?.at(-1)
    if (previous && cells.length > 1 && cells[0].emotion === previous.emotion && cells[0].band === previous.band)
      cells.push(cells.shift()!)
    blocks.push(cells)
  }
  return blocks
}

function splitEvenly<T>(items: readonly T[], parts: number): T[][] {
  const groups: T[][] = []
  let start = 0
  for (let part = 0; part < parts; part++) {
    const size = Math.floor(items.length / parts) + (part < items.length % parts ? 1 : 0)
    groups.push(items.slice(start, start + size))
    start += size
  }
  return groups
}

/**
 * Builds the sessions of one T3 emotion gate run. Deterministic for a gate, emotion gate, settings and seed.
 * Throws when even one block of pulses per session cannot fit in `maxSessionSeconds`.
 */
export function buildT3EmotionPlan(t3: EmotionT3Gate, gate: EmotionGate, settings: ExpressionPerformanceSettings, seed = hashSeed(`${t3.id}@${t3.version}:order`)): T3EmotionPlan {
  const spacing: T3EmotionPlan['spacing'] = {}
  for (const cell of t3.cells)
    spacing[cell.band] = t3PulseSpacing(t3, gate, settings, cell.band)
  const blocks = t3PulseOrder(t3, seed)
  const pulses = blocks.length * t3.cells.length
  const { warmup, placeboSpacing } = gate.scenario
  const blockSeconds = (block: readonly { band: Band }[]) => block.reduce((sum, cell) => sum + spacing[cell.band]!.spacing, 0)

  for (let count = Math.max(1, t3.minSessions); count <= blocks.length; count++) {
    const groups = splitEvenly(blocks, count)
    const leadPlacebos = Math.max(0, Math.ceil((t3.minPlacebos - pulses) / count))
    const lead = warmup + leadPlacebos * placeboSpacing
    const durationSeconds = Math.max(...groups.map(group => lead + group.reduce((sum, block) => sum + blockSeconds(block), 0)))
    if (durationSeconds > t3.maxSessionSeconds)
      continue
    let trial = 0
    const counters = new Map<string, number>()
    const sessions = groups.map((group, index): T3EmotionSession => {
      const events: ScenarioEvent[] = []
      const screenshotsAt: number[] = []
      const slots: T3PulseSlot[] = []
      for (let placebo = 0; placebo < leadPlacebos; placebo++)
        events.push({ kind: 'placebo', at: warmup + placebo * placeboSpacing, trialId: `t3-placebo-s${index + 1}-lead-${placebo + 1}` })
      let at = lead
      const shot = new Set<string>()
      for (const cell of group.flat()) {
        const cellKey = `${cell.emotion}-${cell.band}`
        const n = (counters.get(cellKey) ?? 0) + 1
        counters.set(cellKey, n)
        trial++
        const step = spacing[cell.band]!.spacing
        const placeboAt = at + step - (gate.windows.face[1] + maxEventLagSeconds)
        const trialId = `${cell.emotion}-${cell.band}-t3-${n}`
        events.push({ kind: 'emotion', at, emotion: cell.emotion, band: cell.band, source: 'devtools', trialId })
        events.push({ kind: 'placebo', at: placeboAt, trialId: `t3-placebo-s${index + 1}-after-${trial}` })
        // The first pulse of each cell in a session is photographed 1 s and 3 s after it, inside the scored face window.
        if (!shot.has(cellKey)) {
          shot.add(cellKey)
          screenshotsAt.push(at + 1, at + 3)
        }
        slots.push({ emotion: cell.emotion, band: cell.band, trialId, at, spacing: step, placeboAt })
        at += step
      }
      const scenario = parse(MotionScenarioSchema, {
        version: 1,
        id: `t3-emotion-transfer-${index + 1}-of-${count}`,
        seed: index + 1,
        durationSeconds,
        home: 'desk',
        levels: ['t1', 't3'],
        settings: t3ScenarioSettings(gate),
        screenshotsAt,
        events,
      })
      return { scenario, pulses: slots, placebos: events.filter(event => event.kind === 'placebo').length }
    })
    return { sessions, spacing, placebos: sessions.reduce((sum, session) => sum + session.placebos, 0) }
  }
  throw new Error(`[qa-tools] ${t3.id}: one block of ${t3.cells.length} pulses does not fit in ${t3.maxSessionSeconds} s`)
}

/** A layout invariant of the live planner that an archived scenario set breaks; `invariant` names the rule. */
export class T3ArchiveError extends Error {
  constructor(readonly invariant: string, detail: string) {
    super(`archive invariant "${invariant}": ${detail}`)
  }
}

const epsilon = 1e-9

/**
 * The plan of scenarios that already ran (`--rescore`), read back from the archived scenario files so a re-score judges
 * exactly what was performed even when the committed plan has changed since. Every layout invariant `buildT3EmotionPlan`
 * guarantees is checked first, and the first one broken throws `T3ArchiveError`:
 * - `monotonic-times`: event times strictly increase within each session;
 * - `scenario-identity`: scenarios `t3-emotion-transfer-<i>-of-<n>` in order, seed `i`, home `desk`, levels t1 and t3,
 *   the planner's settings, and a valid scenario;
 * - `event-kinds`: only `emotion` (source `devtools`) and `placebo` events;
 * - `cell-membership`: every pulse is one of the gate's cells;
 * - `unique-ids`: trial and placebo ids are unique across the archive and never shared between the two kinds;
 * - `trial-id-format`: pulse ids are `<emotion>-<band>-t3-<n>`, numbered 1, 2, ... per cell in session order;
 * - `session-count` and `session-duration`: at least `minSessions` sessions, one shared duration of at most `maxSessionSeconds`;
 * - `warm-up`: no event before the gate's warm-up;
 * - `pulse-spacing`: each pulse lasts until the next (or the session end) at least the planner's spacing for its band,
 *   which is at least `max(minSpacingSeconds, naturalEmotionLifetime + lifetimeMarginSeconds)`;
 * - `cell-count`: `trialsPerCell` pulses per cell;
 * - `back-to-back`: no cell is pulsed twice in a row within a session;
 * - `placebo-per-pulse`: exactly one placebo between consecutive pulses and after the last pulse;
 * - `placebo-window`: every placebo's window (baseline start to scored-window end) starts after the lifetime of every
 *   earlier pulse and ends `maxEventLagSeconds` before every later pulse, inside the session;
 * - `placebo-overlap`: placebo windows do not overlap one another;
 * - `placebo-total`: at least `minPlacebos` placebo windows in total;
 * - `screenshots`: 1 s and 3 s after the first pulse of each cell in each session.
 */
export function t3PlanFromScenarios(t3: EmotionT3Gate, gate: EmotionGate, settings: ExpressionPerformanceSettings, scenarios: readonly MotionScenario[]): T3EmotionPlan {
  const spacing: T3EmotionPlan['spacing'] = {}
  for (const cell of t3.cells)
    spacing[cell.band] = t3PulseSpacing(t3, gate, settings, cell.band)
  const fail = (invariant: string, detail: string): never => {
    throw new T3ArchiveError(invariant, detail)
  }

  for (const input of scenarios) {
    input.events.forEach((event, index) => {
      if (index > 0 && !(event.at > input.events[index - 1].at))
        fail('monotonic-times', `${input.id}: event ${index} at ${event.at} s does not come after ${input.events[index - 1].at} s`)
    })
  }
  const expectedSettings = JSON.stringify(t3ScenarioSettings(gate))
  const parsed = scenarios.map((input, index) => {
    const result = safeParse(MotionScenarioSchema, input)
    if (!result.success)
      return fail('scenario-identity', `${input.id} is not a valid scenario: ${result.issues.map(issue => issue.message).join('; ')}`)
    const scenario = result.output
    const id = `t3-emotion-transfer-${index + 1}-of-${scenarios.length}`
    if (scenario.id !== id || scenario.seed !== index + 1 || scenario.home !== 'desk' || JSON.stringify(scenario.levels) !== JSON.stringify(['t1', 't3']) || JSON.stringify(scenario.settings) !== expectedSettings)
      fail('scenario-identity', `session ${index + 1} (${scenario.id}) is not the planner's ${id} with seed ${index + 1}, home desk, levels t1/t3 and its settings`)
    for (const event of scenario.events) {
      if (event.kind !== 'placebo' && (event.kind !== 'emotion' || event.source !== 'devtools'))
        fail('event-kinds', `${scenario.id}: a ${event.kind} event at ${event.at} s; the planner writes only devtools emotion and placebo events`)
      if (event.kind === 'emotion' && !t3.cells.some(cell => cell.emotion === event.emotion && cell.band === event.band))
        fail('cell-membership', `${scenario.id}: ${event.emotion} ${event.band} at ${event.at} s is not a cell of ${t3.id}`)
    }
    return scenario
  })

  const ids = new Map<string, string>()
  for (const scenario of parsed) {
    for (const event of scenario.events) {
      const id = event.kind === 'emotion' || event.kind === 'placebo' ? event.trialId : undefined
      if (!id)
        fail('unique-ids', `${scenario.id}: the ${event.kind} event at ${event.at} s has no trialId`)
      if (ids.has(id!))
        fail('unique-ids', `${scenario.id}: ${event.kind} id ${id} at ${event.at} s repeats the ${ids.get(id!)}`)
      ids.set(id!, `${event.kind} at ${event.at} s in ${scenario.id}`)
    }
  }
  const counters = new Map<string, number>()
  for (const scenario of parsed) {
    for (const event of scenario.events) {
      if (event.kind !== 'emotion')
        continue
      const key = `${event.emotion}-${event.band}`
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      if (event.trialId !== `${key}-t3-${n}`)
        fail('trial-id-format', `${scenario.id}: the pulse at ${event.at} s has id ${event.trialId}, expected ${key}-t3-${n}`)
    }
  }

  if (parsed.length < t3.minSessions)
    fail('session-count', `${parsed.length} sessions, below ${t3.minSessions}`)
  const duration = parsed[0].durationSeconds
  for (const scenario of parsed) {
    if (scenario.durationSeconds !== duration || scenario.durationSeconds > t3.maxSessionSeconds)
      fail('session-duration', `${scenario.id} lasts ${scenario.durationSeconds} s; every session must last the same ${duration} s, at most ${t3.maxSessionSeconds} s`)
    if (scenario.events.length && scenario.events[0].at < gate.scenario.warmup - epsilon)
      fail('warm-up', `${scenario.id}: the first event at ${scenario.events[0].at} s is inside the ${gate.scenario.warmup} s warm-up`)
  }

  const sessions = parsed.map((scenario): T3EmotionSession => {
    const emotions = scenario.events.filter(event => event.kind === 'emotion')
    const pulses = emotions.map((event, index): T3PulseSlot => {
      const next = emotions[index + 1]?.at ?? scenario.durationSeconds
      const required = spacing[event.band]!.spacing
      if (next - event.at < required - epsilon)
        fail('pulse-spacing', `${scenario.id}: the ${event.band} pulse at ${event.at} s lasts ${next - event.at} s until the next, below the planner's ${required} s (at least max(${t3.minSpacingSeconds}, lifetime ${spacing[event.band]!.lifetime} + ${t3.lifetimeMarginSeconds}))`)
      const placebo = scenario.events.find(entry => entry.kind === 'placebo' && entry.at > event.at && entry.at < next)
      return { emotion: event.emotion, band: event.band, trialId: event.trialId!, at: event.at, spacing: next - event.at, placeboAt: placebo?.at ?? Number.NaN }
    })
    return { scenario, pulses, placebos: scenario.events.filter(event => event.kind === 'placebo').length }
  })

  const all = sessions.flatMap(session => session.pulses)
  for (const cell of t3.cells) {
    const count = all.filter(pulse => pulse.emotion === cell.emotion && pulse.band === cell.band).length
    if (count !== t3.trialsPerCell)
      fail('cell-count', `${count} ${cell.emotion} ${cell.band} pulses, not ${t3.trialsPerCell}`)
  }

  const [baselineStart] = gate.windows.baseline
  const windowEnd = gate.windows.face[1]
  for (const { scenario, pulses } of sessions) {
    pulses.slice(1).forEach((pulse, index) => {
      if (pulse.emotion === pulses[index].emotion && pulse.band === pulses[index].band)
        fail('back-to-back', `${scenario.id}: ${pulse.emotion} ${pulse.band} at ${pulses[index].at} s and ${pulse.at} s in a row`)
    })
    pulses.forEach((pulse, index) => {
      const next = pulses[index + 1]?.at ?? scenario.durationSeconds
      const between = scenario.events.filter(event => event.kind === 'placebo' && event.at > pulse.at && event.at < next).length
      if (between !== 1)
        fail('placebo-per-pulse', `${scenario.id}: ${between} placebos between the pulse at ${pulse.at} s and ${next} s, expected 1`)
    })
    const placebos = scenario.events.filter(event => event.kind === 'placebo')
    for (const placebo of placebos) {
      const from = placebo.at + baselineStart
      const to = placebo.at + windowEnd
      if (from < -epsilon || to > scenario.durationSeconds + epsilon)
        fail('placebo-window', `${scenario.id}: the placebo at ${placebo.at} s has its window [${from}, ${to}] s outside the session`)
      for (const pulse of pulses) {
        const lifetime = spacing[pulse.band]!.lifetime
        const clearAfter = from >= pulse.at + lifetime - epsilon
        const clearBefore = to + maxEventLagSeconds <= pulse.at + epsilon
        if (!clearAfter && !clearBefore)
          fail('placebo-window', `${scenario.id}: the placebo at ${placebo.at} s has its window [${from}, ${to}] s within the ${pulse.emotion} ${pulse.band} pulse at ${pulse.at} s and its ${lifetime} s lifetime (or less than ${maxEventLagSeconds} s before it)`)
      }
    }
    placebos.slice(1).forEach((placebo, index) => {
      if (placebo.at + baselineStart < placebos[index].at + windowEnd - epsilon)
        fail('placebo-overlap', `${scenario.id}: the placebo windows at ${placebos[index].at} s and ${placebo.at} s overlap`)
    })
    const shots: number[] = []
    const seen = new Set<string>()
    for (const pulse of pulses) {
      const key = `${pulse.emotion}-${pulse.band}`
      if (!seen.has(key)) {
        seen.add(key)
        shots.push(pulse.at + 1, pulse.at + 3)
      }
    }
    if (JSON.stringify(scenario.screenshotsAt ?? []) !== JSON.stringify(shots))
      fail('screenshots', `${scenario.id}: screenshots at ${JSON.stringify(scenario.screenshotsAt ?? [])}, the planner takes ${JSON.stringify(shots)}`)
  }

  const placebos = sessions.reduce((sum, session) => sum + session.placebos, 0)
  if (placebos < t3.minPlacebos)
    fail('placebo-total', `${placebos} placebo windows, below ${t3.minPlacebos}`)
  return { sessions, spacing, placebos }
}

/**
 * Why a session's trace does not record exactly its scenario, or `null` when it does. The stamped scenario events
 * (without the capture marker) must equal the scenario's events one for one, field by field: every field a scenario event
 * carries is compared, because the scorer reads `kind`, `trialId`, `emotion` and `band` (trial identity, recipe and
 * lifetime) and orders equal-time events by the whole event. The reason names the first differing field. Stamped times
 * (the trace's `t`) are not compared: a throttled session stamps late, and its verification records that.
 */
export function t3TraceMismatch(scenario: MotionScenario, stamped: readonly ScenarioEvent[]): string | null {
  if (stamped.length !== scenario.events.length)
    return `${scenario.id}: field "count": the trace stamps ${stamped.length} scenario events, the scenario has ${scenario.events.length}`
  for (let index = 0; index < scenario.events.length; index++) {
    const expected = scenario.events[index] as Record<string, unknown>
    const actual = stamped[index] as Record<string, unknown>
    const field = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().find(key => expected[key] !== actual[key])
    if (field !== undefined)
      return `${scenario.id}: field "${field}" of event ${index} (${String(expected.kind)} at ${String(expected.at)} s, ${String(expected.trialId ?? '')}) is ${JSON.stringify(actual[field])} in the trace, ${JSON.stringify(expected[field])} in the scenario`
  }
  return null
}

/** What a session run dir records about its capture; every field is optional because an archive may be damaged. */
export interface T3SessionHeader {
  /** The session's own `scenario.json`. */
  sessionScenario: unknown
  /** The session's `run.json`. */
  manifest: { label?: unknown, gitSha?: unknown }
  trace: { version?: unknown, meta?: { driver?: unknown, durationSeconds?: unknown, model?: unknown } }
  /** The session's `bridge.json`. */
  bridge: { rig?: { name?: unknown, model3?: unknown, files?: unknown, bytes?: unknown }, configured?: { modelId?: unknown, driver?: unknown, cursorAttention?: unknown, expressionEnabled?: unknown, screenAwareness?: unknown, heldEmotions?: unknown }, capture?: { durationSeconds?: unknown } }
}

/**
 * Why a session run dir does not belong to its archived scenario, or `null` when it does. The session must have run
 * that exact scenario (`scenario.json` equal, run label `t3-<scenario id>`) from the gate run's commit (`gitSha`), on the
 * expected rig (`rigName`, and `rig` when given: the same model file, file count and zipped byte count as the first session;
 * the zip's sha256 differs per session because the archive stores timestamps), with the Natural driver,
 * cursor attention off, screen-aware attention off, expressions on and the scenario's held-emotion setting, and its capture must be the scenario's
 * length plus one second (at most 600 s) of the configured model. The reason names the first header field that differs.
 */
export function t3SessionHeaderMismatch(scenario: MotionScenario, header: T3SessionHeader, expected: { gitSha: string, rigName: string, rig?: { model3: unknown, files: unknown, bytes: unknown } }): string | null {
  const captureSeconds = Math.min(600, scenario.durationSeconds + 1)
  const checks: [field: string, actual: unknown, wanted: unknown][] = [
    ['run.label', header.manifest.label, `t3-${scenario.id}`.replaceAll(/[^\w.-]/g, '-')],
    ['run.gitSha', header.manifest.gitSha, expected.gitSha],
    ['trace.version', header.trace.version, 2],
    ['trace.meta.driver', header.trace.meta?.driver, 'natural'],
    ['trace.meta.durationSeconds', header.trace.meta?.durationSeconds, captureSeconds],
    ['bridge.capture.durationSeconds', header.bridge.capture?.durationSeconds, captureSeconds],
    ['bridge.rig.name', header.bridge.rig?.name, expected.rigName],
    ...(expected.rig === undefined
      ? []
      : [['bridge.rig.model3', header.bridge.rig?.model3, expected.rig.model3], ['bridge.rig.files', header.bridge.rig?.files, expected.rig.files], ['bridge.rig.bytes', header.bridge.rig?.bytes, expected.rig.bytes]] as [string, unknown, unknown][]),
    ['bridge.configured.driver', header.bridge.configured?.driver, 'natural'],
    ['bridge.configured.cursorAttention', header.bridge.configured?.cursorAttention, false],
    ['bridge.configured.expressionEnabled', header.bridge.configured?.expressionEnabled, true],
    ['bridge.configured.screenAwareness', header.bridge.configured?.screenAwareness, false],
    ['bridge.configured.heldEmotions', header.bridge.configured?.heldEmotions, scenario.settings?.heldEmotions ?? true],
    ['bridge.configured.modelId', header.bridge.configured?.modelId, header.trace.meta?.model],
  ]
  if (!isDeepStrictEqual(header.sessionScenario, scenario))
    return `${scenario.id}: header "scenario.json" differs from the archived scenario`
  const broken = checks.find(([, actual, wanted]) => actual !== wanted)
  return broken ? `${scenario.id}: header "${broken[0]}" is ${JSON.stringify(broken[1])}, expected ${JSON.stringify(broken[2])}` : null
}

/** One idle capture of the T3 liveliness gate: no inputs, a marker each minute so the trace carries scenario events. */
export function buildT3IdleScenario(index: number, durationSeconds: number): MotionScenario {
  const markers = Array.from({ length: Math.floor(durationSeconds / 60) }, (_, minute) => ({ kind: 'marker' as const, at: (minute + 1) * 60, label: `idle-minute-${minute + 1}` }))
    .filter(marker => marker.at <= durationSeconds)
  return parse(MotionScenarioSchema, {
    version: 1,
    id: `t3-idle-liveliness-${index}`,
    seed: index,
    durationSeconds,
    home: 'desk',
    levels: ['t1', 't3'],
    settings: { heldEmotions: true, cursorAttention: false, expressionEnabled: true },
    screenshotsAt: [60, Math.round(durationSeconds / 2), durationSeconds - 9],
    events: markers,
  })
}
