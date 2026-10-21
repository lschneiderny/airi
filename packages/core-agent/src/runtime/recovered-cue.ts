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
 * - Handling a recovered special in the parser's `onSpecial`. Returning `false` there keeps the raw text spoken,
 *   unless {@link stripsRecoveredCue} marks it as markup to strip.
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

/**
 * Decides whether a square-bracket near-miss cue that is not a valid cue is markup to strip instead of prose to speak.
 *
 * Use when:
 * - {@link acceptsRecoveredCue} turned a recovered special down. Accepting that special in `onSpecial` without
 *   performing it removes the raw text from speech and from the text handed to `onEnd`.
 *
 * Expects:
 * - `special` is the canonical `<|NAME body|>` form and `raw` is the text the model wrote.
 *
 * Returns:
 * - `true` when `raw` names `ACT` or `DELAY` in upper case after `[`, the body is no valid payload, and the cue has
 *   one of these marker shapes. Prose does not take them.
 *   - The body is empty or starts with `{`, directly or after a `:` right behind the name, such as
 *     `[ACT {"emotion":"happy",}]`, `[ACT]`, `[ACT:{"emotion":"happy",}]` or `[DELAY:]`.
 *   - A `DELAY` body starts with a digit, such as `[DELAY 1s]`, `[DELAY 0]` or `[DELAY 2 seconds]`.
 *   - A line break follows `ACT` directly, such as `[ACT\nhappy]`.
 * - `false` otherwise. Prose such as "[Act 2]", "[ACT 2]" or "[ACT calm]" stays spoken verbatim.
 */
export function stripsRecoveredCue(special: string, raw: string): boolean {
  const name = /^\[\|?(ACT|DELAY)/.exec(raw)?.[1]
  if (!name || performs(special))
    return false
  if (/^\[\|?ACT[\r\n]/.test(raw))
    return true
  const rest = special.slice(`<|${name}`.length, -'|>'.length)
  const colon = rest.startsWith(':')
  const body = (colon ? rest.slice(1) : rest).trim()
  if (body === '' || body.startsWith('{'))
    return true
  // A digit-led ACT body stays spoken, because "In [ACT 2] she leaves" is screenplay prose.
  return !colon && name === 'DELAY' && /^\d/.test(body)
}
