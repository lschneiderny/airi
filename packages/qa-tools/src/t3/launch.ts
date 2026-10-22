import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import type { LiveProcess, OwnedProcess, ProcessLister } from '../env/processes'

import { createWriteStream } from 'node:fs'
import { platform, env as processEnv } from 'node:process'

import { acquire } from '@proj-airi/cpu-slots'
import { CdpClient, findAvailablePort, findDebugTarget, waitForRemoteDebug } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { spawnPnpm } from '../env/pnpm'

/** The main stage window: the synced leader on the root route. */
export const stageTargetPattern = /synced-leader=true[^#]*#\/$/

/** The environment of a rendered run: fresh profile, CDP on a free port without the system browser, and the bridge gate. */
export function t3LaunchEnv(profileDir: string, port: number): Record<string, string> {
  return {
    APP_USER_DATA_PATH: profileDir,
    APP_REMOTE_DEBUG: 'true',
    APP_REMOTE_DEBUG_PORT: String(port),
    APP_REMOTE_DEBUG_NO_OPEN: 'true',
    APP_MOTION_QA_BRIDGE: 'true',
  }
}

export interface LaunchedApp {
  child: ChildProcess
  root: OwnedProcess
  port: number
  env: Record<string, string>
  /** Resolves with the exit code when the root process exits. */
  exited: Promise<number | null>
  /** Resolves `true` when the root exits within `timeoutMs`. */
  waitExit: (timeoutMs: number) => Promise<boolean>
  /** Rejects when the dev session prints a fatal startup error (Electron keeps running without a window after one). */
  fatal: Promise<never>
}

/** Startup errors after which Electron stays alive but never opens the remote debug endpoint or a window. */
export const fatalStartupPattern = /App threw an error during load[^\n]*\n?[^\n]*/

/**
 * Starts `pnpm --dir <repoRoot> -F @proj-airi/stage-tamagotchi dev` with the T3 environment. `--dir` puts the
 * worktree path into the root's command line, so teardown can prove ownership from the live process table.
 */
export async function launchStageTamagotchi(options: { repoRoot: string, profileDir: string, logFile: string, list: ProcessLister }): Promise<LaunchedApp> {
  const port = await findAvailablePort()
  const env = t3LaunchEnv(options.profileDir, port)
  // The caller (`runT3Cli`, `gate --level t3`) already holds the exclusive lease, so this reuses it in-process and only
  // reads its env. A direct caller without one queues here and gives the lease back when the app exits.
  const lease = await acquire({ class: 'exclusive', command: `stage-tamagotchi dev (T3, ${options.repoRoot})`, cwd: options.repoRoot })
  const child = spawnPnpm(['--dir', options.repoRoot, '-F', '@proj-airi/stage-tamagotchi', 'dev'], {
    repoRoot: options.repoRoot,
    env: { ...processEnv, ...env, ...lease.env },
    stdio: 'pipe',
    detached: platform !== 'win32',
  })
  const log = createWriteStream(options.logFile)
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  let tail = ''
  const fatal = new Promise<never>((_, reject) => {
    const watch = (chunk: Buffer | string) => {
      tail = `${tail}${String(chunk)}`.slice(-4_000)
      const match = fatalStartupPattern.exec(tail)
      if (match)
        reject(new Error(`The dev session reported a fatal startup error: ${match[0].trim()}`))
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)
  })
  fatal.catch(() => {})
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => {
      if (!lease.inherited)
        lease.release()
      log.end()
      resolveExit(code)
    })
    child.once('error', () => {
      if (!lease.inherited)
        lease.release()
      resolveExit(null)
    })
  })
  if (child.pid === undefined)
    throw new Error(`Could not start the stage-tamagotchi dev session: ${(await exited) ?? 'no exit code'}`)
  const pid = child.pid
  lease.addWorkload(pid)
  const live: LiveProcess | undefined = (await options.list()).find(entry => entry.pid === pid)
  const root: OwnedProcess = { pid, created: live?.created, commandLine: live?.commandLine ?? child.spawnargs.join(' ') }
  return {
    child,
    root,
    port,
    env,
    exited,
    fatal,
    waitExit: timeoutMs => new Promise<boolean>((resolveWait) => {
      const timer = setTimeout(resolveWait, timeoutMs, false)
      void exited.then(() => {
        clearTimeout(timer)
        resolveWait(true)
      })
    }),
  }
}

/** Fails as soon as the app exits, so a crashed launch does not wait out a CDP timeout. */
export function failOnExit<T>(app: LaunchedApp, step: string, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    app.fatal,
    app.exited.then((code) => {
      throw new Error(`The app exited (code ${code}) while waiting for ${step}`)
    }),
  ])
}

/** Waits for the CDP endpoint and the main stage target, then connects to it. Each wait is bounded (120 s each). */
export async function connectStage(app: LaunchedApp): Promise<{ stage: CdpClient, browserUrl: string, targetUrl: string }> {
  const browserUrl = await failOnExit(app, 'the remote debug endpoint', waitForRemoteDebug(app.port))
  const target = await failOnExit(app, 'the main stage window', findDebugTarget(app.port, 'main stage window', candidate => candidate.type === 'page' && stageTargetPattern.test(candidate.url)))
  if (!target.webSocketDebuggerUrl)
    throw new Error(`The main stage target ${target.url} has no WebSocket debugger URL`)
  const stage = await CdpClient.connect(target.webSocketDebuggerUrl)
  return { stage, browserUrl, targetUrl: target.url }
}
