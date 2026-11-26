import type { InstalledApp } from '../../../shared/eventa'

import process from 'node:process'

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'

/** One installed app, with the window class its desktop file declares (Linux only). */
export interface InstalledAppEntry extends InstalledApp {
  windowClass: string | null
}

/** Values of the `[Desktop Entry]` group that decide whether and how a launcher lists the app. */
function desktopEntry(text: string): { name: string | null, listed: boolean, windowClass: string | null } {
  let inEntry = false
  const values = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    const separator = line.indexOf('=')
    if (!inEntry || line.startsWith('#') || separator <= 0)
      continue
    const key = line.slice(0, separator).trim()
    if (!values.has(key))
      values.set(key, line.slice(separator + 1).trim())
  }
  const name = values.get('Name') || null
  const listed = values.get('Type') === 'Application' && values.get('NoDisplay') !== 'true' && values.get('Hidden') !== 'true'
  return { name, listed, windowClass: values.get('StartupWMClass') || null }
}

/**
 * The `applications` folders of the XDG base directories, most important first: `XDG_DATA_HOME`, then each
 * `XDG_DATA_DIRS` entry. Flatpak and Snap add their export folders to `XDG_DATA_DIRS`.
 */
export function linuxApplicationDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share')
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)
  return [dataHome, ...dataDirs].map(dir => join(dir, 'applications'))
}

/**
 * Lists the apps a Linux launcher shows, by desktop file id (`org.kde.konsole` for `org/kde/konsole.desktop` or
 * `org.kde.konsole.desktop`). KWin reports the same id as the window's desktop file name, so the id is the
 * block-list entry. The first folder that has an id wins, also when its entry hides the app. `windowClass` is the
 * entry's `StartupWMClass`, the class of a window that reports no desktop file name.
 */
export async function readLinuxApps(dirs: readonly string[]): Promise<InstalledAppEntry[]> {
  const seen = new Set<string>()
  const apps: InstalledAppEntry[] = []
  for (const dir of dirs) {
    let files: string[]
    try {
      files = await readdir(dir, { recursive: true })
    }
    catch {
      // A missing or unreadable folder lists nothing.
      continue
    }
    for (const file of files.filter(file => file.endsWith('.desktop')).sort()) {
      const id = file.slice(0, -'.desktop'.length).split(posix.sep).join('-')
      if (seen.has(id))
        continue
      seen.add(id)
      let text: string
      try {
        text = await readFile(join(dir, file), 'utf8')
      }
      catch {
        continue
      }
      const entry = desktopEntry(text)
      if (entry.listed)
        apps.push({ name: entry.name ?? id, appKey: id, windowClass: entry.windowClass })
    }
  }
  return apps
}

/** The `.app` bundles in the folders Launchpad lists; the bundle file name is the block-list entry. */
export async function readDarwinApps(dirs: readonly string[]): Promise<InstalledAppEntry[]> {
  const seen = new Set<string>()
  const apps: InstalledAppEntry[] = []
  for (const dir of dirs) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    }
    catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app') || seen.has(entry.toLowerCase()))
        continue
      seen.add(entry.toLowerCase())
      apps.push({ name: entry.slice(0, -'.app'.length), appKey: entry, windowClass: null })
    }
  }
  return apps
}

function darwinApplicationDirs(home: string): string[] {
  return ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', join(home, 'Applications')]
}

let cached: Promise<InstalledApp[]> | undefined
let names: Map<string, string> | undefined
let idsByClass = new Map<string, string[]>()

/**
 * The installed apps of this host, sorted by name, read once per run. Windows has no reader yet and lists none,
 * because no check runs there (docs/ai/context/testing.md#platforms).
 */
export function listInstalledApps(): Promise<InstalledApp[]> {
  cached ??= (async () => {
    const home = homedir()
    const entries = process.platform === 'linux'
      ? await readLinuxApps(linuxApplicationDirs(process.env, home))
      : process.platform === 'darwin'
        ? await readDarwinApps(darwinApplicationDirs(home))
        : []
    // Two installs of one app, such as a Flatpak and a system package, can declare the same class.
    idsByClass = new Map()
    for (const app of entries) {
      if (app.windowClass)
        idsByClass.set(app.windowClass.toLowerCase(), [...idsByClass.get(app.windowClass.toLowerCase()) ?? [], app.appKey])
    }
    const apps = entries.map(({ name, appKey }) => ({ name, appKey }))
    apps.sort((left, right) => left.name.localeCompare(right.name))
    names = new Map(apps.map(app => [app.appKey.toLowerCase(), app.name]))
    return apps
  })().catch((error) => {
    useLogg('installed-apps').useGlobalConfig().warn(`installed apps are unavailable: ${errorMessageFrom(error) ?? 'unknown error'}`)
    names = new Map()
    return []
  })
  return cached
}

/** The launcher name of an installed app by its block-list entry, or `null` before the list loaded or for an unknown app. */
export function installedAppName(appKey: string): string | null {
  if (!names) {
    void listInstalledApps()
    return null
  }
  return names.get(appKey.toLowerCase()) ?? null
}

/**
 * The desktop file ids of the installed apps whose entries declare this window class (`StartupWMClass`). Empty before
 * {@link listInstalledApps} resolved, or when no entry declares the class.
 */
export function desktopIdsForClass(windowClass: string): readonly string[] {
  return idsByClass.get(windowClass.toLowerCase()) ?? []
}
