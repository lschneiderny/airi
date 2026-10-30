import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, posix, resolve } from 'node:path'
import { execPath, platform, env as processEnv, version as processVersion } from 'node:process'

import { errorMessageFrom } from '@moeru/std'

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

/**
 * Everything the doctor reads from the outside world. Tests replace each probe; `createSystemProbes`
 * implements them against the real repository, filesystem and process table.
 */
export interface DoctorProbes {
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
  /** The checkout the doctor checks; `stray-electron` reports only processes of this worktree. */
  repoRoot: string
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

/** Builds the eight preflight checks, in report order, on top of the given probes. */
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
        const commands = missing.map(path => `\`pnpm -F @proj-airi/${path.split('/')[1]} dev\``)
        return {
          status: 'fail',
          detail: `missing ${missing.join(', ')}`,
          fix: `From this worktree's root, run ${commands.join(' and ')}. The DownloadLive2DSDK() Vite configResolved hook downloads CubismSdkForWeb-5-r.3 into each app's public/. Stop each app after the download completes, then rerun pnpm qa:doctor. Installing dependencies alone does not download Cubism Core.`,
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
      id: 'stray-electron',
      run: async () => {
        const strays = strayElectronProcesses(await probes.listProcesses(), probes.repoRoot)
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

function listProcesses(timeoutMs: number): Promise<ProcessEntry[]> {
  const [command, args] = platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select ProcessId,CommandLine | ConvertTo-Json']] as const
    : ['ps', ['-eo', 'pid,args']] as const
  return new Promise((resolveList, reject) => {
    execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      if (platform === 'win32') {
        const parsed = JSON.parse(stdout) as { ProcessId: number, CommandLine: string | null } | { ProcessId: number, CommandLine: string | null }[]
        resolveList((Array.isArray(parsed) ? parsed : [parsed]).map(({ ProcessId, CommandLine }) => ({ pid: ProcessId, commandLine: CommandLine ?? '' })))
        return
      }
      resolveList(stdout.split('\n').slice(1).flatMap((line) => {
        const trimmed = line.trim()
        const separator = trimmed.indexOf(' ')
        const pid = Number(trimmed.slice(0, separator))
        return separator > 0 && Number.isInteger(pid) ? [{ pid, commandLine: trimmed.slice(separator + 1).trim() }] : []
      }))
    })
  })
}

/** Real probes for `runDoctor`, rooted at the repository checkout. */
export function createSystemProbes(repoRoot: string, env: Record<string, string | undefined> = processEnv): DoctorProbes {
  const abs = (path: string) => resolve(repoRoot, path)
  return {
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
    listProcesses: () => listProcesses(10_000),
    repoRoot,
  }
}
