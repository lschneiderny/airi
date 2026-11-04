import type { CueDirection, CueDirections } from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'

type Axis = keyof CueDirections

/** The six words of the stage contract's MOOD paragraph (`base.prompt.mood`) and the axis step each one names. */
const WORDS: Readonly<Record<string, readonly [Axis, CueDirection]>> = {
  brighter: ['valence', 1],
  lower: ['valence', -1],
  livelier: ['energy', 1],
  tireder: ['energy', -1],
  tenser: ['tension', 1],
  calmer: ['tension', -1],
}

const MAX_WORDS = 2
const MARKER_PREFIX = '<|MOOD'
const MARKER_SUFFIX = '|>'

/**
 * A native MOOD marker: `<|MOOD` followed by whitespace or the closing `|>`. Same detection as the cue contract
 * scorer (`qa-tools` `score/cue-contract.ts`) and the core-agent cue fixtures.
 */
export const MOOD_CUE_MARKER = /^<\|MOOD(?:\s|\|>)/

/** A well-formed MOOD cue: one direction per axis and the cleaned reason. */
export interface MoodCue {
  readonly directions: CueDirections
  readonly reason: string
}

/** The body between `<|MOOD` and `|>` of a native MOOD marker token, or `null` when the token is not one. */
export function moodCueBody(token: string): string | null {
  if (!MOOD_CUE_MARKER.test(token))
    return null
  const end = token.endsWith(MARKER_SUFFIX) ? token.length - MARKER_SUFFIX.length : token.length
  return token.slice(MARKER_PREFIX.length, end).trim()
}

function cleanReason(text: string): string {
  let cleaned = text
  // Removing one marker fragment can join two halves into a new one (`<<||`), so repeat until none is left.
  while (/<\||\|>/.test(cleaned))
    cleaned = cleaned.replace(/<\||\|>/g, '')
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, CHARACTER_STATE_SETTINGS.rendering.reasons.maxChars).trim()
}

/**
 * Parses a MOOD cue body (the text between `<|MOOD` and `|>`), grammar `w1[ w2]: reason`. The words come from
 * brighter, lower, livelier, tireder, tenser, and calmer, at most two, on different axes; a contradictory or repeated
 * pair, any other word, a missing `:`, or a reason that is empty after cleaning returns `null`. The reason loses
 * marker text (`<|`, `|>`) and line breaks and is cut to 60 characters.
 */
export function parseMoodCue(body: string): MoodCue | null {
  const colon = body.indexOf(':')
  if (colon < 0)
    return null
  const words = body.slice(0, colon).trim().split(/\s+/)
  if (words.length > MAX_WORDS)
    return null

  const directions: Record<Axis, CueDirection> = { valence: 0, energy: 0, tension: 0 }
  for (const word of words) {
    const step = Object.hasOwn(WORDS, word) ? WORDS[word] : undefined
    if (step === undefined || directions[step[0]] !== 0)
      return null
    directions[step[0]] = step[1]
  }

  const reason = cleanReason(body.slice(colon + 1))
  if (reason === '')
    return null
  return { directions, reason }
}
