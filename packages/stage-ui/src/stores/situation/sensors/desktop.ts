import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { Observation, PresenceReason, PresenceState, WakeObservation } from '@proj-airi/stage-shared/situation'

import { AWAY_INPUT_IDLE_SECONDS } from '@proj-airi/stage-shared/performance-state'
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
 * unlocked desktop whose idle time cannot be measured reads as `unknown`, like the performance resolver.
 */
function presenceOf(snapshot: DesktopActivitySnapshot | null, nowMs: number): Presence {
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
  const idleSeconds = timeOrNull(snapshot.idleSeconds)
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
 * Turns the desktop activity samples of this window into `presence` and `wake` observations.
 *
 * Presence is reported only when its state or reason changes. A wake is reported when `unlockedAtMs` or
 * `resumedAtMs` advances past the last known value; the first sample is only a baseline, because its times can be
 * hours old. Equal or older times are not wakes. The caller owns the clock: it calls {@link DesktopSensor.check}
 * from its own ticker, so the sensor adds no timer. Hosts without a producer keep a `null` snapshot, which reads
 * as `unknown`.
 */
export function startDesktopSensor(ingest: (observation: Observation) => void): DesktopSensor {
  const desktopActivity = useDesktopActivityStore()
  let presence: Presence = UNKNOWN
  let baselined = false
  let unlockedAtMs: number | null = null
  let resumedAtMs: number | null = null

  function reportPresence(nowMs: number) {
    const next = presenceOf(desktopActivity.snapshot, nowMs)
    if (next.state === presence.state && next.reason === presence.reason)
      return
    presence = next
    ingest({ kind: 'presence', state: next.state, ...(next.reason ? { reason: next.reason } : {}), atMs: nowMs })
  }

  function reportWakes(snapshot: DesktopActivitySnapshot) {
    const unlocked = timeOrNull(snapshot.unlockedAtMs)
    const resumed = timeOrNull(snapshot.resumedAtMs)
    if (!baselined) {
      baselined = true
      unlockedAtMs = unlocked
      resumedAtMs = resumed
      return
    }

    const wakes: WakeObservation[] = []
    if (unlocked !== null && (unlockedAtMs === null || unlocked > unlockedAtMs)) {
      unlockedAtMs = unlocked
      wakes.push({ kind: 'wake', cause: 'unlock', atMs: unlocked })
    }
    if (resumed !== null && (resumedAtMs === null || resumed > resumedAtMs)) {
      resumedAtMs = resumed
      wakes.push({ kind: 'wake', cause: 'resume', atMs: resumed })
    }
    // The reducer keeps only the newest wake, so the older one goes first.
    for (const wake of wakes.sort((a, b) => a.atMs - b.atMs))
      ingest(wake)
  }

  const scope = effectScope(true)
  scope.run(() => {
    // Sync, so two samples written in one tick (locked, then unlocked) are both seen.
    watch(() => desktopActivity.snapshot, (snapshot) => {
      if (snapshot)
        reportWakes(snapshot)
      reportPresence(Date.now())
    }, { immediate: true, flush: 'sync' })
  })

  return {
    check: reportPresence,
    stop: () => scope.stop(),
  }
}
