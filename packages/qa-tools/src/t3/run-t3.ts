import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionQaRunScenarioResult, MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import type { OwnedProcess } from '../env/processes'
import type { RunHandle } from '../evidence/run'
import type { ResolvedRig } from './args'
import type { LaunchedApp } from './launch'
import type { TakenScreenshot } from './screenshot'
import type { TeardownReport } from './teardown'

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { CdpClient, waitFor } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { killTree, listLiveProcesses } from '../env/processes'
import { createRun } from '../evidence/run'
import { MotionQaBridgeClient } from './bridge-client'
import { parkCursor } from './cursor'
import { toRenderedExpressionIds } from './expression-ids'
import { importRig, zipRig } from './import-rig'
import { connectStage, failOnExit, launchStageTamagotchi } from './launch'
import { completeOnboarding } from './onboarding'
import { planPointerSteps, playPointer, readPointerDesktop } from './pointer'
import { assertStageAnimating, captureStagePng, planScreenshots, untilDeadline } from './screenshot'
import { findWorktreeAppProcesses, teardownRun, trackTree } from './teardown'
import { captureMarkerPrefix, parseTraceEvents, verifyT3Run } from './verify-trace'

export interface RunT3Options {
  repoRoot: string
  rig: ResolvedRig
  scenario: MotionScenario
  scenarioSource: string
  /** The rig's expression catalog; maps scenario expression ids to the app's archive paths. */
  catalog: readonly CatalogEntry[]
  keepOpen: boolean
  /** Aborted on Ctrl+C; the run stops its current wait and tears down. */
  signal: AbortSignal
  log: (line: string) => void
  /** PIDs that are never treated as the run's processes (this CLI and its parent). */
  selfPids: readonly number[]
}

export interface RunT3Result {
  exitCode: number
  summary: string
  runDir?: string
  teardown?: TeardownReport
}

/** Bounds of the run's waits; every CDP call also has its own timeout. */
const bounds = {
  dispatcherMs: 300_000,
  bridgeMs: 300_000,
  importMs: 600_000,
  commandMs: 30_000,
}

/**
 * The Natural screen-aware attention setting a T3 run configures: on iff the scenario has a `placement` or `chat-*` event.
 * Runs always pass it explicitly, because the T3 profile persists localStorage and the setting defaults to on.
 */
export function t3ScreenAwareness(scenario: MotionScenario): boolean {
  return scenario.events.some(event => event.kind === 'placement' || event.kind.startsWith('chat-'))
}

function sleep(ms: number) {
  return new Promise<void>(resolveSleep => setTimeout(resolveSleep, ms))
}

async function closeBrowser(browserUrl: string): Promise<void> {
  const browser = await CdpClient.connect(browserUrl, 5_000)
  try {
    await browser.send('Browser.close', {}, 5_000)
  }
  catch (error) {
    // The browser may close its socket before answering; that is the expected outcome.
    if (!/socket (?:closed|errored)/i.test(errorMessageFrom(error) ?? ''))
      throw error
  }
  finally {
    browser.close()
  }
}

function writeJson(run: RunHandle, name: string, value: unknown) {
  writeFileSync(run.path(name), `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * One rendered run: launch with a fresh profile, complete onboarding, import the rig, configure Natural, park the
 * cursor, capture while the scenario runs through the bridge, take screenshots, verify the trace, and always tear down.
 * Exit codes: 0 verified, 1 failure (including a failed teardown), 2 refused before launch, 130 interrupted.
 */
export async function runT3(options: RunT3Options): Promise<RunT3Result> {
  const { repoRoot, scenario, log, signal } = options
  const cursorAttention = scenario.events.some(event => event.kind === 'pointer')
  if (cursorAttention && platform !== 'win32')
    return { exitCode: 2, summary: 'pointer-platform-unsupported: real pointer runs require Windows' }
  const conflicts = findWorktreeAppProcesses(await listLiveProcesses(), repoRoot, options.selfPids)
  if (conflicts.length > 0) {
    return {
      exitCode: 2,
      summary: `Refusing to launch: Electron/stage-tamagotchi processes of this worktree are running (${conflicts.map(entry => entry.pid).join(', ')}). Stop that session first; the harness never kills processes it did not start.`,
    }
  }

  const run = createRun({ tool: 'motion', label: `t3-${scenario.id}`.replaceAll(/[^\w.-]/g, '-'), repoRoot })
  const profileDir = run.path('profile')
  const zipPath = run.path('rig.zip')
  mkdirSync(run.path('screenshots'))
  writeJson(run, 'scenario.json', scenario)
  log(`qa-tools t3: run dir ${run.dir}`)

  let abortListener: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(signal.reason instanceof Error ? signal.reason : new Error('interrupted'))
    if (signal.aborted)
      abortListener()
    else
      signal.addEventListener('abort', abortListener, { once: true })
  })
  aborted.catch(() => {})
  const abortable = <T>(work: Promise<T>) => Promise.race([work, aborted])

  let app: LaunchedApp | undefined
  let stage: CdpClient | undefined
  let browserUrl: string | undefined
  let tracked: OwnedProcess[] = []
  let exitCode = 1
  let summary = 'not started'
  const bridgeLog: Record<string, unknown> = {}
  const pointerAbort = new AbortController()
  let pointerPlayback: ReturnType<typeof playPointer> | undefined
  let cursorParked = false

  try {
    const zipped = await abortable(zipRig(options.rig.modelDir, zipPath))
    bridgeLog.rig = { name: options.rig.name, model3: options.rig.model3.slice(options.rig.root.length).replaceAll('\\', '/'), ...zipped }
    log(`qa-tools t3: zipped ${zipped.files} rig files (${zipped.bytes} bytes); launching stage-tamagotchi`)

    app = await launchStageTamagotchi({ repoRoot, profileDir, logFile: run.path('app.log'), list: listLiveProcesses })
    run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine })
    writeJson(run, 'launch.json', { env: app.env, root: app.root })
    log(`qa-tools t3: root PID ${app.root.pid}, remote debug port ${app.port}`)

    const launched = app
    const connected = await abortable(connectStage(launched))
    stage = connected.stage
    browserUrl = connected.browserUrl
    tracked = trackTree(await listLiveProcesses(), launched.root)
    log(`qa-tools t3: connected to ${connected.targetUrl}`)

    const stagePage = stage
    await abortable(failOnExit(launched, 'the motion QA dispatcher', waitFor('motion QA dispatcher', async () => {
      return await stagePage.evaluate<boolean>('typeof globalThis.__airiMotionQa?.dispatch === \'function\'', 10_000) ? true : undefined
    }, bounds.dispatcherMs, 500)))
    await abortable(completeOnboarding(stagePage))
    const bridge = new MotionQaBridgeClient(stagePage)
    bridgeLog.initialState = await abortable(failOnExit(launched, 'the motion QA bridge', bridge.waitForBridge({ timeoutMs: bounds.bridgeMs })))
    log('qa-tools t3: bridge answered; importing the rig')

    bridgeLog.import = await abortable(failOnExit(launched, 'the rig import', importRig(stagePage, bridge, zipPath, bounds.importMs)))
    bridgeLog.configured = await abortable(bridge.call('configure', { driver: 'natural', cursorAttention, expressionEnabled: true, screenAwareness: t3ScreenAwareness(scenario), heldEmotions: scenario.settings?.heldEmotions ?? true }, bounds.commandMs))
    bridgeLog.cursorAttention = cursorAttention
    bridgeLog.fadeOnHover = await abortable(stagePage.evaluate('JSON.parse(localStorage.getItem("controls-island/fade-on-hover-enabled") ?? "false")'))
    if (cursorAttention)
      bridgeLog.frames = await abortable(assertStageAnimating(stagePage))
    const pointerState = cursorAttention ? await abortable(bridge.call('state', undefined, bounds.commandMs)) : undefined
    if (pointerState && !pointerState.modelLoaded)
      throw new Error('pointer-model-unavailable: model load has not committed')
    bridgeLog.pointerState = pointerState
    let steps: ReturnType<typeof planPointerSteps>['steps'] = []
    if (pointerState) {
      const windowCss = await abortable(stagePage.evaluate<{ width: number, height: number }>('({ width: innerWidth, height: innerHeight })'))
      bridgeLog.pointerGeometry = { head: pointerState.head, windowCss, screen: pointerState.screen }
      log(`qa-tools t3: pointer geometry headCss=${JSON.stringify(pointerState.head)} windowCss=${JSON.stringify(windowCss)}`)
      if (pointerState.head && pointerState.head.width > windowCss.width / 2)
        throw new Error(`pointer-head-implausible: head width ${pointerState.head.width} CSS px exceeds half window width ${windowCss.width / 2} CSS px`)
      const desktop = await abortable(readPointerDesktop())
      bridgeLog.virtualScreen = desktop
      // Refuse before even parking: neither the declared nor a mirrored path may move outside the desktop.
      const plan = planPointerSteps(scenario.events, pointerState, desktop)
      steps = plan.steps
      bridgeLog.pointerPlan = plan
      log(`qa-tools t3: pointer plan ${steps.length} steps, mirrored=${plan.mirrored ?? 'none'}, virtualScreen=${JSON.stringify(desktop)}`)
    }
    const parked = await abortable(parkCursor())
    bridgeLog.cursor = parked
    if (!parked.ok)
      throw new Error(`Cursor parking failed: ${parked.reason}`)
    cursorParked = true
    tracked = [...tracked, ...trackTree(await listLiveProcesses(), launched.root)]

    if (!cursorAttention)
      bridgeLog.frames = await abortable(assertStageAnimating(stagePage))

    const captureSeconds = Math.min(600, scenario.durationSeconds + 1)
    const capture = await abortable(bridge.call('startCapture', { durationSeconds: captureSeconds, label: run.runId }, bounds.commandMs))
    const captureRendererMs = await abortable(bridge.rendererNowMs())
    const rendered = toRenderedExpressionIds(scenario, options.catalog)
    bridgeLog.expressionIds = rendered.mapped
    const started = await abortable(bridge.start('runScenario', { scenario: rendered.scenario }, bounds.commandMs))
    const rendererNowMs = await abortable(bridge.rendererNowMs())
    const hostOriginMs = Date.now() - (rendererNowMs - started.rendererStartMs)
    if (cursorAttention) {
      pointerPlayback = playPointer(steps, Math.round(hostOriginMs), pointerAbort.signal)
      // The screenshot loop can still be running when playback rejects.
      pointerPlayback.catch(() => {})
    }
    bridgeLog.capture = { ...capture, durationSeconds: captureSeconds }
    log(`qa-tools t3: capture ${capture.captureId} (${captureSeconds} s) and scenario ${scenario.id} started`)

    const taken: TakenScreenshot[] = []
    for (const shot of planScreenshots(scenario.screenshotsAt ?? [])) {
      await abortable(untilDeadline(hostOriginMs + shot.at * 1000))
      const rendererMs = await abortable(bridge.rendererNowMs())
      await abortable(captureStagePng(stagePage, run.path(join('screenshots', shot.file))))
      taken.push({ ...shot, actualAt: (rendererMs - started.rendererStartMs) / 1000, traceT: (rendererMs - captureRendererMs) / 1000 })
    }

    const scenarioResult: MotionQaRunScenarioResult = await abortable(started.settle((scenario.durationSeconds + 60) * 1000))
    bridgeLog.runScenario = scenarioResult
    if (pointerPlayback)
      bridgeLog.pointer = await abortable(pointerPlayback)
    const { trace } = await abortable(bridge.call('awaitCapture', { captureId: capture.captureId }, captureSeconds * 1000 + 120_000))
    writeJson(run, 'trace.json', trace)
    const traceEvents = parseTraceEvents(trace)
    // The capture marker is stamped when startCapture returns, right before `captureRendererMs` is read.
    const marker = traceEvents.events.find(entry => entry.source === 'scenario' && entry.event.kind === 'marker' && entry.event.label.startsWith(captureMarkerPrefix))
    writeJson(run, 'screenshots.json', taken.map(shot => ({ ...shot, traceT: shot.traceT + (marker?.t ?? 0) })))

    const verification = verifyT3Run({
      scenario,
      run: scenarioResult,
      trace: traceEvents,
      screenshots: readdirSync(run.path('screenshots')).filter(file => file.endsWith('.png')).length,
      scenarioStartTraceT: (started.rendererStartMs - captureRendererMs) / 1000 + (marker?.t ?? 0),
    })
    writeJson(run, 'verification.json', verification)
    exitCode = verification.ok ? 0 : 1
    summary = verification.ok
      ? `T3 ${scenario.id}: PASS: verified ${verification.counts.scenarioEvents} scenario events, ${verification.counts.naturalHolds} Natural holds, ${verification.counts.screenshots} screenshots`
      : `T3 ${scenario.id}: verification failed: ${verification.failures.join('; ')}`
    log(`qa-tools t3: ${summary}`)

    if (options.keepOpen) {
      log('qa-tools t3: --keep-open: the app stays open; press Ctrl+C to tear down')
      await aborted.catch(() => {})
    }
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'unknown error'
    exitCode = signal.aborted && !options.keepOpen ? 130 : 1
    summary = signal.aborted ? `interrupted: ${message}` : `failed: ${message}`
    writeFileSync(run.path('error.txt'), `${error instanceof Error && error.stack ? error.stack : message}\n`)
    log(`qa-tools t3: ${summary}`)
  }
  finally {
    pointerAbort.abort()
    if (pointerPlayback) {
      await pointerPlayback.catch(() => {})
      // A killed PowerShell cannot execute its finally; release LEFTUP from a new owned command before parking.
      try {
        bridgeLog.pointerRelease = await playPointer([], Date.now())
      }
      catch (error) {
        bridgeLog.pointerReleaseError = errorMessageFrom(error)
        exitCode = exitCode === 0 ? 1 : exitCode
        summary += `; pointer release failed: ${errorMessageFrom(error)}`
      }
    }
    if (cursorParked) {
      const parked = await parkCursor()
      bridgeLog.cursorFinally = parked
      if (!parked.ok) {
        exitCode = exitCode === 0 ? 1 : exitCode
        summary += `; final cursor parking failed: ${parked.reason}`
      }
    }
    if (abortListener)
      signal.removeEventListener('abort', abortListener)
  }

  writeJson(run, 'bridge.json', bridgeLog)
  log('qa-tools t3: tearing down')
  const report = await teardownRun(
    { repoRoot, profileDir, root: app?.root, tracked, selfPids: options.selfPids },
    {
      list: listLiveProcesses,
      kill: killTree,
      closeBrowser: browserUrl ? () => closeBrowser(browserUrl!) : undefined,
      waitRootExit: app?.waitExit,
      removeDir: path => rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }),
      sleep,
    },
    [zipPath],
  )
  stage?.close()
  writeJson(run, 'teardown.json', report)
  if (!report.ok) {
    exitCode = exitCode === 0 ? 1 : exitCode
    summary = `${summary}; teardown failed: ${report.leftovers.length} leftover processes${report.refused.length > 0 ? `, ${report.refused.join('; ')}` : ''}`
  }
  log(`qa-tools t3: teardown ${report.ok ? 'ok' : 'FAILED'}: ${report.kills.length} tree kills, ${report.leftovers.length} leftovers, profile removed: ${report.profileRemoved}`)

  for (const [name, kind] of [['scenario.json', 'scenario'], ['launch.json', 'launch'], ['trace.json', 'trace'], ['screenshots.json', 'screenshots-index'], ['verification.json', 'verification'], ['bridge.json', 'bridge-log'], ['teardown.json', 'teardown'], ['app.log', 'log'], ['error.txt', 'error']] as const) {
    if (existsSync(run.path(name)))
      run.addArtifact(name, kind)
  }
  for (const file of readdirSync(run.path('screenshots')).sort())
    run.addArtifact(join('screenshots', file), 'screenshot')
  run.finish({ exitCode, summary })
  return { exitCode, summary, runDir: run.dir, teardown: report }
}
