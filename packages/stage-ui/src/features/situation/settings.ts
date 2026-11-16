import type {} from 'pinia-plugin-synced'
import type { InferOutput } from 'valibot'

import { isElectronWindow } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { withoutAppExtension } from '@proj-airi/stage-shared/situation'
import { clamp, isPlainObject, uniq } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, boolean, check, number, optional, parse, pipe, safeParse, strictObject, string, transform, unknown } from 'valibot'
import { shallowRef, toRaw } from 'vue'

/**
 * Trims app-name glob entries and drops blank or repeated ones, so a newline-separated draft stores only usable
 * patterns. `defaultsFor` picks the default entries of the host platform; it never changes a user list.
 */
function appPatterns(defaultsFor: (platform: string | undefined) => readonly string[]) {
  return optional(
    pipe(array(string()), transform(entries => uniq(entries.map(entry => entry.trim()).filter(entry => entry !== '')))),
    () => [...defaultsFor(typeof window !== 'undefined' && isElectronWindow(window) ? window.platform : undefined)],
  )
}

/** Quiet-app defaults have explicit suffixes; a host keeps the entries whose suffix it strips. */
const QUIET_APP_DEFAULTS = ['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex*.exe', 'zoom.us.app', 'Microsoft Teams.app', 'FaceTime.app', 'Webex*.app']

/**
 * Password managers and keyrings, per host. Linux entries are wildcards because the block list is matched against
 * the executable, the window class, and the desktop file name, which spell one app differently
 * (`keepassxc`, `org.keepassxc.KeePassXC`). A host without a foreground reader has no defaults.
 */
const BLOCKED_APP_DEFAULTS: Record<string, readonly string[]> = {
  win32: ['1password*.exe', 'keepass*.exe', 'bitwarden.exe', 'keepassxc.exe'],
  darwin: ['1Password*.app', 'Bitwarden.app', 'KeePassXC.app', 'Passwords.app', 'Keychain Access.app'],
  linux: ['*1password*', '*keepass*', '*bitwarden*', '*kwallet*', '*seahorse*', 'org.gnome.World.Secrets', '*proton*pass*', '*enpass*'],
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
  /**
   * True adds the window title to each foreground reading. While false, the Electron main process answers with an
   * empty title, so the situation and the prompt carry the app name and category only. The opportunity gate reads
   * the category, never the title, so it decides the same either way. Has no effect while `shareForegroundWindow`
   * is false. @default true
   */
  shareWindowTitles: optional(boolean(), true),
  /**
   * False ignores everything the AIRI web extension sends (page and video titles, links, subtitles, and video
   * notifications), and the leader's situation forgets what it already sent. Independent of
   * `shareForegroundWindow`. @default true
   */
  shareBrowserActivity: optional(boolean(), true),
  /** Foreground app-name globs (Windows `.exe`, macOS `.app`) during which the character stays quiet. */
  quietApps: appPatterns(platform => QUIET_APP_DEFAULTS.filter(pattern => withoutAppExtension(pattern, platform) !== pattern)),
  /**
   * App-name globs the character never sees. The Electron main process drops a foreground reading of these apps
   * before it reaches a renderer, so their name, category, and window title appear in no situation, prompt, or log.
   * An entry matches the executable or bundle name with or without `.exe`/`.app`, and on Linux also the window
   * class and the desktop file name.
   */
  blockedApps: appPatterns(platform => BLOCKED_APP_DEFAULTS[platform ?? ''] ?? []),
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
 * What a host's foreground read may return under these settings; the Electron producer sends it with every read.
 * A reader that holds an earlier reading watches {@link foregroundReadPolicyKey} and drops the reading when it
 * changes, because that reading may name an app that is blocked now or carry a title that is no longer shared.
 */
export function foregroundReadPolicy(settings: Pick<SituationSettings, 'blockedApps' | 'shareWindowTitles'>) {
  return { blockedApps: [...settings.blockedApps], includeTitle: settings.shareWindowTitles }
}

/**
 * The read policy as one comparable value. Every holder of a foreground reading watches this same key, so they all
 * agree on when the policy changed. Every settings update replaces the document, also when another field changed,
 * so the document itself cannot be compared.
 */
export function foregroundReadPolicyKey(settings: Pick<SituationSettings, 'blockedApps' | 'shareWindowTitles'>): string {
  return JSON.stringify(foregroundReadPolicy(settings))
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
