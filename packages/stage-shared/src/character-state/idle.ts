import type { CharacterReading, IdleDrive } from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'

const IDLE = CHARACTER_STATE_SETTINGS.idle

/** A rested daytime character without a mood, who neither just talked nor has been alone for long. */
export const NEUTRAL_IDLE_DRIVE: IdleDrive = Object.freeze({ energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: IDLE.solitudeUnknown })

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Hours from `from` forward to `to` on a 24-hour clock, in [0, 24). */
function hoursForward(from: number, to: number): number {
  return (((to - from) % 24) + 24) % 24
}

/**
 * Sleepiness at a local hour (0 to 24, fractions allowed): 0 through her day, rising linearly over the evening ramp to
 * 1, held through the deep night, and falling linearly over the morning ramp. A non-finite hour gives 0.
 */
export function sleepinessAt(localHour: number): number {
  if (!Number.isFinite(localHour))
    return 0
  const { fromHour, deepHour, untilHour, clearHour } = IDLE.night
  const sinceFrom = hoursForward(fromHour, localHour)
  const rise = hoursForward(fromHour, deepHour)
  const deep = hoursForward(fromHour, untilHour)
  const night = hoursForward(fromHour, clearHour)
  if (sinceFrom >= night)
    return 0
  if (sinceFrom < rise)
    return sinceFrom / rise
  if (sinceFrom < deep)
    return 1
  return 1 - (sinceFrom - deep) / (night - deep)
}

/**
 * The idle drive of a reading at `nowMs` and the local hour `localHour`. Mood counts as its distance from the resting
 * disposition, undamped: unlike the resting face, how she idles should show her mood most when nobody is talking to
 * her. Solitude is `1 - 2^(-t / 30 min)` for the time `t` since the last interaction. No reading keeps the neutral
 * mood and the unknown solitude; the hour still applies. The caller supplies the hour, because this package reads no
 * clock or time zone.
 */
export function idleDriveOf(reading: Pick<CharacterReading, 'mood' | 'resting' | 'lastInteractionAtMs'> | null, nowMs: number, localHour: number): IdleDrive {
  const sleepiness = sleepinessAt(localHour)
  if (reading === null || !Number.isFinite(nowMs))
    return { ...NEUTRAL_IDLE_DRIVE, sleepiness }
  const since = reading.lastInteractionAtMs === null ? null : Math.max(0, nowMs - reading.lastInteractionAtMs)
  return {
    energy: clamp(reading.mood.energy - reading.resting.energy, -1, 1),
    valence: clamp(reading.mood.valence - reading.resting.valence, -1, 1),
    tension: clamp(reading.mood.tension - reading.resting.tension, -1, 1),
    sleepiness,
    solitude: since === null ? IDLE.solitudeUnknown : 1 - 2 ** (-since / IDLE.solitudeHalfLifeMs),
  }
}
