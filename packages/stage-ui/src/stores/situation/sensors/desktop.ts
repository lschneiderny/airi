import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { Observation, PresenceReason, PresenceState } from '@proj-airi/stage-shared/situation'

import { AWAY_INPUT_IDLE_SECONDS, userIdleSeconds } from '@proj-airi/stage-shared/performance-state'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { effectScope, watch } from 'vue'

/**
 * Input idle longer than this, and up to {@link AWAY_INPUT_IDLE_SECONDS}, reads as `idle`.
 *
 * Tuning: raise it if short reading pauses count as idle; lower it to notice a paused user sooner.
 */
export const IDLE_INPUT_IDLE_SECONDS = 60

/**
 * A sample whose `sampledAtMs` is further than this from now reads as presence `unknown` with reason `stale`.
 * The producer samples at 1 Hz while the stage is visible and stops while it is hidden or minimized, so an old
 * sample describes the past. A sample from the future is equally untrusted.
 *
 * Tuning: keep it several producer intervals long, so one slow main-process reply does not flap presence.
 */
export const DESKTOP_SAMPLE_STALE_MS = 5_000

interface Presence {
  readonly state: PresenceState
  readonly reason?: PresenceReason
}

/** Matches the presence of `initialSituationState`, so a host without samples sends nothing. */
const UNKNOWN: Presence = Object.freeze({ state: 'unknown' })

function timeOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Maps one sample to presence. An unknown idle time (`null`, negative, NaN) is not treated as activity: an
 * unlocked desktop whose idle time cannot be measured reads as `unknown`, like the performance resolver. A turn of
 * the user's own counts as input like a key press, as it does there, so a user who only talks is not away.
 */
function presenceOf(snapshot: DesktopActivitySnapshot | null, nowMs: number, userTurnAtMs: number | null): Presence {
  if (!snapshot)
    return UNKNOWN
  const sampledAtMs = timeOrNull(snapshot.sampledAtMs)
  if (sampledAtMs === null || Math.abs(nowMs - sampledAtMs) > DESKTOP_SAMPLE_STALE_MS)
    return { state: 'unknown', reason: 'stale' }
  if (snapshot.locked === true)
    return { state: 'away', reason: 'locked' }
  const suspendedAtMs = timeOrNull(snapshot.suspendedAtMs)
  const resumedAtMs = timeOrNull(snapshot.resumedAtMs)
  if (suspendedAtMs !== null && (resumedAtMs === null || suspendedAtMs > resumedAtMs))
    return { state: 'away', reason: 'suspended' }
  const idleSeconds = userIdleSeconds(timeOrNull(snapshot.idleSeconds), userTurnAtMs, nowMs)
  if (idleSeconds === null)
    return UNKNOWN
  if (idleSeconds > AWAY_INPUT_IDLE_SECONDS)
    return { state: 'away', reason: 'idle' }
  if (idleSeconds > IDLE_INPUT_IDLE_SECONDS)
    return { state: 'idle', reason: 'idle' }
  return { state: 'here' }
}

export interface DesktopSensor {
  /** Re-evaluates presence at `nowMs` without a new sample, so a sample that stops arriving turns `unknown`. */
  check: (nowMs: number) => void
  stop: () => void
}

/**
 * Turns the desktop activity samples of this window into `presence` observations.
 *
 * Presence is reported only when its state or reason changes. Returns and desktop wakes come from the character
 * mind through the stage's voice port, not from this sensor. The caller owns the clock: it calls {@link DesktopSensor.check}
 * from its own ticker, so the sensor adds no timer. Hosts without a producer keep a `null` snapshot, which reads
 * as `unknown`. `userTurnAtMs` returns when the user last sent a turn of their own; the caller calls `check` after
 * one, because no sample changes then.
 */
export function startDesktopSensor(ingest: (observation: Observation) => void, userTurnAtMs: () => number | null = () => null): DesktopSensor {
  const desktopActivity = useDesktopActivityStore()
  let presence: Presence = UNKNOWN

  function reportPresence(nowMs: number) {
    const next = presenceOf(desktopActivity.snapshot, nowMs, userTurnAtMs())
    if (next.state === presence.state && next.reason === presence.reason)
      return
    presence = next
    ingest({ kind: 'presence', state: next.state, ...(next.reason ? { reason: next.reason } : {}), atMs: nowMs })
  }

  const scope = effectScope(true)
  scope.run(() => {
    // Sync, so two samples written in one tick (locked, then unlocked) are both seen.
    watch(() => desktopActivity.snapshot, () => reportPresence(Date.now()), { immediate: true, flush: 'sync' })
  })

  return {
    check: reportPresence,
    stop: () => scope.stop(),
  }
}
