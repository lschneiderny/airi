import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { MotionQaBridgeClient } from '../t3/bridge-client'
import type { BenchLaunch, BenchScenario } from './matrix'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import { appLaunchEnv, buildSeedEntries } from '../app/plan'
import { sendMessage } from '../app/send'
import { matchExpectations } from '../app/summary'
import { formatHostLoad, waitForHostQuiet } from '../host-quiet/wait'
import { loadScript } from '../llm/script'
import { ReplayServer } from '../llm/server'
import { AppSessionCore } from '../session/app-session'
import { importRig, zipRig } from '../t3/import-rig'
import { appendBenchLine } from './history'
import { measurableFrom, readRawRun, summarizeBenchRun } from './summarize'

/** Longest wait for a calm host before one launch; other worktrees' work can keep the machine busy that long. */
const HOST_QUIET_WAIT_MS = 30 * 60_000
/** Exit code when the host stays busy or the mounted model does not arrive in time. 0, 1, 2 and 130 are taken. */
const BUSY_OR_HUNG_EXIT = 3
/** Launch, bridge, and import together; a launch that has not mounted its model by then is hung, not slow. */
const MOUNT_TIMEOUT_MS = 6 * 60_000
const TURN_TIMEOUT_MS = 120_000
/** One recorder tick (5 s) and a margin, so the rollup that closes the measured span is written before teardown. */
const LAST_TICK_MS = 6_000

/** The model a scenario imports: `zipFrom` is the directory zipped once per bench, `fingerprint` from `modelFingerprint`. */
export interface BenchModel {
  readonly kind: BenchScenario['model']['kind']
  readonly zipFrom: string
  readonly fingerprint: string
}

export interface BenchOptions {
  readonly repoRoot: string
  readonly out: string
  readonly launches: readonly BenchLaunch[]
  readonly models: ReadonlyMap<BenchScenario['model']['env'], BenchModel>
  readonly historyPath: string
  readonly selfPids: readonly number[]
  readonly signal: AbortSignal
  readonly log: (line: string) => void
}

export interface BenchRunOutcome {
  readonly scenario: BenchScenario['id']
  readonly run: number
  readonly runDir: string
  /** `null` when the launch broke before a record could be made; `error` says why. */
  readonly record: BenchRunRecord | null
  readonly error?: string
  readonly teardownOk: boolean
}

/** Ends the whole bench with `exitCode` after the current launch is torn down. */
class BenchStop extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message)
  }
}

async function withinMountDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(reject, MOUNT_TIMEOUT_MS, new BenchStop(`the model did not mount within ${MOUNT_TIMEOUT_MS / 60_000} min; the launch was torn down`, BUSY_OR_HUNG_EXIT))
  })
  try {
    return await Promise.race([work, deadline])
  }
  finally {
    clearTimeout(timer)
  }
}

/** Waits until the turn after `sinceSeq` has completed and its speech has finished playing. */
async function waitForTurn(session: AppSessionCore<CdpClient>, bridge: MotionQaBridgeClient, sinceSeq: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + TURN_TIMEOUT_MS
  const events: MotionQaEvent[] = []
  let lastSeq = sinceSeq
  for (;;) {
    const pending = matchExpectations(events, ['turn', 'tts'], sinceSeq)
    if (pending.length === 0)
      return
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new Error(`the turn did not end within ${TURN_TIMEOUT_MS / 1000} s (missing ${pending.join(', ')})`)
    const result = await session.whileRunning('the turn events', bridge.call('events', { sinceSeq: lastSeq }, Math.min(remaining, 10_000)))
    lastSeq = result.lastSeq
    events.push(...result.events)
    if (matchExpectations(events, ['turn', 'tts'], sinceSeq).length > 0)
      await setTimeout(Math.min(250, remaining), undefined, { signal })
  }
}

interface LaunchContext extends BenchOptions {
  readonly zips: ReadonlyMap<BenchScenario['model']['env'], string>
}

/**
 * One measured launch on a calm host: fresh profile in the run directory, recording into `<run dir>/perf`, model
 * import, settle, measurement, teardown, and the run's record. Throws `BenchStop` for a host that stays busy or a hung
 * mount.
 */
async function benchLaunch(launch: BenchLaunch, context: LaunchContext): Promise<BenchRunOutcome> {
  const { scenario, run } = launch
  const model = context.models.get(scenario.model.env)
  const zip = context.zips.get(scenario.model.env)
  if (!model || !zip)
    throw new Error(`no model was resolved for ${scenario.model.env}`)
  const runDir = join(context.out, `${scenario.id}-${run}`)
  const profileDir = join(runDir, 'profile')
  const perfDir = join(runDir, 'perf')
  mkdirSync(profileDir, { recursive: true })

  const host = await waitForHostQuiet({ waitSeconds: HOST_QUIET_WAIT_MS / 1_000, signal: context.signal })
  if (!host.quiet)
    throw new BenchStop(`the host stayed busy for ${HOST_QUIET_WAIT_MS / 60_000} min before the launch (${formatHostLoad(host.sample)}); stop the other load and run the bench again`, BUSY_OR_HUNG_EXIT)

  const { signal } = context
  const session = AppSessionCore.create({ repoRoot: context.repoRoot, profileDir, selfPids: context.selfPids, signal })
  let server: ReplayServer | undefined
  let measured: { startMs: number, endMs: number } | undefined
  let failure: unknown
  let teardownOk = false
  try {
    const { measure } = scenario
    let baseURL: string | undefined
    if (measure.kind === 'talk') {
      const script = await loadScript({ script: resolve(context.repoRoot, measure.script) }, context.repoRoot)
      const [reply] = script.entries
      while (script.entries.length < measure.turns)
        script.append(reply)
      server = new ReplayServer({ script, log: join(runDir, 'requests.jsonl') })
      baseURL = await server.listen()
    }
    const replayURL = baseURL
    const started = await withinMountDeadline((async () => {
      const startedSession = await session.start({
        launch: { logFile: join(runDir, 'app.log'), env: appLaunchEnv({ perfDir, stageHost: 'window' }) },
        beforeOnboarding: replayURL === undefined
          ? undefined
          : async ({ stage }) => {
            await stage.evaluate(`(() => {
              for (const [key, value] of Object.entries(${JSON.stringify(buildSeedEntries(replayURL))}))
                localStorage.setItem(key, value)
            })()`, 30_000)
          },
        bridge: { step: 'the motion QA bridge', timeoutMs: MOUNT_TIMEOUT_MS },
      })
      await session.whileRunning('the model import', importRig(startedSession.stage, startedSession.bridge, zip, MOUNT_TIMEOUT_MS, model.kind))
      return startedSession
    })())
    context.log(`qa:bench: ${scenario.id} run ${run}: model mounted; settling ${scenario.settleSeconds} s`)
    await session.whileRunning('the settle', setTimeout(scenario.settleSeconds * 1000, undefined, { signal }))
    const measurable = measurableFrom((await readRawRun(perfDir)).records)
    if (measurable === null)
      throw new Error('the recorder wrote no session-start, so perf recording is not on')
    if (measurable > Date.now())
      await session.whileRunning('the rollup settling', setTimeout(measurable - Date.now(), undefined, { signal }))

    const startMs = Date.now()
    if (measure.kind === 'idle') {
      context.log(`qa:bench: ${scenario.id} run ${run}: measuring ${measure.seconds} s`)
      await session.whileRunning('the measurement', setTimeout(measure.seconds * 1000, undefined, { signal }))
    }
    else {
      for (let turn = 1; turn <= measure.turns; turn += 1) {
        context.log(`qa:bench: ${scenario.id} run ${run}: turn ${turn}/${measure.turns}`)
        const { lastSeq } = await session.whileRunning('the event cursor', started.bridge.call('events', {}, 10_000))
        await session.whileRunning('the send', sendMessage({ port: started.app.port, bridge: started.bridge, text: `Bench turn ${turn}: tell me what we should do next.`, timeoutMs: 30_000 }))
        await waitForTurn(session, started.bridge, lastSeq, signal)
      }
    }
    measured = { startMs, endMs: Date.now() }
    await session.whileRunning('the last rollup', setTimeout(LAST_TICK_MS, undefined, { signal }))
  }
  catch (error) {
    failure = error
  }
  finally {
    try {
      const report = await session.teardown()
      teardownOk = report.ok
      if (!report.ok)
        context.log(`qa:bench: ${scenario.id} run ${run}: teardown left ${report.leftovers.length} processes${report.refused.length ? `; ${report.refused.join('; ')}` : ''}`)
    }
    catch (error) {
      context.log(`qa:bench: ${scenario.id} run ${run}: teardown failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
    }
    await server?.close()
  }
  if (failure instanceof BenchStop || signal.aborted)
    throw failure
  const outcome = (record: BenchRunRecord | null, error?: string): BenchRunOutcome => {
    const result = { scenario: scenario.id, run, runDir, record, ...(error === undefined ? {} : { error }), teardownOk }
    writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`)
    return result
  }
  if (failure !== undefined || measured === undefined)
    return outcome(null, errorMessageFrom(failure) ?? 'the launch broke')
  const summary = summarizeBenchRun(await readRawRun(perfDir), { scenario, run, modelFingerprint: model.fingerprint, measured })
  if (!summary.ok)
    return outcome(null, summary.reason)
  appendBenchLine(context.historyPath, JSON.stringify(summary.record))
  return outcome(summary.record)
}

/**
 * Runs the planned launches one after another and appends each launch's `bench-run` record to the history. Exit
 * codes: 0 every launch recorded a valid run, 1 a launch broke, recorded an invalid run, or left processes behind
 * (which also stops the bench), 3 a host that stays busy or a hung mount (stops the bench), 130 interrupted.
 */
export async function runBench(options: BenchOptions): Promise<{ exitCode: number, outcomes: BenchRunOutcome[] }> {
  const outcomes: BenchRunOutcome[] = []
  const scratch = mkdtempSync(join(tmpdir(), 'airi-qa-bench-'))
  let exitCode = 0
  try {
    const zips = new Map<BenchScenario['model']['env'], string>()
    for (const env of new Set(options.launches.map(launch => launch.scenario.model.env))) {
      const model = options.models.get(env)
      if (!model)
        throw new Error(`no model was resolved for ${env}`)
      const zip = join(scratch, `${env}.zip`)
      await zipRig(model.zipFrom, zip)
      zips.set(env, zip)
    }
    for (const [index, launch] of options.launches.entries()) {
      options.log(`qa:bench: launch ${index + 1}/${options.launches.length}: ${launch.scenario.id} run ${launch.run}`)
      let outcome: BenchRunOutcome
      try {
        outcome = await benchLaunch(launch, { ...options, zips })
      }
      catch (error) {
        if (options.signal.aborted)
          return { exitCode: 130, outcomes }
        if (error instanceof BenchStop) {
          options.log(`qa:bench: ${error.message}`)
          return { exitCode: error.exitCode, outcomes }
        }
        throw error
      }
      outcomes.push(outcome)
      const { record } = outcome
      options.log(record
        ? `qa:bench: ${launch.scenario.id} run ${launch.run}: ${record.valid ? 'valid' : `invalid (${record.invalidReason})`}, ${record.metrics.fps.toFixed(1)} fps, stage window ${record.metrics.stageWindowCpuPct.toFixed(1)} % CPU`
        : `qa:bench: ${launch.scenario.id} run ${launch.run} failed: ${outcome.error}`)
      if (!record?.valid)
        exitCode = 1
      if (!outcome.teardownOk) {
        options.log('qa:bench: stopping, because the next launch would meet the processes this one left')
        return { exitCode: 1, outcomes }
      }
    }
    return { exitCode, outcomes }
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
