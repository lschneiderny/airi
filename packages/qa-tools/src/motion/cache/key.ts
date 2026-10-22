import process from 'node:process'

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The runtime facts a result depends on; injectable so tests need no real toolchain. */
export interface RuntimeIdentity {
  node: string
  platform: string
  arch: string
  vitestVersion: string
  /** sha256 of the raw `vitest/package.json`: content rather than path, so another worktree's virtual store still matches. */
  vitestManifestSha: string
}

export interface CacheKeyInput {
  repoRoot: string
  /** Canonical, JSON-serializable arguments: target, level, selection (emotion order as given), bands, seeds, sections. */
  args: unknown
  /** The environment as the child sees it after the CLI's overrides. It is filtered here. */
  env: NodeJS.ProcessEnv
  gateFileSha: string
  runtime?: RuntimeIdentity
}

const keyEnvPattern = /^(?:QA_|VITE_|VITEST_)/
const keyEnvNames = new Set(['NODE_OPTIONS', 'NODE_ENV', 'TZ'])
const rootFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']

export function sha256Bytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** `QA_RUN_DIR` differs on every run by design, so it never enters the key. Names are upper-cased: Windows env names are case-insensitive. */
export function pickKeyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const name of Object.keys(env).sort()) {
    const value = env[name]
    const upper = name.toUpperCase()
    if (value === undefined || upper === 'QA_RUN_DIR')
      continue
    if (keyEnvPattern.test(upper) || keyEnvNames.has(upper))
      picked[upper] = value
  }
  return picked
}

function hashFileOrAbsent(path: string): string {
  return existsSync(path) ? sha256Bytes(readFileSync(path)) : 'absent'
}

function listFiles(dir: string, prefix: string): string[] {
  if (!existsSync(dir))
    return []
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(entry => entry.isDirectory()
      ? listFiles(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join(prefix, entry.name)])
}

/** Raw-byte hashes of the install-level inputs: lockfile, workspace file, root manifest, and every patch. */
export function hashInstallInputs(repoRoot: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const file of rootFiles)
    hashes[file] = hashFileOrAbsent(join(repoRoot, file))
  for (const file of listFiles(join(repoRoot, 'patches'), 'patches'))
    hashes[file] = hashFileOrAbsent(join(repoRoot, file))
  return hashes
}

export function currentRuntimeIdentity(): RuntimeIdentity {
  const manifestFile = fileURLToPath(import.meta.resolve('vitest/package.json'))
  const bytes = readFileSync(manifestFile)
  const manifest = JSON.parse(bytes.toString('utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string')
    throw new Error(`qa-tools cache: ${manifestFile} has no version`)
  return { node: process.version, platform: process.platform, arch: process.arch, vitestVersion: manifest.version, vitestManifestSha: sha256Bytes(bytes) }
}

/** sha256 over canonical JSON of every input that can change a T1 result, other than the module closure (checked per entry). */
export function computeCacheKey(input: CacheKeyInput): string {
  const runtime = input.runtime ?? currentRuntimeIdentity()
  const canonical = JSON.stringify({
    args: input.args,
    env: pickKeyEnv(input.env),
    gateFileSha: input.gateFileSha,
    install: hashInstallInputs(input.repoRoot),
    runtime,
  })
  return createHash('sha256').update(canonical).digest('hex')
}
