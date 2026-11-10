import type { InferOutput, ObjectEntries, StrictObjectSchema } from 'valibot'

import { check, parse, pipe, safeParse, strictObject, unknown } from 'valibot'
import { shallowRef, toRaw } from 'vue'

import { useLocalStorageManualReset } from '../use-local-storage-manual-reset'

export type SettingsDocument<TEntries extends ObjectEntries> = InferOutput<StrictObjectSchema<TEntries, undefined>>

export interface UseSettingsDocumentOptions {
  /** Names the document in console warnings, for example `live2d-natural-settings`. */
  label: string
  /**
   * Raw field values to start from while nothing is stored under the key. They pass the same per-field validation as
   * a stored document. `reset` ignores them and writes the schema defaults.
   */
  initial?: () => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Holds one validated settings document and its private localStorage copy.
 *
 * Use when:
 * - A synced Pinia store owns a user-facing settings document (tier 1 of
 *   `docs/ai/adr/2026-11-01-persistence-tiers.md`). Return `document`, `update`, and `reset` from the store setup, and
 *   list `update` and `reset` under `synced.actions`, so only the leader writes storage.
 *
 * Expects:
 * - Every entry of `entries` accepts `undefined` and supplies a default, so `{}` parses to the default document.
 * - The document supports `structuredClone`.
 *
 * Returns:
 * - `document`: replaced as a whole on every change, never mutated in place.
 * - `update(patch)`: merges the patch over the document one level deep, validates, then commits and persists. An
 *   invalid patch changes nothing and returns the issues.
 * - `reset()`: commits and persists the schema defaults.
 *
 * localStorage is outside the app's control, so each stored field is validated on its own: an invalid field falls
 * back to its default while valid siblings survive, and unknown fields are dropped. Storage changes from other
 * windows are not observed; replication is the synced store's job.
 */
export function useSettingsDocument<const TEntries extends ObjectEntries>(key: string, entries: TEntries, options: UseSettingsDocumentOptions) {
  // Valibot objects accept arrays; the settings document must be a record.
  const schema = pipe(unknown(), check(isRecord, 'Expected a settings object'), strictObject(entries))
  type Document = SettingsDocument<TEntries>

  function sanitize(stored: unknown): Document {
    if (!isRecord(stored)) {
      console.warn(`[${options.label}] Stored settings are not an object; using defaults`)
      return parse(schema, {})
    }

    const document: Record<string, unknown> = {}
    const invalid: string[] = []
    for (const [field, fieldSchema] of Object.entries(entries)) {
      const result = safeParse(fieldSchema, stored[field])
      if (result.success)
        document[field] = result.output
      else
        invalid.push(field)
    }
    if (invalid.length > 0)
      console.warn(`[${options.label}] Invalid stored fields reset to defaults:`, invalid.join(', '))
    return parse(schema, document)
  }

  function readStored(raw: string): Document {
    let stored: unknown
    try {
      stored = JSON.parse(raw)
    }
    catch {
      stored = undefined
    }
    return sanitize(stored)
  }

  // Persistence is private: applying a remote snapshot never writes back into
  // synchronized state or persists an uncommitted follower proposal.
  const persisted = useLocalStorageManualReset<Document>(key, () => sanitize(options.initial?.() ?? {}), {
    listenToStorageChanges: false,
    writeDefaults: false,
    flush: 'sync',
    serializer: {
      read: readStored,
      write: value => JSON.stringify(value),
    },
  })
  const document = shallowRef<Document>(structuredClone(toRaw(persisted.value)))

  async function update(patch: Partial<Document>) {
    const candidate = isRecord(patch) ? { ...structuredClone(toRaw(document.value)), ...patch } : patch
    const result = safeParse(schema, candidate)
    if (!result.success)
      return { success: false as const, issues: result.issues }

    document.value = result.output
    persisted.value = result.output
    return { success: true as const }
  }

  async function reset() {
    const value = parse(schema, {})
    document.value = value
    persisted.value = value
  }

  return { document, update, reset }
}
