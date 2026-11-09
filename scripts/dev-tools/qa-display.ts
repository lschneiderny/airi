import process from 'node:process'

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { run } from './lib/exec'
import { clientEnv, parseQaDisplayArgs, parseSessionEnv, qaDisplayPaths, qaDisplayUnitArgs, qaDisplayUsage, shellExports } from './qa-display-plan'

const startTimeoutMs = 20_000

function fail(message: string, code = 1): never {
  console.error(`qa:display: ${message}`)
  process.exit(code)
}

function isActive(unit: string): boolean {
  return spawnSync('systemctl', ['--user', 'is-active', '--quiet', unit]).status === 0
}

function readSession(envFile: string) {
  return existsSync(envFile) ? parseSessionEnv(readFileSync(envFile, 'utf8')) : null
}

async function up(args: { name: string, width: number, height: number, windowed: boolean }, quiet: boolean) {
  const paths = qaDisplayPaths(args.name, runtimeDir())
  const running = isActive(paths.unit) ? readSession(paths.envFile) : null
  if (running)
    return running

  if (isActive(paths.unit))
    execFileSync('systemctl', ['--user', 'stop', paths.unit], { stdio: 'inherit' })
  // A failed unit keeps its name until it is reset, and `--collect` does not cover a failure before the start finishes.
  spawnSync('systemctl', ['--user', 'reset-failed', paths.unit], { stdio: 'ignore' })
  rmSync(paths.dir, { recursive: true, force: true })
  mkdirSync(paths.dir, { recursive: true })
  execFileSync('systemd-run', qaDisplayUnitArgs(args, paths, process.env.WAYLAND_DISPLAY), { stdio: 'inherit' })

  const deadline = Date.now() + startTimeoutMs
  while (Date.now() < deadline) {
    const session = readSession(paths.envFile)
    if (session) {
      if (!quiet)
        console.info(`qa:display: "${args.name}" is up on ${session.WAYLAND_DISPLAY} and X display ${session.DISPLAY} (${args.width}x${args.height}${args.windowed ? ', windowed' : ''}).`)
      return session
    }
    if (!isActive(paths.unit))
      fail(`"${args.name}" exited during startup. Read its log with: journalctl --user -u ${paths.unit}`)
    await sleep(200)
  }
  fail(`"${args.name}" did not become ready within ${startTimeoutMs / 1000} seconds. Read its log with: journalctl --user -u ${paths.unit}`)
}

function runtimeDir(): string {
  const dir = process.env.XDG_RUNTIME_DIR
  if (!dir)
    fail('XDG_RUNTIME_DIR is not set. Run this from a logged-in desktop session.', 2)
  return dir
}

async function main() {
  if (process.platform !== 'linux')
    fail('the headless QA display needs Linux with KWin. On Windows, T3 runs use the real desktop.', 2)

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
      if (!isActive(paths.unit)) {
        console.info(`qa:display: "${args.name}" is not running.`)
        return
      }
      execFileSync('systemctl', ['--user', 'stop', paths.unit], { stdio: 'inherit' })
      rmSync(paths.dir, { recursive: true, force: true })
      console.info(`qa:display: stopped "${args.name}".`)
      return
    case 'status': {
      const session = isActive(paths.unit) ? readSession(paths.envFile) : null
      if (!session) {
        console.info(`qa:display: "${args.name}" is not running.`)
        process.exit(1)
      }
      console.info(`qa:display: "${args.name}" is running as ${paths.unit}.\n${shellExports(session, args.name)}`)
      return
    }
    case 'env': {
      const session = isActive(paths.unit) ? readSession(paths.envFile) : null
      if (!session)
        fail(`"${args.name}" is not running. Start it with: pnpm qa:display up --name ${args.name}`)
      console.info(shellExports(session, args.name))
      return
    }
    case 'run': {
      const session = await up(args, true)
      const [command, ...rest] = args.argv
      process.exitCode = await run(command, rest, { cwd: process.cwd(), env: clientEnv(process.env, session, args.name) })
      return
    }
    case 'shot': {
      const session = isActive(paths.unit) ? readSession(paths.envFile) : null
      if (!session)
        fail(`"${args.name}" is not running.`)
      const file = resolve(args.file!)
      // Spectacle asks the session's KWin for the capture, so it must run inside the session.
      const result = spawnSync('spectacle', ['--background', '--nonotify', '--fullscreen', '--output', file], { env: clientEnv(process.env, session, args.name), stdio: ['ignore', 'ignore', 'inherit'], timeout: 20_000 })
      if (result.status !== 0 || !existsSync(file))
        fail(`spectacle could not capture "${args.name}" (exit ${result.status ?? result.signal}).`)
      console.info(`qa:display: wrote ${file}`)
    }
  }
}

try {
  await main()
}
catch (error) {
  fail(errorMessageFrom(error) ?? 'unexpected failure')
}
