import type {} from 'pinia-plugin-synced'
import type { InferOutput } from 'valibot'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { ConversationRegisterSchema, TEXTING_FLAVORS } from '@proj-airi/stage-shared/conversation-register'
import { isPlainObject } from 'es-toolkit'
import { defineStore } from 'pinia'
import { check, optional, parse, picklist, pipe, safeParse, strictObject, unknown } from 'valibot'
import { shallowRef, toRaw } from 'vue'

const conversationSettingsEntries = {
  /** Whether the character speaks aloud or writes like a chat message. @default 'talking' */
  register: optional(ConversationRegisterSchema, 'talking'),
  /** Texting style; only read while `register` is `'texting'`. @default 'plain' */
  textingFlavor: optional(picklist(TEXTING_FLAVORS), 'plain'),
}

// Valibot objects accept arrays; the settings document must be a record.
const ConversationSettingsSchema = pipe(unknown(), check(isPlainObject, 'Expected a settings object'), strictObject(conversationSettingsEntries))

export type ConversationSettings = InferOutput<typeof ConversationSettingsSchema>

export function defaultConversationSettings(): ConversationSettings {
  return parse(ConversationSettingsSchema, {})
}

/**
 * localStorage is outside the app's control, so each stored field is validated on its own: an invalid field falls
 * back to its default while a valid sibling survives, and unknown fields are dropped.
 */
function readStoredConversationSettings(raw: string): ConversationSettings {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    stored = undefined
  }
  if (!isPlainObject(stored)) {
    console.warn('[conversation-settings] Stored settings are not an object; using defaults')
    return defaultConversationSettings()
  }

  const document: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const [field, schema] of Object.entries(conversationSettingsEntries)) {
    const result = safeParse(schema, stored[field])
    if (result.success)
      document[field] = result.output
    else
      invalid.push(field)
  }
  if (invalid.length > 0)
    console.warn('[conversation-settings] Invalid stored fields reset to defaults:', invalid.join(', '))
  return parse(ConversationSettingsSchema, document)
}

/** Replicates one conversation settings document; only leader-routed commands persist changes. */
export const useConversationSettings = defineStore('conversation-settings', () => {
  // Persistence is private: applying a remote snapshot never writes back into
  // synchronized state or persists an uncommitted follower proposal.
  const persisted = useLocalStorageManualReset<ConversationSettings>('settings/conversation', defaultConversationSettings, {
    listenToStorageChanges: false,
    writeDefaults: false,
    flush: 'sync',
    serializer: {
      read: readStoredConversationSettings,
      write: value => JSON.stringify(value),
    },
  })
  const document = shallowRef(structuredClone(toRaw(persisted.value)))

  async function update(patch: Partial<ConversationSettings>) {
    const candidate = isPlainObject(patch) ? { ...structuredClone(toRaw(document.value)), ...patch } : patch
    const result = safeParse(ConversationSettingsSchema, candidate)
    if (!result.success)
      return { success: false as const, issues: result.issues }

    document.value = result.output
    persisted.value = result.output
    return { success: true as const }
  }

  async function reset() {
    const value = defaultConversationSettings()
    document.value = value
    persisted.value = value
  }

  return { document, update, reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
