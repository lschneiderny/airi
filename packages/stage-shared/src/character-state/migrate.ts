import type { AdvanceContext, CharacterProfile, CharacterStateRecordV1 } from './types'

import { parse, safeParse } from 'valibot'

import { initialCharacterState } from './reducer'
import { CHARACTER_STATE_SETTINGS } from './settings'
import { CharacterStateRecordSchema } from './types'

const { stepMs } = CHARACTER_STATE_SETTINGS.temperament

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns a stored value into a valid record of `cardId`. A version 1 record is validated field by field: an invalid or
 * missing top-level field falls back to its value in a fresh {@link initialCharacterState}, valid siblings survive, and
 * unknown fields are dropped. The record is always stored under `cardId` (an imported record keeps its new card's
 * id), and the temperament cursor is floored to the epoch hour it must lie on. Anything else, including a future
 * version, returns a fresh initial state. This is the only place that reads older or foreign record shapes.
 */
export function migrateCharacterState(value: unknown, cardId: string, profile: CharacterProfile, ctx: AdvanceContext): CharacterStateRecordV1 {
  const fresh = initialCharacterState(cardId, profile, ctx)
  if (!isPlainObject(value) || value.version !== 1)
    return fresh

  const document: Record<string, unknown> = {}
  for (const [field, schema] of Object.entries(CharacterStateRecordSchema.entries)) {
    const result = safeParse(schema, value[field])
    document[field] = result.success ? result.output : fresh[field as keyof CharacterStateRecordV1]
  }
  const record = parse(CharacterStateRecordSchema, { ...document, cardId })
  return {
    ...record,
    temperament: { ...record.temperament, throughHourMs: Math.floor(record.temperament.throughHourMs / stepMs) * stepMs },
  }
}
