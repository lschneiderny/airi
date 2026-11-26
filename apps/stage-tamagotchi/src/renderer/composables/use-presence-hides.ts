import type { PresenceHideScope, PresenceHidesState } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { onScopeDispose, shallowRef } from 'vue'

import { presenceHidesAdd, presenceHidesChanged, presenceHidesGet, presenceHidesRemove } from '../../shared/eventa'

/**
 * Drops this window's foreground reading whenever the main process changes its temporary presence hides, so the
 * situation forgets an app the user just hid. Every window calls it once, for the lifetime of its App scope.
 */
export function usePresenceHidesPolicy() {
  const foregroundWindow = useForegroundWindowStore()
  const context = useElectronEventaContext()
  const off = context.value.on(presenceHidesChanged, (event) => {
    if (event.body?.hidesChanged)
      foregroundWindow.hostPolicyChanged()
  })
  onScopeDispose(off)
}

/**
 * The temporary presence hides and the app last in front, kept current from the main process, with the actions
 * that change them.
 */
export function usePresenceHides() {
  const context = useElectronEventaContext()
  const get = useElectronEventaInvoke(presenceHidesGet)
  const addHide = useElectronEventaInvoke(presenceHidesAdd)
  const removeHide = useElectronEventaInvoke(presenceHidesRemove)
  const state = shallowRef<PresenceHidesState>({ hides: [], front: null })
  let changed = false

  // Subscribe before requesting the state: a pushed change wins over an older reply.
  const off = context.value.on(presenceHidesChanged, (event) => {
    if (!event.body)
      return
    changed = true
    state.value = { hides: event.body.hides, front: event.body.front }
  })
  onScopeDispose(off)
  void get().then((next) => {
    if (!changed)
      state.value = next
  }).catch(error => console.warn('[PresenceHides] Failed to read the presence hides:', errorMessageFrom(error) ?? 'Unknown error'))

  async function add(scope: PresenceHideScope, durationMs: number | null) {
    state.value = await addHide({ scope, durationMs })
  }

  async function remove(id: string) {
    state.value = await removeHide({ id })
  }

  return { state, add, remove }
}
