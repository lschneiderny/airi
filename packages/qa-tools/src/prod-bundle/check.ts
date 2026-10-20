import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Strings that exist only in the dev-only motion QA bridge: its globals, its Eventa contract ids, and its installer. */
export const motionQaBundleMarkers = ['__airiMotionQa', 'motion-qa:', 'installMotionQaDispatcher'] as const

export interface BundleLeak {
  file: string
  marker: string
  /** Character offset of the match; production bundles are minified, so line numbers say little. */
  offset: number
  excerpt: string
}

/** Lists every marker occurrence in one file's text. */
export function findBundleLeaks(file: string, text: string): BundleLeak[] {
  const leaks: BundleLeak[] = []
  for (const marker of motionQaBundleMarkers) {
    for (let offset = text.indexOf(marker); offset !== -1; offset = text.indexOf(marker, offset + marker.length))
      leaks.push({ file, marker, offset, excerpt: text.slice(Math.max(0, offset - 40), offset + marker.length + 40) })
  }
  return leaks
}

/**
 * Scans every `.js` file under `root`, recursively.
 *
 * Returns the scanned file count with the leaks, so a caller can refuse an empty scan: a missing or empty build
 * directory must not read as a clean bundle.
 */
export async function scanBundle(root: string): Promise<{ files: number, leaks: BundleLeak[] }> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.js')).map(entry => join(entry.parentPath, entry.name))
  const leaks: BundleLeak[] = []
  for (const file of files)
    leaks.push(...findBundleLeaks(file, await readFile(file, 'utf8')))
  return { files: files.length, leaks }
}
