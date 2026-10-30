import type { PresenceState } from '../types'
import type { GateLocalTime, RitualDay, RitualKind } from './types'

import { LOGICAL_DAY_ROLLOVER_HOUR, RITUAL_TUNING } from './types'

/** Tuning: welcome-back is reserved for an absence of at least three hours. */
const WELCOME_BACK_MIN_AWAY_MS = 3 * 60 * 60_000
const DAY_MINUTES = 24 * 60

/** Minutes from the latest logical-day rollover to the local `minuteOfDay`. */
function minutesSinceRollover(minuteOfDay: number): number {
  return ((minuteOfDay - LOGICAL_DAY_ROLLOVER_HOUR * 60) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES
}

export function logicalDayKey(local: { year: number, month: number, day: number, hour: number }): string {
  // UTC calendar arithmetic avoids depending on the host's time zone or DST.
  const date = new Date(0)
  date.setUTCFullYear(local.year, local.month - 1, local.day - (local.hour < LOGICAL_DAY_ROLLOVER_HOUR ? 1 : 0))
  return date.toISOString().slice(0, 10)
}

export function advanceRituals(day: RitualDay | null, facts: {
  nowMs: number
  local: GateLocalTime
  presence: PresenceState
  userSpokeToday: boolean
  awayEndedAtMs: number | null
  awayDurationMs: number | null
}): RitualDay {
  const current: RitualDay = day?.dayKey === facts.local.dayKey
    ? day
    : {
        dayKey: facts.local.dayKey,
        firstPresentAtMs: null,
        lastAwayEndedAtMs: null,
        states: { 'greeting': 'open', 'sign-off': 'open', 'welcome-back': 'open' },
        windowOpenedAtMs: { 'greeting': null, 'sign-off': null, 'welcome-back': null },
      }
  const states = { ...current.states }
  const windowOpenedAtMs = { ...current.windowOpenedAtMs }
  const present = facts.presence === 'here' || facts.presence === 'idle'
  const firstPresence = present && current.firstPresentAtMs === null
  const minute = facts.local.minuteOfDay
  const greeting = RITUAL_TUNING.greeting

  if (states.greeting === 'open') {
    if (facts.userSpokeToday) {
      states.greeting = 'expired'
    }
    else if (firstPresence) {
      if (minute >= greeting.startMinute && minute <= greeting.endMinute)
        windowOpenedAtMs.greeting = facts.nowMs
      else
        states.greeting = 'expired'
    }
  }

  const signOff = RITUAL_TUNING['sign-off']
  const inSignOffWindow = minute >= signOff.startMinute || minute < signOff.endMinute
  if (states['sign-off'] === 'open') {
    if (present && inSignOffWindow && windowOpenedAtMs['sign-off'] === null) {
      // Anchor the fixed nightly window at 22:30, not at the first tick present,
      // so openRituals can expire it at 01:30 with only explicit epoch time.
      const elapsedMinutes = (minute - signOff.startMinute + 24 * 60) % (24 * 60)
      windowOpenedAtMs['sign-off'] = Math.floor(facts.nowMs / 60_000) * 60_000 - elapsedMinutes * 60_000
    }
    if (!inSignOffWindow && (windowOpenedAtMs['sign-off'] !== null || minute < LOGICAL_DAY_ROLLOVER_HOUR * 60))
      states['sign-off'] = 'expired'
  }

  let lastAwayEndedAtMs = current.lastAwayEndedAtMs
  if (present && facts.awayEndedAtMs !== null && (lastAwayEndedAtMs === null || facts.awayEndedAtMs > lastAwayEndedAtMs)) {
    lastAwayEndedAtMs = facts.awayEndedAtMs
    // An absence that began before the latest rollover (overnight) ends on a new
    // logical day whose greeting already covers the return, so only an absence
    // that began within the current logical day opens welcome-back.
    if (states['welcome-back'] === 'open' && windowOpenedAtMs['welcome-back'] === null
      && facts.awayDurationMs !== null && facts.awayDurationMs >= WELCOME_BACK_MIN_AWAY_MS
      && minutesSinceRollover(minute) >= facts.awayDurationMs / 60_000) {
      windowOpenedAtMs['welcome-back'] = facts.awayEndedAtMs
    }
  }

  for (const kind of Object.keys(states) as RitualKind[]) {
    const openedAtMs = windowOpenedAtMs[kind]
    if (states[kind] === 'open' && openedAtMs !== null && facts.nowMs >= openedAtMs + RITUAL_TUNING[kind].windowMs)
      states[kind] = 'expired'
  }

  return {
    dayKey: current.dayKey,
    firstPresentAtMs: firstPresence ? facts.nowMs : current.firstPresentAtMs,
    lastAwayEndedAtMs,
    states,
    windowOpenedAtMs,
  }
}

export function openRituals(day: RitualDay, nowMs: number): readonly RitualKind[] {
  return (Object.keys(day.states) as RitualKind[]).filter((kind) => {
    const openedAtMs = day.windowOpenedAtMs[kind]
    return day.states[kind] === 'open' && openedAtMs !== null
      && nowMs >= openedAtMs && nowMs < openedAtMs + RITUAL_TUNING[kind].windowMs
  })
}

export function ritualHazardPerHour(kind: RitualKind): number {
  return RITUAL_TUNING[kind].ratePerHour
}

export function markRitualDone(day: RitualDay, kind: RitualKind): RitualDay {
  return { ...day, states: { ...day.states, [kind]: 'done' } }
}
