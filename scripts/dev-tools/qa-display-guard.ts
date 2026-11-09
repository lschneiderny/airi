import type { QaSession } from './qa-display-plan'

import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { parseSessionEnv, qaDisplayGuard, qaDisplayPaths, takeAllowHostSession } from './qa-display-plan'

/**
 * Exits with code 2 unless this process may open windows or read desktop sensors: on Linux only inside a live
 * `pnpm qa:display` session, or with `--allow-host-session`. Returns the arguments without that flag.
 * The checks read the session's env file and ask the user's systemd for its unit state; they open no display or bus.
 */
export function requireQaDisplaySession(command: string, argv: readonly string[]): string[] {
  const taken = takeAllowHostSession(argv)
  assertQaDisplaySession(command, taken.allowHostSession)
  return taken.argv
}

export function assertQaDisplaySession(command: string, allowHostSession: boolean): void {
  const env = process.env
  const name = env.AIRI_QA_DISPLAY_SESSION
  const hostRuntimeDir = env.AIRI_QA_HOST_RUNTIME_DIR
  let session: QaSession | null = null
  let unitActive = false
  if (process.platform === 'linux' && !allowHostSession && name && hostRuntimeDir) {
    const paths = qaDisplayPaths(name, hostRuntimeDir)
    session = existsSync(paths.envFile) ? parseSessionEnv(readFileSync(paths.envFile, 'utf8')) : null
    unitActive = spawnSync('systemctl', ['--user', 'is-active', '--quiet', paths.unit], {
      env: { ...env, XDG_RUNTIME_DIR: hostRuntimeDir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${hostRuntimeDir}/bus` },
      stdio: 'ignore',
      timeout: 10_000,
    }).status === 0
  }
  const verdict = qaDisplayGuard({ command, platform: process.platform, env, allowHostSession, session, unitActive })
  if (!verdict.ok) {
    console.error(verdict.message)
    process.exit(2)
  }
}
