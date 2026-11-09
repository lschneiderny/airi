import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/**
 * The desktop file basename. The XDG portals identify AIRI by it, so it must equal the app id.
 * Packaged Linux builds install it through electron-builder's `syncDesktopName`.
 */
export const DESKTOP_FILE_NAME = 'ai.moeru.airi.desktop'

/** Quotes one Exec argument per the Desktop Entry Specification, including the string-value escape of backslashes. */
function quoteExecArgument(argument: string): string {
  return `"${argument.replace(/["`$\\]/g, character => `\\${character}`)}"`.replace(/\\/g, '\\\\')
}

/**
 * Writes `<data home>/applications/ai.moeru.airi.desktop` for a development build when no such file exists.
 *
 * Use when:
 * - A development build must be resolvable as `ai.moeru.airi` by the portals, which a packaged install provides itself
 *
 * Expects:
 * - `dataHome` resolved from the caller's injected environment, see {@link resolveDataHome}
 *
 * Returns:
 * - The written path, or `undefined` when a file already exists; an existing file is never replaced
 */
export async function installDevelopmentDesktopEntry(options: { dataHome: string, execPath: string, appPath: string }): Promise<string | undefined> {
  const directory = join(options.dataHome, 'applications')
  const path = join(directory, DESKTOP_FILE_NAME)
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=AIRI',
    'Comment=AIRI development build',
    `Exec=${quoteExecArgument(options.execPath)} ${quoteExecArgument(options.appPath)}`,
    'Terminal=false',
    'NoDisplay=true',
    'StartupWMClass=ai.moeru.airi',
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
