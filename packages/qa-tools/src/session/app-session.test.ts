import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import type { LiveProcess } from '../env/processes'
import type { LaunchedApp } from '../t3/launch'
import type { AppSessionDeps, SessionStage } from './app-session'

import { ChildProcess } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { PageErrorCollector } from '../smoke/page-errors'
import { AppSessionCore, refuseIfWorktreeBusy } from './app-session'

const repoRoot = '/wt/tqr-t8'
const profileDir = '/wt/tqr-t8/.temp/qa/run-1/profile'
const root: LiveProcess = { pid: 4242, parentPid: 1, created: 1, commandLine: `node pnpm.mjs --dir ${repoRoot} -F @proj-airi/stage-tamagotchi dev` }
const electron: LiveProcess = { pid: 4243, parentPid: root.pid, created: 2, commandLine: `${repoRoot}/node_modules/electron/dist/electron .` }
const state: MotionQaState = { modelId: 'm', modelLoaded: true, driver: 'natural', cursorAttention: true, expressionEnabled: true, heldEmotions: true, naturalActive: true, hold: null, captureActive: false, head: { x: 100, y: 50, width: 80, height: 100 }, screen: { x: 0, y: 0, devicePixelRatio: 1 }, screenAwareness: true, placement: null, placementYawBias: 0, chat: null, host: null, foreground: null, desktopIdleSeconds: null, performanceMode: null, performance: null }

/** A stage window whose bridge answers `state` once `ready` resolves; every evaluation is recorded in `steps`. */
class FakeStage implements SessionStage {
  closed = false
  constructor(private readonly steps: string[], private readonly ready: Promise<void>) {}

  async evaluate<T>(expression: string): Promise<T> {
    if (!expression.includes('__airiMotionQa'))
      return undefined as T
    this.steps.push('bridge:poll')
    await this.ready
    return JSON.stringify({ ok: true, result: state }) as T
  }

  close() {
    this.closed = true
  }
}

class FakeCollector extends PageErrorCollector {
  constructor(private readonly steps: string[]) {
    super(0)
  }

  override async start(): Promise<void> {
    this.steps.push('collector:start')
  }

  override async stop(): Promise<void> {
    this.steps.push('collector:stop')
  }
}

/** A launched app with a controllable exit and a fake process table that loses the root once it is killed. */
function fakeWorld(options: { bridgeReady?: Promise<void>, onboarding?: () => Promise<void>, connecting?: () => Promise<void> } = {}) {
  const steps: string[] = []
  let listing: LiveProcess[] = []
  let exit: (code: number) => void = () => {}
  const exited = new Promise<number | null>((resolveExit) => {
    exit = resolveExit
  })
  const releaseLease = vi.fn(() => {
    steps.push('lease:release')
  })
  const app: LaunchedApp = {
    child: new ChildProcess(),
    root: { pid: root.pid, created: root.created, commandLine: root.commandLine },
    port: 9333,
    env: {},
    exited,
    waitExit: async () => false,
    fatal: new Promise<never>(() => {}),
    releaseLease,
  }
  const stage = new FakeStage(steps, options.bridgeReady ?? Promise.resolve())
  const removed: string[] = []
  const deps: AppSessionDeps<FakeStage> = {
    list: async () => [...listing],
    kill: async (pid) => {
      steps.push(`kill:${pid}`)
      listing = listing.filter(entry => entry.pid !== pid && entry.parentPid !== pid)
      return { pid, invocation: `kill ${pid}`, exitCode: 0, output: '' }
    },
    sleep: async () => {},
    launch: async (launchOptions) => {
      steps.push(`launch:${launchOptions.script ?? 'dev'}`)
      listing = [root, electron]
      return app
    },
    connect: async (_app, pattern) => {
      steps.push(`connect:${pattern.source}`)
      await options.connecting?.()
      return { stage, browserUrl: 'ws://browser', targetUrl: 'http://localhost/?synced-leader=true#/' }
    },
    createErrorCollector: () => new FakeCollector(steps),
    completeOnboarding: async () => {
      steps.push('onboarding')
      await options.onboarding?.()
    },
    closeBrowser: async () => {
      steps.push('browser:close')
    },
  }
  return { steps, app, stage, deps, removed, exit, releaseLease, removeDir: (path: string) => void removed.push(path) }
}

describe('appSessionCore', () => {
  it('launches, connects, tracks, collects, prepares, onboards and waits for the bridge, in that order', async () => {
    const world = fakeWorld()
    const session = new AppSessionCore({ repoRoot, profileDir, selfPids: [7] }, world.deps)
    const started = await session.start({
      launch: { logFile: '/dev/null', script: 'dev:xwayland' },
      onLaunched: () => void world.steps.push('recorded'),
      collectPageErrors: true,
      beforeOnboarding: async ({ targetUrl }) => void world.steps.push(`prepare:${targetUrl}`),
      bridge: { step: 'the bridge', timeoutMs: 1_000 },
    })

    expect(world.steps).toEqual(['launch:dev:xwayland', 'recorded', expect.stringMatching(/^connect:/), 'collector:start', 'prepare:http://localhost/?synced-leader=true#/', 'onboarding', 'bridge:poll'])
    expect(started.initialState).toEqual(state)
    expect(session.tracked).toEqual([{ pid: electron.pid, created: electron.created, commandLine: electron.commandLine }])
    expect(session.collector).toBeInstanceOf(FakeCollector)
  })

  it('skips the optional steps it was not asked for', async () => {
    const world = fakeWorld()
    const session = new AppSessionCore({ repoRoot, profileDir }, world.deps)
    const started = await session.start({ launch: { logFile: '/dev/null' }, onboarding: false })

    expect(world.steps).toEqual(['launch:dev', expect.stringMatching(/^connect:/)])
    expect(started.initialState).toBeUndefined()
    expect(session.collector).toBeUndefined()
    // The bridge client exists even without the wait, so a caller can still drive it.
    expect(started.bridge).toBeDefined()
  })

  it('refuses a second start while the first one owns the app', async () => {
    const world = fakeWorld()
    const session = new AppSessionCore({ repoRoot, profileDir }, world.deps)
    await session.start({ launch: { logFile: '/dev/null' } })
    await expect(session.start({ launch: { logFile: '/dev/null' } })).rejects.toThrow('already started')
  })

  it('fails the bridge wait as soon as the app exits, and teardown still releases everything', async () => {
    const world = fakeWorld({ bridgeReady: new Promise(() => {}) })
    const session = new AppSessionCore({ repoRoot, profileDir }, world.deps)
    const starting = session.start({ launch: { logFile: '/dev/null' }, collectPageErrors: true, bridge: { step: 'the seeded bridge', timeoutMs: 60_000 } })
    world.exit(1)

    await expect(starting).rejects.toThrow('The app exited (code 1) while waiting for the seeded bridge')
    const report = await session.teardown({ removeDir: world.removeDir, extraPaths: ['/wt/tqr-t8/.temp/qa/run-1/model.zip'] })
    expect(report.ok).toBe(true)
    expect(report.leftovers).toEqual([])
    expect(world.removed).toEqual([profileDir, '/wt/tqr-t8/.temp/qa/run-1/model.zip'])
    expect(world.steps.slice(-4)).toEqual(['collector:stop', 'browser:close', `kill:${root.pid}`, 'lease:release'])
    expect(world.stage.closed).toBe(true)
  })

  it('stops at the current step on abort and tears the partial session down', async () => {
    const controller = new AbortController()
    let reachedOnboarding: () => void = () => {}
    const atOnboarding = new Promise<void>((resolveReached) => {
      reachedOnboarding = resolveReached
    })
    const world = fakeWorld({ onboarding: () => {
      reachedOnboarding()
      return new Promise(() => {})
    } })
    const session = new AppSessionCore({ repoRoot, profileDir, signal: controller.signal }, world.deps)
    const starting = session.start({ launch: { logFile: '/dev/null' }, collectPageErrors: true, bridge: { step: 'the bridge', timeoutMs: 60_000 } })
    await atOnboarding
    controller.abort(new Error('interrupted'))

    await expect(starting).rejects.toThrow('interrupted')
    expect(world.steps).not.toContain('bridge:poll')
    expect(session.bridge).toBeUndefined()
    const report = await session.teardown({ removeDir: world.removeDir })
    expect(report.ok).toBe(true)
    expect(world.releaseLease).toHaveBeenCalledOnce()
    expect(world.steps.slice(-3)).toEqual(['browser:close', `kill:${root.pid}`, 'lease:release'])
  })

  it('does not launch when the signal is already aborted', async () => {
    const world = fakeWorld()
    const controller = new AbortController()
    controller.abort(new Error('interrupted'))
    const session = new AppSessionCore({ repoRoot, profileDir, signal: controller.signal }, world.deps)

    await expect(session.start({ launch: { logFile: '/dev/null' } })).rejects.toThrow('interrupted')
    expect(world.steps).toEqual([])
    const report = await session.teardown({ removeDir: world.removeDir })
    expect(report.browserClose.attempted).toBe(false)
    expect(world.releaseLease).not.toHaveBeenCalled()
  })

  it('refuses to launch while this worktree already runs an Electron session', async () => {
    const busy: LiveProcess = { pid: 900, parentPid: 1, created: 2, commandLine: `${repoRoot}/node_modules/electron/dist/electron .` }
    await expect(refuseIfWorktreeBusy(repoRoot, async () => [busy], [7])).rejects.toThrow('already has an Electron session')
    await expect(refuseIfWorktreeBusy(repoRoot, async () => [busy], [900])).resolves.toBeUndefined()
  })

  describe('interrupt while the stage connection is still being made', () => {
    function interruptDuringConnect() {
      const controller = new AbortController()
      let finishConnect: () => void = () => {}
      let reachedConnect: () => void = () => {}
      const atConnect = new Promise<void>((resolveReached) => {
        reachedConnect = resolveReached
      })
      const world = fakeWorld({ connecting: () => {
        reachedConnect()
        return new Promise<void>((resolveConnect) => {
          finishConnect = resolveConnect
        })
      } })
      return { controller, world, atConnect, finishConnect: () => finishConnect() }
    }

    it('after-connect lets the connect finish, so teardown closes the browser gracefully instead of only killing', async () => {
      const { controller, world, atConnect, finishConnect } = interruptDuringConnect()
      const session = new AppSessionCore({ repoRoot, profileDir, signal: controller.signal, abortMode: 'after-connect' }, world.deps)
      const starting = session.start({ launch: { logFile: '/dev/null' }, bridge: { step: 'the bridge', timeoutMs: 60_000 } })
      await atConnect
      controller.abort(new Error('interrupted'))
      finishConnect()

      await expect(starting).rejects.toThrow('interrupted')
      expect(world.steps).not.toContain('onboarding')
      const report = await session.teardown({ removeDir: world.removeDir })
      expect(report.browserClose).toEqual({ attempted: true, ok: true, detail: 'Browser.close sent' })
      expect(world.steps.slice(-3)).toEqual(['browser:close', `kill:${root.pid}`, 'lease:release'])
    })

    it('race rejects at once and leaves no browser to close, as smoke and app always did', async () => {
      const { controller, world, atConnect } = interruptDuringConnect()
      const session = new AppSessionCore({ repoRoot, profileDir, signal: controller.signal }, world.deps)
      const starting = session.start({ launch: { logFile: '/dev/null' } })
      await atConnect
      controller.abort(new Error('interrupted'))

      await expect(starting).rejects.toThrow('interrupted')
      const report = await session.teardown({ removeDir: world.removeDir })
      expect(report.browserClose.attempted).toBe(false)
      expect(world.steps).not.toContain('browser:close')
    })
  })
})
