import process from 'node:process'

import config from 'virtual:ergosphere-it/config'

import { startLauncher } from '@ergosphere-it/electron/launcher'

import { isUpdaterDisabled } from '../shared/update-source'

// NOTICE: Electron emits `ready` only after the top-level await of its entry, so the bundle main starts before ready.
// See the custom launcher section of the @ergosphere-it/electron API reference.
// eslint-disable-next-line antfu/no-top-level-await
await startLauncher({
  ...config,
  // The main process reads this decision from the status of the updater, see `src/main/services/electron/auto-updater.ts`.
  disabled: isUpdaterDisabled(config.disabled, process),
  launcherUrl: import.meta.url,
})
