import process from 'node:process'

import config from 'virtual:ergosphere-it/config'

import { startLauncher } from '@ergosphere-it/electron/launcher'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { ensureSelfResponsible } from 'node-macos-disclaim'

import { isUpdaterDisabled } from '../shared/update-source'

/**
 * Makes AIRI its own TCC responsible process on macOS.
 *
 * When a terminal or Steam starts AIRI, macOS checks the privacy permissions of that launcher, not of AIRI. Screen and
 * system audio capture then gives silence, and permission prompts show the name of the launcher. The call re-execs
 * AIRI in place with the same PID. It does nothing when AIRI is already its own responsible process, for example after
 * a start from Finder or the Dock.
 *
 * Development runs keep the permissions of the terminal. The path of their Electron binary changes, so permissions
 * that macOS gave to it do not last.
 */
function becomeOwnResponsibleProcess() {
  if (!app.isPackaged)
    return

  try {
    ensureSelfResponsible()
  }
  catch (error) {
    // AIRI still works as a child of the launcher, only with the permissions of the launcher.
    console.warn(`[launcher] Cannot make AIRI its own TCC responsible process: ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
}

// Re-exec before the launcher loads a bundle, so that no update work runs twice.
becomeOwnResponsibleProcess()

// NOTICE: Electron emits `ready` only after the top-level await of its entry, so the bundle main starts before ready.
// See the custom launcher section of the @ergosphere-it/electron API reference.
// eslint-disable-next-line antfu/no-top-level-await
await startLauncher({
  ...config,
  // The main process reads this decision from the status of the updater, see `src/main/services/electron/auto-updater.ts`.
  disabled: isUpdaterDisabled(config.disabled, process),
  launcherUrl: import.meta.url,
})
