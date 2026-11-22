import type { SettingsDocument } from '@proj-airi/stage-shared/composables'

import { isElectronWindow } from '@proj-airi/stage-shared'
import { EmotionBehaviorSettingsSchema } from '@proj-airi/stage-shared/expression-performance'
import { withoutAppExtension } from '@proj-airi/stage-shared/situation'
import { clamp, uniq } from 'es-toolkit'
import { array, boolean, check, number, optional, parse, pipe, strictObject, string, transform, unknown } from 'valibot'

/** Quiet-app defaults have explicit suffixes; a host keeps the entries whose suffix it strips. */
const quietAppDefaults = ['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex*.exe', 'zoom.us.app', 'Microsoft Teams.app', 'FaceTime.app', 'Webex*.app']

export const speakingBehaviorEntries = {
  unpromptedEnabled: optional(boolean(), true),
  chattiness: optional(pipe(number(), transform(value => clamp(value, 0, 1))), 0.5),
  dontDisturb: optional(boolean(), false),
  quietApps: optional(
    pipe(array(string()), transform(entries => uniq(entries.map(entry => entry.trim()).filter(Boolean)))),
    () => {
      const platform = typeof window !== 'undefined' && isElectronWindow(window) ? window.platform : undefined
      return quietAppDefaults.filter(pattern => withoutAppExtension(pattern, platform) !== pattern)
    },
  ),
  speakDuringGames: optional(boolean(), true),
}

const speakingSchema = pipe(
  unknown(),
  check(value => !Array.isArray(value), 'Expected a speaking settings object'),
  strictObject(speakingBehaviorEntries),
)

export const characterBehaviorEntries = {
  idleActivities: optional(boolean(), true),
  touchReactions: optional(boolean(), true),
  cursorAttention: optional(boolean(), true),
  chatAttention: optional(boolean(), true),
  emotion: optional(EmotionBehaviorSettingsSchema, () => parse(EmotionBehaviorSettingsSchema, {})),
  speaking: optional(speakingSchema, () => parse(speakingSchema, {})),
}

export type CharacterBehaviorSettings = SettingsDocument<typeof characterBehaviorEntries>

export function defaultCharacterBehaviorSettings(): CharacterBehaviorSettings {
  return parse(strictObject(characterBehaviorEntries), {})
}
