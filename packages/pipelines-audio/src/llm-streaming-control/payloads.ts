/**
 * Supported emotion values emitted through ACT tokens.
 *
 * Keep this list synchronized with renderer/runtime support.
 */
const emotionValues = [
  'happy',
  'sad',
  'angry',
  'think',
  'surprised',
  'awkward',
  'question',
  'curious',
  'neutral',
  'love',
  'flustered',
  'sleepy',
] as const

/** Constant-time membership lookup. */
const emotionSet = new Set<string>(emotionValues)

export type StreamingControlEmotion = (typeof emotionValues)[number]

/**
 * Where an ACT cue directs the character's gaze: at the user, at their screen, or away.
 */
export type StreamingControlLook = 'you' | 'screen' | 'away'

/** Accepted `look` words; `camera` and `aside` are synonyms the model may use. */
const lookValues: ReadonlyMap<string, StreamingControlLook> = new Map([
  ['you', 'you'],
  ['camera', 'you'],
  ['screen', 'screen'],
  ['away', 'away'],
  ['aside', 'away'],
])

export interface StreamingControlEmotionPayload {
  /** Canonical normalized emotion. */
  name: StreamingControlEmotion
  /** Emotion strength in range [0–1]. */
  intensity: number
}

export interface NormalizedActPayload {
  /** Emotion request emitted by the model, when present and supported. */
  emotion?: StreamingControlEmotionPayload
  /** Motion cue emitted by the model, when present. */
  motion?: string
  /** Expression label for the consumer to resolve; never matched or evaluated here. */
  expression?: string
  /** Gaze direction emitted by the model, when present and supported. */
  look?: StreamingControlLook
}

/**
 * Converts arbitrary emotion text into canonical emotion.
 *
 * Examples:
 * - "Surprised" → "surprised"
 * - " HAPPY " → "happy"
 */
function normalizeEmotionName(
  value: string,
): StreamingControlEmotion | undefined {
  const normalized = value.trim().toLowerCase()

  return emotionSet.has(normalized)
    ? (normalized as StreamingControlEmotion)
    : undefined
}

/**
 * Normalizes intensity into [0, 1].
 *
 * Missing or invalid values mean clear strength (0.6).
 * Numeric strings are accepted because streaming payloads can serialize numbers.
 */
function normalizeIntensity(value: unknown): number {
  if (typeof value === 'string') {
    const band = value.trim().toLowerCase()
    if (band === 'slight')
      return 0.25
    if (band === 'clear')
      return 0.6
    if (band === 'strong')
      return 0.9
    if (!band)
      return 0.6
  }

  const numeric
    = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numeric)) {
    return 0.6
  }

  return Math.max(0, Math.min(1, numeric))
}

/**
 * Converts arbitrary emotion payload into normalized structure.
 *
 * Supported:
 * - "happy"
 * - { name: "happy" }
 * - { name: "happy", intensity: 0.8 }
 *
 * A bare string emotion takes `flatIntensity` (the payload's top-level
 * `intensity`); a nested `intensity` always wins over it.
 */
function normalizeEmotion(
  value: unknown,
  flatIntensity?: unknown,
): StreamingControlEmotionPayload | undefined {
  if (typeof value === 'string') {
    const name = normalizeEmotionName(value)

    return name
      ? {
          name,
          intensity: normalizeIntensity(flatIntensity),
        }
      : undefined
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const normalizedValue = value as {
    name?: unknown
    intensity?: unknown
  }

  const name
    = typeof normalizedValue.name === 'string'
      ? normalizeEmotionName(normalizedValue.name)
      : undefined

  if (!name) {
    return undefined
  }

  return {
    name,
    intensity: normalizeIntensity(normalizedValue.intensity),
  }
}

/**
 * Trims motion cues and expression labels without interpreting their contents.
 *
 * Empty strings become undefined.
 */
function normalizeCue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()

  return normalized.length > 0
    ? normalized
    : undefined
}

/**
 * Converts a `look` word into a canonical direction; unknown words are dropped.
 *
 * Examples:
 * - " Camera " -> "you"
 * - "aside" -> "away"
 * - "ceiling" -> undefined
 */
function normalizeLook(value: unknown): StreamingControlLook | undefined {
  if (typeof value !== 'string')
    return undefined

  return lookValues.get(value.trim().toLowerCase())
}

/**
 * Normalizes ACT token payloads.
 *
 * Input:
 * {
 *   emotion: "Surprised",
 *   motion: " nod "
 * }
 *
 * Output:
 * {
 *   emotion: {
 *     name: "surprised",
 *     intensity: 0.6
 *   },
 *   motion: "nod"
 * }
 */
export function normalizeActPayload(
  payload: Record<string, unknown>,
): NormalizedActPayload {
  const emotion = normalizeEmotion(payload.emotion, payload.intensity)
  const motion = normalizeCue(payload.motion)
  const expression = normalizeCue(payload.expression)
  const look = normalizeLook(payload.look)

  return {
    ...(emotion && { emotion }),
    ...(motion && { motion }),
    ...(expression && { expression }),
    ...(look && { look }),
  }
}
