import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { TrackUsageError } from './args'

export const SERVICE_UNIT = 'airi-perf-track.service'
export const TIMER_UNIT = 'airi-perf-track.timer'

const TEMPLATE_DIR = resolve(import.meta.dirname, '../../perf/systemd')

export interface UnitValues {
  /** Absolute path of the runner worktree that holds tracker code at `ref`. */
  readonly runner: string
  readonly ref: string
  readonly pnpm: string
  readonly git: string
  readonly path: string
}

/**
 * Fills the committed unit templates. Every value must be non-empty.
 * @throws {TrackUsageError} when a value is empty.
 */
export function renderUnits(values: UnitValues): { readonly service: string, readonly timer: string } {
  const fills = new Map(Object.entries({ RUNNER: values.runner, REF: values.ref, PNPM: values.pnpm, GIT: values.git, PATH: values.path }))
  for (const [name, value] of fills) {
    if (!value.trim())
      throw new TrackUsageError(`${name.toLowerCase()} must not be empty when rendering the systemd units`)
  }
  const render = (file: string) => readFileSync(join(TEMPLATE_DIR, file), 'utf8').replace(/@([A-Z]+)@/g, (placeholder, name: string) => {
    const value = fills.get(name)
    if (value === undefined)
      throw new Error(`unknown placeholder ${placeholder} in ${file}`)
    return value
  })
  return { service: render(SERVICE_UNIT), timer: render(TIMER_UNIT) }
}

/**
 * The service's `PATH`: the caller's absolute entries, without the `node_modules/.bin`
 * directories that `pnpm` prepends for the script running the install.
 */
export function unitPath(pathEnv: string): string {
  const insideNodeModulesBin = (entry: string) => basename(entry) === '.bin' && entry.split(sep).includes('node_modules')
  return pathEnv.split(delimiter).filter(entry => isAbsolute(entry) && !insideNodeModulesBin(entry)).join(delimiter)
}

function findExecutable(name: string, path: string): string {
  for (const dir of path.split(delimiter)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile())
        return candidate
    }
    catch {
      // Not in this PATH entry; try the next one.
    }
  }
  throw new Error(`${name} was not found on PATH`)
}

export interface TimerHost {
  /** Runs `git` with these arguments and returns stdout; throws on a non-zero exit. */
  readonly git: (args: readonly string[]) => string
  /** Runs `systemctl` with these arguments and returns stdout; throws on a non-zero exit. */
  readonly systemctl: (args: readonly string[]) => string
  /** `$XDG_CONFIG_HOME`, or `~/.config` when it is unset. */
  readonly configHome: string
  readonly pathEnv: string
  readonly print: (text: string) => void
}

function trackerPaths(host: TimerHost) {
  const main = dirname(host.git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())
  // Same worktree directory rule as `pnpm wt new` (scripts/dev-tools/wt.ts).
  const worktrees = join(dirname(main), `${basename(main)}-wt`)
  return {
    main,
    runner: join(worktrees, 'perf-track-runner'),
    app: join(worktrees, 'perf-track'),
    unitDir: join(host.configHome, 'systemd', 'user'),
  }
}

/**
 * Creates and locks the runner worktree when it is missing, writes both units, and enables the timer.
 * @throws {TrackUsageError} when `ref` names no commit.
 */
export function installTimer(host: TimerHost, options: { readonly ref: string | null }): void {
  const ref = options.ref ?? 'origin/main'
  const { main, runner, unitDir } = trackerPaths(host)
  try {
    host.git(['-C', main, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  }
  catch {
    throw new TrackUsageError(`--ref "${ref}" does not name a commit in ${main}`)
  }
  const path = unitPath(host.pathEnv)
  const units = renderUnits({ runner, ref, path, git: findExecutable('git', path), pnpm: findExecutable('pnpm', path) })

  if (!existsSync(runner)) {
    host.git(['-C', main, 'worktree', 'add', '--detach', runner, ref])
    host.git(['-C', main, 'worktree', 'lock', '--reason', 'perf tracker', runner])
    host.print(`created and locked the runner worktree ${runner}`)
  }
  mkdirSync(unitDir, { recursive: true })
  for (const [file, text] of [[SERVICE_UNIT, units.service], [TIMER_UNIT, units.timer]]) {
    writeFileSync(join(unitDir, file), text)
    // writeFileSync's mode is masked by the umask and ignored for an existing file.
    chmodSync(join(unitDir, file), 0o644)
  }
  host.print(`wrote ${SERVICE_UNIT} and ${TIMER_UNIT} to ${unitDir}`)
  host.systemctl(['--user', 'daemon-reload'])
  host.systemctl(['--user', 'enable', '--now', TIMER_UNIT])
  host.print(host.systemctl(['--user', 'list-timers', TIMER_UNIT]).trimEnd())
}

/** Disables and removes both units, and leaves the tracker worktrees in place. */
export function uninstallTimer(host: TimerHost): void {
  const { main, runner, app, unitDir } = trackerPaths(host)
  if (existsSync(join(unitDir, TIMER_UNIT)))
    host.systemctl(['--user', 'disable', '--now', TIMER_UNIT])
  rmSync(join(unitDir, SERVICE_UNIT), { force: true })
  rmSync(join(unitDir, TIMER_UNIT), { force: true })
  host.systemctl(['--user', 'daemon-reload'])
  host.print(`removed ${SERVICE_UNIT} and ${TIMER_UNIT} from ${unitDir}`)
  const kept = [runner, app].filter(existsSync)
  if (kept.length > 0) {
    host.print('the tracker worktrees stay in place; remove them with:')
    for (const worktree of kept)
      host.print(`  git -C ${main} worktree unlock ${worktree} && git -C ${main} worktree remove ${worktree}`)
  }
}
