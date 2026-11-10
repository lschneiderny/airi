import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { AppOptions } from './args'
import type { SendPath } from './summary'

import process from 'node:process'

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { createRun } from '../evidence/run'
import { loadScript } from '../llm/script'
import { ReplayServer } from '../llm/server'
import { AppSessionCore, refuseIfWorktreeBusy } from '../session/app-session'
import { importRig, zipRig } from '../t3/import-rig'
import { captureStagePng } from '../t3/screenshot'
import { buildPlan, buildSeedEntries } from './plan'
import { sendMessage } from './send'
import { buildSummary, matchExpectations } from './summary'

/** One disposable experience session. The CLI owns the exclusive CPU lease and interrupt signal. */
export async function runApp(options: AppOptions, repoRoot: string, signal: AbortSignal) {
  const script = await loadScript(options, repoRoot)
  await refuseIfWorktreeBusy(repoRoot)
  const run = createRun({ tool: 'app', label: 'experience', repoRoot, outDir: options.out })
  const profileDir = run.path('profile')
  mkdirSync(profileDir)
  const session = AppSessionCore.create({ repoRoot, profileDir, signal })
  const events: MotionQaEvent[] = []
  const sendPaths: SendPath[] = []
  const missing: string[] = []
  const details: Record<string, unknown> = { plan: buildPlan(options, run.dir), turns: [] }
  const turns: Record<string, unknown>[] = []
  details.turns = turns
  const startedAt = Date.now()
  let server: ReplayServer | undefined
  let screenshot: string | null = null
  let failed = false
  let exitCode = 1
  const bounded = <T>(work: Promise<T>): Promise<T> => session.bounded(work)
  const json = (name: string, value: unknown) => writeFileSync(run.path(name), `${JSON.stringify(value, null, 2)}\n`)

  try {
    server = new ReplayServer({ script, log: run.path('requests.jsonl') })
    const baseURL = await server.listen()
    details.replay = { baseURL, source: script.source, entries: script.entries.length }
    const started = await session.start({
      launch: { logFile: run.path('app.log'), env: { AIRI_STAGE_HOST: 'window' } },
      onLaunched: launched => run.recordProcess({ rootPid: launched.root.pid, created: launched.root.created, commandLine: launched.root.commandLine }),
      collectPageErrors: true,
      beforeOnboarding: async ({ stage, app, targetUrl }) => {
        details.launch = { env: app.env, targetUrl }
        await stage.evaluate(`(() => {
          for (const [key, value] of Object.entries(${JSON.stringify(buildSeedEntries(baseURL))}))
            localStorage.setItem(key, value)
        })()`, options.timeoutMs)
      },
      bridge: { step: 'the seeded bridge', timeoutMs: 300_000 },
    })
    const { app, stage: page } = started
    details.initialState = started.initialState

    let modelInput = options.model
    const extension = extname(modelInput).toLowerCase()
    if (statSync(modelInput).isDirectory() || ['.pmx', '.pmd'].includes(extension)) {
      modelInput = run.path('model.zip')
      await bounded(zipRig(statSync(options.model).isDirectory() ? options.model : dirname(options.model), modelInput))
    }
    details.import = await session.whileRunning('model import', importRig(page, started.bridge, modelInput, 600_000, options.kind))
    const client = started.bridge
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
          const result = await session.whileRunning('expected events', client.call('events', { sinceSeq: lastSeq }, Math.min(remaining, 10_000)))
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
    const stage = session.stage
    if (stage && !signal.aborted) {
      try {
        details.state = await session.bridge?.call('state', undefined, 5_000)
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
    try {
      await server?.close()
    }
    catch (error) {
      failed = true
      exitCode = exitCode === 0 ? 1 : exitCode
      details.serverCloseError = errorMessageFrom(error)
    }
  }
  const collector = session.collector
  details.events = events
  details.sendPaths = sendPaths
  details.pageErrors = collector?.errors ?? []
  details.pageErrorWindows = collector?.targets ?? []
  details.durationMs = Date.now() - startedAt
  details.requests = existsSync(run.path('requests.jsonl')) ? readFileSync(run.path('requests.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  json('diagnostics.json', details)
  const summary = buildSummary({ runDir: run.dir, model: options.model, sendPaths, events, missing, screenshot, diagnostics: run.path('diagnostics.json'), durationMs: Date.now() - startedAt, failed, pageErrors: collector?.errors.length ?? 0 })
  json('summary.json', summary)
  for (const name of ['diagnostics.json', 'summary.json', 'requests.jsonl', 'stage.png', 'app.log']) {
    if (existsSync(run.path(name)))
      run.addArtifact(name, name.endsWith('.png') ? 'screenshot' : 'diagnostics')
  }
  run.finish({ exitCode, summary: summary.ok ? 'Experience expectations passed' : 'Experience run failed; see diagnostics.json' })
  return { exitCode, summary }
}
