import type { LlmStreamingControlParser, LlmStreamingControlTokenAct } from '../types'

import { normalizeActPayload } from '../payloads'

const actTokenPrefix = '<|ACT '
const actColonTokenPrefix = '<|ACT:'
const markerSuffix = '|>'
const intensityBands = new Set(['slight', 'clear', 'strong'])
const intensityNumberPattern = /^(?:\d+(?:\.\d+)?|\.\d+)$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Creates the parser for `<|ACT {...}|>` streaming-control tokens.
 *
 * Use when:
 * - Loading the built-in performance action control
 *
 * Expects:
 * - The token body is a JSON object literal after `<|ACT `
 * - Or a bare emotion word with an optional intensity band or number after `<|ACT ` or `<|ACT:`,
 *   for example `<|ACT happy|>`, `<|ACT:sad 0.3|>`, or `<|ACT sleepy slight|>`
 *
 * Returns:
 * - Parsed action data with no side effects; undefined when the token is not valid
 */
export function tokenAct(): LlmStreamingControlParser<LlmStreamingControlTokenAct> {
  return {
    name: 'ACT',
    match(special) {
      const trimmed = special.trim()
      return (trimmed.startsWith(actTokenPrefix) || trimmed.startsWith(actColonTokenPrefix))
        && trimmed.endsWith(markerSuffix)
    },
    parse(special) {
      const trimmed = special.trim()
      const isColonForm = trimmed.startsWith(actColonTokenPrefix)
      const rawPayload = trimmed
        .slice((isColonForm ? actColonTokenPrefix : actTokenPrefix).length, -markerSuffix.length)
        .trim()

      if (rawPayload.startsWith('{')) {
        if (isColonForm) {
          return undefined
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(rawPayload)
        }
        catch {
          return undefined
        }

        if (!isPlainObject(parsed)) {
          return undefined
        }

        return {
          type: 'act',
          payload: parsed,
        }
      }

      const [name = '', intensity, ...rest] = rawPayload.split(/\s+/)
      if (!name || rest.length > 0) {
        return undefined
      }

      if (intensity !== undefined && !intensityBands.has(intensity.toLowerCase()) && !intensityNumberPattern.test(intensity)) {
        return undefined
      }

      const payload = {
        emotion: {
          name,
          ...(intensity !== undefined && {
            intensity: intensityNumberPattern.test(intensity) ? Number(intensity) : intensity,
          }),
        },
      }

      // Validates the word against the supported emotion set without exporting it.
      if (!normalizeActPayload(payload).emotion) {
        return undefined
      }

      return {
        type: 'act',
        payload,
      }
    },
  }
}
