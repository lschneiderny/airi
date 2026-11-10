import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import type { OwnedProcess } from '../env/processes'
import type { LaunchedApp } from '../t3/launch'
import type { TeardownReport } from '../t3/teardown'
import type { DriveReceipt, DriveStep, HostSample, LinuxDesktopExpectation, MissedSample, SmokeFailure, SmokeResult } from './smoke'

import process from 'node:process'

import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'
import { waitFor } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import { capabilitiesForHost, LINUX_DESKTOP_BACKENDS, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { killTree, listLiveProcesses } from '../env/processes'
import { createRun } from '../evidence/run'
import { MotionQaBridgeClient } from '../t3/bridge-client'
import { parkCursor } from '../t3/cursor'
import { connectStage, failOnExit, launchStageTamagotchi } from '../t3/launch'
import { completeOnboarding } from '../t3/onboarding'
import { closeBrowser } from '../t3/run-t3'
import { findWorktreeAppProcesses, teardownRun, trackTree } from '../t3/teardown'
import { evaluateHostSmoke, expectedHostFacts, focusRoundTrip, hostSmokeExpectation, LINUX_VERIFIED_FACTS, linuxDriveSteps, observeHost, parseLinuxDesktopExpectation } from './smoke'

export const hostUsage = `Usage: pnpm qa:host smoke [--xwayland] [--expect-idle verified|unverified] [--expect-backend ${LINUX_DESKTOP_BACKENDS.join('|')}] [--expect-verified <${LINUX_VERIFIED_FACTS.join(',')}>] [--expect <host> (test-only)]`

/** A report failure: an evaluator failure, or a refused, broken or untidy run. Tooling branches on `code`. */
export type HostReportFailure = SmokeFailure | { readonly code: 'refused' | 'run-failed' | 'teardown-failed', readonly message: string }

/** Copies an evaluation into the report, keeping each failure's code, signal and statuses. */
export function applySmokeResult(report: { exitCode: number, failures: unknown[], idleOutcome?: string }, result: SmokeResult): void {
  report.exitCode = result.exitCode
  report.idleOutcome = result.idleOutcome
  report.failures.push(...result.failures)
}

/** The CLI owns signals and both lease references until its entire app tree has stopped. */
export async function runHostCli(argv: string[], repoRoot: string): Promise<number> {
  const samples: HostSample[] = []
  const report: {
    exitCode: number
    failures: HostReportFailure[]
    samples: HostSample[]
    missedSamples: MissedSample[]
    expected?: HostCapabilities
    runnerFacts?: ReturnType<typeof expectedHostFacts>
    idleOutcome?: string
    linuxDesktop?: LinuxDesktopExpectation | null
    verifiedSignals?: ReturnType<typeof hostSmokeExpectation>['verifiedSignals']
    drive?: DriveReceipt[]
    runDir?: string
    teardown?: TeardownReport
    cursor?: Awaited<ReturnType<typeof parkCursor>>
  } = { exitCode: 2, failures: [], samples, missedSamples: [] }
  const controller = new AbortController()
  const onInterrupt = () => {
    process.stderr.write('qa-tools host: interrupted; teardown must finish\n')
    controller.abort(new Error('interrupted'))
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const
  for (const signal of signals)
    process.on(signal, onInterrupt)
  let lease: Awaited<ReturnType<typeof acquire>> | undefined
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { 'xwayland': { type: 'boolean' }, 'expect-idle': { type: 'string' }, 'expect': { type: 'string' }, 'expect-backend': { type: 'string' }, 'expect-verified': { type: 'string' } },
      allowPositionals: true,
      strict: true,
    })
    if (positionals.length !== 1 || positionals[0] !== 'smoke')
      throw new Error(hostUsage)
    const expectIdle = values['expect-idle']
    if (expectIdle !== undefined && expectIdle !== 'verified' && expectIdle !== 'unverified')
      throw new Error('--expect-idle must be verified or unverified')
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux')
      throw new Error(`Unsupported runner platform: ${process.platform}`)
    const linuxDesktop = parseLinuxDesktopExpectation(process.platform, values['expect-backend'], values['expect-verified'])
    report.linuxDesktop = linuxDesktop
    const facts = expectedHostFacts({
      platform: process.platform,
      env: process.env,
      xwayland: values.xwayland ?? false,
      macosVersion: process.platform === 'darwin' ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 10_000 }).trim() : null,
      linuxDesktop,
    })
    report.runnerFacts = facts
    if (values.xwayland && !facts.waylandSession)
      throw new Error('--xwayland requires a Linux Wayland session')
    const detected = resolveHostCapabilities(facts, 0)
    const forced = values.expect
    if (forced !== undefined && !['windows', 'macos', 'linux-x11', 'linux-xwayland', 'linux-wayland', 'web'].includes(forced))
      throw new Error(`Unknown --expect host: ${forced}`)
    // The test-only mismatch flag changes the oracle, never the launched app or runner facts.
    const expectation = hostSmokeExpectation(
      desktop => forced === undefined ? resolveHostCapabilities({ ...facts, linuxDesktop: desktop }, 0) : capabilitiesForHost(forced as HostCapabilities['host'], desktop ?? undefined),
      linuxDesktop,
    )
    const expected = expectation.expected
    report.expected = expected
    report.verifiedSignals = expectation.verifiedSignals
    if (detected.host === 'linux-wayland' && expectIdle === undefined)
      throw new Error('--expect-idle verified|unverified is required on linux-wayland')
    const selfPids = [process.pid, process.ppid]
    if (findWorktreeAppProcesses(await listLiveProcesses(), repoRoot, selfPids).length)
      throw new Error('Refusing to launch: this worktree already has an Electron session')
    lease = await acquire({
      class: 'exclusive',
      command: `qa:host ${argv.join(' ')}`,
      cwd: repoRoot,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60_000)]),
    })
    controller.signal.throwIfAborted()
    const run = createRun({ tool: 'host', label: values.xwayland ? 'smoke-xwayland' : 'smoke', repoRoot })
    report.runDir = run.dir
    const profileDir = run.path('profile')
    mkdirSync(profileDir)
    let app: LaunchedApp | undefined
    let stage: CdpClient | undefined
    let browserUrl: string | undefined
    let tracked: OwnedProcess[] = []
    report.exitCode = 1
    try {
      app = await launchStageTamagotchi({ repoRoot, profileDir, logFile: run.path('app.log'), list: listLiveProcesses, script: values.xwayland ? 'dev:xwayland' : 'dev' })
      run.recordProcess({ rootPid: app.root.pid, created: app.root.created, commandLine: app.root.commandLine })
      const connected = await connectStage(app)
      stage = connected.stage
      browserUrl = connected.browserUrl
      tracked = trackTree(await listLiveProcesses(), app.root)
      controller.signal.throwIfAborted()
      const page = stage
      await failOnExit(app, 'the dispatcher', waitFor('motion QA dispatcher', async () => {
        controller.signal.throwIfAborted()
        return await page.evaluate<boolean>('typeof globalThis.__airiMotionQa?.dispatch === "function"', 10_000) ? true : undefined
      }, 120_000, 500))
      await completeOnboarding(stage)
      const bridge = new MotionQaBridgeClient(stage)
      await failOnExit(app, 'the bridge', bridge.waitForBridge({ timeoutMs: 120_000 }))
      // A Windows run parks once before observation; other hosts never move the OS cursor.
      if (process.platform === 'win32') {
        report.cursor = await parkCursor()
        if (!report.cursor.ok)
          throw new Error(report.cursor.reason)
      }
      process.stderr.write(`qa-tools host: observing ${detected.host} for 180 seconds; run dir ${run.dir}\n`)
      const launched = app
      const session = process.env.AIRI_QA_DISPLAY_SESSION
      const driveSteps = linuxDriveSteps(linuxDesktop?.verified ?? [])
      const drive = process.platform === 'linux' ? (report.drive = []) : undefined
      const readForeground = async () => (await failOnExit(launched, 'host state', bridge.call('state', undefined, 10_000))).foreground
      await observeHost({
        readState: () => failOnExit(launched, 'host state', bridge.call('state', undefined, 10_000)),
        now: () => performance.now(),
        sleep: ms => setTimeout(ms, undefined, { signal: controller.signal }),
        signal: controller.signal,
        samples,
        missed: report.missedSamples,
        drive: drive && (index => driveLinuxVerification({ step: driveSteps.find(step => step.sample === index), session, repoRoot, readForeground, signal: controller.signal, receipts: drive })),
      })
      applySmokeResult(report, evaluateHostSmoke({ ...expectation, expectIdle, samples, driveSteps, drive }))
    }
    catch (error) {
      report.failures.push({ code: 'run-failed', message: errorMessageFrom(error) ?? 'host smoke failed' })
    }
    finally {
      const url = browserUrl
      try {
        report.teardown = await teardownRun(
          { repoRoot, profileDir, root: app?.root, tracked, selfPids },
          {
            list: listLiveProcesses,
            kill: killTree,
            closeBrowser: url ? () => closeBrowser(url) : undefined,
            waitRootExit: app?.waitExit,
            removeDir: path => rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }),
            sleep: ms => setTimeout(ms),
          },
        )
        if (!report.teardown.ok) {
          report.exitCode = 1
          report.failures.push({ code: 'teardown-failed', message: 'teardown failed; see teardown receipts' })
        }
      }
      finally {
        stage?.close()
        app?.releaseLease()
      }
      writeFileSync(run.path('report.json'), `${JSON.stringify(report, null, 2)}\n`)
      run.addArtifact('report.json', 'host-smoke')
      run.addArtifact('app.log', 'log')
      run.finish({ exitCode: report.exitCode, summary: report.failures.map(failure => `${failure.code}: ${failure.message}`).join('; ') || report.idleOutcome || 'host smoke' })
    }
  }
  catch (error) {
    // Exit 2 is still set only when the run stopped before launching anything.
    const refused = report.exitCode === 2
    if (report.exitCode === 0)
      report.exitCode = 1
    report.failures.push({ code: refused ? 'refused' : 'run-failed', message: errorMessageFrom(error) ?? 'host smoke refused' })
  }
  finally {
    lease?.release()
    for (const signal of signals)
      process.off(signal, onInterrupt)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
  return report.exitCode
}

const execFileAsync = promisify(execFile)

/**
 * Runs the evidence step planned after this sample, if any, and records its receipt. Pointer steps move the session
 * pointer with `pnpm qa:display pointer`; the focus step opens a helper window inside the session and proves the round
 * trip with the app's own foreground samples. A failed step is recorded as failed; the evaluation then fails the run.
 */
async function driveLinuxVerification(input: { step: DriveStep | undefined, session: string | undefined, repoRoot: string, readForeground: () => Promise<HostSample['foreground']>, signal: AbortSignal, receipts: DriveReceipt[] }): Promise<void> {
  const { step } = input
  if (!step)
    return
  const action = step.kind === 'pointer' ? `pointer ${step.x},${step.y}` : 'focus a helper window and back to AIRI'
  try {
    if (!input.session)
      throw new Error('not inside a qa:display session')
    const session = input.session
    const detail = step.kind === 'pointer'
      ? (await execFileAsync('pnpm', ['--silent', 'qa:display', 'pointer', '--name', session, String(step.x), String(step.y)], { cwd: input.repoRoot, timeout: 30_000, signal: input.signal })).stdout.trim()
      : await focusRoundTrip({
          openHelper,
          readForeground: input.readForeground,
          now: () => performance.now(),
          sleep: ms => setTimeout(ms, undefined, { signal: input.signal }),
        })
    input.receipts.push({ sample: step.sample, action, ok: true, detail })
  }
  catch (error) {
    input.receipts.push({ sample: step.sample, action, ok: false, detail: errorMessageFrom(error) ?? 'failed' })
  }
}

/**
 * Starts a Konsole window that runs `cat` inside the qa:display session, so focus has somewhere to go. The process is
 * a child of this CLI in the session's scope unit; `close` stops it and waits for it to exit.
 */
async function openHelper(): Promise<{ close: () => Promise<void> }> {
  const helper = spawn('konsole', ['--separate', '--nofork', '-e', 'cat'], { stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    helper.once('spawn', resolve)
    helper.once('error', reject)
  })
  return {
    close: async () => {
      if (helper.exitCode !== null || helper.signalCode !== null)
        return
      const exited = once(helper, 'exit')
      helper.kill('SIGTERM')
      const timer = globalThis.setTimeout(() => helper.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(timer)
    },
  }
}
