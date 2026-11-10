import type { Buffer } from 'node:buffer'

import type { OwnedProcess } from '../env/processes'
import type { StageFrameRun, StageMode, StageScenario } from './gates'

import { execFile, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'
import { CdpClient, findDebugTarget, sleep, waitForRemoteDebug } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { killTree, listLiveProcesses } from '../env/processes'
import { failOnExit, launchStageTamagotchi } from '../t3/launch'
import { closeBrowser } from '../t3/run-t3'
import { teardownRun, trackTree } from '../t3/teardown'
import { stageScenarioColumns } from './gates'

/**
 * The K6 measurement of todo 1, productised: it reads the MMD frame measurement through the motion diagnostics
 * BroadcastChannel of the stage target while the OS cursor circles over the character, so the synchronous hit-test
 * readback is part of the measured frames. Both host pages take the cursor from the main process, not from DOM
 * events, so the real cursor must move. A 1 Hz sidecar records the load average and, on macOS, any concurrent
 * heavyweight check (Vitest, tsc, vue-tsc); a run with a hit is INVALID-CONCURRENT-LOAD and is repeated.
 */

const stageTargetPatterns: Record<StageMode, RegExp> = {
  window: /synced-leader=true[^#]*#\/$/,
  desktop: /synced-leader=true[^#]*#\/stage$/,
}

const diagnosticsChannel = 'airi-stores-stage-ui-mmd-motion-diagnostics'
const heavyweightPattern = '[v]itest|[t]sc --noEmit|[v]ue-tsc'
const quietLoadMax = 3

// three-mmd internals and the draw call; every other timed stage is an AIRI pose or surface stage.
const engineStages = new Set(['beforeUpdate', 'restore', 'commands', 'mixer.update', 'updateAnimation', 'capture', 'beforePhysics', 'physics.reset', 'physics.update', 'afterPhysics', 'render'])

interface StageTiming { meanMs: number, p95Ms: number, maxMs: number }

interface Collected {
  snapshots: number
  loadedModelKey: string | null
  driver: string | null
  measurement: { state: string, fps: number, frames: number, durationMs: number, stages: Record<string, StageTiming> } | null
  readbackMs: { max: number, mean: number, windows: number } | null
}

export interface LoadSample { t: number, load1: number, heavyweight: string | null }

export interface StageMeasureAttempt {
  startedAt: string
  pre: { load: number[], heavyweight: string | null }
  samples: LoadSample[]
  heavyweightHits: number
  psBackground: string[] | null
  pointer: { method: 'os' | 'cdp', moves: number }
  verdict: 'VALID' | 'INVALID-CONCURRENT-LOAD'
}

export interface StageMeasureRecord {
  kind: 'stage-measure'
  version: 1
  mode: StageMode
  n?: number
  target: string
  seconds: number
  result: StageFrameRun
  detail: { snapshots: number, loadedModelKey: string | null, driver: string | null, state: string, durationMs: number, stages: Record<string, StageTiming> }
  physicsUpdate: StageTiming | null
  /** The pointer circle in page CSS pixels; `origin` is the window's screen position for the OS cursor. */
  pointer: { cx: number, cy: number, r: number, origin: { x: number, y: number } }
  load: StageMeasureAttempt
  discarded: StageMeasureAttempt[]
  valid: boolean
}

export interface StagePairsRecord {
  kind: 'stage-measure-pairs'
  version: 1
  pairs: number
  seconds: number
  profile: string
  runs: StageMeasureRecord[]
  /** Runs that broke (launch, model mount, CDP); a pairs file with failures does not pass the gate's pair count. */
  failures: { mode: StageMode, n: number, error: string }[]
}

function run(command: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return new Promise((resolveRun) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout) => {
      // pgrep exits 1 when nothing matches; the empty stdout is the answer.
      resolveRun(error && !stdout ? '' : stdout)
    })
  })
}

/**
 * Whether the quiet-machine sidecar may read the host process table. Only macOS does: Windows has no `pgrep`, and on
 * Linux agent QA must not read the user's processes (todo 27), so there the load average is the only quiet signal.
 */
function readsHostProcesses(os: NodeJS.Platform): boolean {
  return os === 'darwin'
}

/** Heavyweight checks running on the host, or `null` where the host process table is not read. */
export async function heavyweightProcesses(os: NodeJS.Platform = platform, exec: typeof run = run): Promise<string | null> {
  if (!readsHostProcesses(os))
    return null
  return (await exec('pgrep', ['-fl', heavyweightPattern])).trim()
}

/** The eight busiest host processes, or `null` where the host process table is not read. */
export async function topCpu(os: NodeJS.Platform = platform, exec: typeof run = run): Promise<string[] | null> {
  if (!readsHostProcesses(os))
    return null
  const listing = await exec('ps', ['-A', '-o', '%cpu=,comm='])
  return listing.split('\n').map(line => line.trim()).filter(Boolean).sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a)).slice(0, 8)
}

async function waitForQuiet(timeoutMs: number, log: (line: string) => void): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = await heavyweightProcesses()
    const load1 = loadavg()[0]
    if (!busy && load1 < quietLoadMax)
      return
    if (Date.now() >= deadline)
      throw new Error(`the machine did not become quiet within ${timeoutMs / 1000} s (load1 ${load1.toFixed(2)}${busy ? `, running: ${busy.replace(/\n/g, '; ')}` : ''})`)
    log(`qa-tools stage: waiting for a quiet machine (load1 ${load1.toFixed(2)}${busy ? ', heavyweight check running' : ''})`)
    await sleep(5_000)
  }
}

function collectExpression(seconds: number): string {
  return `(async () => {
  const channel = new BroadcastChannel(${JSON.stringify(diagnosticsChannel)})
  const snapshots = []
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'snapshot')
      snapshots.push({ measurement: event.data.snapshot.measurement, loadedModelKey: event.data.snapshot.loadedModelKey, driver: event.data.snapshot.driver })
  })
  channel.postMessage({ type: 'command', name: 'startMeasurement' })
  await new Promise(resolve => setTimeout(resolve, ${seconds * 1000}))
  channel.postMessage({ type: 'command', name: 'stopMeasurement' })
  await new Promise(resolve => setTimeout(resolve, 500))
  channel.close()
  const readbacks = snapshots.map(snapshot => snapshot.measurement?.readbackMs).filter(Boolean)
  const last = snapshots.at(-1)
  return {
    snapshots: snapshots.length,
    loadedModelKey: last?.loadedModelKey ?? null,
    driver: last?.driver ?? null,
    measurement: last?.measurement ?? null,
    readbackMs: readbacks.length === 0 ? null : {
      max: Math.max(...readbacks.map(r => r.maxMs)),
      mean: readbacks.reduce((sum, r) => sum + r.meanMs, 0) / readbacks.length,
      windows: readbacks.length,
    },
  }
})()`
}

/** Resolves with the mounted model and the pointer circle: the character's placement in desktop mode, else the viewport centre. */
function mountedExpression(timeoutMs: number): string {
  return `(async () => {
  const channel = new BroadcastChannel(${JSON.stringify(diagnosticsChannel)})
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no snapshot with a loaded model within ${timeoutMs} ms')), ${timeoutMs})
      channel.addEventListener('message', (event) => {
        const snapshot = event.data?.type === 'snapshot' ? event.data.snapshot : null
        if (!snapshot?.loadedModelKey)
          return
        clearTimeout(timer)
        const p = snapshot.characterPlacement
        const cx = p ? p.x + p.width / 2 : innerWidth / 2
        const cy = p ? p.y + p.height * 0.4 : innerHeight / 2
        const r = Math.min(160, (p ? Math.min(p.width, p.height) : Math.min(innerWidth, innerHeight)) * 0.3)
        resolve({ loadedModelKey: snapshot.loadedModelKey, cx, cy, r, origin: { x: screenX, y: screenY } })
      })
    })
  }
  finally {
    channel.close()
  }
})()`
}

async function connectTarget(port: number, mode: StageMode): Promise<{ client: CdpClient, url: string }> {
  const target = await findDebugTarget(port, `the ${mode} stage target`, candidate => candidate.type === 'page' && stageTargetPatterns[mode].test(candidate.url), 120_000)
  if (!target.webSocketDebuggerUrl)
    throw new Error(`the ${mode} stage target ${target.url} has no WebSocket debugger URL`)
  return { client: await CdpClient.connect(target.webSocketDebuggerUrl), url: target.url }
}

/**
 * Circles the OS cursor over the character for `seconds` from one long-lived process and resolves with the number of
 * moves it made, or returns `null` where no OS cursor driver exists (CDP moves are used instead, and the hit test then
 * records no readback).
 */
function startOsWiggle(pointer: { cx: number, cy: number, r: number, origin: { x: number, y: number } }, seconds: number): Promise<number> | null {
  const cx = pointer.origin.x + pointer.cx
  const cy = pointer.origin.y + pointer.cy
  let command: string
  let args: string[]
  if (platform === 'darwin') {
    // CGWarpMouseCursorPosition needs no Accessibility trust.
    command = 'osascript'
    args = ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); var t0 = Date.now(); var n = 0; while (Date.now() - t0 < ${seconds * 1000}) { var a = n * 0.12; $.CGWarpMouseCursorPosition({ x: ${cx} + ${pointer.r} * Math.cos(a), y: ${cy} + ${pointer.r * 0.6} * Math.sin(a) }); n++; delay(0.016) } n`]
  }
  else if (platform === 'win32') {
    command = 'powershell'
    args = ['-NoProfile', '-NonInteractive', '-Command', [
      'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);\' -Name QaWiggle -Namespace Qa',
      `$sw = [Diagnostics.Stopwatch]::StartNew(); $n = 0; while ($sw.ElapsedMilliseconds -lt ${seconds * 1000}) { $a = $n * 0.12; [void][Qa.QaWiggle]::SetCursorPos([int](${cx} + ${pointer.r} * [Math]::Cos($a)), [int](${cy} + ${pointer.r * 0.6} * [Math]::Sin($a))); $n++; Start-Sleep -Milliseconds 16 }; $n`,
    ].join('; ')]
  }
  else {
    return null
  }
  return new Promise((resolveMoves) => {
    let stdout = ''
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += String(chunk)
    })
    child.once('error', () => resolveMoves(0))
    child.once('exit', () => resolveMoves(Number.parseInt(stdout.trim(), 10) || 0))
  })
}

/**
 * Starts the 1 Hz concurrent-load sidecar of one attempt (load average and, on macOS, heavyweight checks and one
 * `ps` listing halfway through `seconds`). `stop` ends it and sets the verdict.
 */
async function startLoadWatch(seconds: number): Promise<{ attempt: StageMeasureAttempt, stop: () => void }> {
  const attempt: StageMeasureAttempt = {
    startedAt: new Date().toISOString(),
    pre: { load: loadavg().map(value => Number(value.toFixed(2))), heavyweight: await heavyweightProcesses() },
    samples: [],
    heavyweightHits: 0,
    psBackground: null,
    pointer: { method: 'cdp', moves: 0 },
    verdict: 'VALID',
  }
  const started = Date.now()
  const sidecar = setInterval(() => {
    void heavyweightProcesses().then((heavyweight) => {
      attempt.samples.push({ t: Math.round((Date.now() - started) / 100) / 10, load1: Number(loadavg()[0].toFixed(2)), heavyweight: heavyweight || null })
      if (heavyweight)
        attempt.heavyweightHits += 1
    })
  }, 1_000)
  const psTimer = setTimeout(() => {
    void topCpu().then((top) => {
      attempt.psBackground = top
    })
  }, seconds * 500)
  return {
    attempt,
    stop: () => {
      clearInterval(sidecar)
      clearTimeout(psTimer)
      attempt.verdict = attempt.heavyweightHits > 0 ? 'INVALID-CONCURRENT-LOAD' : 'VALID'
    },
  }
}

async function measureAttempt(client: CdpClient, seconds: number, pointer: { cx: number, cy: number, r: number, origin: { x: number, y: number } }): Promise<{ collected: Collected, attempt: StageMeasureAttempt }> {
  const { attempt, stop } = await startLoadWatch(seconds)
  const wiggle = startOsWiggle(pointer, seconds)
  let angle = 0
  let moving = false
  const pointerTimer = wiggle
    ? undefined
    : setInterval(() => {
        if (moving)
          return
        moving = true
        angle += 0.35
        const x = Math.round(pointer.cx + pointer.r * Math.cos(angle))
        const y = Math.round(pointer.cy + pointer.r * 0.6 * Math.sin(angle))
        void client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, 5_000)
          .then(() => {
            attempt.pointer.moves += 1
          })
          .catch(() => {})
          .finally(() => {
            moving = false
          })
      }, 50)
  try {
    const collected = await client.evaluate<Collected>(collectExpression(seconds), seconds * 1_000 + 30_000)
    if (wiggle)
      attempt.pointer = { method: 'os', moves: await wiggle }
    return { collected, attempt }
  }
  finally {
    clearInterval(pointerTimer)
    stop()
  }
}

/**
 * Measures the stage on an already mounted model: up to `attempts` runs, repeating a run that saw concurrent load.
 * The record is `valid: false` when every attempt was invalid.
 */
async function measureStage(client: CdpClient, options: { mode: StageMode, target: string, seconds: number, attempts: number, n?: number, log: (line: string) => void }): Promise<StageMeasureRecord> {
  const pointer = await client.evaluate<{ loadedModelKey: string, cx: number, cy: number, r: number, origin: { x: number, y: number } }>(mountedExpression(180_000), 190_000)
  const discarded: StageMeasureAttempt[] = []
  for (let index = 1; ; index += 1) {
    await waitForQuiet(300_000, options.log)
    options.log(`qa-tools stage: measuring ${options.mode}${options.n ? ` pair ${options.n}` : ''} for ${options.seconds} s (attempt ${index}/${options.attempts})`)
    const { collected, attempt } = await measureAttempt(client, options.seconds, pointer)
    if (!collected.measurement)
      throw new Error(`no measurement arrived (${collected.snapshots} snapshots); is an MMD model mounted on the ${options.mode} stage?`)
    if (attempt.verdict === 'VALID' || index >= options.attempts) {
      const stages = collected.measurement.stages
      const p95StageMs = Object.entries(stages).filter(([id]) => !engineStages.has(id)).reduce((sum, [, timing]) => sum + timing.p95Ms, 0)
      return {
        kind: 'stage-measure',
        version: 1,
        mode: options.mode,
        ...(options.n === undefined ? {} : { n: options.n }),
        target: options.target,
        seconds: options.seconds,
        result: { mode: options.mode, fps: collected.measurement.fps, p95StageMs, readbackMs: collected.readbackMs, frames: collected.measurement.frames },
        detail: { snapshots: collected.snapshots, loadedModelKey: collected.loadedModelKey, driver: collected.driver, state: collected.measurement.state, durationMs: collected.measurement.durationMs, stages },
        physicsUpdate: stages['physics.update'] ?? null,
        pointer: { cx: pointer.cx, cy: pointer.cy, r: pointer.r, origin: pointer.origin },
        load: attempt,
        discarded,
        valid: attempt.verdict === 'VALID',
      }
    }
    options.log(`qa-tools stage: attempt ${index} INVALID-CONCURRENT-LOAD (${attempt.heavyweightHits} sidecar hits), repeating`)
    discarded.push(attempt)
  }
}

export async function measureAttached(options: { port: number, mode: StageMode, seconds: number, attempts: number, log: (line: string) => void }): Promise<StageMeasureRecord> {
  const { client, url } = await connectTarget(options.port, options.mode)
  try {
    return await measureStage(client, { ...options, target: url })
  }
  finally {
    client.close()
  }
}

export interface StageScenarioRecord {
  kind: 'stage-scenario'
  version: 1
  scenario: StageScenario
  clip: string
  mode: StageMode
  target: string
  /** gesture-walk: the walk span to reach with the clip on the upper layer; action-preempt: playing time before the stop. */
  seconds: number
  loadedModelKey: string | null
  /** The walk goal in model units: 600 DIP from the start toward the side with more ground, clamped to the ground. */
  goal: { fromX: number, x: number, dip: number, unitsPerDip: number }
  /** ms after the playClip post at which stopClip was posted. */
  stopAtMs: number | null
  /** The director's refusal of the playClip request, when it never performed. */
  refusal: string | null
  /** action-preempt: no goal was issued within 10 s after the stop. */
  timedOut: boolean
  measurement: { fps: number, frames: number, durationMs: number, p95StageMs: number, stages: Record<string, StageTiming> } | null
  series: { columns: string[], rows: unknown[][] }
  load: StageMeasureAttempt
  discarded: StageMeasureAttempt[]
  valid: boolean
}

interface ScenarioCollected {
  loadedModelKey: string | null
  goal: StageScenarioRecord['goal']
  stopAtMs: number | null
  refusal: string | null
  /** The director's retry time for a refused request (set for action and dance refractories). */
  retryAfterMs: number | null
  timedOut: boolean
  measurement: { fps: number, frames: number, durationMs: number, stages: Record<string, StageTiming> } | null
  rows: unknown[][]
}

/**
 * The page side of a scenario. It waits for her to stand still, starts the frame measurement, requests a walk goal
 * 600 DIP away and, one second into the walk, posts playClip. gesture-walk loops the clip (a debug loop skips the
 * gesture repeat cooldown, not the ownership rules) and walks her back and forth between the start and the goal until
 * the clip has played on the upper layer during `walking` for `seconds`, or for six times that plus 10 s (a 600 DIP
 * leg spends only about 1.4 s of its starting, walking, stopping and turning in mode `walking`), then posts
 * stopClip. action-preempt plays the clip with its own loop setting, requests the goal again at the first performing
 * sample (while the director is still settling), posts stopClip after `seconds` of playing, and records until the held
 * goal is issued. Every snapshot becomes one row in `stageScenarioColumns` order, `t` in ms since the playClip post.
 */
function scenarioExpression(scenario: StageScenario, clip: string, seconds: number): string {
  return `(async () => {
  const scenario = ${JSON.stringify(scenario)}
  const clip = ${JSON.stringify(clip)}
  const spanMs = ${seconds * 1000}
  const channel = new BroadcastChannel(${JSON.stringify(diagnosticsChannel)})
  const send = (name, value) => channel.postMessage(value === undefined ? { type: 'command', name } : { type: 'command', name, value })
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const rows = []
  let latest = null
  let recording = false
  let onSnapshot = null
  channel.addEventListener('message', (event) => {
    const snapshot = event.data?.type === 'snapshot' ? event.data.snapshot : null
    if (!snapshot)
      return
    latest = snapshot
    const now = performance.now()
    if (recording && snapshot.locomotion && snapshot.director) {
      const performing = snapshot.action?.performing ?? null
      rows.push([now, snapshot.locomotion.mode, snapshot.locomotion.enabled, snapshot.locomotion.skate, snapshot.feet?.maxError ?? 0, performing?.name ?? null, performing?.layer ?? null, performing?.phase ?? null, snapshot.director.pendingGoal != null, snapshot.director.goalX ?? null])
    }
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
  })
  try {
    await until(s => s.loadedModelKey && s.world && s.locomotion && s.director, 30000, 'a mounted model on the stage world')
    await until(s => s.locomotion.mode === 'idle' && s.director.goalX === null && s.director.pendingGoal === null && s.action.performing === null, 60000, 'her to stand still')
    const world = latest.world
    const fromX = latest.locomotion.position.x
    const side = world.ground.maxX - fromX >= fromX - world.ground.minX ? 1 : -1
    const x = Math.min(world.ground.maxX, Math.max(world.ground.minX, fromX + side * 600 * world.unitsPerDip))
    const goal = { fromX, x, dip: Math.abs(x - fromX) / world.unitsPerDip, unitsPerDip: world.unitsPerDip }
    const startSeq = latest.action.lastActionSeq
    send('startMeasurement')
    recording = true
    send('requestGoal', { x, pace: 'walk' })
    await until(s => s.locomotion.mode === 'walking', 10000, 'the walk to start')
    await wait(1000)
    const playAt = performance.now()
    send('playClip', scenario === 'gesture-walk' ? { name: clip, loop: true } : { name: clip })
    let refusal = null
    let retryAfterMs = null
    let performed = false
    let stopAt = null
    let timedOut = false
    const refused = (s) => {
      if (s.action.performing?.name === clip)
        performed = true
      if (!performed && s.action.lastActionSeq > startSeq && s.action.refusal) {
        refusal = s.action.refusal
        retryAfterMs = s.action.retryAfterMs ?? null
      }
      return refusal !== null
    }
    if (scenario === 'gesture-walk') {
      let walkedMs = 0
      let last = playAt
      let next = fromX
      let awaitingGoal = false
      const limitMs = spanMs * 6 + 10000
      await until((s, now) => {
        const performing = s.action.performing
        if (s.locomotion.mode === 'walking' && performing?.name === clip && performing.layer === 'upper')
          walkedMs += now - last
        last = now
        if (s.director.goalX !== null)
          awaitingGoal = false
        if (!awaitingGoal && s.locomotion.mode === 'idle' && s.director.goalX === null && s.director.pendingGoal === null) {
          send('requestGoal', { x: next, pace: 'walk' })
          next = next === x ? fromX : x
          awaitingGoal = true
        }
        return refused(s) || walkedMs >= spanMs || now - playAt >= limitMs
      }, limitMs + 5000, 'the walk span')
      stopAt = performance.now()
      send('stopClip')
      await wait(500)
    }
    else {
      let secondGoal = false
      await until((s) => {
        if (s.action.performing?.name === clip && !secondGoal) {
          send('requestGoal', { x, pace: 'walk' })
          secondGoal = true
        }
        return refused(s) || (s.action.performing?.name === clip && s.action.performing.phase === 'playing')
      }, 20000, 'the clip to play')
      if (refusal === null) {
        const playingAt = performance.now()
        stopAt = await until((s, now) => s.action.performing === null || now - playingAt >= spanMs, spanMs + 5000, 'the playing time')
        send('stopClip')
        await until(s => s.action.performing === null && s.director.pendingGoal === null && s.director.goalX !== null, 10000, 'the held goal to be issued').catch(() => {
          timedOut = true
        })
        await wait(500)
      }
    }
    recording = false
    send('stopMeasurement')
    await wait(500)
    return {
      loadedModelKey: latest.loadedModelKey,
      goal,
      stopAtMs: stopAt === null ? null : Math.round(stopAt - playAt),
      refusal,
      retryAfterMs,
      timedOut,
      measurement: latest.measurement ?? null,
      rows: rows.map(([t, ...rest]) => [Math.round(t - playAt), ...rest]),
    }
  }
  finally {
    recording = false
    channel.close()
  }
})()`
}

/**
 * Runs one stage scenario on an attached app with an MMD model mounted on the stage world: up to `attempts` runs,
 * repeating a run that saw concurrent load; the record is `valid: false` when every attempt was invalid.
 */
export async function measureScenario(options: { port: number, mode: StageMode, scenario: StageScenario, clip: string, seconds: number, attempts: number, log: (line: string) => void }): Promise<StageScenarioRecord> {
  const { client, url } = await connectTarget(options.port, options.mode)
  try {
    const discarded: StageMeasureAttempt[] = []
    let refractoryWaits = 0
    // The longest page-side wait: stand still (60 s), the walk start, the span limit or the playing time, the resume.
    const budgetSeconds = 60 + 10 + options.seconds * 6 + 10 + 30
    for (let index = 1; ; index += 1) {
      await waitForQuiet(300_000, options.log)
      options.log(`qa-tools stage: ${options.scenario} with ${options.clip} on the ${options.mode} stage (attempt ${index}/${options.attempts})`)
      const { attempt, stop } = await startLoadWatch(budgetSeconds)
      let collected: ScenarioCollected
      try {
        collected = await client.evaluate<ScenarioCollected>(scenarioExpression(options.scenario, options.clip, options.seconds), budgetSeconds * 1_000 + 30_000)
      }
      finally {
        stop()
      }
      if (collected.refusal)
        options.log(`qa-tools stage: the director refused ${options.clip}: ${collected.refusal}`)
      // An earlier attempt that played the clip arms the action or dance refractory (15 s, 60 s); wait it out and repeat
      // the attempt instead of recording a refusal the scenario caused itself.
      if (collected.refusal === 'refractory' && collected.retryAfterMs !== null && refractoryWaits < options.attempts) {
        refractoryWaits += 1
        options.log(`qa-tools stage: waiting ${Math.ceil(collected.retryAfterMs / 1000) + 1} s for the refractory, then repeating attempt ${index}`)
        await sleep(collected.retryAfterMs + 1_000)
        index -= 1
        continue
      }
      if (attempt.verdict === 'VALID' || index >= options.attempts) {
        const measurement = collected.measurement
        return {
          kind: 'stage-scenario',
          version: 1,
          scenario: options.scenario,
          clip: options.clip,
          mode: options.mode,
          target: url,
          seconds: options.seconds,
          loadedModelKey: collected.loadedModelKey,
          goal: collected.goal,
          stopAtMs: collected.stopAtMs,
          refusal: collected.refusal,
          timedOut: collected.timedOut,
          measurement: measurement && {
            fps: measurement.fps,
            frames: measurement.frames,
            durationMs: measurement.durationMs,
            p95StageMs: Object.entries(measurement.stages).filter(([id]) => !engineStages.has(id)).reduce((sum, [, timing]) => sum + timing.p95Ms, 0),
            stages: measurement.stages,
          },
          series: { columns: [...stageScenarioColumns], rows: collected.rows },
          load: attempt,
          discarded,
          valid: attempt.verdict === 'VALID',
        }
      }
      options.log(`qa-tools stage: attempt ${index} INVALID-CONCURRENT-LOAD (${attempt.heavyweightHits} sidecar hits), repeating`)
      discarded.push(attempt)
    }
  }
  finally {
    client.close()
  }
}

/**
 * Alternating window/desktop pairs, each run on a fresh launch (`AIRI_STAGE_HOST=<mode>`) of a throwaway copy of
 * `profile`, which must already hold the onboarded profile with the model selected. `onRun` receives the record after
 * every run, so a broken later run keeps the earlier ones.
 */
export async function measurePairs(options: {
  repoRoot: string
  profile: string
  pairs: number
  seconds: number
  settleSeconds: number
  attempts: number
  selfPids: readonly number[]
  log: (line: string) => void
  onRun: (record: StagePairsRecord) => void
}): Promise<StagePairsRecord> {
  const record: StagePairsRecord = { kind: 'stage-measure-pairs', version: 1, pairs: options.pairs, seconds: options.seconds, profile: options.profile, runs: [], failures: [] }
  const scratch = mkdtempSync(join(tmpdir(), 'airi-qa-stage-'))
  try {
    for (let n = 1; n <= options.pairs; n += 1) {
      for (const mode of ['window', 'desktop'] as const) {
        try {
          record.runs.push(await launchAndMeasure({ ...options, mode, n, scratch }))
        }
        catch (error) {
          const message = errorMessageFrom(error) ?? 'unknown error'
          options.log(`qa-tools stage: ${mode} pair ${n} failed: ${message}`)
          record.failures.push({ mode, n, error: message })
        }
        options.onRun(record)
      }
    }
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return record
}

async function launchAndMeasure(options: { repoRoot: string, profile: string, mode: StageMode, n: number, seconds: number, settleSeconds: number, attempts: number, scratch: string, selfPids: readonly number[], log: (line: string) => void }): Promise<StageMeasureRecord> {
  const profileDir = join(options.scratch, `${options.mode}-${options.n}-profile`)
  cpSync(options.profile, profileDir, { recursive: true })
  options.log(`qa-tools stage: launching ${options.mode} pair ${options.n}`)
  const lease = await acquire({ class: 'exclusive', command: `qa:stage measure ${options.mode} pair ${options.n}`, cwd: options.repoRoot })
  const app = await launchStageTamagotchi({
    lease,
    repoRoot: options.repoRoot,
    profileDir,
    logFile: join(options.scratch, `${options.mode}-${options.n}.log`),
    list: listLiveProcesses,
    env: { AIRI_STAGE_HOST: options.mode },
  }).catch((error) => {
    lease.release()
    throw error
  })
  let tracked: OwnedProcess[] = []
  let browserUrl: string | undefined
  let client: CdpClient | undefined
  try {
    browserUrl = await failOnExit(app, 'the remote debug endpoint', waitForRemoteDebug(app.port))
    const connected = await failOnExit(app, `the ${options.mode} stage target`, connectTarget(app.port, options.mode))
    client = connected.client
    tracked = trackTree(await listLiveProcesses(), app.root)
    await failOnExit(app, 'the model mount', client.evaluate(mountedExpression(180_000), 190_000))
    await sleep(options.settleSeconds * 1_000)
    return await failOnExit(app, 'the measurement', measureStage(client, { ...options, target: connected.url }))
  }
  finally {
    client?.close()
    const report = await teardownRun(
      { repoRoot: options.repoRoot, profileDir, root: app.root, tracked, selfPids: options.selfPids },
      {
        list: listLiveProcesses,
        kill: killTree,
        closeBrowser: browserUrl ? () => closeBrowser(browserUrl!) : undefined,
        waitRootExit: app.waitExit,
        removeDir: path => rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }),
        sleep,
      },
    ).finally(() => app.releaseLease())
    if (!report.ok)
      options.log(`qa-tools stage: teardown of ${options.mode} pair ${options.n} left ${report.leftovers.length} processes${report.refused.length ? `; ${report.refused.join('; ')}` : ''}`)
  }
}
