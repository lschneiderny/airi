import { posix, win32 } from 'node:path'

export interface PerfDirsHost {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: string
}

/**
 * The perf directories the desktop app writes by default, `<userData>/perf`. Electron names userData after the
 * app's package.json `productName`, else its `name`, and neither build sets `productName`: `pnpm dev` uses
 * `@proj-airi/stage-tamagotchi`, and packaged builds use `ai.moeru.airi`, which electron-builder `extraMetadata`
 * writes as `name`. Apps started with `APP_USER_DATA_PATH` or `AIRI_PERF_DIR` need `--dir`.
 */
export function defaultPerfDirs(host: PerfDirsHost): string[] {
  const path = host.platform === 'win32' ? win32 : posix
  const configDir = (() => {
    switch (host.platform) {
      case 'darwin':
        return path.join(host.homedir, 'Library', 'Application Support')
      case 'win32':
        return host.env.APPDATA?.trim() || path.join(host.homedir, 'AppData', 'Roaming')
      default:
        // Electron uses the XDG config dir on Linux and the other Unix platforms.
        return host.env.XDG_CONFIG_HOME?.trim() || path.join(host.homedir, '.config')
    }
  })()
  return [path.join(configDir, '@proj-airi', 'stage-tamagotchi', 'perf'), path.join(configDir, 'ai.moeru.airi', 'perf')]
}
