import type { KwinProbe } from '../t3/pointer-kwin'

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { execPath, platform, env as processEnv, version as processVersion } from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { defaultCompileCacheDir } from '../../../../scripts/dev-tools/lib/compile-cache'
import { isPathInside } from '../../../../scripts/dev-tools/lib/paths'
import { parseKwinProbe, runKwinHelper } from '../t3/pointer-kwin'
import { resolvePnpm, resolveVitestEntry } from './pnpm'
import { commandLineContainsPath, killOwnedTree, killTree, listLiveProcesses } from './processes'

export type DoctorStatus = 'ok' | 'warn' | 'fail'

export interface DoctorRow {
  id: string
  status: DoctorStatus
  detail: string
  fix: string
}

export interface PackageManifestEntry {
  /** Package directory relative to the repository root, with forward slashes, for example `packages/i18n`. */
  dir: string
  exports: unknown
}

export interface RigListing {
  isDirectory: boolean
  /** `*.model3.json` paths relative to the rig directory, found at depth <= 2. */
  models: string[]
}

export interface ProcessEntry {
  pid: number
  commandLine: string
}

/** One filesystem's use, from `statfs`. `inodes` is null where the filesystem has no fixed inode table (btrfs, Windows). */
export interface DiskUsage {
  inodes: { used: number, total: number } | null
  space: { used: number, total: number }
}

/**
 * Everything the doctor reads from the outside world. Tests replace each probe; `createSystemProbes`
 * implements them against the real repository, filesystem and process table.
 */
export interface DoctorProbes {
  platform: () => string
  sessionType: () => string | undefined
  nodeVersion: () => string
  /** Contents of `.tool-versions`, or undefined when the file is missing. */
  readToolVersions: () => string | undefined
  /** Resolves the pinned pnpm; throws with a message when it cannot. */
  resolvePnpm: () => { version: string, entry: string }
  /** Whether a path relative to the repository root exists. */
  exists: (path: string) => boolean
  packageManifests: () => PackageManifestEntry[]
  /** Newest modification time (ms) of files under a repo-relative directory whose names end with `suffix`; undefined when there are none. */
  newestMtime: (dir: string, suffix: string) => number | undefined
  /** Absolute path of the Playwright Chromium executable, or undefined when playwright-core cannot be resolved. */
  chromiumExecutable: () => string | undefined
  /** Whether an absolute path exists. */
  existsAbsolute: (path: string) => boolean
  env: Record<string, string | undefined>
  listRig: (dir: string) => RigListing
  listProcesses: () => Promise<ProcessEntry[]>
  /** Runs the KWin pointer helper's probe in the current session; called only inside a `pnpm qa:display` session. */
  kwinPointer: () => Promise<KwinProbe>
  /** The checkout the doctor checks; `stray-electron` reports only processes of this worktree. */
  repoRoot: string
  /** The system temporary directory (`os.tmpdir()`). */
  tempDir: () => string
  /** Use of the filesystem holding `path`, or of its nearest existing ancestor. */
  diskUsage: (path: string) => DiskUsage
  /** The direct subdirectory of `dir` holding the most entries, counted recursively; unreadable ones are skipped. */
  largestEntry: (dir: string) => { path: string, entries: number } | undefined
}

export interface DoctorCheck {
  id: string
  run: () => Promise<Omit<DoctorRow, 'id'>> | Omit<DoctorRow, 'id'>
}

export interface RunDoctorOptions {
  /** Bound for each check; a check that does not settle in time becomes a `fail` row. Default 15 s. */
  timeoutMs?: number
}

const cubismCorePaths = [
  'apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js',
  'apps/stage-web/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js',
] as const

const rigEnvNames = ['AIRI_QA_RIG_FORBOOTH', 'AIRI_QA_RIG_BEAR'] as const

function ok(detail: string): Omit<DoctorRow, 'id'> {
  return { status: 'ok', detail, fix: '' }
}

const diskWarnPercent = 80
const diskFailPercent = 95

function percent(part: { used: number, total: number }): number {
  return part.total > 0 ? part.used / part.total * 100 : 0
}

/** The worse of inode and space use, with a readable summary. */
function describeDisk(path: string, usage: DiskUsage): { worst: number, text: string } {
  const space = percent(usage.space)
  const inodes = usage.inodes ? percent(usage.inodes) : null
  const inodeText = usage.inodes && inodes !== null
    ? `inodes ${inodes.toFixed(0)}% (${usage.inodes.used}/${usage.inodes.total})`
    : 'no inode limit'
  return { worst: Math.max(space, inodes ?? 0), text: `${path}: ${inodeText}, space ${space.toFixed(0)}%` }
}

function majorMinor(version: string): string | undefined {
  return /^v?(\d+\.\d+)/.exec(version.trim())?.[1]
}

function distTargets(exports: unknown): string[] {
  if (typeof exports === 'string')
    return exports.startsWith('./dist/') ? [exports] : []
  // NOTICE:
  // `types` conditions are skipped: packages/i18n exports `./dist/locales/{es,ru,fr,vi}/index.d.mts`, which its tsdown build never emits.
  // Source: packages/i18n/package.json exports.
  // Remove once the build emits them or the exports drop them.
  if (exports && typeof exports === 'object')
    return Object.entries(exports).flatMap(([condition, value]) => condition === 'types' ? [] : distTargets(value))
  return []
}

/** Builds preflight checks in report order on top of the given probes. */
function createDoctorChecks(probes: DoctorProbes): DoctorCheck[] {
  return [
    {
      id: 'node-version',
      run: () => {
        const file = probes.readToolVersions()
        const pinned = file && /^nodejs\s+(\S+)/m.exec(file)?.[1]
        const actual = probes.nodeVersion()
        if (!pinned)
          return { status: 'fail', detail: `.tool-versions has no nodejs entry (running ${actual})`, fix: 'Add a "nodejs <version>" line to .tool-versions.' }
        if (majorMinor(pinned) !== majorMinor(actual))
          return { status: 'fail', detail: `running ${actual}, .tool-versions pins nodejs ${pinned}`, fix: `Switch to Node ${pinned} (major.minor ${majorMinor(pinned)}).` }
        return ok(`${actual} matches .tool-versions nodejs ${pinned}`)
      },
    },
    {
      id: 'pnpm',
      run: () => {
        try {
          const { version, entry } = probes.resolvePnpm()
          return ok(`pnpm ${version} at ${entry}`)
        }
        catch (error) {
          return { status: 'fail', detail: errorMessageFrom(error) ?? 'resolvePnpm failed', fix: 'Install the pinned pnpm version named in package.json "packageManager".' }
        }
      },
    },
    {
      id: 'temp-space',
      run: () => {
        const tempDir = probes.tempDir()
        const configured = probes.env.NODE_COMPILE_CACHE
        const repoDefault = defaultCompileCacheDir(probes.repoRoot)
        const temp = describeDisk(tempDir, probes.diskUsage(tempDir))
        const largest = probes.largestEntry(tempDir)
        const details = [temp.text, largest ? `most entries: ${largest.path} (${largest.entries})` : `no readable directory in ${tempDir}`]
        let worst = temp.worst
        // An empty value is a deliberate setting: Node keeps no compile cache, so there is no directory to measure.
        const cacheDir = configured === undefined ? repoDefault : configured || undefined
        const cacheInTemp = cacheDir !== undefined && isPathInside(tempDir, cacheDir)
        if (configured === undefined)
          details.push(`NODE_COMPILE_CACHE unset; repository entry points use ${repoDefault}`)
        else if (configured === '')
          details.push('NODE_COMPILE_CACHE is empty, so Node keeps no compile cache')
        else
          details.push(cacheInTemp ? `NODE_COMPILE_CACHE=${configured} is inside ${tempDir}` : `NODE_COMPILE_CACHE=${configured}`)
        if (cacheDir !== undefined && !cacheInTemp) {
          const cache = describeDisk(cacheDir, probes.diskUsage(cacheDir))
          details.push(`compile cache ${cache.text}`)
          worst = Math.max(worst, cache.worst)
        }
        const fixes: string[] = []
        if (worst > diskWarnPercent)
          fixes.push(`Free inodes or space${largest ? `; ${largest.path} holds the most entries` : ''}. Doctor deletes nothing.`)
        if (cacheInTemp)
          fixes.push(`Set NODE_COMPILE_CACHE off the temporary directory in your shell or agent environment, for example ${repoDefault}. Repository entry points apply that default only when the variable is unset.`)
        const status = worst > diskFailPercent ? 'fail' : fixes.length > 0 ? 'warn' : 'ok'
        return { status, detail: details.join('; '), fix: fixes.join(' ') }
      },
    },
    {
      id: 'install',
      run: () => probes.exists('node_modules/.modules.yaml')
        ? ok('node_modules/.modules.yaml exists')
        : { status: 'fail', detail: 'node_modules/.modules.yaml is missing', fix: 'pnpm install --frozen-lockfile' },
    },
    {
      id: 'built-packages',
      run: () => {
        const missing = [...new Set(probes.packageManifests().flatMap(({ dir, exports }) =>
          distTargets(exports)
            // A subpath pattern such as `./dist/files/*.ttf` cannot be checked file by file; its directory must exist.
            .map(target => posix.join(dir, target.includes('*') ? target.slice(0, target.lastIndexOf('/', target.indexOf('*'))) : target))))]
          .filter(path => !probes.exists(path))
        const problems: string[] = []
        if (missing.length > 0)
          problems.push(`missing dist files: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ''}`)

        const newestYaml = probes.newestMtime('packages/i18n/src/locales/en', '.yaml')
        const newestDist = probes.newestMtime('packages/i18n/dist', '')
        const i18nStale = newestYaml !== undefined && (newestDist === undefined || newestDist < newestYaml)
        if (i18nStale)
          problems.push(newestDist === undefined ? 'packages/i18n/dist is missing' : 'packages/i18n/dist is older than packages/i18n/src/locales/en yaml (browser tests would render raw keys)')

        if (problems.length === 0)
          return ok('every packages/* dist export exists and packages/i18n/dist is current')
        const fix = missing.length > 0 ? 'pnpm run build:packages' : 'pnpm -F @proj-airi/i18n build'
        return { status: 'fail', detail: problems.join('; '), fix }
      },
    },
    {
      id: 'cubism-core',
      run: () => {
        const missing = cubismCorePaths.filter(path => !probes.exists(path))
        if (missing.length === 0)
          return ok('Cubism core exists for stage-tamagotchi and stage-web')
        return {
          status: 'fail',
          detail: `missing ${missing.join(', ')}`,
          fix: 'From this worktree\'s root, run pnpm qa:setup cubism, then rerun pnpm qa:doctor. Installing dependencies alone does not download Cubism Core.',
        }
      },
    },
    {
      id: 'playwright',
      run: () => {
        const fix = 'pnpm exec playwright install chromium'
        const executable = probes.chromiumExecutable()
        if (!executable)
          return { status: 'warn', detail: 'playwright-core could not be resolved from packages/stage-ui', fix }
        return probes.existsAbsolute(executable)
          ? ok(`Chromium at ${executable}`)
          : { status: 'warn', detail: `Chromium executable missing: ${executable}`, fix }
      },
    },
    {
      id: 'rigs',
      run: () => {
        const unset: string[] = []
        const invalid: string[] = []
        const found: string[] = []
        for (const name of rigEnvNames) {
          const dir = probes.env[name]
          if (!dir) {
            unset.push(name)
            continue
          }
          const listing = probes.listRig(dir)
          if (!listing.isDirectory)
            invalid.push(`${name}=${dir} is not a directory`)
          else if (listing.models.length === 0)
            invalid.push(`${name}=${dir} has no *.model3.json at depth <= 2`)
          else
            found.push(`${name}: ${listing.models[0]}`)
        }
        if (invalid.length > 0)
          return { status: 'fail', detail: invalid.join('; '), fix: 'Point the variable at the rig directory that contains the *.model3.json, or unset it.' }
        if (unset.length > 0)
          return { status: 'warn', detail: [`${unset.join(', ')} unset`, ...found].join('; '), fix: `Set ${unset.join(' / ')} to a Live2D rig directory for rendered QA runs.` }
        return ok(found.join('; '))
      },
    },
    {
      id: 'pointer-platform',
      run: async () => {
        const platform = probes.platform()
        if (platform === 'win32')
          return ok('Windows supports real-pointer rendered QA and cursor parking')
        const measure = 'qa:stage measure falls back to CDP pointer moves, which never trigger the hit-test readback, so stage-frame-budget readback is unmeasured'
        const wayland = platform === 'linux' && probes.sessionType()?.toLowerCase() === 'wayland'
          ? ['Linux Wayland: classic window only, click-through is disabled and the polled cursor can stick stale (#2521)']
          : []
        const display = platform === 'linux' ? probes.env.AIRI_QA_DISPLAY : undefined
        if (display) {
          const probe = await probes.kwinPointer()
          if (probe.ok) {
            const output = probe.screen ? ` on a ${probe.screen.width}x${probe.screen.height} output` : ''
            return ok([`QA display "${display}": real-pointer T3 touch runs inject input through KWin EIS${output} and park the session cursor`, 'runs without pointer events inject no input, so T3 liveliness/emotion runs still use cursorAttention off instead of a parked cursor', measure, ...wayland].join('; '))
          }
          return {
            status: 'warn',
            detail: [`QA display "${display}": the KWin EIS pointer backend is unavailable (${probe.missing.join('; ')}), so real-pointer T3 touch scenarios will fail`, measure, ...wayland].join('; '),
            fix: 'Install python3-gobject and libei, and use a KWin that exports org.kde.KWin.EIS.RemoteDesktop.',
          }
        }
        const limits = [
          platform === 'linux'
            ? 'linux outside the QA display: real-pointer T3 touch scenarios exit pointer-platform-unsupported'
            : `${platform}: real-pointer T3 touch scenarios exit pointer-platform-unsupported`,
          'cursor parking is not implemented, so T3 liveliness/emotion runs use cursorAttention off instead of a parked cursor (a different condition)',
          measure,
          ...wayland,
        ]
        return {
          status: 'warn',
          detail: limits.join('; '),
          fix: platform === 'linux' ? 'Run rendered pointer QA inside `pnpm qa:display run -- ...`, or on Windows.' : 'Run rendered pointer QA on Windows, or on Linux inside `pnpm qa:display run -- ...`.',
        }
      },
    },
    {
      id: 'stray-electron',
      run: async () => {
        let listing: ProcessEntry[]
        try {
          listing = await probes.listProcesses()
        }
        catch (error) {
          return { status: 'warn', detail: `not checked: ${errorMessageFrom(error) ?? 'the process listing failed'}`, fix: 'On Linux, run the doctor inside a QA display to check for stray Electron processes: pnpm qa:display run -- pnpm qa:doctor' }
        }
        const strays = strayElectronProcesses(listing, probes.repoRoot)
        return strays.length === 0
          ? ok('no stage-tamagotchi electron processes from this worktree')
          : { status: 'warn', detail: `stage-tamagotchi electron processes from this worktree running: PIDs ${strays.map(({ pid }) => pid).join(', ')}`, fix: 'Stop the dev session that owns them before a rendered run; doctor never kills processes.' }
      },
    },
  ]
}

/** The `stray-electron` probe: stage-tamagotchi Electron processes whose command line contains this worktree's path. */
export function strayElectronProcesses<T extends { commandLine: string }>(listing: readonly T[], repoRoot: string): T[] {
  return listing.filter(({ commandLine }) => {
    const lower = commandLine.toLowerCase()
    // Other worktrees run their own dev sessions; only this checkout's processes conflict with a run here.
    return lower.includes('stage-tamagotchi') && lower.includes('electron') && commandLineContainsPath(commandLine, repoRoot)
  })
}

async function runBounded(check: DoctorCheck, timeoutMs: number): Promise<DoctorRow> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Omit<DoctorRow, 'id'>>((resolveTimeout) => {
    timer = setTimeout(resolveTimeout, timeoutMs, { status: 'fail', detail: `probe did not finish within ${timeoutMs} ms`, fix: 'Investigate why the probe hangs; rerun doctor.' })
  })
  try {
    const result = await Promise.race([Promise.resolve().then(check.run), timeout])
    return { id: check.id, ...result }
  }
  catch (error) {
    return { id: check.id, status: 'fail', detail: `probe threw: ${errorMessageFrom(error) ?? 'unknown error'}`, fix: 'Investigate the probe error; rerun doctor.' }
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Runs preflight checks in order and returns one row per check.
 *
 * Use when:
 * - A QA run needs to know whether the worktree can produce meaningful results.
 *
 * Expects:
 * - `probes` from `createSystemProbes` (real) or a test double. Doctor only reports; it never fixes or kills anything.
 *
 * Returns:
 * - Rows in check order; a check that throws or exceeds `timeoutMs` becomes a `fail` row.
 */
export async function runDoctor(probes: DoctorProbes, options: RunDoctorOptions = {}): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = []
  for (const check of createDoctorChecks(probes))
    rows.push(await runBounded(check, options.timeoutMs ?? 15_000))
  return rows
}

export interface WarmRunResult {
  exitCode: number | null
  output: string
}

const optimizerReloadPattern = /optimized dependencies changed/i

/** Turns one or two warm-up runs into a `warm` row; reruns once only for the cold optimizer reload. */
export async function runWarm(runOnce: () => Promise<WarmRunResult>): Promise<DoctorRow> {
  const fix = 'Read the Vitest output above; doctor does not fix it.'
  const first = await runOnce()
  if (first.exitCode === 0)
    return { id: 'warm', status: 'ok', detail: 'warm: ok', fix: '' }
  if (!optimizerReloadPattern.test(first.output))
    return { id: 'warm', status: 'fail', detail: first.output.trim() || `vitest exited ${first.exitCode}`, fix }
  const second = await runOnce()
  if (second.exitCode === 0)
    return { id: 'warm', status: 'ok', detail: 'warm: ok after reload', fix: '' }
  return { id: 'warm', status: 'fail', detail: second.output.trim() || `vitest exited ${second.exitCode}`, fix }
}

const warmTestFile = 'src/components/scenes/live2d-blink-ownership.browser.test.ts'

/** Runs the stage-ui blink-ownership browser test once through the Vitest CLI entry, killing it after `timeoutMs`. */
export function spawnWarmRun(repoRoot: string, timeoutMs = 300_000): Promise<WarmRunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(execPath, [resolveVitestEntry(), 'run', '--project', 'browser', warmTestFile], {
      cwd: join(repoRoot, 'packages', 'stage-ui'),
      env: { ...processEnv, FORCE_COLOR: '0' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => output += chunk)
    child.stderr.on('data', (chunk: string) => output += chunk)
    const timer = setTimeout(() => {
      output += `\nqa-tools doctor: warm-up exceeded ${timeoutMs} ms; killing the process tree of PID ${child.pid}`
      // `child.kill()` ends only the Vitest node process on Windows and can orphan its Chromium; kill the tree,
      // after checking that the live PID is still this worktree's Vitest. When the listing fails or ownership is
      // refused, nothing is signalled and the output records why.
      if (child.pid !== undefined) {
        void killOwnedTree({ pid: child.pid }, { ownedPaths: [repoRoot] }, { list: listLiveProcesses, kill: killTree })
          .catch((error) => {
            output += `\nqa-tools doctor: tree kill not performed: ${errorMessageFrom(error) ?? 'unknown error'}`
          })
      }
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun({ exitCode: null, output: `${output}\n${errorMessageFrom(error) ?? 'spawn failed'}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ exitCode: code, output })
    })
  })
}

function newestMtimeIn(dir: string, suffix: string): number | undefined {
  if (!existsSync(dir))
    return undefined
  let newest: number | undefined
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(suffix))
      continue
    const mtime = statSync(join(entry.parentPath, entry.name)).mtimeMs
    newest = newest === undefined ? mtime : Math.max(newest, mtime)
  }
  return newest
}

function diskUsageOf(path: string): DiskUsage {
  let existing = resolve(path)
  while (!existsSync(existing) && dirname(existing) !== existing)
    existing = dirname(existing)
  const stats = statfsSync(existing)
  return {
    inodes: stats.files > 0 ? { used: stats.files - stats.ffree, total: stats.files } : null,
    space: { used: (stats.blocks - stats.bfree) * stats.bsize, total: stats.blocks * stats.bsize },
  }
}

function largestEntryIn(dir: string): { path: string, entries: number } | undefined {
  let largest: { path: string, entries: number } | undefined
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue
    const path = join(dir, entry.name)
    let entries: number
    try {
      entries = readdirSync(path, { recursive: true }).length
    }
    catch {
      // Another user's private directory; it cannot be counted, and doctor does not need it to name the largest.
      continue
    }
    if (!largest || entries > largest.entries)
      largest = { path, entries }
  }
  return largest
}

function listRigModels(dir: string): RigListing {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    return { isDirectory: false, models: [] }
  const models: string[] = []
  const walk = (current: string, relative: string, depth: number) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isFile() && entry.name.endsWith('.model3.json'))
        models.push(rel)
      else if (entry.isDirectory() && depth < 2)
        walk(join(current, entry.name), rel, depth + 1)
    }
  }
  walk(dir, '', 0)
  return { isDirectory: true, models }
}

function resolveChromiumExecutable(repoRoot: string): string | undefined {
  try {
    const fromStageUi = createRequire(join(repoRoot, 'packages', 'stage-ui', 'package.json'))
    const fromProvider = createRequire(fromStageUi.resolve('@vitest/browser-playwright'))
    const fromPlaywright = createRequire(fromProvider.resolve('playwright'))
    const playwrightCore = fromPlaywright('playwright-core') as { chromium: { executablePath: () => string } }
    return playwrightCore.chromium.executablePath()
  }
  catch {
    return undefined
  }
}

/** Real probes for `runDoctor`, rooted at the repository checkout. */
export function createSystemProbes(repoRoot: string, env: Record<string, string | undefined> = processEnv): DoctorProbes {
  const abs = (path: string) => resolve(repoRoot, path)
  return {
    platform: () => platform,
    sessionType: () => env.XDG_SESSION_TYPE ?? (env.WAYLAND_DISPLAY ? 'wayland' : undefined),
    nodeVersion: () => processVersion,
    readToolVersions: () => existsSync(abs('.tool-versions')) ? readFileSync(abs('.tool-versions'), 'utf8') : undefined,
    resolvePnpm: () => resolvePnpm({ repoRoot, env }),
    exists: path => existsSync(abs(path)),
    packageManifests: () => readdirSync(abs('packages'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(abs('packages'), entry.name, 'package.json')))
      .map((entry) => {
        const manifest = JSON.parse(readFileSync(join(abs('packages'), entry.name, 'package.json'), 'utf8')) as { exports?: unknown }
        return { dir: `packages/${entry.name}`, exports: manifest.exports }
      }),
    newestMtime: (dir, suffix) => newestMtimeIn(abs(dir), suffix),
    chromiumExecutable: () => resolveChromiumExecutable(repoRoot),
    existsAbsolute: path => existsSync(path),
    env,
    listRig: listRigModels,
    // On Linux this lists only the current qa:display session and refuses outside one; it never reads the host table.
    listProcesses: () => listLiveProcesses(10_000, platform, env),
    kwinPointer: async () => {
      try {
        return parseKwinProbe(await runKwinHelper('probe', { timeoutMs: 10_000 }))
      }
      catch (error) {
        return { ok: false, missing: [errorMessageFrom(error) ?? 'the KWin pointer probe failed'] }
      }
    },
    repoRoot,
    tempDir: tmpdir,
    diskUsage: diskUsageOf,
    largestEntry: largestEntryIn,
  }
}
