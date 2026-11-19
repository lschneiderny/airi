import type { DynamicSite } from './lib/storage-writes'

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkStorageWrites, findStorageWrites, readStateRegistry, repositoryReader } from './lib/storage-writes'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** `pnpm verify` runs this test when a scanned file or the registry changes (`fileGuards` in `verify-plan.ts`). */
const registryPath = 'packages/stage-ui/src/persistence/state-registry.ts'
const scanned = /^(?:packages\/[^/]+\/src|apps\/stage-tamagotchi\/src\/renderer)\/.+\.(?:ts|vue)$/
const notScanned = [
  /\.test\.ts$/,
  /\.stories\.(?:ts|vue)$/,
  /\.story\.vue$/,
  /\/src\/test\//,
  // The helpers that the scan treats as write sites; their callers are the sites.
  /^packages\/stage-shared\/src\/composables\/use-[^/]*(?:storage|settings-document)[^/]*\//,
  // The registry sweeps every location.
  new RegExp(`^${registryPath}$`),
  // QA drivers seed the app's storage from outside, through Playwright or CDP.
  /^packages\/(?:qa-tools|scenarios-[^/]+|vishot-[^/]+)\//,
]

/**
 * Sites whose key the scan cannot resolve, or whose prefix no single location covers, by file. A new entry needs the
 * registration it belongs to and a reason; a site that a constant can express should use one.
 */
const dynamicSites: DynamicSite[] = [
  { file: 'packages/stage-ui/src/stores/modules/consciousness-settings.ts', registration: 'consciousness-settings', reason: 'Writes `settings/consciousness/<setting>` for each setting that its caller hands it.' },
  { file: 'packages/stage-ui/src/stores/modules/gaming-module-factory.ts', registration: 'factorio', reason: 'Builds `settings/<module>/...` keys from the module name that the factory takes.' },
]

function scannedFiles(): string[] {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages', 'apps/stage-tamagotchi/src/renderer'], { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`git ls-files failed: ${result.stderr || result.error?.message}`)
  return result.stdout.split('\n').filter(path => scanned.test(path) && !notScanned.some(pattern => pattern.test(path)))
}

describe('renderer storage writes', () => {
  it('writes only keys that a registration owns, from the files it names as writers', () => {
    const read = repositoryReader(repoRoot)
    const registry = readStateRegistry(readFileSync(join(repoRoot, registryPath), 'utf8'))
    const sites = scannedFiles().flatMap(path => findStorageWrites(path, read(path) ?? '', read))

    expect(sites.length).toBeGreaterThan(0)
    expect(checkStorageWrites(sites, registry, dynamicSites)).toEqual([])
  })
})
