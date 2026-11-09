import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import type { OwnedProcess } from '../env/processes'
import type { LaunchedApp } from '../t3/launch'
import type { SmokeOptions } from './args'

import process from 'node:process'

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { killTree, listLiveProcesses } from '../env/processes'
import { createRun } from '../evidence/run'
import { MotionQaBridgeClient } from '../t3/bridge-client'
import { importRig, zipRig } from '../t3/import-rig'
import { connectStage, desktopStageTargetPattern, failOnExit, launchStageTamagotchi, stageTargetPattern } from '../t3/launch'
import { completeOnboarding } from '../t3/onboarding'
import { closeBrowser } from '../t3/run-t3'
import { captureStagePng } from '../t3/screenshot'
import { findWorktreeAppProcesses, teardownRun, trackTree } from '../t3/teardown'
import { PageErrorCollector } from './page-errors'
import { parseAllowedErrors, scanMainLog, triageErrors } from './triage'

export const defaultAllowListPath = 'packages/qa-tools/fixtures/smoke/allowed-errors.json'

/**
 * One clean start: a fresh profile, onboarding completed, the bridge ready, an optional model import, and a quiet
 * settle period, while every window reports its errors. The CLI owns the exclusive CPU lease and interrupt signal.
 */
export async function runSmoke(options: SmokeOptions, repoRoot: string, signal: AbortSignal) {
  const allowList = parseAllowedErrors(JSON.parse(readFileSync(options.allow ?? resolve(repoRoot, defaultAllowListPath), 'utf8')))
  const selfPids = [process.pid, process.ppid]
  if (findWorktreeAppProcesses(await listLiveProcesses(), repoRoot, selfPids).length)
    throw new Error('Refusing to launch while this worktree already has an Electron session')
  const run = createRun({ tool: 'smoke', label: 'clean-start', repoRoot, outDir: options.out })
  const profileDir = run.path('profile')
  mkdirSync(profileDir)
  const details: Record<string, unknown> = { options }
  const startedAt = Date.now()
  let app: LaunchedApp | undefined
  let stage: CdpClient | undefined
  let browserUrl: string | undefined
  let collector: PageErrorCollector | undefined
  let tracked: OwnedProcess[] = []
  let screenshot: string | null = null
  let failure: string | undefined
  let interruptedRun = false
  const interrupted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('interrupted'))
    if (signal.aborted)
      onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
  })
  void interrupted.catch(() => {})
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, interrupted])

  try {
    const desktop = options.stageHost === 'desktop'
    // The desktop stage is enabled in the temporary profile the way the setting saves it, so the launch goes through
    // `selectHostMode` and its platform gate. An empty AIRI_STAGE_HOST is not a mode, so it overrides nothing.
    if (desktop)
      writeFileSync(join(profileDir, 'stage-config.json'), `${JSON.stringify({ experimental: true, mode: 'desktop', activeRenderer: 'mmd' })}\n`)
    app = await launchStageTamagotchi({ repoRoot, profileDir, logFile: run.path('app.log'), list: listLiveProcesses, env: { AIRI_STAGE_HOST: desktop ? '' : 'window' } })
    run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine })
    const connected = await bounded(connectStage(app, desktop ? desktopStageTargetPattern : stageTargetPattern))
    stage = connected.stage
    browserUrl = connected.browserUrl
    tracked = trackTree(await listLiveProcesses(), app.root)
    collector = new PageErrorCollector(app.port)
    await bounded(collector.start())
    await bounded(completeOnboarding(stage))
    const bridge = new MotionQaBridgeClient(stage)
    details.initialState = await bounded(failOnExit(app, 'the bridge', bridge.waitForBridge({ timeoutMs: 300_000 })))
    if (options.model) {
      let modelInput = options.model
      if (statSync(modelInput).isDirectory() || ['.pmx', '.pmd'].includes(extname(modelInput).toLowerCase())) {
        modelInput = run.path('model.zip')
        await bounded(zipRig(statSync(options.model).isDirectory() ? options.model : dirname(options.model), modelInput))
      }
      details.import = await bounded(failOnExit(app, 'model import', importRig(stage, bridge, modelInput, 600_000, options.kind)))
    }
    await bounded(failOnExit(app, 'the settle period', setTimeout(options.settleMs)))
    details.state = await bounded(bridge.call('state', undefined, 30_000))
    await bounded(captureStagePng(stage, run.path('stage.png')))
    screenshot = run.path('stage.png')
  }
  catch (error) {
    interruptedRun = signal.aborted
    failure = errorMessageFrom(error) ?? 'unknown smoke failure'
    if (stage && !signal.aborted) {
      try {
        await captureStagePng(stage, run.path('stage.png'), 5_000)
        screenshot = run.path('stage.png')
      }
      catch (captureError) {
        details.captureError = errorMessageFrom(captureError)
      }
    }
  }
  finally {
    await collector?.stop()
    const browser = browserUrl
    try {
      const teardown = await teardownRun({ repoRoot, profileDir, root: app?.root, tracked, selfPids }, {
        list: listLiveProcesses,
        kill: killTree,
        closeBrowser: browser ? () => closeBrowser(browser) : undefined,
        waitRootExit: app?.waitExit,
        removeDir: path => rmSync(path, { recursive: true, force: true }),
        sleep: async (ms) => { await setTimeout(ms) },
      }, [run.path('model.zip')])
      details.teardown = teardown
      if (!teardown.ok)
        failure ??= 'teardown left processes or files behind'
    }
    catch (error) {
      failure ??= `teardown failed: ${errorMessageFrom(error) ?? 'unknown error'}`
    }
    finally {
      app?.releaseLease()
    }
    stage?.close()
  }

  const mainLines = existsSync(run.path('app.log')) ? scanMainLog(readFileSync(run.path('app.log'), 'utf8')) : []
  const triage = triageErrors(collector?.errors ?? [], mainLines, allowList)
  const attachErrors = collector?.attachErrors ?? []
  const clean = triage.unexpected.length === 0 && triage.mainUnexpected.length === 0 && attachErrors.length === 0
  const summary = {
    ok: failure === undefined && clean,
    runDir: run.dir,
    failure: failure ?? null,
    windows: collector?.targets ?? [],
    errors: triage.unexpected.length,
    mainErrors: triage.mainUnexpected.length,
    allowed: triage.allowed.length + triage.mainAllowed.length,
    unwatchedWindows: attachErrors,
    firstErrors: [...triage.unexpected.map(error => `${error.target} ${error.kind}: ${error.text.split('\n')[0]}`), ...triage.mainUnexpected].slice(0, 5),
    screenshot,
    durationMs: Date.now() - startedAt,
  }
  const json = (name: string, value: unknown) => writeFileSync(run.path(name), `${JSON.stringify(value, null, 2)}\n`)
  json('errors.json', { ...triage, attachErrors })
  json('diagnostics.json', details)
  json('summary.json', summary)
  for (const name of ['summary.json', 'errors.json', 'diagnostics.json', 'stage.png', 'app.log']) {
    if (existsSync(run.path(name)))
      run.addArtifact(name, name.endsWith('.png') ? 'screenshot' : 'diagnostics')
  }
  const exitCode = interruptedRun ? 130 : summary.ok ? 0 : 1
  run.finish({ exitCode, summary: summary.ok ? 'Clean start: no unexpected errors' : failure ?? `${summary.errors + summary.mainErrors} unexpected errors; see errors.json` })
  return { exitCode, summary }
}
