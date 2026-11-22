import type {} from 'pinia-plugin-synced'

import type { CharacterBehaviorSettings } from './schema'

import { useSettingsDocument } from '@proj-airi/stage-shared/composables'
import { mergeWith } from 'es-toolkit'
import { defineStore } from 'pinia'
import { toRaw } from 'vue'

import { importCharacterBehaviorSettings } from './import'
import { characterBehaviorEntries } from './schema'

export { defaultCharacterBehaviorSettings } from './schema'
export type { CharacterBehaviorSettings } from './schema'

type SettingsPatch<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? SettingsPatch<T[K]> : T[K] }

/** One user's decision settings. Only acknowledged leader commands write storage. */
export const useCharacterBehaviorSettings = defineStore('character-behavior-settings', () => {
  const imported = typeof localStorage === 'undefined' ? undefined : importCharacterBehaviorSettings(key => localStorage.getItem(key))
  let needsImport = imported !== undefined
  const settings = useSettingsDocument('settings/character-behavior', characterBehaviorEntries, {
    label: 'character-behavior-settings',
    initial: () => imported,
  })

  /** Startup calls this before any old document can be narrowed by a write. Repeated calls have no side effects. */
  async function initialize() {
    if (!needsImport)
      return
    if (localStorage.getItem('settings/character-behavior') === null)
      await settings.update({})
    needsImport = false
  }

  async function update(patch: SettingsPatch<CharacterBehaviorSettings>) {
    const merged = mergeWith(structuredClone(toRaw(settings.document.value)), patch, (_target, source) => Array.isArray(source) ? source : undefined)
    const result = await settings.update(merged)
    if (result.success)
      needsImport = false
    return result
  }

  async function reset() {
    await settings.reset()
    // A later initialization must not resurrect the document after Delete all data sweeps its key.
    needsImport = false
  }

  return { document: settings.document, initialize, update, reset }
}, {
  synced: { state: true, actions: ['initialize', 'update', 'reset'] },
})
