import type { Lease } from '@proj-airi/cpu-slots'

import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { createRun } from '../evidence/run'
import { AppSessionCore, refuseIfWorktreeBusy } from '../session/app-session'
import { importRig, zipRig } from '../t3/import-rig'
import { desktopStageTargetPattern } from '../t3/launch'
import { captureStagePng } from '../t3/screenshot'
import { stageHandOffColumns } from './gates'
import { diagnosticsChannel } from './measure'

export interface StageHandOffRecord {
  kind: 'stage-handoff'
  version: 1
  model: string
  loadedModelKey: string | null
  /** Why the scenario could not run: one display, hand-off is off on this host, or the walk broke. `null` when it ran. */
  refusal: string | null
  /** Every display's ground line on the row, in model units. */
  reach: { minX: number, maxX: number }[]
  /** Where she stood and the camera origin before the walk. */
  from: { rootX: number, originX: number } | null
  /** The walk goals in order: the middle of the nearest ground line she was not on, then the spot she started from. */
  goals: number[]
  /** A goal was not reached within the time limit; the walk ended there. */
  timedOut: boolean
  /** The state one second after she stopped; `viewWidth` is the stage window's width in DIP. */
  final: { rootX: number, originX: number, mode: string, placementX: number | null, placementWidth: number | null, viewWidth: number } | null
  /** A walk timeline in the shape the `stage-walk-skate` gate reads, plus the hand-off columns. */
  perFrameSeries: { columns: readonly string[], rows: unknown[][] }
}

interface Plan {
  loadedModelKey: string | null
  refusal: string | null
  reach: { minX: number, maxX: number }[]
  from: StageHandOffRecord['from']
  /** The middle of the nearest ground line she is not on. */
  awayX: number | null
}

interface Leg {
  timedOut: boolean
  final: NonNullable<StageHandOffRecord['final']>
  /** One row per snapshot in `stageHandOffColumns` order, with `t` on the page's own clock. */
  rows: [number, ...unknown[]][]
}

/** The page-side helpers both expressions share: the diagnostics channel, its commands, and a wait for a snapshot. */
const pagePrelude = `
  const channel = new BroadcastChannel(${JSON.stringify(diagnosticsChannel)})
  const send = (name, value) => channel.postMessage(value === undefined ? { type: 'command', name } : { type: 'command', name, value })
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  let latest = null
  let onSnapshot = null
  let record = null
  channel.addEventListener('message', (event) => {
    const snapshot = event.data?.type === 'snapshot' ? event.data.snapshot : null
    if (!snapshot)
      return
    latest = snapshot
    const now = performance.now()
    record?.(snapshot, now)
    onSnapshot?.(snapshot, now)
  })
  const until = (test, timeoutMs, what) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onSnapshot = null
      reject(new Error('timed out after ' + timeoutMs + ' ms waiting for ' + what))
    }, timeoutMs)
    onSnapshot = (snapshot, now) => {
      if (!test(snapshot, now))
        return
      clearTimeout(timer)
      onSnapshot = null
      resolve(now)
    }
  })`

/**
 * The page side of the plan: it waits for her to stand still and for hand-off to turn on, then names where she stands
 * and the middle of the nearest ground line she is not on. That line belongs to a neighbour, so the window has to
 * follow her once each way.
 */
function planExpression(): string {
  return `(async () => {${pagePrelude}
  try {
    await until(s => s.loadedModelKey && s.world && s.locomotion && s.director, 60000, 'a mounted model on the stage world')
    await until(s => s.locomotion.mode === 'idle' && s.director.goalX === null && s.director.pendingGoal === null && s.action.performing === null, 60000, 'her to stand still')
    // The host turns hand-off on once it reports the window origin and the cursor as live, which can follow the mount.
    await until(s => Array.isArray(s.world.reach) && s.world.reach.length > 1, 30000, 'hand-off to turn on').catch(() => {})
    const reach = latest.world.reach ?? []
    const plan = { loadedModelKey: latest.loadedModelKey, reach, from: null, awayX: null }
    if (reach.length < 2)
      return { ...plan, refusal: 'hand-off is off: the row has one display, or the host does not report the window origin and the cursor as live' }
    const fromX = latest.locomotion.position.x
    const away = zone => Math.max(zone.minX - fromX, fromX - zone.maxX)
    const target = reach.filter(zone => away(zone) > 0).sort((a, b) => away(a) - away(b))[0]
    if (!target)
      return { ...plan, refusal: 'her root is on every ground line of the row' }
    return { ...plan, refusal: null, from: { rootX: fromX, originX: latest.world.originX }, awayX: (target.minX + target.maxX) / 2 }
  }
  finally {
    channel.close()
  }
})()`
}

/**
 * The page side of one leg: it requests a debug walk goal and records every snapshot until she stands there, plus one
 * second. A goal she does not reach within `limitMs` ends the leg as timed out.
 */
function legExpression(goalX: number, limitMs: number): string {
  return `(async () => {${pagePrelude}
  const goalX = ${JSON.stringify(goalX)}
  const rows = []
  record = (s, now) => {
    if (s.locomotion && s.world)
      rows.push([now, s.locomotion.mode, s.locomotion.skate, s.feet?.maxError ?? 0, s.locomotion.position.x, s.world.originX, goalX, s.characterPlacement?.x ?? null, s.characterPlacement?.width ?? null, s.locomotion.skateContact])
  }
  try {
    send('requestGoal', { x: goalX, pace: 'walk' })
    let timedOut = false
    await until(s => s.locomotion.mode !== 'idle', 10000, 'the walk to start')
    await until(s => s.locomotion.mode === 'idle' && Math.abs(s.locomotion.position.x - goalX) <= 0.2, ${limitMs}, 'her to arrive').catch(() => {
      timedOut = true
    })
    await wait(1000)
    const s = latest
    return { timedOut, rows, final: { rootX: s.locomotion.position.x, originX: s.world.originX, mode: s.locomotion.mode, placementX: s.characterPlacement?.x ?? null, placementWidth: s.characterPlacement?.width ?? null, viewWidth: innerWidth } }
  }
  finally {
    record = null
    channel.close()
  }
})()`
}

/**
 * Moves the pointer of the QA display session this process runs in to two positions away from her.
 *
 * A KWin session reports the cursor as live only after it has seen the pointer at two positions, and hand-off stays
 * off until then. A headless session has no hand on the mouse, so the scenario supplies the two positions.
 */
function wakeSessionPointer(repoRoot: string): void {
  const name = process.env.AIRI_QA_DISPLAY_SESSION
  if (process.platform !== 'linux' || !name)
    return
  for (const [x, y] of [[40, 40], [80, 60]])
    execFileSync('pnpm', ['--silent', '--dir', repoRoot, 'qa:display', 'pointer', String(x), String(y), '--name', name], { stdio: 'ignore', timeout: 30_000 })
}

/**
 * Captures every output of the QA display session into `file`, so the picture shows which display she is on. The stage
 * screenshot shows the window's content only. A session that cannot capture (no `spectacle`, not KWin) is skipped.
 */
function captureSessionDisplay(repoRoot: string, file: string): void {
  const name = process.env.AIRI_QA_DISPLAY_SESSION
  if (process.platform !== 'linux' || !name)
    return
  try {
    execFileSync('pnpm', ['--silent', '--dir', repoRoot, 'qa:display', 'shot', file, '--name', name], { stdio: 'ignore', timeout: 60_000 })
  }
  catch {
    // The record and the stage screenshot stand without it.
  }
}

/**
 * Walks her to another display and back in a fresh desktop stage session and records both crossings.
 *
 * Use when:
 * - The session has more than one display, as in `pnpm qa:display run --outputs 2 -- pnpm qa:stage handoff ...`
 *
 * Returns:
 * - The record `qa:stage gate` judges with `stage-handoff` and `stage-walk-skate`, and the run directory with the app
 *   log, a screenshot of the stage window after the walk, and, in a KWin QA display, a capture of every output
 */
export async function runHandOff(options: { repoRoot: string, model: string, limitSeconds: number, signal: AbortSignal, lease: Lease }): Promise<{ record: StageHandOffRecord, runDir: string, teardownOk: boolean }> {
  await refuseIfWorktreeBusy(options.repoRoot)
  const run = createRun({ tool: 'stage', label: 'handoff', repoRoot: options.repoRoot })
  const profileDir = run.path('profile')
  mkdirSync(profileDir)
  const session = AppSessionCore.create({ repoRoot: options.repoRoot, profileDir, signal: options.signal })
  const record: StageHandOffRecord = { kind: 'stage-handoff', version: 1, model: options.model, loadedModelKey: null, refusal: 'the app did not reach the walk', reach: [], from: null, goals: [], timedOut: false, final: null, perFrameSeries: { columns: stageHandOffColumns, rows: [] } }
  let teardownOk = false
  try {
    // The desktop stage is enabled the way the setting saves it, so the launch goes through `selectHostMode`.
    writeFileSync(join(profileDir, 'stage-config.json'), `${JSON.stringify({ experimental: true, mode: 'desktop', activeRenderer: 'mmd' })}\n`)
    const { stage, bridge } = await session.start({
      launch: { lease: options.lease, logFile: run.path('app.log'), env: { AIRI_STAGE_HOST: '' }, script: 'dev' },
      onLaunched: app => run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine }),
      targetPattern: desktopStageTargetPattern,
      collectPageErrors: true,
      bridge: { step: 'the bridge', timeoutMs: 300_000 },
    })
    let modelInput = options.model
    if (statSync(modelInput).isDirectory() || ['.pmx', '.pmd'].includes(extname(modelInput).toLowerCase())) {
      modelInput = run.path('model.zip')
      await session.bounded(zipRig(statSync(options.model).isDirectory() ? options.model : dirname(options.model), modelInput))
    }
    await session.whileRunning('model import', importRig(stage, bridge, modelInput, 600_000, 'mmd'))
    wakeSessionPointer(options.repoRoot)
    const limitMs = options.limitSeconds * 1000
    try {
      const plan = await session.whileRunning('the hand-off plan', stage.evaluate<Plan>(planExpression(), 180_000))
      Object.assign(record, { loadedModelKey: plan.loadedModelKey, refusal: plan.refusal, reach: plan.reach, from: plan.from })
      if (plan.refusal === null && plan.from && plan.awayX !== null) {
        record.goals = [plan.awayX, plan.from.rootX]
        let startAt: number | null = null
        for (const [index, goalX] of record.goals.entries()) {
          const leg = await session.whileRunning('the hand-off walk', stage.evaluate<Leg>(legExpression(goalX, limitMs), limitMs + 60_000))
          startAt ??= leg.rows[0]?.[0] ?? 0
          const origin = startAt
          record.perFrameSeries.rows.push(...leg.rows.map(([t, ...rest]) => [Math.round(t - origin), ...rest]))
          record.final = leg.final
          record.timedOut = leg.timedOut
          // Every output of the session, taken while she stands on the display this leg walked to.
          captureSessionDisplay(options.repoRoot, run.path(index === 0 ? 'display-away.png' : 'display-back.png'))
          if (leg.timedOut)
            break
        }
      }
    }
    catch (error) {
      // A walk that broke is evidence too: the record says why, and the screenshot shows where she is.
      record.refusal = errorMessageFrom(error) ?? 'the hand-off walk failed'
    }
    await session.bounded(captureStagePng(stage, run.path('stage.png')))
  }
  catch (error) {
    record.refusal = errorMessageFrom(error) ?? record.refusal
  }
  finally {
    const teardown = await session.teardown({ extraPaths: [run.path('model.zip')] })
    teardownOk = teardown.ok
  }
  writeFileSync(run.path('handoff.json'), `${JSON.stringify(record, null, 1)}\n`)
  for (const name of ['handoff.json', 'stage.png', 'display-away.png', 'display-back.png', 'app.log']) {
    if (existsSync(run.path(name)))
      run.addArtifact(name, name.endsWith('.png') ? 'screenshot' : 'diagnostics')
  }
  const ok = record.refusal === null && !record.timedOut && teardownOk
  run.finish({ exitCode: ok ? 0 : 1, summary: record.refusal ?? (record.timedOut ? 'She did not reach a goal in time' : 'She walked to the other display and back') })
  return { record, runDir: run.dir, teardownOk }
}
