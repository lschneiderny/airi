import { readFileSync } from 'node:fs'
import { env } from 'node:process'

import { defineConfig } from '@ergosphere-it/electron/config'

// Node loads this file with type stripping, which resolves only full file names.
// eslint-disable-next-line no-restricted-syntax
import { channelOfVersion } from './src/shared/update-channels.ts'
// eslint-disable-next-line no-restricted-syntax
import { updateSourceFromEnv } from './src/shared/update-source.ts'

// CI names each build in `ERGOSPHERE_IT_VERSION`, for example `0.13.1-nightly.12.13eef81`. The build uses the same name.
const version = env.ERGOSPHERE_IT_VERSION
  || (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

// Fork departure from upstream: the fork has no release store, so a build never takes upstream's bundles. No feed and
// no key is built in, and updates are off unless the build sets both, see `updateSourceFromEnv`. Flatpak, Nix, and
// macOS are known only at runtime, see src/launcher/index.ts.
const updateSource = updateSourceFromEnv(env)

export default defineConfig({
  // The app can switch to another channel at run time, see `src/main/services/electron/auto-updater.ts`.
  channel: env.AIRI_UPDATE_CHANNEL || channelOfVersion(version),
  disabled: updateSource.disabled,
  feedUrl: updateSource.feedUrl,
  // 3: requires an installer with Electron 43.8.4 to fix CVE-2026-111497. Bundle updates cannot replace Electron.
  nativeVersion: 3,
  publicKeys: updateSource.publicKeys,
})
