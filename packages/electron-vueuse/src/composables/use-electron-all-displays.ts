import { defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { useAsyncState, useIntervalFn } from '@vueuse/core'

import { useElectronEventaContext } from './use-electron-eventa-context'

export function useElectronAllDisplays() {
  const context = useElectronEventaContext()
  const getAllDisplays = defineInvoke(context.value, electron.screen.getAllDisplays)
  // A refresh is not a display removal: keep the completed snapshot until IPC answers.
  const { state: allDisplays, execute } = useAsyncState(() => getAllDisplays(), [], { resetOnExecute: false })

  useIntervalFn(() => {
    void execute()
  }, 5000)

  return allDisplays
}
