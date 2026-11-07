import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { cwd, execPath, platform, env as processEnv, stderr } from 'node:process'
import { fileURLToPath } from 'node:url'

export interface ResolvedPnpm {
  version: string
  node: string
  entry: string
}

export interface ResolvePnpmOptions {
  repoRoot: string
  env?: Record<string, string | undefined>
}

const pnpmPackageManagerPattern = /^pnpm@(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\+.*)?$/
const jsEntryPattern = /\.(?:c|m)?js$/

/** Reads the pnpm version pinned by the `packageManager` field of the root package.json. */
export function readPinnedPnpmVersion(repoRoot: string): string {
  const file = join(repoRoot, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { packageManager?: unknown }
  if (typeof manifest.packageManager !== 'string')
    throw new Error(`qa-tools: ${file} has no "packageManager" field; expected something like "pnpm@11.24.0"`)
  const match = pnpmPackageManagerPattern.exec(manifest.packageManager)
  if (!match)
    throw new Error(`qa-tools: cannot read a pnpm version from packageManager "${manifest.packageManager}" in ${file}; expected "pnpm@<major>.<minor>.<patch>"`)
  return match[1]
}

function defaultPnpmHome(env: Record<string, string | undefined>): string {
  if (platform === 'win32')
    return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'pnpm')
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'pnpm')
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'pnpm')
}

function pnpmVersionOfEntry(entry: string): string | undefined {
  for (let dir = dirname(entry), parent = dirname(dir); dir !== parent; dir = parent, parent = dirname(dir)) {
    const manifestFile = join(dir, 'package.json')
    if (!existsSync(manifestFile))
      continue
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name?: unknown, version?: unknown }
    if (manifest.name === 'pnpm' && typeof manifest.version === 'string')
      return manifest.version
  }
  return undefined
}

/**
 * Finds the JS entry of a standalone pnpm executable (the layout mise installs): `<install>/pnpm` with `<install>/dist/pnpm.mjs` and no package.json.
 * The dist directory comes from an absolute `npm_execpath`, or, in a nested `pnpm` call where `npm_execpath` is the bare word `pnpm`,
 * from `npm_config_node_gyp` (`<dist>/node_modules/node-gyp/bin/node-gyp.js`), which pnpm sets for every script.
 * The version is asked from the entry itself; an entry that cannot answer is not a match.
 */
function standalonePnpmEntry(env: Record<string, string | undefined>, version: string): string | undefined {
  const distDirs: string[] = []
  const execpath = env.npm_execpath
  if (execpath && isAbsolute(execpath) && !jsEntryPattern.test(execpath))
    distDirs.push(join(dirname(execpath), 'dist'))
  const nodeGyp = env.npm_config_node_gyp
  if (nodeGyp && isAbsolute(nodeGyp))
    distDirs.push(dirname(dirname(dirname(dirname(nodeGyp)))))

  for (const distDir of distDirs) {
    const entry = join(distDir, 'pnpm.mjs')
    if (!existsSync(entry))
      continue
    try {
      if (execFileSync(execPath, [entry, '--version'], { encoding: 'utf8' }).trim() === version)
        return entry
    }
    catch {
      // Not a runnable pnpm entry; try the next candidate. The caller's error names the expected path.
    }
  }
  return undefined
}

/**
 * Resolves the pinned pnpm to a `node <entry>` pair so no `.cmd` shim is involved.
 *
 * Use when:
 * - A QA script spawns pnpm and must not depend on regenerated `PNPM_HOME` shims.
 *
 * Expects:
 * - The pinned version is installed under `<PNPM_HOME>/.tools/pnpm/<version>/`, or `npm_execpath` is a JS file of that version,
 *   or the running pnpm is a standalone executable of that version with `dist/pnpm.mjs` beside it.
 *
 * Returns:
 * - `{ version, node, entry }`; throws with the expected path and the fix when neither exists.
 */
export function resolvePnpm(options: ResolvePnpmOptions): ResolvedPnpm {
  const env = options.env ?? processEnv
  const version = readPinnedPnpmVersion(options.repoRoot)
  const pnpmHome = env.PNPM_HOME || defaultPnpmHome(env)
  // NOTICE: only the exact "<version>" directory is considered. Sibling "<version>_tmp_<pid>"
  // directories are half-installed leftovers and must never be picked up.
  const entry = join(pnpmHome, '.tools', 'pnpm', version, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (existsSync(entry))
    return { version, node: execPath, entry }

  const execpath = env.npm_execpath
  if (execpath && jsEntryPattern.test(execpath) && existsSync(execpath) && pnpmVersionOfEntry(execpath) === version)
    return { version, node: execPath, entry: resolve(execpath) }

  const standaloneEntry = standalonePnpmEntry(env, version)
  if (standaloneEntry)
    return { version, node: execPath, entry: standaloneEntry }

  throw new Error([
    `qa-tools: pnpm ${version} (pinned by packageManager in ${join(options.repoRoot, 'package.json')}) was not found.`,
    `Expected entry: ${entry}`,
    `Fix: install it with "corepack use pnpm@${version}" or "pnpm self-update ${version}", or set PNPM_HOME to the directory that holds .tools/pnpm/${version}. qa-tools does not do this automatically.`,
  ].join('\n'))
}

/**
 * Spawns `node <pnpm entry> ...args` without a shell and logs which pnpm was used to stderr.
 * `detached` starts a new process group on POSIX, so the whole tree can be signalled through the group.
 */
export function spawnPnpm(args: readonly string[], options: ResolvePnpmOptions & { cwd?: string, stdio?: 'inherit' | 'pipe', detached?: boolean } = { repoRoot: cwd() }) {
  const { version, node, entry } = resolvePnpm(options)
  stderr.write(`qa-tools: pnpm ${version} via ${entry}\n`)
  return spawn(node, [entry, ...args], {
    cwd: options.cwd ?? options.repoRoot,
    env: { ...(options.env ?? processEnv) } as NodeJS.ProcessEnv,
    shell: false,
    stdio: options.stdio ?? 'inherit',
    detached: options.detached ?? false,
  })
}

/** Resolves the Vitest CLI file so callers run `node <entry>` instead of a `.cmd` shim. */
export function resolveVitestEntry(): string {
  const packageUrl = import.meta.resolve('vitest/package.json')
  const packageFile = fileURLToPath(packageUrl)
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as { bin?: string | Record<string, string> }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vitest
  if (!bin)
    throw new Error(`qa-tools: ${packageUrl} declares no "bin.vitest" entry`)
  return resolve(dirname(packageFile), bin)
}
