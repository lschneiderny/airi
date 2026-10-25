import type { AppCategory } from './types'

/** Longest normalized title, in code points, including the trailing ellipsis. Tuning: lower to save prompt budget. */
export const WINDOW_TITLE_MAX_CHARS = 120

/** App names that browsers and editors append to every window title. */
const KNOWN_TITLE_SUFFIXES = [
  'Mozilla Firefox',
  'Firefox',
  'Visual Studio Code',
  'Google Chrome',
  'Microsoft Edge',
  'Brave',
  'Opera',
  'Vivaldi',
]

/** Separator (hyphen, en dash, em dash) at the end of the text left after removing the app name. */
const TRAILING_SEPARATOR = /\s+[-\u2013\u2014]\s*$/u

/** Unsaved-file markers that editors add before or after the file name. */
const UNSAVED_PREFIX = /^[*\u25CF\u2022]+\s*/u
const UNSAVED_SUFFIX = /\s*[*\u25CF\u2022]+$/u

/** Zero-width and control characters. Edge, for one, puts U+200B inside "Microsoft Edge". */
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/gu

function stripTrailingAppName(title: string, appNames: readonly string[]): string {
  // Only the last segment is removed, so "a - b - Google Chrome" keeps "a - b".
  const lowered = title.toLowerCase()
  for (const name of appNames) {
    const lowerName = name.toLowerCase()
    if (!lowerName || !lowered.endsWith(lowerName))
      continue
    const head = title.slice(0, title.length - name.length)
    const separator = TRAILING_SEPARATOR.exec(head)
    if (separator && separator.index > 0)
      return head.slice(0, separator.index)
  }
  return title
}

/**
 * Turns a raw foreground window title into a short, prompt-safe description.
 *
 * Removes invisible characters, collapses whitespace, strips unsaved markers
 * (`*`, `●`, `•`) and the trailing app name (known browser and editor names,
 * plus ` - <appLabel>`), then caps the result at {@link WINDOW_TITLE_MAX_CHARS}
 * code points. Returns `null` when nothing useful is left, including a title
 * that is only the app's own name.
 */
export function normalizeWindowTitle(title: string | null | undefined, appLabel: string): string | null {
  if (typeof title !== 'string')
    return null

  const appNames = [...KNOWN_TITLE_SUFFIXES, appLabel.replace(INVISIBLE_CHARS, '').trim()]
  let text = title.replace(INVISIBLE_CHARS, ' ').replace(/\s+/gu, ' ').trim()

  // Repeat until stable: "● file.ts - Visual Studio Code" needs both the marker and the suffix removed.
  for (let previous = ''; previous !== text;) {
    previous = text
    text = stripTrailingAppName(text, appNames)
    text = text.replace(UNSAVED_PREFIX, '').replace(UNSAVED_SUFFIX, '').trim()
  }

  if (!text || appNames.some(name => name && name.toLowerCase() === text.toLowerCase()))
    return null

  const codePoints = Array.from(text)
  if (codePoints.length <= WINDOW_TITLE_MAX_CHARS)
    return text
  return `${codePoints.slice(0, WINDOW_TITLE_MAX_CHARS - 1).join('').trimEnd()}\u2026`
}

/** File name of an executable path. Accepts `\` and `/` separators. */
function basenameOf(exePath: string): string {
  const parts = exePath.trim().split(/[\\/]/u)
  return parts[parts.length - 1] ?? ''
}

/** Removes a Windows executable or macOS bundle extension, including from a settings glob. */
export function withoutAppExtension(fileName: string): string {
  return fileName.replace(/\.(?:exe|app)$/iu, '')
}

/**
 * Stable app id: the lowercased file name without `.exe` or `.app`, for example
 * `C:\Program Files\Zoom\bin\Zoom.exe` => `zoom`. Returns `''` for an empty path.
 */
export function appIdFromExe(exePath: string): string {
  return withoutAppExtension(basenameOf(exePath)).toLowerCase()
}

/**
 * Display name: the file name without `.exe` or `.app`, with the first letter of each
 * word (split on spaces, `-`, `_`, `.`) upper-cased, for example `ms-teams` => `Ms-Teams`.
 * Dotted bundle names keep this casing too: `zoom.us.app` becomes `Zoom.Us`.
 */
export function labelFromExe(exePath: string): string {
  return withoutAppExtension(basenameOf(exePath))
    .replace(/(^|[\s\-_.])(\p{Ll})/gu, (_, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`)
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`, 'iu')
}

/**
 * Whether an executable is on the title denylist. Matching is case-insensitive
 * against the file name (a full path is reduced to its file name), and `*` in a
 * pattern matches any run of characters, so `1password*.exe` matches `1Password.exe`.
 */
export function isDenylisted(exeName: string, denylist: readonly string[]): boolean {
  const fileName = basenameOf(exeName)
  if (!fileName)
    return false
  return denylist.some((pattern) => {
    const trimmed = pattern.trim()
    return trimmed !== '' && globToRegExp(trimmed).test(fileName)
  })
}

/**
 * Install folders whose executables are games, compared case-insensitively
 * against the path with `/` normalized to `\`.
 */
const GAME_PATH_MARKERS = [
  'steamapps\\common',
  'epic games',
  'gog galaxy\\games',
  'riot games',
  'battle.net',
]

/** App ids (see {@link appIdFromExe}) per category. Tuning: add executables users report as `other`. */
const CATEGORY_BY_APP_ID: Readonly<Record<string, AppCategory>> = Object.freeze({
  'chrome': 'browser',
  'msedge': 'browser',
  'firefox': 'browser',
  'brave': 'browser',
  'opera': 'browser',
  'vivaldi': 'browser',
  'safari': 'browser',
  'google chrome': 'browser',
  'arc': 'browser',
  'microsoft edge': 'browser',
  'code': 'editor',
  'cursor': 'editor',
  'idea64': 'editor',
  'devenv': 'editor',
  'sublime_text': 'editor',
  'notepad++': 'editor',
  'visual studio code': 'editor',
  'xcode': 'editor',
  'zed': 'editor',
  'vlc': 'media',
  'mpc-hc64': 'media',
  'spotify': 'media',
  'music': 'media',
  'quicktime player': 'media',
  'iina': 'media',
  'discord': 'chat',
  'slack': 'chat',
  'telegram': 'chat',
  'whatsapp': 'chat',
  'messages': 'chat',
  'zoom': 'call',
  'ms-teams': 'call',
  'teams': 'call',
  'webex': 'call',
  'zoom.us': 'call',
  'microsoft teams': 'call',
  'facetime': 'call',
})

/**
 * Category of a foreground app. A path inside a known game library folder is a
 * `game`; otherwise the executable name decides; anything unknown is `other`.
 * `exeName` falls back to the file name of `exePath` when empty.
 */
export function categorizeApp(exePath: string, exeName: string): AppCategory {
  const path = exePath.replace(/\//gu, '\\').toLowerCase()
  if (GAME_PATH_MARKERS.some(marker => path.includes(marker)))
    return 'game'

  const appId = appIdFromExe(exeName.trim() || exePath)
  return Object.hasOwn(CATEGORY_BY_APP_ID, appId) ? CATEGORY_BY_APP_ID[appId] : 'other'
}
