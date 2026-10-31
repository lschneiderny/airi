import type { LlmStreamingControlParser, LlmStreamingControlTokenBreak } from '../types'

const breakTokenPrefix = '<|BREAK'
const markerSuffix = '|>'
const defaultBreakSeconds = 1
const minimumBreakSeconds = 0.3
const maximumBreakSeconds = 3

/**
 * Creates the parser for `<|BREAK|>` and `<|BREAK n|>` streaming-control tokens.
 *
 * Use when:
 * - Loading the built-in pause between two parts of one reply, for example two chat bubbles
 *
 * Expects:
 * - No body, or a plain decimal number of seconds after one space
 *
 * Returns:
 * - `{ type: 'break', seconds, explicit }` with `seconds` clamped to 0.3-3.0 and 1.0 when no body
 *   is written; `explicit` is true when the model wrote the duration
 * - undefined for any other body, so the controller reports it as parse-failed
 */
export function tokenBreak(): LlmStreamingControlParser<LlmStreamingControlTokenBreak> {
  return {
    name: 'BREAK',
    match(special) {
      const trimmed = special.trim()
      if (!trimmed.startsWith(breakTokenPrefix) || !trimmed.endsWith(markerSuffix))
        return false

      // `<|BREAKFAST|>` names another token; only a separator or the closer may follow the name.
      return !/\w/.test(trimmed.charAt(breakTokenPrefix.length))
    },
    parse(special) {
      const trimmed = special.trim()
      const rawPayload = trimmed.slice(breakTokenPrefix.length, -markerSuffix.length).trim()
      if (!rawPayload) {
        return {
          type: 'break',
          seconds: defaultBreakSeconds,
          explicit: false,
        }
      }

      if (!/^\d+(?:\.\d+)?$/.test(rawPayload))
        return undefined

      return {
        type: 'break',
        seconds: Math.max(minimumBreakSeconds, Math.min(maximumBreakSeconds, Number.parseFloat(rawPayload))),
        explicit: true,
      }
    },
  }
}
