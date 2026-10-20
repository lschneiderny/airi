import { normalizeActPayload, tokenAct, tokenDelay } from '@proj-airi/pipelines-audio'

const actParser = tokenAct()
const delayParser = tokenDelay()

function performs(special: string): boolean {
  if (delayParser.match(special))
    return delayParser.parse(special) !== undefined
  if (!actParser.match(special))
    return false
  const token = actParser.parse(special)
  return token !== undefined && Object.keys(normalizeActPayload(token.payload)).length > 0
}

/**
 * Decides whether a near-miss cue rewritten by `useLlmmarkerParser` is accepted as a cue.
 *
 * Use when:
 * - Handling a recovered special in the parser's `onSpecial`. Returning `false` there keeps the raw text spoken.
 *
 * Expects:
 * - `special` is the canonical `<|NAME body|>` form and `raw` is the text the model wrote.
 *
 * Returns:
 * - `false` for a square-bracket near-miss whose body is not a valid DELAY duration or an ACT payload naming a known
 *   emotion, look, motion, or expression. Prose such as "[Act 2]" therefore stays spoken verbatim.
 * - `true` otherwise.
 */
export function acceptsRecoveredCue(special: string, raw: string): boolean {
  // NOTICE:
  // Angle-bracket near-misses are always accepted, even with an invalid body.
  // Spoken as literal text, `<ACT banana>` opens a tag that hides later live speech.
  // Source: `createStreamingCategorizer` in `./response-categoriser`.
  // Removal condition: that categorizer stops treating unknown `<word>` text as a tag.
  if (!raw.startsWith('['))
    return true
  return performs(special)
}
