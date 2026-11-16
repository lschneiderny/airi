import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/**
 * The Linux app id. The XDG portals and the compositor identify AIRI by the desktop file `<app id>.desktop`.
 *
 * A packaged build uses `ai.moeru.airi`, whose desktop file electron-builder installs through `syncDesktopName`.
 * A development build has its own id, because a desktop file in the user's data home replaces a system one of the
 * same name: a shared id would let the hidden development entry remove an installed AIRI from the application menu.
 */
export function resolveLinuxAppId(development: boolean): string {
  return development ? 'ai.moeru.airi.dev' : 'ai.moeru.airi'
}

/** Quotes one Exec argument per the Desktop Entry Specification, including the string-value escape of backslashes. */
function quoteExecArgument(argument: string): string {
  return `"${argument.replace(/["`$\\]/g, character => `\\${character}`)}"`.replace(/\\/g, '\\\\')
}

/**
 * Writes `<data home>/applications/ai.moeru.airi.dev.desktop` for a development build when no such file exists.
 *
 * Use when:
 * - A development build must be resolvable by its app id by the portals, which a packaged install provides itself
 *
 * Expects:
 * - `dataHome` resolved from the caller's injected environment, see {@link resolveDataHome}
 *
 * Returns:
 * - The written path, or `undefined` when a file already exists; an existing file is never replaced
 */
export async function installDevelopmentDesktopEntry(options: { dataHome: string, execPath: string, appPath: string }): Promise<string | undefined> {
  const appId = resolveLinuxAppId(true)
  const directory = join(options.dataHome, 'applications')
  const path = join(directory, `${appId}.desktop`)
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=AIRI',
    'Comment=AIRI development build',
    `Exec=${quoteExecArgument(options.execPath)} ${quoteExecArgument(options.appPath)}`,
    'Terminal=false',
    'NoDisplay=true',
    `StartupWMClass=${appId}`,
    '',
  ].join('\n')

  await mkdir(directory, { recursive: true })
  try {
    await writeFile(path, entry, { flag: 'wx' })
    return path
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      return undefined
    throw error
  }
}

/** `$XDG_DATA_HOME`, or `~/.local/share` when it is unset or relative, as the XDG Base Directory Specification requires. */
export function resolveDataHome(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const dataHome = env.XDG_DATA_HOME
  return dataHome && isAbsolute(dataHome) ? dataHome : join(home, '.local', 'share')
}
