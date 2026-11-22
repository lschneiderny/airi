import type { ObjectEntries } from 'valibot'

import { safeParse } from 'valibot'

import { characterBehaviorEntries, emotionBehaviorEntries, speakingBehaviorEntries } from './schema'

// NOTICE:
// Import old behavior before narrowing its documents.
// Root cause: renderer and Presence settings owned behavior before CM7c.
// Source: packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts,
// packages/stage-ui-mmd/src/stores/natural-settings.ts, packages/stage-ui/src/features/performance/settings.ts,
// packages/stage-ui/src/features/situation/settings.ts before CM7c.
// Removal condition: one release after CM7c, alongside the pre-document Natural import; first leader startup saves it.
export function importCharacterBehaviorSettings(read: (key: string) => string | null) {
  if (read('settings/character-behavior') !== null)
    return undefined

  function json(key: string): unknown {
    const raw = read(key)
    if (raw === null)
      return undefined
    try {
      return JSON.parse(raw)
    }
    catch {
      return undefined
    }
  }

  function document(key: string): Record<string, unknown> {
    const value = json(key)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  function natural(renderer: 'live2d' | 'mmd') {
    const key = `settings/${renderer}/natural`
    if (read(key) !== null)
      return document(key)
    return {
      touch: json(`${key}-touch`),
      cursorAttention: json(`${key}-cursor-attention`),
      screenAwareness: json(`${key}-screen-awareness`),
    }
  }

  function validFields(entries: ObjectEntries, input: Record<string, unknown>) {
    const fields: Record<string, unknown> = {}
    for (const [field, schema] of Object.entries(entries)) {
      if (input[field] === undefined)
        continue
      const result = safeParse(schema, input[field])
      if (result.success)
        fields[field] = result.output
    }
    return fields
  }

  const live2d = natural('live2d')
  const mmd = natural('mmd')
  const switches: Record<string, unknown> = {}
  for (const [target, source] of [['idleActivities', 'idleActivities'], ['touchReactions', 'touch']] as const) {
    const values = [live2d[source], mmd[source]].filter(value => typeof value === 'boolean')
    if (values.length > 0)
      switches[target] = !values.includes(false)
  }
  switches.cursorAttention = live2d.cursorAttention
  switches.chatAttention = live2d.screenAwareness
  const imported = validFields(characterBehaviorEntries, switches)
  const emotion = validFields(emotionBehaviorEntries, document('settings/expression-performance'))
  const speaking = validFields(speakingBehaviorEntries, document('settings/situation'))
  if (Object.keys(emotion).length > 0)
    imported.emotion = emotion
  if (Object.keys(speaking).length > 0)
    imported.speaking = speaking
  return Object.keys(imported).length > 0 ? imported : undefined
}
