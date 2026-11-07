import type { Plugin, ResolvedConfig } from 'vite'

import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Downloads through the same SDK implementation as both app Vite plugins, without starting Vite. */
export async function setupCubism(
  repoRoot: string,
  force: boolean,
  download?: (appRoot: string) => Promise<void>,
): Promise<string[]> {
  const messages: string[] = []
  for (const app of ['stage-tamagotchi', 'stage-web']) {
    const appRoot = join(repoRoot, 'apps', app)
    const core = join(appRoot, 'public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js')
    if (!force && existsSync(core)) {
      messages.push(`skip apps/${app}: Cubism Core already exists`)
      continue
    }
    // Clear incomplete copies too: the SDK hook checks directories rather than the Core file.
    for (const parent of ['public', '.cache'])
      rmSync(join(appRoot, parent, 'assets/js/CubismSdkForWeb-5-r.3'), { recursive: true, force: true })
    if (download) {
      await download(appRoot)
    }
    else {
      const require = createRequire(join(appRoot, 'package.json'))
      const sdk: { DownloadLive2DSDK: () => Plugin }
        = await import(pathToFileURL(require.resolve('@proj-airi/unplugin-live2d-sdk')).href)
      const plugin = sdk.DownloadLive2DSDK()
      // NOTICE:
      // Run the SDK download without starting Vite or an app.
      // The package exposes only a configResolved hook, which reads only config.root.
      // Source: node_modules/@proj-airi/unplugin-live2d-sdk/dist/vite/index.cjs.
      // Remove this cast when the package exports a standalone download function.
      const downloadHook = plugin.configResolved as (config: Pick<ResolvedConfig, 'root'>) => Promise<void>
      await downloadHook({ root: appRoot })
    }
    messages.push(`downloaded apps/${app}`)
  }
  return messages
}
