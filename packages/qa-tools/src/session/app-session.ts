import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { OwnedProcess, ProcessLister, TreeKiller } from '../env/processes'
import type { RendererEvaluator } from '../t3/bridge-client'
import type { LaunchedApp } from '../t3/launch'
import type { TeardownReport } from '../t3/teardown'

import process from 'node:process'

import { rmSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

import { killTree, listLiveProcesses } from '../env/processes'
import { PageErrorCollector } from '../smoke/page-errors'
import { MotionQaBridgeClient } from '../t3/bridge-client'
import { connectStage, failOnExit, launchStageTamagotchi, stageTargetPattern } from '../t3/launch'
import { completeOnboarding } from '../t3/onboarding'
import { closeBrowser } from '../t3/run-t3'
import { findWorktreeAppProcesses, teardownRun, trackTree } from '../t3/teardown'

/** Throws when this worktree already runs an Electron or stage-tamagotchi process; commands call it before creating a run. */
export async function refuseIfWorktreeBusy(repoRoot: string, list: ProcessLister = listLiveProcesses, selfPids: readonly number[] = [process.pid, process.ppid]): Promise<void> {
  if (findWorktreeAppProcesses(await list(), repoRoot, selfPids).length)
    throw new Error('Refusing to launch while this worktree already has an Electron session')
}

export type LaunchOptions = Parameters<typeof launchStageTamagotchi>[0]

/** What the session needs from the stage window connection; `CdpClient` in production. */
export interface SessionStage extends RendererEvaluator {
  close: () => void
}

/** The process, CDP and browser boundaries of a session. Tests pass fakes; `AppSessionCore.create` uses the real ones. */
export interface AppSessionDeps<Stage extends SessionStage> {
  list: ProcessLister
  kill: TreeKiller
  /** Bounded wait between process-table reads during teardown. */
  sleep: (ms: number) => Promise<void>
  launch: (options: LaunchOptions) => Promise<LaunchedApp>
  connect: (app: LaunchedApp, targetPattern: RegExp) => Promise<{ stage: Stage, browserUrl: string, targetUrl: string }>
  createErrorCollector: (port: number) => PageErrorCollector
  completeOnboarding: (stage: Stage) => Promise<void>
  closeBrowser: (browserUrl: string) => Promise<void>
}

export interface AppSessionContext {
  repoRoot: string
  /** The fresh profile the app runs on; teardown removes it once no run process is left. */
  profileDir: string
  /** This CLI and its parent; never counted or killed. Defaults to the current process and its parent. */
  selfPids?: readonly number[]
  /** Aborting stops `start` with the signal's reason, as `abortMode` decides; teardown stays the caller's call. */
  signal?: AbortSignal
  /**
   * `race` (default) rejects the step in progress at once, so an interrupt during the connect leaves no browser to close
   * over CDP and teardown kills the tree. `after-connect` lets the launch and connect finish and checks the signal once
   * the process tree is tracked, so teardown can close the browser gracefully; later waits are never cut short, and
   * the caller checks the signal inside its own long waits. `qa:host` relies on `after-connect`.
   */
  abortMode?: 'race' | 'after-connect'
}

export interface AppSessionStartOptions<Stage extends SessionStage> {
  launch: Omit<LaunchOptions, 'repoRoot' | 'profileDir' | 'list'>
  /** The stage window to attach to; defaults to the classic main stage window. */
  targetPattern?: RegExp
  /** Runs right after the launch, before any wait, so a run records its root process even when the connect fails. */
  onLaunched?: (app: LaunchedApp) => void
  /** Starts a `PageErrorCollector` over every window before onboarding. */
  collectPageErrors?: boolean
  /** Runs after the connect (and the collector) and before onboarding, for example to seed local storage. */
  beforeOnboarding?: (connected: { stage: Stage, app: LaunchedApp, targetUrl: string }) => Promise<void>
  /** Defaults to `true`: marks onboarding complete in the fresh profile and reloads the stage. */
  onboarding?: boolean
  /** Waits for the motion QA bridge; `step` names the wait in the error raised when the app exits during it. */
  bridge?: { step: string, timeoutMs: number }
}

export interface StartedAppSession<Stage extends SessionStage> {
  app: LaunchedApp
  stage: Stage
  browserUrl: string
  targetUrl: string
  bridge: MotionQaBridgeClient
  /** The bridge's first `state` answer; `undefined` when the start did not wait for the bridge. */
  initialState?: MotionQaState
}

/**
 * The shared lifecycle of one rendered app run: launch, connect to the stage window, track the process tree, collect
 * page errors, complete onboarding, wait for the bridge, and tear everything down again. The commands that use it
 * (`qa:smoke`, `qa:app`, `qa:host`, and the MCP session) own their run directory, CPU lease, evidence and report.
 *
 * By default every step after the launch is raced against the abort signal (see `abortMode`). A failed
 * or aborted `start` leaves whatever it reached in place; the caller always calls `teardown`, which also works when
 * nothing was launched. Each instance starts once.
 */
export class AppSessionCore<Stage extends SessionStage> {
  private launched?: LaunchedApp
  private connected?: { stage: Stage, browserUrl: string, targetUrl: string }
  private ownedTree: OwnedProcess[] = []
  private errorCollector?: PageErrorCollector
  private bridgeClient?: MotionQaBridgeClient
  private started = false
  private readonly selfPids: readonly number[]
  private readonly interrupted: Promise<never>
  private readonly onAbort: () => void

  constructor(private readonly context: AppSessionContext, private readonly deps: AppSessionDeps<Stage>) {
    this.selfPids = context.selfPids ?? [process.pid, process.ppid]
    let rejectInterrupted: (reason: unknown) => void = () => {}
    this.interrupted = new Promise<never>((_, reject) => {
      rejectInterrupted = reject
    })
    // A run can fail before it reaches the first raced step; the rejection must not surface as unhandled.
    void this.interrupted.catch(() => {})
    this.onAbort = () => rejectInterrupted(context.signal?.reason ?? new Error('interrupted'))
    context.signal?.addEventListener('abort', this.onAbort, { once: true })
    if (context.signal?.aborted)
      this.onAbort()
  }

  /** A session over the real launcher, CDP connection, process table and browser. */
  static create(context: AppSessionContext): AppSessionCore<CdpClient> {
    return new AppSessionCore<CdpClient>(context, {
      list: listLiveProcesses,
      kill: killTree,
      sleep: async (ms) => { await setTimeout(ms) },
      launch: launchStageTamagotchi,
      connect: connectStage,
      createErrorCollector: port => new PageErrorCollector(port),
      completeOnboarding: stage => completeOnboarding(stage),
      closeBrowser,
    })
  }

  get app(): LaunchedApp | undefined {
    return this.launched
  }

  get stage(): Stage | undefined {
    return this.connected?.stage
  }

  get browserUrl(): string | undefined {
    return this.connected?.browserUrl
  }

  get tracked(): readonly OwnedProcess[] {
    return this.ownedTree
  }

  get collector(): PageErrorCollector | undefined {
    return this.errorCollector
  }

  /** Defined once onboarding is done (or skipped). */
  get bridge(): MotionQaBridgeClient | undefined {
    return this.bridgeClient
  }

  /** Races `work` against the abort signal; returns `work` unchanged under `after-connect`. */
  bounded<T>(work: Promise<T>): Promise<T> {
    return this.context.abortMode === 'after-connect' ? work : Promise.race([work, this.interrupted])
  }

  /** Races `work` against the abort signal, the app's exit, and its fatal startup error; `step` names it in the exit error. */
  whileRunning<T>(step: string, work: Promise<T>): Promise<T> {
    if (!this.launched)
      throw new Error(`No app is running for ${step}`)
    return this.bounded(failOnExit(this.launched, step, work))
  }

  async start(options: AppSessionStartOptions<Stage>): Promise<StartedAppSession<Stage>> {
    if (this.started)
      throw new Error('This app session was already started; create a new one for another launch')
    this.started = true
    this.context.signal?.throwIfAborted()
    const app = await this.deps.launch({ ...options.launch, repoRoot: this.context.repoRoot, profileDir: this.context.profileDir, list: this.deps.list })
    this.launched = app
    options.onLaunched?.(app)
    const connected = await this.bounded(this.deps.connect(app, options.targetPattern ?? stageTargetPattern))
    this.connected = connected
    this.ownedTree = trackTree(await this.bounded(this.deps.list()), app.root)
    if (this.context.abortMode === 'after-connect')
      this.context.signal?.throwIfAborted()
    if (options.collectPageErrors) {
      this.errorCollector = this.deps.createErrorCollector(app.port)
      await this.bounded(this.errorCollector.start())
    }
    if (options.beforeOnboarding)
      await this.bounded(options.beforeOnboarding({ stage: connected.stage, app, targetUrl: connected.targetUrl }))
    if (options.onboarding ?? true)
      await this.bounded(this.deps.completeOnboarding(connected.stage))
    const bridge = new MotionQaBridgeClient(connected.stage)
    this.bridgeClient = bridge
    const initialState = options.bridge
      ? await this.whileRunning(options.bridge.step, bridge.waitForBridge({ timeoutMs: options.bridge.timeoutMs }))
      : undefined
    return { app, stage: connected.stage, browserUrl: connected.browserUrl, targetUrl: connected.targetUrl, bridge, initialState }
  }

  /**
   * Stops the page-error collector, closes the browser over CDP, kills the owned process tree, and removes the profile
   * and `extraPaths` only when nothing of the run is left. The launch's lease reference is released and the stage
   * connection closed even when the teardown throws. The report's `ok` is the caller's to judge.
   */
  async teardown(options: { extraPaths?: readonly string[], removeDir?: (path: string) => void } = {}): Promise<TeardownReport> {
    this.context.signal?.removeEventListener('abort', this.onAbort)
    await this.errorCollector?.stop()
    const app = this.launched
    const browserUrl = this.connected?.browserUrl
    try {
      return await teardownRun({ repoRoot: this.context.repoRoot, profileDir: this.context.profileDir, root: app?.root, tracked: this.ownedTree, selfPids: this.selfPids }, {
        list: this.deps.list,
        kill: this.deps.kill,
        closeBrowser: browserUrl ? () => this.deps.closeBrowser(browserUrl) : undefined,
        waitRootExit: app?.waitExit,
        removeDir: options.removeDir ?? (path => rmSync(path, { recursive: true, force: true })),
        sleep: this.deps.sleep,
      }, options.extraPaths)
    }
    finally {
      app?.releaseLease()
      this.connected?.stage.close()
    }
  }
}
