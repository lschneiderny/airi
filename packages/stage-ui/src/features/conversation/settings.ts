import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { ConversationRegisterSchema, TEXTING_FLAVORS } from '@proj-airi/stage-shared/conversation-register'
import { defineStore } from 'pinia'
import { optional, parse, picklist, strictObject } from 'valibot'

const conversationSettingsEntries = {
  /** Whether the character speaks aloud or writes like a chat message. @default 'talking' */
  register: optional(ConversationRegisterSchema, 'talking'),
  /** Texting style; only read while `register` is `'texting'`. @default 'plain' */
  textingFlavor: optional(picklist(TEXTING_FLAVORS), 'plain'),
}

export type ConversationSettings = SettingsDocument<typeof conversationSettingsEntries>

export function defaultConversationSettings(): ConversationSettings {
  return parse(strictObject(conversationSettingsEntries), {})
}

/** Replicates one conversation settings document; only leader-routed commands persist changes. */
export const useConversationSettings = defineStore('conversation-settings', () => {
  const settings = useSettingsDocument('settings/conversation', conversationSettingsEntries, { label: 'conversation-settings' })

  return { document: settings.document, update: settings.update, reset: settings.reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
