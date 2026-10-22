import type {} from 'pinia-plugin-synced'
import type { InferOutput } from 'valibot'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { clamp, isPlainObject, uniq } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, boolean, check, number, optional, parse, pipe, safeParse, strictObject, string, transform, unknown } from 'valibot'
import { shallowRef, toRaw } from 'vue'

/** Trims exe-name glob entries and drops blank or repeated ones, so a newline-separated draft stores only usable patterns. */
function exePatterns(defaults: readonly string[]) {
  return optional(
    pipe(array(string()), transform(entries => uniq(entries.map(entry => entry.trim()).filter(entry => entry !== '')))),
    () => [...defaults],
  )
}

const situationSettingsEntries = {
  /** False keeps the character from starting a turn on its own. @default true */
  unpromptedEnabled: optional(boolean(), true),
  /** How readily the character speaks unprompted, from 0 (rarely) to 1 (often); out-of-range numbers are clamped. @default 0.5 */
  chattiness: optional(pipe(number(), transform(value => clamp(value, 0, 1))), 0.5),
  /** True suppresses unprompted turns until the user turns it off. @default false */
  dontDisturb: optional(boolean(), false),
  /**
   * False stops reading the user's foreground app and window title: the Electron host stops sampling, and the situation
   * keeps no app, title, or app category. The opportunity gate then holds as it does on a host without a foreground
   * reader, so the character stops speaking up on her own until it is true again. @default true
   */
  shareForegroundWindow: optional(boolean(), true),
  /** Foreground exe-name globs during which the character stays quiet. */
  quietApps: exePatterns(['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex*.exe']),
  /** Foreground exe-name globs whose window titles are never recorded. */
  titleDenylist: exePatterns(['1password*.exe', 'keepass*.exe', 'bitwarden.exe', 'keepassxc.exe']),
  /** False hides the chat cue that marks an unprompted turn. @default true */
  showUnpromptedCue: optional(boolean(), true),
  /** False keeps the character quiet while a game is in the foreground, except for urgent notifications. @default true */
  speakDuringGames: optional(boolean(), true),
}

// Valibot objects accept arrays; the settings document must be a record.
const SituationSettingsSchema = pipe(unknown(), check(isPlainObject, 'Expected a settings object'), strictObject(situationSettingsEntries))

export type SituationSettings = InferOutput<typeof SituationSettingsSchema>

export function defaultSituationSettings(): SituationSettings {
  return parse(SituationSettingsSchema, {})
}

/**
 * localStorage is outside the app's control, so each stored field is validated on its own: an invalid field falls
 * back to its default while valid siblings survive, and unknown fields are dropped.
 */
function readStoredSituationSettings(raw: string): SituationSettings {
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  }
  catch {
    stored = undefined
  }
  if (!isPlainObject(stored)) {
    console.warn('[situation-settings] Stored settings are not an object; using defaults')
    return defaultSituationSettings()
  }

  const document: Record<string, unknown> = {}
  const invalid: string[] = []
  for (const [field, schema] of Object.entries(situationSettingsEntries)) {
    const result = safeParse(schema, stored[field])
    if (result.success)
      document[field] = result.output
    else
      invalid.push(field)
  }
  if (invalid.length > 0)
    console.warn('[situation-settings] Invalid stored fields reset to defaults:', invalid.join(', '))
  return parse(SituationSettingsSchema, document)
}

/** Replicates one presence settings document; only leader-routed commands persist changes. */
export const useSituationSettings = defineStore('situation-settings', () => {
  // Persistence is private: applying a remote snapshot never writes back into
  // synchronized state or persists an uncommitted follower proposal.
  const persisted = useLocalStorageManualReset<SituationSettings>('settings/situation', defaultSituationSettings, {
    listenToStorageChanges: false,
    writeDefaults: false,
    flush: 'sync',
    serializer: {
      read: readStoredSituationSettings,
      write: value => JSON.stringify(value),
    },
  })
  const document = shallowRef(structuredClone(toRaw(persisted.value)))

  async function update(patch: Partial<SituationSettings>) {
    const candidate = isPlainObject(patch) ? { ...structuredClone(toRaw(document.value)), ...patch } : patch
    const result = safeParse(SituationSettingsSchema, candidate)
    if (!result.success)
      return { success: false as const, issues: result.issues }

    document.value = result.output
    persisted.value = result.output
    return { success: true as const }
  }

  async function reset() {
    const value = defaultSituationSettings()
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
