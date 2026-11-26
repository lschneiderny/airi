import type { InstalledApp } from '../../../../shared/eventa'

/** One block-list entry, with the launcher name of the installed app it names, if any. */
export interface BlockedAppRow {
  entry: string
  name: string | null
}

const sameEntry = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** The block list as rows; an entry that names an installed app shows that app's name. Patterns keep `name` `null`. */
export function blockedAppRows(entries: readonly string[], installed: readonly InstalledApp[]): BlockedAppRow[] {
  return entries.map(entry => ({ entry, name: installed.find(app => sameEntry(app.appKey, entry))?.name ?? null }))
}

/** The installed apps that the block list does not name yet. */
export function addableApps(installed: readonly InstalledApp[], entries: readonly string[]): InstalledApp[] {
  return installed.filter(app => !entries.some(entry => sameEntry(entry, app.appKey)))
}

/** The block list with `entry` added, or `null` when it is blank or the list already has it. */
export function withEntry(entries: readonly string[], entry: string): string[] | null {
  const trimmed = entry.trim()
  if (!trimmed || entries.some(existing => sameEntry(existing, trimmed)))
    return null
  return [...entries, trimmed]
}
