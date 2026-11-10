import type { SmokeOptions } from './args'

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { createRun } from '../evidence/run'
import { AppSessionCore, refuseIfWorktreeBusy } from '../session/app-session'
import { importRig, zipRig } from '../t3/import-rig'
import { desktopStageTargetPattern, stageTargetPattern } from '../t3/launch'
import { captureStagePng } from '../t3/screenshot'
import { checkHostMode } from './host-mode'
import { parseAllowedErrors, scanMainLog, triageErrors } from './triage'

export const defaultAllowListPath = 'packages/qa-tools/fixtures/smoke/allowed-errors.json'

/**
 * One clean start: a fresh profile, onboarding completed, the bridge ready, an optional model import, and a quiet
 * settle period, while every window reports its errors. The CLI owns the exclusive CPU lease and interrupt signal.
 */
export async function runSmoke(options: SmokeOptions, repoRoot: string, signal: AbortSignal) {
  const allowList = parseAllowedErrors(JSON.parse(readFileSync(options.allow ?? resolve(repoRoot, defaultAllowListPath), 'utf8')))
  await refuseIfWorktreeBusy(repoRoot)
  const run = createRun({ tool: 'smoke', label: options.xwayland ? 'clean-start-xwayland' : 'clean-start', repoRoot, outDir: options.out })
  const profileDir = run.path('profile')
  mkdirSync(profileDir)
  const session = AppSessionCore.create({ repoRoot, profileDir, signal })
  const details: Record<string, unknown> = { options }
  const startedAt = Date.now()
  let screenshot: string | null = null
  let failure: string | undefined
  let interruptedRun = false

  try {
    const desktop = options.stageHost === 'desktop'
    // The desktop stage is enabled in the temporary profile the way the setting saves it, so the launch goes through
    // `selectHostMode` and its platform gate. An empty AIRI_STAGE_HOST is not a mode, so it overrides nothing.
    if (desktop)
      writeFileSync(join(profileDir, 'stage-config.json'), `${JSON.stringify({ experimental: true, mode: 'desktop', activeRenderer: 'mmd' })}\n`)
    const { stage, bridge, initialState } = await session.start({
      launch: {
        logFile: run.path('app.log'),
        env: { AIRI_STAGE_HOST: desktop ? '' : 'window' },
        script: options.xwayland ? 'dev:xwayland' : 'dev',
        electronArgs: options.electronArgs,
      },
      onLaunched: app => run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine }),
      // The run attaches to the stage window of the host it expects: a gated platform keeps the classic `#/` window.
      targetPattern: options.expectHost === 'desktop' ? desktopStageTargetPattern : stageTargetPattern,
      collectPageErrors: true,
      bridge: { step: 'the bridge', timeoutMs: 300_000 },
    })
    details.initialState = initialState
    if (options.model) {
      let modelInput = options.model
      if (statSync(modelInput).isDirectory() || ['.pmx', '.pmd'].includes(extname(modelInput).toLowerCase())) {
        modelInput = run.path('model.zip')
        await session.bounded(zipRig(statSync(options.model).isDirectory() ? options.model : dirname(options.model), modelInput))
      }
      details.import = await session.whileRunning('model import', importRig(stage, bridge, modelInput, 600_000, options.kind))
    }
    await session.whileRunning('the settle period', setTimeout(options.settleMs))
    details.state = await session.bounded(bridge.call('state', undefined, 30_000))
    await session.bounded(captureStagePng(stage, run.path('stage.png')))
    screenshot = run.path('stage.png')
  }
  catch (error) {
    interruptedRun = signal.aborted
    failure = errorMessageFrom(error) ?? 'unknown smoke failure'
    const stage = session.stage
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
    try {
      const teardown = await session.teardown({ extraPaths: [run.path('model.zip')] })
      details.teardown = teardown
      if (!teardown.ok)
        failure ??= 'teardown left processes or files behind'
    }
    catch (error) {
      failure ??= `teardown failed: ${errorMessageFrom(error) ?? 'unknown error'}`
    }
  }
  const collector = session.collector

  const appLog = existsSync(run.path('app.log')) ? readFileSync(run.path('app.log'), 'utf8') : ''
  const mainLines = scanMainLog(appLog)
  if (failure === undefined && session.app) {
    const hostModeFailure = checkHostMode(options.expectHost, appLog, collector?.targets ?? [])
    if (hostModeFailure)
      failure = hostModeFailure
  }
  const triage = triageErrors(collector?.errors ?? [], mainLines, allowList)
  const attachErrors = collector?.attachErrors ?? []
  const clean = triage.unexpected.length === 0 && triage.mainUnexpected.length === 0 && attachErrors.length === 0
  const summary = {
    ok: failure === undefined && clean,
    runDir: run.dir,
    failure: failure ?? null,
    expectHost: options.expectHost,
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
