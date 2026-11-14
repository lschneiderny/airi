import type { WindowRollupRecord } from './records'

import { FRAME_BINS_V1 } from './bins'

/** Why a detected incident was not written. Deciders return all but `budget`, which {@link IncidentBudget} returns. */
export type IncidentSuppressedReason = 'host-contended' | 'chromium-trace' | 'settling' | 'hidden' | 'suspended' | 'budget' | 'cooldown'

/** State the caller knows at decision time; any `true` suppresses a new incident. */
export interface IncidentConditions {
  readonly suspended: boolean
  readonly hidden: boolean
  /** Within the settling time after a session start, model load, resume, renderer reload, or identity change. */
  readonly settling: boolean
  readonly chromiumTrace: boolean
  readonly hostContended: boolean
}

export const INCIDENT_CALM: IncidentConditions = Object.freeze({ suspended: false, hidden: false, settling: false, chromiumTrace: false, hostContended: false })

/**
 * One decision. `fire` writes an incident. A detection while a condition holds does not open an episode, so the
 * same incident fires as soon as the condition ends; it carries `suppressedReason` once per stretch of held
 * conditions. A detection inside the cooldown opens an episode silently after reporting `cooldown`.
 */
export interface IncidentDecision<Memory> {
  readonly fire: boolean
  readonly suppressedReason?: IncidentSuppressedReason
  readonly memory: Memory
}

/** Shared by every decider memory: a condition-suppressed detection was already reported in this stretch. */
interface ConditionReport {
  readonly conditionReported: boolean
}

type ConditionReason = Exclude<IncidentSuppressedReason, 'budget' | 'cooldown'>

/** The first condition that holds, in order of how much it undermines the measurement. */
function conditionOf(conditions: IncidentConditions): ConditionReason | null {
  if (conditions.suspended)
    return 'suspended'
  if (conditions.hidden)
    return 'hidden'
  if (conditions.settling)
    return 'settling'
  if (conditions.chromiumTrace)
    return 'chromium-trace'
  if (conditions.hostContended)
    return 'host-contended'
  return null
}

/** Suppresses a detection without opening its episode; `memory` already carries the detector's other updates. */
function suppressByCondition<Memory extends ConditionReport>(reason: ConditionReason, memory: Memory): IncidentDecision<Memory> {
  const next = { ...memory, conditionReported: true }
  return memory.conditionReported ? { fire: false, memory: next } : { fire: false, suppressedReason: reason, memory: next }
}

function inCooldown(lastFireMs: number | null, cooldownMs: number, nowMs: number): boolean {
  return lastFireMs !== null && nowMs < lastFireMs + cooldownMs
}

export const FRAME_STALL_FRAME_MS = 500
export const FRAME_STALL_SLOW_FRAME_MS = 100
export const FRAME_STALL_SLOW_FRAMES = 3
export const FRAME_STALL_LONG_TASK_MS = 500
export const FRAME_STALL_CLEAR_ROLLUPS = 6
export const FRAME_STALL_COOLDOWN_MS = 10 * 60_000

/** Per stage window. */
export interface FrameStallMemory extends ConditionReport {
  readonly active: boolean
  readonly cleanRollups: number
  readonly lastFireMs: number | null
}

export const INITIAL_FRAME_STALL_MEMORY: FrameStallMemory = Object.freeze({ active: false, cleanRollups: 0, lastFireMs: null, conditionReported: false })

export interface FrameStallInput {
  /** The window's pulled rollup, or `null` when the window did not answer the tick's pull (`rollup-missing`). */
  readonly rollup: Pick<WindowRollupRecord, 'frameHist' | 'frameMaxMs' | 'longTasks'> | null
  readonly conditions: IncidentConditions
}

// 100 ms is a frame bin edge, so frames at or above it are exactly the bins after it.
const SLOW_FRAME_FIRST_BIN = FRAME_BINS_V1.edges.indexOf(FRAME_STALL_SLOW_FRAME_MS) + 1

function isFrameStall(rollup: FrameStallInput['rollup']): boolean {
  if (rollup === null)
    return true
  if (rollup.frameMaxMs >= FRAME_STALL_FRAME_MS || rollup.longTasks.maxMs >= FRAME_STALL_LONG_TASK_MS)
    return true
  let slowFrames = 0
  for (let index = SLOW_FRAME_FIRST_BIN; index < rollup.frameHist.length; index++)
    slowFrames += rollup.frameHist[index]
  return slowFrames >= FRAME_STALL_SLOW_FRAMES
}

/**
 * Detects a frame stall in one window rollup: a frame or long task of at least 500 ms, at least 3 frames of
 * 100 ms or more, or a missing rollup. An episode ends after 6 consecutive clean rollups; a new one within
 * 10 min of the last fire is suppressed as `cooldown`.
 */
export function decideFrameStall(memory: FrameStallMemory, input: FrameStallInput, nowMs: number): IncidentDecision<FrameStallMemory> {
  const stall = isFrameStall(input.rollup)
  const condition = conditionOf(input.conditions)
  const conditionReported = condition !== null && memory.conditionReported
  if (memory.active) {
    const cleanRollups = stall ? 0 : memory.cleanRollups + 1
    const cleared = cleanRollups >= FRAME_STALL_CLEAR_ROLLUPS
    return { fire: false, memory: { active: !cleared, cleanRollups: cleared ? 0 : cleanRollups, lastFireMs: memory.lastFireMs, conditionReported } }
  }
  if (!stall)
    return { fire: false, memory: { ...memory, conditionReported } }
  if (condition !== null)
    return suppressByCondition(condition, memory)
  if (inCooldown(memory.lastFireMs, FRAME_STALL_COOLDOWN_MS, nowMs))
    return { fire: false, suppressedReason: 'cooldown', memory: { active: true, cleanRollups: 0, lastFireMs: memory.lastFireMs, conditionReported: false } }
  return { fire: true, memory: { active: true, cleanRollups: 0, lastFireMs: nowMs, conditionReported: false } }
}

export const PEGGED_CPU_PCT = 90
export const PEGGED_SAMPLES = 6
export const PEGGED_CLEAR_CPU_PCT = 60
export const PEGGED_CLEAR_SAMPLES = 3
export const PEGGED_COOLDOWN_MS = 10 * 60_000

/** Per process. */
export interface PeggedMemory extends ConditionReport {
  readonly active: boolean
  /** Keeps counting while a condition suppresses the detection, so the first calm hot sample fires. */
  readonly hotSamples: number
  readonly coolSamples: number
  readonly lastFireMs: number | null
}

export const INITIAL_PEGGED_MEMORY: PeggedMemory = Object.freeze({ active: false, hotSamples: 0, coolSamples: 0, lastFireMs: null, conditionReported: false })

export interface PeggedInput {
  /** `null` when the CPU share is unknown; it breaks both streaks. */
  readonly cpuPctOfCore: number | null
  readonly nowMs: number
  readonly conditions: IncidentConditions
}

/**
 * Detects a process at or above 90 % of a core for 6 consecutive samples. An episode ends after 3 consecutive
 * samples below 60 %; a new one within 10 min of the last fire is suppressed as `cooldown`.
 */
export function decidePegged(memory: PeggedMemory, input: PeggedInput): IncidentDecision<PeggedMemory> {
  const { cpuPctOfCore, nowMs } = input
  const condition = conditionOf(input.conditions)
  const conditionReported = condition !== null && memory.conditionReported
  if (memory.active) {
    const coolSamples = cpuPctOfCore !== null && cpuPctOfCore < PEGGED_CLEAR_CPU_PCT ? memory.coolSamples + 1 : 0
    const cleared = coolSamples >= PEGGED_CLEAR_SAMPLES
    return { fire: false, memory: { active: !cleared, hotSamples: 0, coolSamples: cleared ? 0 : coolSamples, lastFireMs: memory.lastFireMs, conditionReported } }
  }
  const hotSamples = cpuPctOfCore !== null && cpuPctOfCore >= PEGGED_CPU_PCT ? memory.hotSamples + 1 : 0
  if (hotSamples < PEGGED_SAMPLES)
    return { fire: false, memory: { ...memory, hotSamples, conditionReported } }
  if (condition !== null)
    return suppressByCondition(condition, { ...memory, hotSamples })
  if (inCooldown(memory.lastFireMs, PEGGED_COOLDOWN_MS, nowMs))
    return { fire: false, suppressedReason: 'cooldown', memory: { active: true, hotSamples: 0, coolSamples: 0, lastFireMs: memory.lastFireMs, conditionReported: false } }
  return { fire: true, memory: { active: true, hotSamples: 0, coolSamples: 0, lastFireMs: nowMs, conditionReported: false } }
}

const MIB_KB = 1024
export const MEMORY_GROWTH_BASELINE_FROM_MS = 2 * 60_000
export const MEMORY_GROWTH_BASELINE_TO_MS = 5 * 60_000
export const MEMORY_GROWTH_SLOPE_WINDOW_MS = 10 * 60_000
/** The fit needs at least this much history inside the slope window, so a short jump is not read as a rate. */
export const MEMORY_GROWTH_MIN_FIT_MS = 5 * 60_000
export const MEMORY_GROWTH_FIRE_MIB_PER_MIN = 20
export const MEMORY_GROWTH_RISE_MIB = 300
export const MEMORY_GROWTH_CLEAR_MIB_PER_MIN = 5
export const MEMORY_GROWTH_CLEAR_MS = 5 * 60_000
export const MEMORY_GROWTH_COOLDOWN_MS = 30 * 60_000

/** Per stage window process. Sizes are KiB, as Electron reports working sets; MiB is 1024 KiB. */
export interface MemoryGrowthMemory extends ConditionReport {
  /** Start of the baseline: the window's last model load, or the first sample when no load was seen. */
  readonly anchorMs: number | null
  readonly modelLoadMs: number | null
  /** Samples taken 2-5 min after the anchor; their median is the baseline. */
  readonly baselineKb: readonly number[]
  /** Samples within the last 10 min, oldest first. */
  readonly samples: readonly { readonly atMs: number, readonly kb: number }[]
  readonly active: boolean
  readonly calmSinceMs: number | null
  readonly lastFireMs: number | null
  /** Working set at the last fire; the next fire needs a further +300 MiB over it. */
  readonly lastFireKb: number | null
}

export const INITIAL_MEMORY_GROWTH_MEMORY: MemoryGrowthMemory = Object.freeze({
  anchorMs: null,
  modelLoadMs: null,
  baselineKb: Object.freeze([]),
  samples: Object.freeze([]),
  active: false,
  calmSinceMs: null,
  lastFireMs: null,
  lastFireKb: null,
  conditionReported: false,
})

export interface MemoryGrowthInput {
  readonly workingSetKb: number
  readonly nowMs: number
  /** The window's last `model-load` time, or `null` when none was seen this session. */
  readonly modelLoadMs: number | null
  readonly conditions: IncidentConditions
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Least-squares slope in MiB per minute, or `null` while the samples span less than {@link MEMORY_GROWTH_MIN_FIT_MS}. */
function slopeMibPerMin(samples: MemoryGrowthMemory['samples']): number | null {
  if (samples.length < 2 || samples[samples.length - 1].atMs - samples[0].atMs < MEMORY_GROWTH_MIN_FIT_MS)
    return null
  let meanAt = 0
  let meanKb = 0
  for (const sample of samples) {
    meanAt += sample.atMs / samples.length
    meanKb += sample.kb / samples.length
  }
  let covariance = 0
  let variance = 0
  for (const sample of samples) {
    covariance += (sample.atMs - meanAt) * (sample.kb - meanKb)
    variance += (sample.atMs - meanAt) ** 2
  }
  return covariance / variance * 60_000 / MIB_KB
}

/**
 * Detects working-set growth in one window process: the least-squares slope over the last 10 min is above
 * 20 MiB/min and the working set is at least 300 MiB over the baseline (or over the last fire). An episode ends
 * after the slope stays below 5 MiB/min for 5 min; a new one within 30 min of the last fire is suppressed as
 * `cooldown`. A new model load restarts the baseline and forgets the last fire's working set.
 */
export function decideMemoryGrowth(memory: MemoryGrowthMemory, input: MemoryGrowthInput): IncidentDecision<MemoryGrowthMemory> {
  const { workingSetKb, nowMs } = input
  const reanchored = memory.anchorMs === null || input.modelLoadMs !== memory.modelLoadMs
  const base: MemoryGrowthMemory = reanchored
    ? { ...INITIAL_MEMORY_GROWTH_MEMORY, anchorMs: input.modelLoadMs ?? nowMs, modelLoadMs: input.modelLoadMs, lastFireMs: memory.lastFireMs }
    : memory
  const anchorMs = base.anchorMs ?? nowMs
  const sinceAnchor = nowMs - anchorMs
  const inBaseline = sinceAnchor >= MEMORY_GROWTH_BASELINE_FROM_MS && sinceAnchor <= MEMORY_GROWTH_BASELINE_TO_MS
  const condition = conditionOf(input.conditions)
  const next: MemoryGrowthMemory = {
    ...base,
    conditionReported: condition !== null && memory.conditionReported,
    baselineKb: inBaseline ? [...base.baselineKb, workingSetKb] : base.baselineKb,
    samples: [...base.samples.filter(sample => sample.atMs > nowMs - MEMORY_GROWTH_SLOPE_WINDOW_MS), { atMs: nowMs, kb: workingSetKb }],
  }
  const slope = slopeMibPerMin(next.samples)

  if (next.active) {
    const calmSinceMs = slope !== null && slope < MEMORY_GROWTH_CLEAR_MIB_PER_MIN ? (next.calmSinceMs ?? nowMs) : null
    const cleared = calmSinceMs !== null && nowMs - calmSinceMs >= MEMORY_GROWTH_CLEAR_MS
    return { fire: false, memory: { ...next, active: !cleared, calmSinceMs: cleared ? null : calmSinceMs } }
  }
  const baselineReady = sinceAnchor > MEMORY_GROWTH_BASELINE_TO_MS && next.baselineKb.length > 0
  if (!baselineReady || slope === null || slope <= MEMORY_GROWTH_FIRE_MIB_PER_MIN)
    return { fire: false, memory: next }
  const floorKb = next.lastFireKb ?? median(next.baselineKb)
  if (workingSetKb < floorKb + MEMORY_GROWTH_RISE_MIB * MIB_KB)
    return { fire: false, memory: next }
  if (condition !== null)
    return suppressByCondition(condition, next)
  if (inCooldown(next.lastFireMs, MEMORY_GROWTH_COOLDOWN_MS, nowMs))
    return { fire: false, suppressedReason: 'cooldown', memory: { ...next, active: true, calmSinceMs: null } }
  return { fire: true, memory: { ...next, active: true, calmSinceMs: null, lastFireMs: nowMs, lastFireKb: workingSetKb } }
}

export const INCIDENT_BUDGET_PER_HOUR = 6
export const INCIDENT_BUDGET_PER_DAY = 20
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/**
 * Caps written incidents across all triggers at 6 per rolling hour and 20 per rolling day. Call `admit` after a
 * decider fires; only admitted incidents count, and it keeps at most the last day's admissions.
 */
export class IncidentBudget {
  #admittedMs: readonly number[] = []

  admit(nowMs: number): { readonly fire: boolean, readonly suppressedReason?: 'budget' } {
    const lastDay = this.#admittedMs.filter(atMs => atMs > nowMs - DAY_MS)
    const lastHour = lastDay.filter(atMs => atMs > nowMs - HOUR_MS)
    this.#admittedMs = lastDay
    if (lastHour.length >= INCIDENT_BUDGET_PER_HOUR || lastDay.length >= INCIDENT_BUDGET_PER_DAY)
      return { fire: false, suppressedReason: 'budget' }
    this.#admittedMs = [...lastDay, nowMs]
    return { fire: true }
  }
}
