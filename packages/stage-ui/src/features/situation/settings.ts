import type { SettingsDocument } from '@proj-airi/stage-shared/composables'
import type {} from 'pinia-plugin-synced'

import { isElectronWindow } from '@proj-airi/stage-shared'
import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { uniq } from 'es-toolkit'
import { defineStore } from 'pinia'
import { array, boolean, optional, parse, pipe, strictObject, string, transform } from 'valibot'

import { useCharacterBehaviorSettings } from '../character-behavior/settings'

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
  /**
   * App-name globs the character never sees. The Electron main process drops a foreground reading of these apps
   * before it reaches a renderer, so their name, category, and window title appear in no situation, prompt, or log.
   * An entry matches the executable or bundle name with or without `.exe`/`.app`, and on Linux also the window
   * class and the desktop file name.
   */
  blockedApps: appPatterns(platform => BLOCKED_APP_DEFAULTS[platform ?? ''] ?? []),
  /** False hides the chat cue that marks an unprompted turn. @default true */
  showUnpromptedCue: optional(boolean(), true),
}

export type SituationSettings = SettingsDocument<typeof situationSettingsEntries>

export function defaultSituationSettings(): SituationSettings {
  return parse(strictObject(situationSettingsEntries), {})
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

/** Replicates one presence settings document; only leader-routed commands persist changes. */
export const useSituationSettings = defineStore('situation-settings', () => {
  const behavior = useCharacterBehaviorSettings()
  const settings = useSettingsDocument('settings/situation', situationSettingsEntries, { label: 'situation-settings' })

  async function update(patch: Partial<SituationSettings>) {
    await behavior.initialize()
    return settings.update(patch)
  }

  async function reset() {
    await behavior.initialize()
    await settings.reset()
  }

  return { document: settings.document, update, reset }
}, {
  synced: {
    state: true,
    actions: ['update', 'reset'],
  },
})
