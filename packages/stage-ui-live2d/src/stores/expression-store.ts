import type { ExpressionDefinition } from '../composables/live2d/expression/compose'

import { errorMessageFrom } from '@moeru/std'
import { parseRestSet } from '@proj-airi/stage-shared/expression-performance'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { ExpressionComposer } from '../composables/live2d/expression/compose'

export interface NamedExpressionDefinition extends ExpressionDefinition {
  name: string
}

/** Target activation state; fading releases remain owned by the composer until zero. */
export interface Live2DExpressionSettingsSnapshot {
  groups: { id: string, name: string, active: boolean }[]
}

export type Live2DExpressionSettingsCommand
  = | { type: 'toggle', id: string }
    | { type: 'save-defaults' }
    | { type: 'reset-all' }

/** Local to the renderer that owns the model. Other windows use snapshots and commands. */
export const useExpressionStore = defineStore('live2d-expressions', () => {
  const definitions = ref<NamedExpressionDefinition[]>([])
  const modelId = ref('')
  const restSet = ref<string[]>([])
  // Current non-transient targets, including rest entries until manually toggled off.
  const manualActive = ref<string[]>([])
  const composer = markRaw(new ExpressionComposer())

  const settingsSnapshot = computed<Live2DExpressionSettingsSnapshot>(() => ({
    groups: definitions.value.map(definition => ({
      id: definition.id,
      name: definition.name,
      active: manualActive.value.includes(definition.id),
    })),
  }))

  function registerDefinitions(id: string, defs: NamedExpressionDefinition[]) {
    modelId.value = id
    definitions.value = defs
    restSet.value = []
    composer.define(defs)
    try {
      const raw = localStorage.getItem(`expression-rest:${id}`)
      if (raw !== null) {
        const parsed = parseRestSet(JSON.parse(raw))
        if (parsed.success)
          restSet.value = [...new Set(parsed.value.active)].filter(activeId => defs.some(def => def.id === activeId))
        else
          console.warn('[expression-store] Invalid rest set:', parsed.issues)
      }
    }
    catch (error) {
      console.warn('[expression-store] Failed to load rest set:', errorMessageFrom(error))
    }
    manualActive.value = [...restSet.value]
    composer.setActiveSet(manualActive.value, performance.now() / 1000)
  }

  function activate(id: string) {
    if (!definitions.value.some(def => def.id === id) || manualActive.value.includes(id))
      return
    manualActive.value = [...manualActive.value, id]
    composer.activate(id, performance.now() / 1000)
  }

  function deactivate(id: string) {
    manualActive.value = manualActive.value.filter(activeId => activeId !== id)
    composer.deactivate(id, performance.now() / 1000)
  }

  function toggle(id: string) {
    if (manualActive.value.includes(id))
      deactivate(id)
    else
      activate(id)
  }

  function saveDefaults() {
    if (!modelId.value)
      return
    restSet.value = [...manualActive.value]
    try {
      localStorage.setItem(`expression-rest:${modelId.value}`, JSON.stringify({ version: 1, active: restSet.value }))
    }
    catch (error) {
      console.warn('[expression-store] Failed to save rest set:', errorMessageFrom(error))
    }
  }

  function resetAll() {
    manualActive.value = [...restSet.value]
    composer.setActiveSet(manualActive.value, performance.now() / 1000)
  }

  function dispose() {
    composer.restoreBases(() => {})
    definitions.value = []
    modelId.value = ''
    restSet.value = []
    manualActive.value = []
    composer.define([])
  }

  function applySettingsCommand(command: Live2DExpressionSettingsCommand) {
    switch (command.type) {
      case 'toggle':
        return toggle(command.id)
      case 'save-defaults':
        return saveDefaults()
      case 'reset-all':
        return resetAll()
    }
  }

  return { definitions, modelId, restSet, manualActive, composer, settingsSnapshot, registerDefinitions, activate, deactivate, toggle, saveDefaults, resetAll, dispose, applySettingsCommand }
})
