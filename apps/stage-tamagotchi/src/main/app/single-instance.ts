import type { App, BrowserWindow } from 'electron'

import { showUserFacingWindow } from '../windows/stage/identity'

interface SingleInstanceGuardOptions {
  app: App
  getWindow: () => BrowserWindow | undefined
}

/**
 * Shows the user-facing AIRI window after a duplicate launch. The classic window is focused; the desktop stage is
 * shown without focus, so the launch does not take focus from the app in front.
 *
 * Use when:
 * - Electron forwards a second process launch to the primary instance
 * - The app should show the already-running UI instead of starting another runtime
 *
 * Expects:
 * - `getWindow` returns the main user-facing window when it has been created
 *
 * Returns:
 * - N/A
 */
function focusMainWindow(getWindow: SingleInstanceGuardOptions['getWindow']) {
  const window = getWindow()
  if (!window) {
    return
  }

  showUserFacingWindow(window)
}

/**
 * Installs Electron's single-instance guard for the desktop runtime.
 *
 * Use when:
 * - Only one AIRI desktop process should own local runtime resources
 * - Fixed localhost services such as the server channel must not bind twice
 *
 * Expects:
 * - The guard is installed before `app.whenReady()` starts runtime services
 *
 * Returns:
 * - `true` for the primary process, `false` after requesting shutdown for a secondary process
 */
export function installSingleInstanceGuard(options: SingleInstanceGuardOptions) {
  const hasSingleInstanceLock = options.app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    options.app.quit()
    return false
  }

  options.app.on('second-instance', () => {
    focusMainWindow(options.getWindow)
  })

  return true
}
