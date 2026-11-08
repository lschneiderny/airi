import { errorMessageFrom } from '@moeru/std'
import { electron, electronEvents } from '@proj-airi/electron-eventa'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { onScopeDispose } from 'vue'

/** Keeps this window's capabilities current for the lifetime of its App scope. */
export function useHostCapabilitiesProducer() {
  const store = useHostCapabilitiesStore()
  const context = useElectronEventaContext()
  const get = useElectronEventaInvoke(electron.hostCapabilities.get)
  let changed = false
  let disposed = false
  // Subscribe before requesting the snapshot: a runtime change wins over an older reply.
  const off = context.value.on(electronEvents.hostCapabilities.changed, (event) => {
    if (!event.body)
      return
    changed = true
    store.set(event.body)
  })
  onScopeDispose(() => {
    disposed = true
    off()
  })
  void get().then((snapshot) => {
    if (!changed && !disposed)
      store.set(snapshot)
  }).catch(error => console.warn('[HostCapabilities] Failed to read the host snapshot:', errorMessageFrom(error)))
}
