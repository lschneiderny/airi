import type { AdvanceContext, CharacterReading, ClosenessStage, MoodAxes, MoodBuckets } from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'

const RENDERING = CHARACTER_STATE_SETTINGS.rendering
const HOUR_MS = 3_600_000
/** Offset into a logical day from which its events read as "last night". */
const NIGHT_OFFSET_MS = (RENDERING.nightFromHour - CHARACTER_STATE_SETTINGS.relationship.rolloverHour) * HOUR_MS

/** The time inputs rendering needs: the instant and the 04:00 logical day. */
export type CharacterRenderContext = Pick<AdvanceContext, 'nowMs' | 'logicalDayStartOf'>

/** What the rendered text is made of; the text is a one-to-one function of it, so its JSON is the render key. */
export interface CharacterRenderParts {
  /** `null` when every bucket rests and no reason renders. */
  readonly feeling: { readonly words: readonly string[], readonly reasons: readonly string[] } | null
  readonly relationship: string
}

interface BucketScale {
  readonly boundaries: readonly number[]
  readonly words: readonly string[]
}

function bucketOf<W extends string>(value: number, scale: BucketScale, hysteresis: number, previous: W | null, resting: number | undefined): W {
  let index = 0
  while (index < scale.boundaries.length && value >= scale.boundaries[index]!)
    index++
  const atRest = resting !== undefined && Math.abs(value - resting) < CHARACTER_STATE_SETTINGS.mood.epsilon
  if (previous !== null && !atRest) {
    const held = scale.words.indexOf(previous)
    if (held >= 0 && held !== index) {
      const lower = held === 0 ? Number.NEGATIVE_INFINITY : scale.boundaries[held - 1]! - hysteresis
      const upper = held === scale.boundaries.length ? Number.POSITIVE_INFINITY : scale.boundaries[held]! + hysteresis
      if (value >= lower && value < upper)
        return previous
    }
  }
  // The settings list exactly the words of each bucket type, in bucket order.
  return scale.words[index] as W
}

/**
 * The word bucket of each mood axis (plan Appendix A4). A value at a boundary belongs to the upper bucket; with a
 * `previous` bucket, the value keeps it until it leaves that bucket's range by the exit hysteresis. With `resting`, an
 * axis back within the mood epsilon of its resting value drops the hysteresis: the mood nears its resting value only
 * from one side, so a resting value inside a bucket's exit band would otherwise keep that bucket forever (IS-12).
 */
export function bucketsOf(mood: MoodAxes, previous: MoodBuckets | null, resting?: MoodAxes): MoodBuckets {
  const { exitHysteresis } = RENDERING
  return {
    valence: bucketOf(mood.valence, RENDERING.valence, exitHysteresis.valence, previous?.valence ?? null, resting?.valence),
    energy: bucketOf(mood.energy, RENDERING.energy, exitHysteresis.energy, previous?.energy ?? null, resting?.energy),
    tension: bucketOf(mood.tension, RENDERING.tension, exitHysteresis.tension, previous?.tension ?? null, resting?.tension),
  }
}

/** A reason as the prompt shows it: no digits, no list punctuation, no trailing punctuation. */
export function cleanReason(text: string): string {
  return text
    .replace(/\d+/g, '')
    .replace(/[()]/g, '')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    .trim()
    .replace(/[\s.,:!?]+$/, '')
}

/** Coarse time of an event from the logical day: earlier today, last night, yesterday, or a few days ago. */
function timeWordOf(atMs: number, ctx: CharacterRenderContext): string {
  const today = ctx.logicalDayStartOf(ctx.nowMs)
  if (atMs >= today)
    return 'earlier today'
  const yesterday = ctx.logicalDayStartOf(today - 1)
  if (atMs >= yesterday)
    return atMs - yesterday >= NIGHT_OFFSET_MS ? 'last night' : 'yesterday'
  return 'a few days ago'
}

function relationshipSentence(closeness: ClosenessStage, unlocks: CharacterReading['unlocks']): string {
  const sentences: string[] = [RENDERING.stageSentences[closeness]]
  for (const [unlock, sentence] of Object.entries(RENDERING.unlockSentences)) {
    if ((unlocks as readonly string[]).includes(unlock))
      sentences.push(sentence)
  }
  return sentences.join('; ')
}

/**
 * The parts of the character text, or `null` when she is at rest: every bucket equals the resting disposition's
 * bucket, no reason is live, and closeness is below `friendly` (IS-12).
 */
export function characterRenderParts(reading: Omit<CharacterReading, 'renderKey'>, ctx: CharacterRenderContext): CharacterRenderParts | null {
  const resting = bucketsOf(reading.resting, null)
  const { buckets } = reading
  const bucketsRest = buckets.valence === resting.valence && buckets.energy === resting.energy && buckets.tension === resting.tension
  if (bucketsRest && reading.reasons.length === 0 && reading.stages.closeness === 'stranger')
    return null

  const reasons = reading.reasons
    .map(reason => ({ text: cleanReason(reason.text), atMs: reason.atMs }))
    .filter(reason => reason.text !== '')
    .map(reason => `${reason.text} ${timeWordOf(reason.atMs, ctx)}`)
  const words = buckets.tension === RENDERING.tension.words[0] ? [buckets.valence, buckets.energy] : [buckets.valence, buckets.energy, buckets.tension]
  return {
    feeling: bucketsRest && reasons.length === 0 ? null : { words, reasons },
    relationship: relationshipSentence(reading.stages.closeness, reading.unlocks),
  }
}

/** The render key of a reading: it changes exactly when {@link renderCharacterContext} at the same instant changes. */
export function characterRenderKey(reading: Omit<CharacterReading, 'renderKey'>, ctx: CharacterRenderContext): string {
  return JSON.stringify(characterRenderParts(reading, ctx))
}

/**
 * The `system:character` text of a reading: `''` at rest, else at most two English lines without digits,
 * `Feeling: <valence>, <energy>[, <tension>] (<reason>; <reason>).` when the mood is off rest or a reason renders,
 * and `You two: <stage sentence>.`.
 */
export function renderCharacterContext(reading: Omit<CharacterReading, 'renderKey'>, ctx: CharacterRenderContext): string {
  const parts = characterRenderParts(reading, ctx)
  if (parts === null)
    return ''
  const lines: string[] = []
  if (parts.feeling !== null) {
    const reasons = parts.feeling.reasons.length > 0 ? ` (${parts.feeling.reasons.join('; ')})` : ''
    lines.push(`Feeling: ${parts.feeling.words.join(', ')}${reasons}.`)
  }
  lines.push(`You two: ${parts.relationship}.`)
  return lines.join('\n')
}
