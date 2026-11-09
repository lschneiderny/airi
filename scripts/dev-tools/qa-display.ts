import type { QaCompositor, QaDisplayArgs, QaSession } from './qa-display-plan'

import process from 'node:process'

import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { errorMessageFrom } from '@moeru/std'

import { run } from './lib/exec'
import { procStat } from './qa-display-guard'
import { clientEnv, freeX11Display, kglobalShortcutsSeed, locateGlobalAccelDaemon, missingBinaryMessage, parseAudioPids, parseQaDisplayArgs, parseSessionEnv, parseSystemBusPid, pointerCommand, qaDisplayPaths, qaDisplayRunArgs, qaDisplayRunScopeStopArgs, qaDisplayUnitArgs, qaDisplayUsage, requiredBinaries, sessionMountTargets, sessionProcessRunning, shellExports, swayConfig, swayProbeScript, systemBusConfig, wireplumberNoDevicesConf } from './qa-display-plan'

const startTimeoutMs = 20_000
/** Extra startup time for `--private-audio`, whose own waits add up to 20 seconds at most. */
const privateAudioStartMs = 20_000
const kwinPointerHelper = fileURLToPath(new URL('../../packages/qa-tools/scripts/linux/kwin-pointer.py', import.meta.url))

function fail(message: string, code = 1): never {
  console.error(`qa:display: ${message}`)
  process.exit(code)
}

/** Prints a message that already carries its own `qa-display:` prefix. */
function failRaw(message: string, code: number): never {
  console.error(message)
  process.exit(code)
}

/**
 * The environment for `systemctl --user` and `systemd-run --user`. Inside a session, `XDG_RUNTIME_DIR` and the bus
 * are the session's private ones, so this points both back at the user's manager.
 */
function systemdEnv(): NodeJS.ProcessEnv {
  const host = process.env.AIRI_QA_HOST_RUNTIME_DIR
  return host ? { ...process.env, XDG_RUNTIME_DIR: host, DBUS_SESSION_BUS_ADDRESS: `unix:path=${host}/bus` } : process.env
}

/** The runtime directory and bus of the user's own manager, for a `systemd-run --user` started with a session env. */
function systemdEnvKeys(): NodeJS.ProcessEnv {
  const env = systemdEnv()
  return { XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS }
}

function systemctl(args: string[], stdio: 'inherit' | 'ignore' = 'ignore') {
  return spawnSync('systemctl', ['--user', ...args], { env: systemdEnv(), stdio })
}

function isActive(unit: string): boolean {
  return systemctl(['is-active', '--quiet', unit]).status === 0
}

/** Lazily unmounts what the session's FUSE helpers left under its directory, then removes the directory. */
function removeSessionDir(dir: string) {
  for (const target of sessionMountTargets(readFileSync('/proc/self/mountinfo', 'utf8'), dir))
    spawnSync('fusermount3', ['-u', '-z', target], { stdio: 'inherit' })
  rmSync(dir, { recursive: true, force: true })
}

function readSession(envFile: string): QaSession | null {
  return existsSync(envFile) ? parseSessionEnv(readFileSync(envFile, 'utf8')) : null
}

/** The private audio processes that are gone; all of them when the pid file itself is missing. */
function deadAudioProcesses(pidFile: string): string[] {
  const processes = existsSync(pidFile) ? parseAudioPids(readFileSync(pidFile, 'utf8')) : []
  if (processes.length === 0)
    return ['pipewire', 'wireplumber', 'pipewire-pulse']
  return processes.filter(entry => !sessionProcessRunning(entry.name, procStat(entry.pid))).map(entry => `${entry.name} (pid ${entry.pid})`)
}

/** The pid of the session's private system bus while it runs; `null` when the pid file is missing or the daemon exited. */
function runningSystemBusPid(pidFile: string): number | null {
  const pid = existsSync(pidFile) ? parseSystemBusPid(readFileSync(pidFile, 'utf8')) : null
  return pid !== null && sessionProcessRunning('dbus-daemon', procStat(pid)) ? pid : null
}

function describeSession(session: Pick<QaSession, 'compositor' | 'portals' | 'audio'>): string {
  return `${session.compositor}${session.portals ? ' with portals' : ''}${session.audio === 'none' ? '' : `, ${session.audio} audio`}`
}

function hasBinary(binary: string): boolean {
  const candidates = binary.startsWith('/') ? [binary] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, binary))
  return candidates.some((file) => {
    try {
      accessSync(file, constants.X_OK)
      return true
    }
    catch {
      return false
    }
  })
}

function takenX11Displays(): Set<number> {
  const taken = new Set<number>()
  const add = (names: string[], pattern: RegExp) => names.forEach(name => pattern.test(name) && taken.add(Number(pattern.exec(name)![1])))
  add(existsSync('/tmp/.X11-unix') ? readdirSync('/tmp/.X11-unix') : [], /^X(\d+)$/)
  add(readdirSync('/tmp'), /^\.X(\d+)-lock$/)
  return taken
}

function globalAccelExecutable(): string | undefined {
  const rpm = spawnSync('rpm', ['-ql', 'kglobalacceld', 'kf6-kglobalaccel'], { encoding: 'utf8' })
  const located = locateGlobalAccelDaemon(rpm.stdout ?? '')
  return located?.kind === 'executable' ? located.path : undefined
}

async function up(args: Pick<QaDisplayArgs, 'name' | 'width' | 'height' | 'windowed' | 'compositor' | 'portals' | 'audio'>, quiet: boolean): Promise<QaSession> {
  const paths = qaDisplayPaths(args.name, runtimeDir())
  const running = isActive(paths.unit) ? readSession(paths.envFile) : null
  if (running) {
    if ((args.compositor && args.compositor !== running.compositor) || (args.portals && !running.portals) || (args.audio !== 'none' && args.audio !== running.audio))
      fail(`"${args.name}" already runs ${describeSession(running)}. Stop it first with: pnpm qa:display down --name ${args.name}`)
    if (runningSystemBusPid(paths.systemBusPid) === null)
      fail(`the private system bus of "${args.name}" is not running. Restart the session: pnpm qa:display down --name ${args.name} && pnpm qa:display up --name ${args.name}`)
    if (running.audio === 'private') {
      const dead = deadAudioProcesses(paths.audioPids)
      if (dead.length > 0)
        fail(`the private audio stack of "${args.name}" is not running (${dead.join(', ')} exited). Restart the session: pnpm qa:display down --name ${args.name} && pnpm qa:display up --name ${args.name} --private-audio`)
    }
    return running
  }

  const compositor: QaCompositor = args.compositor ?? 'kwin'
  const missing = missingBinaryMessage(requiredBinaries(compositor, args.portals, args.audio), hasBinary)
  if (missing)
    failRaw(missing, 1)

  if (isActive(paths.unit))
    systemctl(['stop', paths.unit], 'inherit')
  // A failed unit keeps its name until it is reset, and `--collect` does not cover a failure before the start finishes.
  systemctl(['reset-failed', paths.unit])
  removeSessionDir(paths.dir)
  mkdirSync(paths.runtime, { recursive: true, mode: 0o700 })
  mkdirSync(paths.data, { recursive: true })
  mkdirSync(paths.config, { recursive: true })
  writeFileSync(paths.systemBusConf, systemBusConfig(paths.systemBusSocket))
  if (args.portals)
    writeFileSync(join(paths.config, 'kglobalshortcutsrc'), kglobalShortcutsSeed())
  if (args.audio === 'private') {
    mkdirSync(dirname(paths.wireplumberConf), { recursive: true })
    writeFileSync(paths.wireplumberConf, wireplumberNoDevicesConf())
  }
  if (compositor === 'sway') {
    writeFileSync(paths.swayConfig, swayConfig(args.width, args.height))
    writeFileSync(paths.swayProbe, swayProbeScript())
  }
  const unitArgs = qaDisplayUnitArgs({
    ...args,
    compositor,
    x11Display: compositor === 'x11' ? freeX11Display(takenX11Displays()) : undefined,
    globalAccelExecutable: args.portals ? globalAccelExecutable() : undefined,
  }, paths, { runtimeDir: runtimeDir(), waylandDisplay: process.env.WAYLAND_DISPLAY })
  execFileSync('systemd-run', unitArgs, { env: systemdEnv(), stdio: 'inherit' })

  const timeoutMs = startTimeoutMs + (args.audio === 'private' ? privateAudioStartMs : 0)
  const deadline = Date.now() + timeoutMs
  const logHint = `Read its log with: journalctl --user -u ${paths.unit}`
  while (Date.now() < deadline) {
    const session = readSession(paths.envFile)
    if (session) {
      if (!quiet) {
        const where = [session.env.WAYLAND_DISPLAY, session.env.DISPLAY && `X display ${session.env.DISPLAY}`].filter(Boolean).join(' and ')
        console.info(`qa:display: "${args.name}" is up (${describeSession(session)}) on ${where} (${args.width}x${args.height}${args.windowed ? ', windowed' : ''}).`)
      }
      return session
    }
    if (existsSync(paths.errorFile)) {
      const reason = readFileSync(paths.errorFile, 'utf8').trim()
      systemctl(['stop', paths.unit])
      fail(`"${args.name}" did not start: ${reason}. ${logHint}`)
    }
    if (!isActive(paths.unit))
      fail(`"${args.name}" exited during startup. ${logHint}`)
    await sleep(200)
  }
  systemctl(['stop', paths.unit])
  fail(`"${args.name}" did not become ready within ${timeoutMs / 1000} seconds and was stopped. ${logHint}`)
}

/** The user's runtime directory, also from inside a session, whose own `XDG_RUNTIME_DIR` is private. */
function runtimeDir(): string {
  const dir = process.env.AIRI_QA_HOST_RUNTIME_DIR ?? process.env.XDG_RUNTIME_DIR
  if (!dir)
    fail('XDG_RUNTIME_DIR is not set. Run this from a logged-in desktop session.', 2)
  return dir
}

function runningSession(unit: string, envFile: string, name: string): QaSession {
  const session = isActive(unit) ? readSession(envFile) : null
  if (!session)
    fail(`"${name}" is not running. Start it with: pnpm qa:display up --name ${name}`)
  return session
}

async function main() {
  if (process.platform !== 'linux')
    fail('the headless QA display needs Linux. On Windows, T3 runs use the real desktop.', 2)

  const args = parseQaDisplayArgs(process.argv.slice(2))
  if ('error' in args) {
    console.error(`qa:display: ${args.error}\n\n${qaDisplayUsage}`)
    process.exit(2)
  }
  const paths = qaDisplayPaths(args.name, runtimeDir())

  switch (args.command) {
    case 'up':
      await up(args, false)
      return
    case 'down':
      systemctl(qaDisplayRunScopeStopArgs(args.name), 'inherit')
      if (!isActive(paths.unit)) {
        console.info(`qa:display: "${args.name}" is not running.`)
        return
      }
      systemctl(['stop', paths.unit], 'inherit')
      {
        // The unit stop kills its whole cgroup, the forked system bus included; this only confirms it.
        const pid = runningSystemBusPid(paths.systemBusPid)
        if (pid !== null) {
          process.kill(pid, 'SIGTERM')
          console.warn(`qa:display: the private system bus (pid ${pid}) outlived the unit stop and was sent SIGTERM.`)
        }
      }
      removeSessionDir(paths.dir)
      console.info(`qa:display: stopped "${args.name}".`)
      return
    case 'status': {
      const session = isActive(paths.unit) ? readSession(paths.envFile) : null
      if (!session) {
        console.info(`qa:display: "${args.name}" is not running.`)
        process.exit(1)
      }
      if (runningSystemBusPid(paths.systemBusPid) === null)
        fail(`"${args.name}" runs, but its private system bus is not running. Restart the session: pnpm qa:display down --name ${args.name} && pnpm qa:display up --name ${args.name}`)
      console.info(`qa:display: "${args.name}" is running as ${paths.unit} (${describeSession(session)}).\n${shellExports(session.env, args.name)}`)
      return
    }
    case 'env':
      console.info(shellExports(runningSession(paths.unit, paths.envFile, args.name).env, args.name))
      return
    case 'run': {
      const session = await up(args, true)
      // The command runs in a scope unit of the session, so qa-tools process discovery, which reads only the
      // session's cgroups, also sees what the command leaves behind after its parent exits.
      const env = clientEnv(process.env, session.env, args.name)
      process.exitCode = await run('systemd-run', qaDisplayRunArgs(args.name, process.pid, env, args.argv), { cwd: process.cwd(), env: { ...env, ...systemdEnvKeys() } })
      return
    }
    case 'shot': {
      const session = runningSession(paths.unit, paths.envFile, args.name)
      if (session.compositor !== 'kwin')
        failRaw('qa-display: shot needs a kwin session; use a CDP screenshot', 2)
      const file = resolve(args.file!)
      // Spectacle asks the session's KWin for the capture, so it must run inside the session.
      const result = spawnSync('spectacle', ['--background', '--nonotify', '--fullscreen', '--output', file], { env: clientEnv(process.env, session.env, args.name), stdio: ['ignore', 'ignore', 'inherit'], timeout: 20_000 })
      if (result.status !== 0 || !existsSync(file))
        fail(`spectacle could not capture "${args.name}" (exit ${result.status ?? result.signal}).`)
      console.info(`qa:display: wrote ${file}`)
      return
    }
    case 'pointer': {
      const session = runningSession(paths.unit, paths.envFile, args.name)
      const built = pointerCommand(session.compositor, args.point!, kwinPointerHelper, Date.now())
      const missing = missingBinaryMessage([{ binary: built.command, pkg: { python3: 'python3', xdotool: 'xdotool', swaymsg: 'sway' }[built.command] ?? built.command }], hasBinary)
      if (missing)
        failRaw(missing, 1)
      const result = spawnSync(built.command, built.args, { env: clientEnv(process.env, session.env, args.name), input: built.input, stdio: ['pipe', 'inherit', 'inherit'], timeout: 20_000 })
      if (result.status !== 0)
        fail(`${built.command} could not move the pointer in "${args.name}" (exit ${result.status ?? result.signal}).`)
      console.info(`qa:display: moved the ${session.compositor} pointer of "${args.name}" to ${args.point!.x},${args.point!.y}.`)
    }
  }
}

try {
  await main()
}
catch (error) {
  fail(errorMessageFrom(error) ?? 'unexpected failure')
}
