/** Tuning: convert hourly hazard rates to explicit milliseconds. */
export const HOUR_MS = 3_600_000
/** Tuning: bound accrual after a suspended tick or a forward clock jump. */
export const ACCRUAL_DT_MAX_MS = 10_000
/** Tuning: minimum spacing between non-urgent openings. */
export const FLOOR_MS = 120_000
/**
 * Tuning: single cadence calibration coefficient at Chattiness 0.5; design
 * value 0.6. Calibrated to 1.0 by the seeded cadence simulation
 * (`gate.simulation.test.ts`): 0.6 gave 2.64 spoken openings per desk day at
 * Chattiness 0.5, and 1.0 (the plan's ceiling) is the first 0.1 step that keeps
 * every Chattiness band and the gap-shape checks.
 */
export const BASE_RATE_AT_HALF_PER_HOUR = 1.0
/** Tuning: rate ratio between the lowest and highest Chattiness. */
export const BASE_RATE_SPAN = 26
/** Tuning: no new topic while the latest user turn is this recent. */
export const EXCHANGE_ZERO_MS = 120_000
/** Tuning: exchange recovery scale; about 98% recovered after 30 minutes. */
export const EXCHANGE_SCALE_MS = HOUR_MS / 4
/** Tuning: recovery scale after a long hard hold clears. */
export const CLEAR_SCALE_MS = HOUR_MS / 20
/** Tuning: reduce opening hazard while a game is active. */
export const GAME_FACTOR = 0.5
/** Tuning: opening pressure with no ripe conversation thread. */
export const PRESSURE_BASE = 0.6
/** Tuning: extra opening pressure from the ripest thread. */
export const PRESSURE_SPAN = 0.8
/** Tuning: integrated continuation hazard before its window closes. */
export const CONTINUATION_K = 0.43
/** Tuning: exponential decay scale for a short unanswered follow-up. */
export const CONTINUATION_TAU_MS = HOUR_MS / 3
/** Tuning: one unanswered opening permits only continuations for 90 minutes. */
export const CONTINUATION_WINDOW_MS = 1.5 * HOUR_MS
/** Tuning: quiet windows and reopened rates for one, two, or at least three unanswered openings. */
export const UNANSWERED_PHASES = Object.freeze([
  Object.freeze({ unanswered: 1, quietMs: CONTINUATION_WINDOW_MS, damping: 0.5 }),
  Object.freeze({ unanswered: 2, quietMs: 4 * HOUR_MS, damping: 0.3 }),
  Object.freeze({ unanswered: 3, quietMs: 8 * HOUR_MS, damping: 0.2 }),
])
/** Tuning: halve the remaining damping each hour after a reply. */
export const RECOVERY_HALF_LIFE_MS = HOUR_MS
/** Tuning: chance of one extra line after a spoken opening. */
export const DOUBLE_TEXT_PROBABILITY = 0.15
/** Tuning: earliest extra-line offset after speech. */
export const DOUBLE_TEXT_OFFSET_MIN_MS = 10_000
/** Tuning: latest extra-line offset after speech. */
export const DOUBLE_TEXT_OFFSET_MAX_MS = 50_000
/** Tuning: discard an unsent extra line after one minute. */
export const DOUBLE_TEXT_EXPIRY_MS = 60_000
/** Tuning: extra hourly hazard for a recently due later-thread. */
export const DUE_BUMP_RATE_PER_HOUR = 1
/** Tuning: duration of the extra hazard after a later-thread comes due. */
export const DUE_BUMP_WINDOW_MS = 2 * HOUR_MS
/** Tuning: independent hourly guard against a miscalibrated rate. */
export const SAFETY_CAP_PER_HOUR = 4

/** Non-finite Chattiness has the same conservative mapping as zero. */
export function baseRatePerHour(chattiness: number): number {
  const c = Number.isFinite(chattiness) ? Math.max(0, Math.min(1, chattiness)) : 0
  return BASE_RATE_AT_HALF_PER_HOUR * BASE_RATE_SPAN ** (c - 0.5)
}

export function exchangeFactor(sinceUserMs: number | null): number {
  if (sinceUserMs === null)
    return 1
  if (sinceUserMs < EXCHANGE_ZERO_MS)
    return 0
  return 1 - Math.exp(-((sinceUserMs / EXCHANGE_SCALE_MS) ** 2))
}

export function clearFactor(sinceHardHoldMs: number | null): number {
  return sinceHardHoldMs === null ? 1 : 1 - Math.exp(-sinceHardHoldMs / CLEAR_SCALE_MS)
}

export function unansweredPhase(unanswered: number, sinceLastSpokenMs: number): { allows: 'open' | 'continuation' | 'urgent', damping: number } {
  if (unanswered < 1)
    return { allows: 'open', damping: 1 }
  const phase = UNANSWERED_PHASES[Math.min(UNANSWERED_PHASES.length, Math.floor(unanswered)) - 1]
  if (sinceLastSpokenMs < phase.quietMs)
    return { allows: unanswered < 2 ? 'continuation' : 'urgent', damping: phase.damping }
  return { allows: 'open', damping: phase.damping }
}

export function recoveryFactor(damp: { readonly depth: number, readonly sinceMs: number } | null, nowMs: number): number {
  return damp === null ? 1 : 1 - damp.depth * 2 ** (-(nowMs - damp.sinceMs) / RECOVERY_HALF_LIFE_MS)
}

export function continuationHazardPerHour(sinceLastSpokenMs: number): number {
  if (sinceLastSpokenMs < 0 || sinceLastSpokenMs >= CONTINUATION_WINDOW_MS)
    return 0
  return (CONTINUATION_K / (CONTINUATION_TAU_MS / HOUR_MS)) * Math.exp(-sinceLastSpokenMs / CONTINUATION_TAU_MS)
}

export function pressure(maxThreadRipeness: number): number {
  return PRESSURE_BASE + PRESSURE_SPAN * maxThreadRipeness
}

/** Accumulate integrated hazard; callers clamp elapsed time before passing it in. */
export function accrue(urge: number, hazardPerHour: number, dtMs: number): number {
  return urge + hazardPerHour * dtMs / HOUR_MS
}

/** Transform a unit ticket in [0, 1) into an exponential threshold. */
export function drawThreshold(u: number): number {
  return -Math.log1p(-u)
}

/** Remaining wait at a constant hazard; negative means the threshold was crossed. */
export function expectedWaitMs(urge: number, threshold: number, hazardPerHour: number): number | null {
  return hazardPerHour === 0 ? null : (threshold - urge) / hazardPerHour * HOUR_MS
}
