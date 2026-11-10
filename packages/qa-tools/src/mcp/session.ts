import type { Lease } from '@proj-airi/cpu-slots'
import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { RunHandle } from '../evidence/run'
import type { MotionQaBridgeClient } from '../t3/bridge-client'
import type { LaunchedApp } from '../t3/launch'
import type { TeardownReport } from '../t3/teardown'

import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { acquire } from '@proj-airi/cpu-slots'

import { buildSeedEntries } from '../app/plan'
import { sendMessage } from '../app/send'
import { matchExpectations } from '../app/summary'
import { listLiveProcesses } from '../env/processes'
import { createRun } from '../evidence/run'
import { loadScript, ReplayScript } from '../llm/script'
import { ReplayServer } from '../llm/server'
import { AppSessionCore, refuseIfWorktreeBusy } from '../session/app-session'
import { scanMainLog } from '../smoke/triage'
import { importRig, zipRig } from '../t3/import-rig'
import { failOnExit } from '../t3/launch'
import { captureStagePng } from '../t3/screenshot'

export type ModelKind = 'live2d' | 'mmd' | 'vrm'
export type EventKind = MotionQaEvent['kind']

export interface StartOptions {
  model?: string
  kind?: ModelKind
  /** A `qa:llm` replay script. Without one, each `send` must carry its own reply. */
  script?: string
}

interface Live {
  lease: Lease
  run: RunHandle
  /** The launched app, its stage connection, process tree and page errors; torn down on `stop`. */
  core: AppSessionCore<CdpClient>
  app: LaunchedApp
  stage: CdpClient
  bridge: MotionQaBridgeClient
  server: ReplayServer
  script: ReplayScript
  /** The QA display session this session started, stopped again on `stop`. */
  display?: string
  shots: number
}

/** The QA display this server uses on Linux when it was not itself started inside one. */
export const mcpDisplayName = 'mcp'

/**
 * One live app for an agent: a fresh profile seeded with the replay LLM, onboarding completed, and the bridge
 * ready. On Linux outside a QA display it starts `qa:display` session `mcp` and launches the app there, so the
 * user's desktop stays undisturbed. The app holds the live CPU lease until `stop`.
 */
export class AppSession {
  private live?: Live
  private starting = false

  constructor(private readonly repoRoot: string) {}

  get running(): boolean {
    return this.live !== undefined
  }

  private require(): Live {
    if (!this.live)
      throw new Error('No app is running. Call airi_start first.')
    return this.live
  }

  async start(options: StartOptions): Promise<Record<string, unknown>> {
    if (this.live || this.starting)
      throw new Error('An app is already running in this server. Call airi_stop first.')
    this.starting = true
    try {
      return await this.launch(options)
    }
    finally {
      this.starting = false
    }
  }

  private displayEnv(): { env?: NodeJS.ProcessEnv, display?: string } {
    if (process.platform !== 'linux' || process.env.AIRI_QA_DISPLAY)
      return {}
    // `qa:display run` starts the session when needed; the child prints the exact environment a client gets.
    const output = execFileSync('pnpm', ['--silent', '--dir', this.repoRoot, 'qa:display', 'run', '--name', mcpDisplayName, '--', 'node', '-p', 'JSON.stringify(process.env)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
    return { env: JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as NodeJS.ProcessEnv, display: mcpDisplayName }
  }

  private async launch(options: StartOptions): Promise<Record<string, unknown>> {
    const { env: baseEnv, display } = this.displayEnv()
    try {
      // On Linux the process table is read only inside a QA display session, so the check runs after the display
      // exists and with that session's environment.
      await refuseIfWorktreeBusy(this.repoRoot, () => listLiveProcesses(undefined, undefined, baseEnv))
    }
    catch (error) {
      if (display)
        execFileSync('pnpm', ['--silent', '--dir', this.repoRoot, 'qa:display', 'down', '--name', display], { stdio: 'ignore', timeout: 60_000 })
      throw error
    }
    const script = options.script ? await loadScript({ script: options.script }, this.repoRoot) : new ReplayScript([], 'airi_send replies')
    const run = createRun({ tool: 'mcp', label: 'session', repoRoot: this.repoRoot })
    const profileDir = run.path('profile')
    mkdirSync(profileDir)
    const server = new ReplayServer({ script, log: run.path('requests.jsonl') })
    const baseURL = await server.listen()
    const core = AppSessionCore.create({ repoRoot: this.repoRoot, profileDir, processEnv: baseEnv })
    let lease: Lease | undefined
    try {
      lease = await acquire({ class: 'live', command: 'qa:mcp session', cwd: this.repoRoot })
      const { app, stage, bridge } = await core.start({
        launch: { logFile: run.path('app.log'), env: { AIRI_STAGE_HOST: 'window' }, baseEnv, lease },
        onLaunched: launched => run.recordProcess({ rootPid: launched.root.pid, created: launched.root.created, commandLine: launched.root.commandLine }),
        collectPageErrors: true,
        beforeOnboarding: async ({ stage }) => {
          await stage.evaluate(`(() => {
            for (const [key, value] of Object.entries(${JSON.stringify(buildSeedEntries(baseURL))}))
              localStorage.setItem(key, value)
          })()`)
        },
        bridge: { step: 'the bridge', timeoutMs: 300_000 },
      })
      this.live = { run, core, app, stage, bridge, server, script, display, lease, shots: 0 }
      let imported: unknown = null
      if (options.model)
        imported = await this.importModel(options.model, options.kind)
      return { runDir: run.dir, display: display ?? process.env.AIRI_QA_DISPLAY ?? null, windows: core.collector?.targets ?? [], imported, replay: { source: script.source, entries: script.entries.length } }
    }
    catch (error) {
      if (!this.live) {
        // A partial start still owns processes, the lease, and the display; release them before reporting the error.
        await this.teardown({ run, core, server, display, lease }).catch(() => {})
      }
      throw error
    }
  }

  async importModel(model: string, kind?: ModelKind): Promise<unknown> {
    const live = this.require()
    const extension = extname(model).toLowerCase()
    const inferred: ModelKind = extension === '.vrm' ? 'vrm' : ['.pmx', '.pmd'].includes(extension) ? 'mmd' : 'live2d'
    let input = model
    if (statSync(model).isDirectory() || ['.pmx', '.pmd'].includes(extension)) {
      input = live.run.path('model.zip')
      rmSync(input, { force: true })
      await zipRig(statSync(model).isDirectory() ? model : dirname(model), input)
    }
    return await failOnExit(live.app, 'model import', importRig(live.stage, live.bridge, input, 600_000, kind ?? inferred))
  }

  async state(): Promise<unknown> {
    const live = this.require()
    return await live.bridge.call('state', undefined, 30_000)
  }

  async events(sinceSeq?: number): Promise<unknown> {
    const live = this.require()
    return await live.bridge.call('events', sinceSeq === undefined ? {} : { sinceSeq }, 30_000)
  }

  /** Sends one chat message through the real chat path and waits for the expected events of this turn. */
  async send(text: string, options: { reply?: string, expect: EventKind[], timeoutMs: number }): Promise<Record<string, unknown>> {
    const live = this.require()
    if (options.reply !== undefined)
      live.script.append({ content: options.reply, toolCalls: [] })
    else if (live.script.remaining === 0)
      throw new Error(`No scripted reply is left in ${live.script.source}. Pass \`reply\` with the assistant reply for this turn.`)
    const before = await live.bridge.call('events', {}, 30_000)
    const sinceSeq = before.lastSeq
    const startedAt = Date.now()
    const sendPath = await failOnExit(live.app, 'send', sendMessage({ port: live.app.port, bridge: live.bridge, text, timeoutMs: options.timeoutMs }))
    const expected = [...new Set([...options.expect, 'turn' as const])]
    const events: MotionQaEvent[] = []
    let lastSeq = sinceSeq
    let pending = matchExpectations(events, expected, sinceSeq)
    while (pending.length && Date.now() - startedAt < options.timeoutMs) {
      const result = await failOnExit(live.app, 'turn events', live.bridge.call('events', { sinceSeq: lastSeq }, 10_000))
      events.push(...result.events)
      lastSeq = result.lastSeq
      pending = matchExpectations(events, expected, sinceSeq)
      if (pending.length)
        await sleep(100)
    }
    return { ok: pending.length === 0, sendPath, missing: pending, durationMs: Date.now() - startedAt, events }
  }

  async screenshot(): Promise<{ path: string, png: string }> {
    const live = this.require()
    const path = live.run.path(`stage-${String(++live.shots).padStart(3, '0')}.png`)
    await captureStagePng(live.stage, path)
    live.run.addArtifact(path.slice(live.run.dir.length + 1), 'screenshot')
    return { path, png: readFileSync(path).toString('base64') }
  }

  errors(): Record<string, unknown> {
    const live = this.require()
    const logFile = live.run.path('app.log')
    return {
      windows: live.core.collector?.targets ?? [],
      unwatchedWindows: live.core.collector?.attachErrors ?? [],
      page: live.core.collector?.errors ?? [],
      main: existsSync(logFile) ? scanMainLog(readFileSync(logFile, 'utf8')) : [],
    }
  }

  /** Evaluates an expression in the stage window and returns its JSON value. */
  async evaluate(expression: string): Promise<unknown> {
    const live = this.require()
    return await live.stage.evaluate(expression)
  }

  async stop(): Promise<TeardownReport | { stopped: false }> {
    const live = this.live
    if (!live)
      return { stopped: false }
    this.live = undefined
    return await this.teardown(live)
  }

  private async teardown(parts: Pick<Live, 'run' | 'core' | 'server' | 'display'> & { lease?: Lease }): Promise<TeardownReport> {
    const { run } = parts
    let teardown: TeardownReport
    try {
      teardown = await parts.core.teardown({ extraPaths: [run.path('model.zip')] })
    }
    finally {
      // Startup can fail before a launch exists; stop still owns the command reference.
      parts.lease?.release()
      await parts.server.close().catch(() => {})
      if (parts.display)
        execFileSync('pnpm', ['--silent', '--dir', this.repoRoot, 'qa:display', 'down', '--name', parts.display], { stdio: 'ignore', timeout: 60_000 })
    }
    for (const name of ['app.log', 'requests.jsonl']) {
      if (existsSync(run.path(name)))
        run.addArtifact(name, 'diagnostics')
    }
    run.finish({ exitCode: teardown.ok ? 0 : 1, summary: teardown.ok ? 'MCP session stopped cleanly' : 'MCP session teardown left processes or files behind' })
    return teardown
  }
}
