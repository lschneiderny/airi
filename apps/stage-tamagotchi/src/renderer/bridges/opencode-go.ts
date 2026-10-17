import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'
import { createOpenCodeGoDesktopProvider } from '@proj-airi/stage-ui/libs/providers/providers/opencode-go/index'
import { defineProvider } from '@proj-airi/stage-ui/libs/providers/providers/registry'

import { GoClient } from './opencode-go-client'

let client: GoClient | undefined

/** Install before provider stores initialize. Every renderer gets its own IPC context. */
export function installGoNetwork(): GoClient {
  if (!isElectronWindow(window))
    throw new TypeError('OpenCode Go desktop transport requires an Electron window')
  const adapter = createContext(window.electron.ipcRenderer)
  client = new GoClient(adapter.context)
  defineProvider(createOpenCodeGoDesktopProvider(client))
  window.addEventListener('beforeunload', () => adapter.dispose(), { once: true })
  return client
}

export function getGoClient(): GoClient {
  if (!client)
    throw new Error('OpenCode Go desktop transport has not initialized')
  return client
}
