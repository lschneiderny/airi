import type { ExpressionPerformanceSettings } from './settings'

/** Where a touch lands; matches the regions of the Live2D touch classifier. */
export type TouchRegion = 'head' | 'body'

/** One classified touch, timed in seconds on the signal producer's monotonic clock. */
export interface TouchAffectInput {
  touch: 'pet-start' | 'pet-end' | 'poke'
  region: TouchRegion
  /** Pet length on `pet-end`; without a finite value the pet is measured from its `pet-start`. */
  durationSeconds?: number
  at: number
}

/**
 * A mood delta for the Natural performer, already scaled by the profile-resolved mood gains.
 * Each id is unique within one memory, so a consumer can drop a replayed dose by id.
 */
export interface MoodDose {
  id: string
  valence: number
  arousal: number
  tension: number
}

type DoseKey = 'pet' | 'poke' | 'poke-burst'

/** Plain JSON: a checkpoint round trip yields the same next output. */
export interface TouchAffectMemory {
  /** Doses issued so far; numbers the dose ids. */
  counter: number
  /** Latest accepted touch; earlier and non-finite times are ignored. */
  lastAt: number | null
  /** The pet in progress: its start, its habituation, and the dose scale it has already given. */
  pet: { startedAt: number, h: number, given: number } | null
  /** Dose times per key inside the habituation window, oldest first. */
  doses: Record<DoseKey, number[]>
  /** The latest poke times inside the burst window, oldest first. */
  pokes: number[]
  /** Whether the current poke burst has already dosed. */
  burstDosed: boolean
}

/** `touchAffect` never mutates a memory, so every state may share this one. */
export const initialTouchAffectMemory: TouchAffectMemory = {
  counter: 0,
  lastAt: null,
  pet: null,
  doses: { 'pet': [], 'poke': [], 'poke-burst': [] },
  pokes: [],
  burstDosed: false,
}

/** A pet at least this long escalates its dose to the clear band. */
const PET_LONG_SECONDS = 3
/** Seconds between pet-start doses. */
const PET_COOLDOWN_SECONDS = 4
/** Seconds between poke doses; a burst dose counts as a poke dose. */
const POKE_COOLDOWN_SECONDS = 1
const POKE_BURST_COUNT = 3
const POKE_BURST_WINDOW_SECONDS = 10
/** Same-key doses inside this window habituate the next dose. */
const HABITUATION_WINDOW_SECONDS = 60
const BODY_POKE_SCALE = 0.6

/** Mood directions as [valence, arousal, tension]. */
const PET_VECTOR = [1, 0, -0.5] as const
const POKE_VECTOR = [0, 1, 0] as const
const BURST_VECTOR = [0, 0.5, 1] as const

/** The mood dose of one band: its profile-resolved mood gain times its nominal intensity. */
function unit(band: 'slight' | 'clear', settings: ExpressionPerformanceSettings) {
  return settings.moodDynamics[`${band}Gain`] * settings.intensity[band]
}

function habituation(times: readonly number[], settings: ExpressionPerformanceSettings) {
  return Math.max(settings.intensity.habituationFloor, settings.intensity.habituationBase ** times.length)
}

function last(times: readonly number[]) {
  return times.length > 0 ? times[times.length - 1] : null
}

/**
 * Turns one touch into at most one mood dose. Pure: time and memory come in, and the returned memory
 * replaces the old one. Touch never creates an emotion episode; the dose feeds mood only.
 *
 * - `pet-start` doses slight along [+1, 0, -0.5] and opens the pet, at most once per 4 s. A start
 *   inside the cooldown opens a pet that has given nothing, so only its `pet-end` can dose.
 * - `pet-end` of a pet lasting at least 3 s escalates that pet to clear along the same vector,
 *   adding only the missing amount; a shorter pet doses nothing more.
 * - `poke` doses slight along [0, +1, 0], scaled by 0.6 on the body, at most once per 1 s. The
 *   3rd poke within 10 s doses clear along [0, +0.5, +1] instead, once per burst; a burst ends
 *   when a poke finds fewer than 3 pokes in the last 10 s.
 * - Every dose is scaled by `h = max(habituationFloor, habituationBase^n)`, where `n` counts the
 *   doses of the same key (pet, poke, or burst) in the last 60 s. A pet escalation keeps the `h`
 *   of its start and is not counted again.
 *
 * Zero-sized doses, such as under a zero mood gain scale, are not returned.
 */
export function touchAffect(memory: TouchAffectMemory, input: TouchAffectInput, settings: ExpressionPerformanceSettings): { dose: MoodDose | null, memory: TouchAffectMemory } {
  const at = input.at
  if (!Number.isFinite(at) || (memory.lastAt !== null && at < memory.lastAt))
    return { dose: null, memory }

  const doses: Record<DoseKey, number[]> = {
    'pet': memory.doses.pet.filter(time => at - time < HABITUATION_WINDOW_SECONDS),
    'poke': memory.doses.poke.filter(time => at - time < HABITUATION_WINDOW_SECONDS),
    'poke-burst': memory.doses['poke-burst'].filter(time => at - time < HABITUATION_WINDOW_SECONDS),
  }
  let next: TouchAffectMemory = { ...memory, lastAt: at, doses }

  function emit(key: DoseKey | null, label: string, vector: readonly [number, number, number], scale: number) {
    if (scale <= 0)
      return { dose: null, memory: next }
    const counter = next.counter + 1
    const dose = { id: `touch-${counter}-${label}`, valence: vector[0] * scale, arousal: vector[1] * scale, tension: vector[2] * scale }
    const recorded = key ? { ...next.doses, [key]: [...next.doses[key], at] } : next.doses
    return { dose, memory: { ...next, counter, doses: recorded } }
  }

  if (input.touch === 'pet-start') {
    const lastPet = last(doses.pet)
    const h = habituation(doses.pet, settings)
    if (lastPet !== null && at - lastPet < PET_COOLDOWN_SECONDS) {
      // A pet still open keeps its dose bookkeeping; a new pet in the cooldown starts from nothing.
      next = { ...next, pet: next.pet ?? { startedAt: at, h, given: 0 } }
      return { dose: null, memory: next }
    }
    const scale = unit('slight', settings) * h
    next = { ...next, pet: { startedAt: at, h, given: scale } }
    return emit('pet', 'pet', PET_VECTOR, scale)
  }

  if (input.touch === 'pet-end') {
    const pet = next.pet
    next = { ...next, pet: null }
    if (!pet)
      return { dose: null, memory: next }
    const duration = input.durationSeconds !== undefined && Number.isFinite(input.durationSeconds) ? input.durationSeconds : at - pet.startedAt
    if (duration < PET_LONG_SECONDS)
      return { dose: null, memory: next }
    return emit(null, 'pet-long', PET_VECTOR, unit('clear', settings) * pet.h - pet.given)
  }

  const pokes = [...memory.pokes.filter(time => at - time < POKE_BURST_WINDOW_SECONDS), at].slice(-POKE_BURST_COUNT)
  const inBurst = pokes.length >= POKE_BURST_COUNT
  next = { ...next, pokes, burstDosed: inBurst && memory.burstDosed }
  if (inBurst && !next.burstDosed) {
    next = { ...next, burstDosed: true }
    return emit('poke-burst', 'poke-burst', BURST_VECTOR, unit('clear', settings) * habituation(doses['poke-burst'], settings))
  }
  const lastPoke = Math.max(last(doses.poke) ?? -Infinity, last(doses['poke-burst']) ?? -Infinity)
  if (at - lastPoke < POKE_COOLDOWN_SECONDS)
    return { dose: null, memory: next }
  const region = input.region === 'body' ? BODY_POKE_SCALE : 1
  return emit('poke', 'poke', POKE_VECTOR, unit('slight', settings) * habituation(doses.poke, settings) * region)
}
