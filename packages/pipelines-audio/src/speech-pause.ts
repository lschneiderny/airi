import { tokenBreak, tokenDelay } from './llm-streaming-control/parsers'

const breakParser = tokenBreak()
const delayParser = tokenDelay()

/**
 * Returns how long a special holds the ordered speech track, in seconds.
 *
 * Use when:
 * - The speech pipeline decides how long the next clip or marker waits after a special
 *
 * Returns:
 * - The pause of a well-formed BREAK or of a valid DELAY, each clamped by its parser
 * - 0 for any other special, a malformed BREAK or DELAY included
 */
export function speechPauseSeconds(special: string | null): number {
  if (!special)
    return 0

  const parser = [breakParser, delayParser].find(candidate => candidate.match(special))
  return parser?.parse(special)?.seconds ?? 0
}

/**
 * Whether text written before `special` must be spoken before it: every special that pauses the
 * speech track, and a malformed BREAK, which still splits the reply.
 */
export function endsSpeechBeforeSpecial(special: string): boolean {
  return breakParser.match(special) || speechPauseSeconds(special) > 0
}
