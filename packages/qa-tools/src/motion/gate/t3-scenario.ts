import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { EmotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import type { EmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { hashSeed, naturalEmotionLifetime } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { createRandomStream } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/random'
import { parse } from 'valibot'

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
