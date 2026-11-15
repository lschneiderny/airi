import type { ManualResetRefReturn, UseStorageOptions } from '@vueuse/core'
import type { MaybeRefOrGetter, WatchOptions } from 'vue'

import { refManualReset, useLocalStorage } from '@vueuse/core'
import { toRaw, toValue, watch } from 'vue'

export function useLocalStorageManualReset<T>(
  key: MaybeRefOrGetter<string>,
  initialValue: MaybeRefOrGetter<T>,
  options?: UseStorageOptions<T> & WatchOptions,
): ManualResetRefReturn<T> {
  // The storage ref wraps its default in a deep reactive proxy, so in-place
  // writes such as `state.value.x = 1` change that object. A getter returns a
  // new value on each call. Other values are copied.
  const copyInitialValue = (): T => typeof initialValue === 'function'
    ? toValue(initialValue)
    : structuredClone(toRaw(toValue(initialValue)))

  const localStorageState = useLocalStorage<T>(key, copyInitialValue(), options)
  const state = refManualReset<T>(localStorageState)

  // `refManualReset` resets to its source, and the source is the storage ref.
  // So write the default to storage first. The state then reads the reactive
  // proxy back, and later in-place writes still reach storage.
  const resetToStoredValue = state.reset
  state.reset = () => {
    localStorageState.value = copyInitialValue()
    resetToStoredValue()
  }

  // Both copies are synchronous, so the state and the storage ref never differ across a tick. A copy that waited for
  // the tick let `reset()`'s default overwrite a value assigned right after the reset, and let the storage ref's own
  // write, which pauses its watcher until the next tick, drop the newer value.
  const sync = { ...options, flush: 'sync' } as const
  const { resume, pause } = watch(state, newValue => localStorageState.value = newValue, sync)
  if (options?.listenToStorageChanges !== false) {
    watch(localStorageState, (newValue) => {
      // Writing state to useStorage updates this ref with the same value. A
      // manual ref triggers even when assigned the same reference, so reflecting
      // that write would publish a second Pinia mutation. Only storage-originated
      // values need to cross this boundary.
      if (toRaw(newValue) === toRaw(state.value))
        return

      pause()
      state.value = newValue
      resume()
    }, sync)
  }

  return state
}
