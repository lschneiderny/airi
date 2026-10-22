import { basename, delimiter, dirname, extname, join } from 'node:path'

export interface ResolvedCommand {
  /** Full path of a batch shim, which only cmd.exe can run. Undefined for a directly spawnable program. */
  shim?: string
  /** True for npm-style shims in node_modules/.bin, which re-parse their arguments a second time. */
  doubleEscape?: boolean
}

const batchExtensions = new Set(['.cmd', '.bat'])
const nativeExtensions = new Set(['.exe', '.com'])

/** Windows resolves a bare name through PATHEXT; only .cmd/.bat results need cmd.exe. */
export function resolveWin32Command(
  command: string,
  pathValue: string,
  pathExt = '.COM;.EXE;.BAT;.CMD',
  exists: (path: string) => boolean = () => false,
): ResolvedCommand {
  const extension = extname(command).toLowerCase()
  const explicit = nativeExtensions.has(extension) || batchExtensions.has(extension)
  const hasDirectory = basename(command) !== command
  const directories = hasDirectory ? [dirname(command)] : pathValue.split(delimiter).filter(Boolean)
  const names = explicit ? [basename(command)] : pathExt.split(';').filter(Boolean).map(ext => `${basename(command)}${ext.toLowerCase()}`)
  for (const directory of directories) {
    for (const name of names) {
      const file = join(directory, name)
      if (!exists(file))
        continue
      const found = extname(file).toLowerCase()
      if (!batchExtensions.has(found))
        return {}
      return { shim: file, doubleEscape: /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file) }
    }
  }
  return explicit && batchExtensions.has(extension) ? { shim: command } : {}
}

// Escaping follows cross-spawn (https://qntm.org/cmd): quote for the program's own parser, then
// caret-escape every cmd.exe metacharacter so nothing is expanded or run by the shell.

const metaCharacters = /([()\][%!^"`<>&|;, *?])/g

function caretEscape(value: string, times: number): string {
  let escaped = value
  for (let i = 0; i < times; i++)
    escaped = escaped.replace(metaCharacters, '^$1')
  return escaped
}

/** The single command string to hand to `cmd.exe /d /s /c "<string>"` with verbatim arguments. */
export function shimCommandLine(shim: string, args: string[], doubleEscape = false): string {
  const times = doubleEscape ? 2 : 1
  const quoted = args.map((arg) => {
    const inner = arg
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/, '$1$1')
    return caretEscape(`"${inner}"`, times)
  })
  return [caretEscape(shim, times), ...quoted].join(' ')
}
