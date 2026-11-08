import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { electronEvents } from '@proj-airi/electron-eventa'
import { powerMonitor } from 'electron'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

export function createPowerMonitorService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  const onSuspend = () => params.context.emit(electronEvents.powerMonitor.suspended, undefined)
  const onResume = () => params.context.emit(electronEvents.powerMonitor.resumed, undefined)
  const onLockScreen = () => params.context.emit(electronEvents.powerMonitor.lockScreen, undefined)
  const onUnlockScreen = () => params.context.emit(electronEvents.powerMonitor.unlockScreen, undefined)

  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  powerMonitor.on('lock-screen', onLockScreen)
  powerMonitor.on('unlock-screen', onUnlockScreen)

  function remove() {
    powerMonitor.off('suspend', onSuspend)
    powerMonitor.off('resume', onResume)
    powerMonitor.off('lock-screen', onLockScreen)
    powerMonitor.off('unlock-screen', onUnlockScreen)
  }

  // The listeners live on the app-wide power monitor, so they go with the
  // window that owns them. A chat mode switch recreates a window, and each
  // copy would otherwise stay subscribed until the app quits.
  // Every window runs this service, so it takes one `closed` listener for all
  // four subscriptions; one per subscription pushed each window past Node's
  // default limit of 10 listeners per event.
  const offBeforeQuit = onAppBeforeQuit(remove)
  params.window.once('closed', () => {
    remove()
    offBeforeQuit()
  })
}
