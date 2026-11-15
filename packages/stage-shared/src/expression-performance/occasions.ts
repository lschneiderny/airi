import type { InferOutput } from 'valibot'

import type { AppCategory } from '../situation/types'

import { picklist } from 'valibot'

/**
 * A stretch of time, lasting minutes or longer, in which a pastime fits what is going on: the hour, what the user
 * does, or how she feels. The list is fixed and knows no rig; the user tags a rig's entries with the occasions they
 * suit, and a rig without a fitting entry skips the occasion.
 *
 * Moments (the user comes back, a touch) are not occasions: a pastime starts on the idle draw's own timing, minutes
 * apart, so it cannot answer a moment.
 */
export const OccasionSchema = picklist(['morning', 'lunchtime', 'late-night', 'gaming', 'music', 'media', 'working', 'call', 'lonely', 'cheerful', 'gloomy'])
export type Occasion = InferOutput<typeof OccasionSchema>
export const OCCASIONS: readonly Occasion[] = OccasionSchema.options

export const OCCASION_SETTINGS = Object.freeze({
  /** Her day starts at this local hour, so a night that runs past midnight still belongs to the day before. */
  dayStartHour: 5,
  /** The user's first presence of her day starts a morning only before this local hour. */
  morningBeforeHour: 11,
  /** How long the morning lasts once it has started. */
  morningMs: 45 * 60_000,
  lunchFromHour: 11.5,
  lunchUntilHour: 13.5,
  /** `sleepinessAt` of the local hour at or above which it is late at night. */
  lateNightSleepiness: 0.5,
  /** Solitude at or above which she has been left alone for long: 0.75 is one hour since the last exchange. */
  lonelySolitude: 0.75,
  /** Mood valence, relative to her resting disposition, beyond which her mood counts as an occasion. */
  moodValence: 0.3,
})

export interface OccasionInput {
  nowMs: number
  /** Local hour, 0 to 24, fractions allowed. */
  localHour: number
  /** Local calendar day as a count of days; only a change matters. */
  localDay: number
  /** The user is at the machine. */
  present: boolean
  /** The idle drive's values; see `idleDriveOf`. */
  sleepiness: number
  solitude: number
  valence: number
  music: boolean
  /** Category of the app in the foreground, or `null` on a host that cannot tell. */
  category: AppCategory | null
}

/** What `resolveOccasions` carries between calls: which of her days the user was first seen on, and when its morning began. */
export interface OccasionMemory {
  readonly day: number | null
  readonly morningStartedAtMs: number | null
}

export const initialOccasionMemory: OccasionMemory = Object.freeze({ day: null, morningStartedAtMs: null })

const CATEGORY_OCCASIONS: Partial<Record<AppCategory, Occasion>> = { game: 'gaming', media: 'media', editor: 'working', work: 'working', call: 'call' }

/**
 * The occasions that hold now, in the order of `OCCASIONS`. Call it about once a second with the memory it returned.
 *
 * - `morning` lasts 45 minutes from the user's first presence of her day, when that falls between 05:00 and 11:00.
 *   A user who first appears later gets no morning that day; one who is away at 05:00 gets it when they arrive.
 * - `lunchtime` is 11:30 to 13:30 local time. `late-night` follows her sleepiness, so it moves with her night.
 * - `gaming`, `media`, `working` and `call` follow the foreground app; `music` follows the music detection.
 * - `lonely`, `cheerful` and `gloomy` follow the idle drive.
 */
export function resolveOccasions(input: OccasionInput, memory: OccasionMemory): { occasions: Occasion[], memory: OccasionMemory } {
  const settings = OCCASION_SETTINGS
  const herDay = input.localHour >= settings.dayStartHour ? input.localDay : input.localDay - 1
  let next = memory
  if (input.present && memory.day !== herDay) {
    const early = input.localHour >= settings.dayStartHour && input.localHour < settings.morningBeforeHour
    next = { day: herDay, morningStartedAtMs: early ? input.nowMs : null }
  }
  const morning = next.day === herDay && next.morningStartedAtMs !== null && input.nowMs - next.morningStartedAtMs < settings.morningMs
  const category = input.category === null ? undefined : CATEGORY_OCCASIONS[input.category]
  const holds: Record<Occasion, boolean> = {
    'morning': morning,
    'lunchtime': input.localHour >= settings.lunchFromHour && input.localHour < settings.lunchUntilHour,
    'late-night': input.sleepiness >= settings.lateNightSleepiness,
    'gaming': category === 'gaming',
    'music': input.music,
    'media': category === 'media',
    'working': category === 'working',
    'call': category === 'call',
    'lonely': input.solitude >= settings.lonelySolitude,
    'cheerful': input.valence >= settings.moodValence,
    'gloomy': input.valence <= -settings.moodValence,
  }
  return { occasions: OCCASIONS.filter(occasion => holds[occasion]), memory: next }
}
