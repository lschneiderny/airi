import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { OwnedProcess } from '../env/processes'
import type { LaunchedApp } from '../t3/launch'
import type { AppOptions } from './args'
import type { SendPath } from './summary'

import process from 'node:process'

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { killTree, listLiveProcesses } from '../env/processes'
import { createRun } from '../evidence/run'
import { loadScript } from '../llm/script'
import { ReplayServer } from '../llm/server'
import { MotionQaBridgeClient } from '../t3/bridge-client'
import { importRig, zipRig } from '../t3/import-rig'
import { connectStage, failOnExit, launchStageTamagotchi } from '../t3/launch'
import { completeOnboarding } from '../t3/onboarding'
import { closeBrowser } from '../t3/run-t3'
import { captureStagePng } from '../t3/screenshot'
import { findWorktreeAppProcesses, teardownRun, trackTree } from '../t3/teardown'
import { buildPlan, buildSeedEntries } from './plan'
import { sendMessage } from './send'
import { buildSummary, matchExpectations } from './summary'

/** One disposable experience session. The CLI owns the exclusive CPU lease and interrupt signal. */
export async function runApp(options: AppOptions, repoRoot: string, signal: AbortSignal) {
  const script = await loadScript(options, repoRoot)
  const selfPids = [process.pid, process.ppid]
  if (findWorktreeAppProcesses(await listLiveProcesses(), repoRoot, selfPids).length)
    throw new Error('Refusing to launch while this worktree already has an Electron session')
  const run = createRun({ tool: 'app', label: 'experience', repoRoot, outDir: options.out })
  const profileDir = run.path('profile')
  mkdirSync(profileDir)
  const events: MotionQaEvent[] = []
  const sendPaths: SendPath[] = []
  const missing: string[] = []
  const details: Record<string, unknown> = { plan: buildPlan(options, run.dir), turns: [] }
  const turns: Record<string, unknown>[] = []
  details.turns = turns
  const startedAt = Date.now()
  let app: LaunchedApp | undefined
  let stage: CdpClient | undefined
  let browserUrl: string | undefined
  let bridge: MotionQaBridgeClient | undefined
  let tracked: OwnedProcess[] = []
  let server: ReplayServer | undefined
  let screenshot: string | null = null
  let failed = false
  let exitCode = 1
  let rejectInterrupted: (reason: unknown) => void = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject
  })
  const onAbort = () => rejectInterrupted(signal.reason ?? new Error('interrupted'))
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted)
    onAbort()
  // A command can fail before reaching the first abortable wait.
  void interrupted.catch(() => {})
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, interrupted])
  const json = (name: string, value: unknown) => writeFileSync(run.path(name), `${JSON.stringify(value, null, 2)}\n`)

  try {
    server = new ReplayServer({ script, log: run.path('requests.jsonl') })
    const baseURL = await server.listen()
    details.replay = { baseURL, source: script.source, entries: script.entries.length }
    signal.throwIfAborted()
    app = await launchStageTamagotchi({ repoRoot, profileDir, logFile: run.path('app.log'), list: listLiveProcesses, env: { AIRI_STAGE_HOST: 'window' } })
    run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine })
    const connected = await bounded(connectStage(app))
    stage = connected.stage
    browserUrl = connected.browserUrl
    tracked = trackTree(await listLiveProcesses(), app.root)
    details.launch = { env: app.env, targetUrl: connected.targetUrl }
    const page = stage
    await bounded(page.evaluate(`(() => {
      for (const [key, value] of Object.entries(${JSON.stringify(buildSeedEntries(baseURL))}))
        localStorage.setItem(key, value)
    })()`, options.timeoutMs))
    await bounded(completeOnboarding(page))
    bridge = new MotionQaBridgeClient(page)
    details.initialState = await bounded(failOnExit(app, 'the seeded bridge', bridge.waitForBridge({ timeoutMs: 300_000 })))

    let modelInput = options.model
    const extension = extname(modelInput).toLowerCase()
    if (statSync(modelInput).isDirectory() || ['.pmx', '.pmd'].includes(extension)) {
      modelInput = run.path('model.zip')
      await bounded(zipRig(statSync(options.model).isDirectory() ? options.model : dirname(options.model), modelInput))
    }
    details.import = await bounded(failOnExit(app, 'model import', importRig(page, bridge, modelInput, 600_000, options.kind)))
    const client = bridge
    for (const text of options.say) {
      signal.throwIfAborted()
      const before = await bounded(client.call('events', {}, options.timeoutMs))
      const sinceSeq = before.lastSeq
      const turnStart = Date.now()
      const sendPath = await bounded(sendMessage({ port: app.port, bridge: client, text, timeoutMs: options.timeoutMs }))
      sendPaths.push(sendPath)
      let lastSeq = sinceSeq
      const turnEvents: MotionQaEvent[] = []
      // A completed turn is always required before another message can begin.
      const expected = [...new Set([...options.expect, 'turn' as const])]
      let pending = matchExpectations(turnEvents, expected, sinceSeq)
      let dropped = 0
      try {
        while (pending.length) {
          signal.throwIfAborted()
          const remaining = options.timeoutMs - (Date.now() - turnStart)
          if (remaining <= 0)
            throw new Error(`Expected events timed out: ${pending.join(', ')}`)
          const result = await bounded(failOnExit(app, 'expected events', client.call('events', { sinceSeq: lastSeq }, Math.min(remaining, 10_000))))
          if (result.events.length && result.events[0].seq > lastSeq + 1)
            throw new Error('Event log overflowed between polls; diagnostics are incomplete')
          lastSeq = result.lastSeq
          dropped = result.dropped
          turnEvents.push(...result.events)
          pending = matchExpectations(turnEvents, expected, sinceSeq)
          if (pending.length)
            await setTimeout(Math.min(100, remaining), undefined, { signal })
        }
      }
      finally {
        events.push(...turnEvents)
        missing.push(...pending)
        turns.push({ text, sendPath, sinceSeq, lastSeq, dropped, missing: pending, durationMs: Date.now() - turnStart })
      }
    }
    details.state = await bounded(client.call('state', undefined, options.timeoutMs))
    await bounded(captureStagePng(page, run.path('stage.png')))
    screenshot = run.path('stage.png')
    exitCode = 0
    if (options.keepOpen) {
      process.stderr.write('qa:app: keeping the app open; interrupt to tear down\n')
      await bounded(app.exited.then(() => {
        throw new Error('App closed during --keep-open')
      }))
    }
  }
  catch (error) {
    failed = true
    exitCode = signal.aborted ? 130 : 1
    details.error = errorMessageFrom(error) ?? 'unknown run failure'
    // Failure evidence is best effort; neither diagnostics nor screenshots may prevent teardown.
    if (stage && !signal.aborted) {
      try {
        details.state = await bridge?.call('state', undefined, 5_000)
        await captureStagePng(stage, run.path('stage.png'), 5_000)
        screenshot = run.path('stage.png')
      }
      catch (captureError) {
        details.captureError = errorMessageFrom(captureError)
      }
    }
  }
  finally {
    signal.removeEventListener('abort', onAbort)
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
      if (!teardown.ok) {
        failed = true
        exitCode = exitCode === 0 ? 1 : exitCode
      }
    }
    catch (error) {
      failed = true
      exitCode = exitCode === 0 ? 1 : exitCode
      details.teardownError = errorMessageFrom(error)
    }
    stage?.close()
    try {
      await server?.close()
    }
    catch (error) {
      failed = true
      exitCode = exitCode === 0 ? 1 : exitCode
      details.serverCloseError = errorMessageFrom(error)
    }
  }
  details.events = events
  details.sendPaths = sendPaths
  details.durationMs = Date.now() - startedAt
  details.requests = existsSync(run.path('requests.jsonl')) ? readFileSync(run.path('requests.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  json('diagnostics.json', details)
  const summary = buildSummary({ runDir: run.dir, model: options.model, sendPaths, events, missing, screenshot, diagnostics: run.path('diagnostics.json'), durationMs: Date.now() - startedAt, failed })
  json('summary.json', summary)
  for (const name of ['diagnostics.json', 'summary.json', 'requests.jsonl', 'stage.png', 'app.log']) {
    if (existsSync(run.path(name)))
      run.addArtifact(name, name.endsWith('.png') ? 'screenshot' : 'diagnostics')
  }
  run.finish({ exitCode, summary: summary.ok ? 'Experience expectations passed' : 'Experience run failed; see diagnostics.json' })
  return { exitCode, summary }
}
