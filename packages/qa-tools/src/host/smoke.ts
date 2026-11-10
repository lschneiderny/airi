import type { HostCapabilities, HostFacts, HostSignal, LinuxDesktopBackend, LinuxDesktopFacts, SignalStatus } from '@proj-airi/stage-shared/host-capabilities'
import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import { isDeepStrictEqual } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { HOST_SIGNALS, HostReasons, idleAdvances, LINUX_DESKTOP_BACKENDS } from '@proj-airi/stage-shared/host-capabilities'

import { isWaylandSession } from './wayland-session'

/** The runtime proofs `--expect-verified` can name; each maps to one `LinuxDesktopFacts` field. */
export const LINUX_VERIFIED_FACTS = ['foreground', 'cursor', 'geometry', 'keepAbove', 'lock', 'portal', 'audio'] as const
export type LinuxVerifiedFact = typeof LINUX_VERIFIED_FACTS[number]

/** What the operator expects of the session's Linux desktop bridge: its backend and the proofs it reaches. */
export interface LinuxDesktopExpectation {
  readonly backend: LinuxDesktopBackend
  readonly verified: readonly LinuxVerifiedFact[]
}

/** Parses the Linux flags; on Linux the backend is required, elsewhere both flags are refused. */
export function parseLinuxDesktopExpectation(platform: NodeJS.Platform, backend: string | undefined, verified: string | undefined): LinuxDesktopExpectation | null {
  if (platform !== 'linux') {
    if (backend !== undefined || verified !== undefined)
      throw new Error('--expect-backend and --expect-verified apply to Linux only')
    return null
  }
  if (backend === undefined)
    throw new Error(`--expect-backend ${LINUX_DESKTOP_BACKENDS.join('|')} is required on Linux`)
  if (!(LINUX_DESKTOP_BACKENDS as readonly string[]).includes(backend))
    throw new Error(`Unknown --expect-backend: ${backend}`)
  const facts = verified === undefined || verified === '' ? [] : verified.split(',')
  for (const fact of facts) {
    if (!(LINUX_VERIFIED_FACTS as readonly string[]).includes(fact))
      throw new Error(`Unknown --expect-verified fact: ${fact}`)
  }
  if (new Set(facts).size !== facts.length)
    throw new Error('--expect-verified names a fact twice')
  return { backend: backend as LinuxDesktopExpectation['backend'], verified: facts as LinuxVerifiedFact[] }
}

/**
 * The facts of a healthy app on the expected backend once every `verified` proof holds. Pass no proofs and
 * `bridge: 'starting'` for the earlier stages the app passes through.
 */
export function linuxDesktopFacts(expectation: LinuxDesktopExpectation, bridge: LinuxDesktopFacts['bridge'] = 'ready'): LinuxDesktopFacts {
  const has = (fact: LinuxVerifiedFact) => expectation.verified.includes(fact)
  return {
    backend: expectation.backend,
    bridge,
    foregroundVerified: has('foreground'),
    cursorVerified: has('cursor'),
    geometryVerified: has('geometry'),
    keepAboveVerified: has('keepAbove'),
    // Either source makes the lock signal live; the resolver does not distinguish them.
    lockSource: has('lock') ? 'logind' : null,
    portalShortcuts: has('portal') ? 'bound' : 'absent',
    bridgeFailure: null,
    // The workspace pins Electron 43.8.7, which has the Linux click-through primitive (43.7.6 or later).
    clickThroughToggle: true,
    systemAudioVerified: has('audio'),
  }
}

/** Runner facts describe a healthy host; runtime binding failures must fail the comparison. */
export function expectedHostFacts(input: {
  platform: HostFacts['platform']
  env: Readonly<Record<string, string | undefined>>
  xwayland: boolean
  macosVersion: string | null
  linuxDesktop?: LinuxDesktopExpectation | null
}): HostFacts {
  const waylandSession = input.platform === 'linux' && isWaylandSession(input.env)
  const version = input.macosVersion?.match(/^(\d+)\.(\d+)(?:\.\d+)?$/)
  if (input.platform === 'darwin' && !version)
    throw new Error('macosVersion must contain the sw_vers product version')
  return {
    platform: input.platform,
    waylandSession,
    waylandOzone: waylandSession && !input.xwayland,
    macosMajorMinor: input.platform === 'darwin' && version ? [Number(version[1]), Number(version[2])] : null,
    foregroundBindingFailed: false,
    globalInputHookFailure: 'none',
    foregroundTitlesTrusted: null,
    waylandIdleVerified: false,
    linuxDesktop: input.platform === 'linux' && input.linuxDesktop ? linuxDesktopFacts(input.linuxDesktop) : null,
  }
}

/** The exact final profile, and the earlier profiles a signal may pass through on the way to it. */
export interface HostSmokeExpectation {
  readonly expected: HostCapabilities
  /** In order; each signal moves forward through these at most once and must end at `expected`. */
  readonly transitions: readonly HostCapabilities[]
  /** The signals that each expected proof turns to its `expected` status. */
  readonly verifiedSignals: Partial<Record<LinuxVerifiedFact, readonly HostSignal[]>>
}

/**
 * Derives every expected profile from the resolver itself: `resolve` maps desktop facts to the host's profile.
 * Throws when a named proof changes no signal on that host and backend, because such a run could never verify it.
 */
export function hostSmokeExpectation(resolve: (desktop: LinuxDesktopFacts | null) => HostCapabilities, desktop: LinuxDesktopExpectation | null): HostSmokeExpectation {
  if (!desktop)
    return { expected: resolve(null), transitions: [], verifiedSignals: {} }
  const expected = resolve(linuxDesktopFacts(desktop))
  const unverified = linuxDesktopFacts({ ...desktop, verified: [] })
  const transitions = [resolve({ ...unverified, bridge: 'starting' }), resolve(unverified)]
  // A portal binding passes through an unbound portal session first.
  if (desktop.verified.includes('portal'))
    transitions.push(resolve({ ...linuxDesktopFacts({ ...desktop, verified: desktop.verified.filter(fact => fact !== 'portal') }), portalShortcuts: 'session' }))
  const verifiedSignals: Partial<Record<LinuxVerifiedFact, readonly HostSignal[]>> = {}
  for (const fact of desktop.verified) {
    const without = resolve(linuxDesktopFacts({ ...desktop, verified: desktop.verified.filter(other => other !== fact) }))
    const signals = HOST_SIGNALS.filter(signal => !isDeepStrictEqual(expected.signals[signal], without.signals[signal]))
    if (!signals.length)
      throw new Error(`--expect-verified ${fact} changes no ${expected.host} signal on the ${desktop.backend} backend`)
    verifiedSignals[fact] = signals
  }
  return { expected, transitions, verifiedSignals }
}

export interface HostSample {
  readonly atMs: number
  readonly host: HostCapabilities | null
  readonly desktopIdleSeconds: number | null
  readonly performanceMode: MotionQaState['performanceMode']
  /** The app's foreground sample without its title, or null while it has none. */
  readonly foreground: MotionQaState['foreground']
}

export interface SmokeResult {
  readonly exitCode: 0 | 1
  readonly idleOutcome: 'idle-verified' | 'idle-unverified' | 'idle-unavailable' | 'idle-failed'
  readonly failures: readonly SmokeFailure[]
}

/** A smoke failure: tests and tooling branch on `code` and `signal`; `message` is for people. */
export interface SmokeFailure {
  readonly code: 'observation-too-short' | 'snapshot-missing' | 'host-mismatch' | 'backend-mismatch' | 'signal-mismatch' | 'verification-missing' | 'drive-failed' | 'wayland-idle-invalid' | 'idle-outcome-mismatch' | 'idle-not-advancing' | 'idle-reading-unexpected'
  readonly signal: HostSignal | 'host'
  readonly message: string
  readonly expected?: unknown
  readonly received?: unknown
}

function unverified(status: SignalStatus): boolean {
  return status.kind === 'unavailable' && status.reason === HostReasons.WaylandIdleUnverified
}

/**
 * Checks every observed snapshot, including status reversals and a frozen live idle sensor. A signal may move
 * forward through `transitions` once and must end at `expected`; nothing else is tolerated.
 */
export function evaluateHostSmoke(input: {
  expected: HostCapabilities
  transitions?: readonly HostCapabilities[]
  verifiedSignals?: HostSmokeExpectation['verifiedSignals']
  expectIdle?: 'verified' | 'unverified'
  samples: readonly HostSample[]
  /** The evidence steps the run had to take, and the receipts of those it took. */
  driveSteps?: readonly DriveStep[]
  drive?: readonly DriveReceipt[]
}): SmokeResult {
  const { expected, samples } = input
  const found = new Map<string, SmokeFailure>()
  const fail = (failure: SmokeFailure) => void found.set(failure.message, failure)
  if (samples.length < 2 || samples[samples.length - 1].atMs - samples[0].atMs < 180_000)
    fail({ code: 'observation-too-short', signal: 'systemIdleTime', message: 'systemIdleTime: observation did not span 180 seconds' })
  const waylandIdle = expected.host === 'linux-wayland'
  for (const sample of samples) {
    const actual = sample.host
    if (!actual) {
      fail({ code: 'snapshot-missing', signal: 'host', message: 'host: bridge snapshot is null' })
      continue
    }
    if (actual.host !== expected.host)
      fail({ code: 'host-mismatch', signal: 'host', message: `host: expected ${expected.host}, received ${actual.host}`, expected: expected.host, received: actual.host })
    if (actual.linuxDesktopBackend !== expected.linuxDesktopBackend)
      fail({ code: 'backend-mismatch', signal: 'host', message: `host: expected Linux desktop backend ${expected.linuxDesktopBackend}, received ${actual.linuxDesktopBackend}`, expected: expected.linuxDesktopBackend, received: actual.linuxDesktopBackend })
    const idle = actual.signals.systemIdleTime
    if (waylandIdle && idle.kind !== 'live' && !unverified(idle))
      fail({ code: 'signal-mismatch', signal: 'systemIdleTime', message: `systemIdleTime: expected ${JSON.stringify(expected.signals.systemIdleTime)}, received ${JSON.stringify(idle)}`, expected: expected.signals.systemIdleTime, received: idle })
  }

  const stages = [...(input.transitions ?? []), expected]
  const verifiedFacts = Object.entries(input.verifiedSignals ?? {}) as Array<[LinuxVerifiedFact, readonly HostSignal[]]>
  for (const signal of HOST_SIGNALS) {
    // Native Wayland idle has its own transition rule below.
    if (signal === 'systemIdleTime' && waylandIdle)
      continue
    let stage = 0
    let mismatched = false
    let last: SignalStatus | undefined
    for (const sample of samples) {
      if (!sample.host)
        continue
      const status = sample.host.signals[signal]
      last = status
      let next = stage
      while (next < stages.length && !isDeepStrictEqual(stages[next].signals[signal], status))
        next++
      if (next < stages.length) {
        stage = next
        continue
      }
      mismatched = true
      fail({ code: 'signal-mismatch', signal, message: `${signal}: expected ${JSON.stringify(expected.signals[signal])}, received ${JSON.stringify(status)}`, expected: expected.signals[signal], received: status })
    }
    if (mismatched || !last || isDeepStrictEqual(last, expected.signals[signal]))
      continue
    const fact = verifiedFacts.find(([, signals]) => signals.includes(signal))?.[0]
    if (fact)
      fail({ code: 'verification-missing', signal, message: `${signal}: --expect-verified ${fact} never reached ${JSON.stringify(expected.signals[signal])}; last ${JSON.stringify(last)}`, expected: expected.signals[signal], received: last })
    else
      fail({ code: 'signal-mismatch', signal, message: `${signal}: expected ${JSON.stringify(expected.signals[signal])}, ended at ${JSON.stringify(last)}`, expected: expected.signals[signal], received: last })
  }
  for (const step of input.driveSteps ?? []) {
    const receipt = input.drive?.find(entry => entry.sample === step.sample)
    if (!receipt)
      fail({ code: 'drive-failed', signal: step.signal, message: `${step.signal}: the ${step.kind} drive step after sample ${step.sample} never ran` })
    else if (!receipt.ok)
      fail({ code: 'drive-failed', signal: step.signal, message: `${step.signal}: ${receipt.action} after sample ${step.sample} failed: ${receipt.detail}` })
  }
  if (input.verifiedSignals?.foreground && !samples.some(sample => sample.foreground !== null))
    fail({ code: 'verification-missing', signal: 'foregroundWindow', message: 'foregroundWindow: --expect-verified foreground, but no foreground sample arrived' })

  let idleOutcome: SmokeResult['idleOutcome'] = 'idle-unavailable'
  const live = samples.filter(sample => sample.host?.signals.systemIdleTime.kind === 'live')
  const advancing = idleAdvances(live.map(sample => ({ atMs: sample.atMs, seconds: sample.desktopIdleSeconds })))
  if (expected.host === 'linux-wayland') {
    const statuses = samples.map(sample => sample.host?.signals.systemIdleTime)
    const allUnverified = statuses.every(status => status && unverified(status))
    // The only permitted transition is unverified -> live, at most once.
    const firstLive = statuses.findIndex(status => status?.kind === 'live')
    const verified = firstLive >= 0
      && statuses.slice(0, firstLive).every(status => status && unverified(status))
      && statuses.slice(firstLive).every(status => status?.kind === 'live')
      && samples.slice(0, firstLive).every(sample => sample.desktopIdleSeconds === null)
      && advancing
    idleOutcome = verified ? 'idle-verified' : allUnverified && samples.every(sample => sample.desktopIdleSeconds === null) ? 'idle-unverified' : 'idle-failed'
    if (idleOutcome === 'idle-failed')
      fail({ code: 'wayland-idle-invalid', signal: 'systemIdleTime', message: 'systemIdleTime: invalid Wayland transition or idle readings did not advance while live' })
    if (input.expectIdle && idleOutcome !== `idle-${input.expectIdle}`)
      fail({ code: 'idle-outcome-mismatch', signal: 'systemIdleTime', message: `systemIdleTime: expected idle-${input.expectIdle}, received ${idleOutcome}`, expected: `idle-${input.expectIdle}`, received: idleOutcome })
  }
  else if (expected.signals.systemIdleTime.kind === 'live') {
    idleOutcome = advancing ? 'idle-verified' : 'idle-failed'
    if (!advancing)
      fail({ code: 'idle-not-advancing', signal: 'systemIdleTime', message: 'systemIdleTime: live idle readings did not advance' })
  }
  else if (samples.some(sample => sample.desktopIdleSeconds !== null)) {
    idleOutcome = 'idle-failed'
    fail({ code: 'idle-reading-unexpected', signal: 'systemIdleTime', message: 'systemIdleTime: unavailable idle signal emitted a reading' })
  }
  return { exitCode: found.size ? 1 : 0, idleOutcome, failures: [...found.values()] }
}

/** One action the smoke took to give the app's verifiers their evidence, and how it went. */
export interface DriveReceipt {
  readonly sample: number
  readonly action: string
  readonly ok: boolean
  readonly detail: string
}

/** One required evidence step, run once after the sample with index `sample`. */
export type DriveStep
  = | { readonly sample: number, readonly kind: 'pointer', readonly x: number, readonly y: number, readonly signal: 'cursorScreenPoint' }
    | { readonly sample: number, readonly kind: 'focus', readonly signal: 'foregroundWindow' }

/**
 * The evidence each expected proof needs: two session pointer positions for `cursor`, and one focus round trip for
 * `foreground`. Pointer moves are desktop input and reset a live idle reading, so no other run gets them.
 */
export function linuxDriveSteps(verified: readonly LinuxVerifiedFact[]): DriveStep[] {
  const steps: DriveStep[] = []
  if (verified.includes('cursor')) {
    steps.push({ sample: 1, kind: 'pointer', x: 200, y: 200, signal: 'cursorScreenPoint' })
    steps.push({ sample: 2, kind: 'pointer', x: 1000, y: 600, signal: 'cursorScreenPoint' })
  }
  if (verified.includes('foreground'))
    steps.push({ sample: 3, kind: 'focus', signal: 'foregroundWindow' })
  return steps
}

/**
 * Moves focus from AIRI to a helper window and back, and proves both moves with the app's own foreground samples:
 * focus must leave AIRI while the helper is open, and return to an AIRI window once it closes. Throws when either
 * move does not happen within `timeoutMs`; the helper is always closed. The helper, bridge, clock and sleep are
 * external boundaries, stubbed in unit tests.
 */
export async function focusRoundTrip(options: {
  openHelper: () => Promise<{ close: () => Promise<void> }>
  readForeground: () => Promise<MotionQaState['foreground']>
  now: () => number
  sleep: (ms: number) => Promise<void>
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const waitFor = async (failure: string, reached: (foreground: NonNullable<MotionQaState['foreground']>) => boolean) => {
    const deadline = options.now() + timeoutMs
    for (;;) {
      const foreground = await options.readForeground()
      if (foreground && reached(foreground))
        return foreground
      if (options.now() >= deadline)
        throw new Error(`${failure} within ${timeoutMs} ms`)
      // The app samples the foreground window once a second.
      await options.sleep(250)
    }
  }
  const helper = await options.openHelper()
  let away: NonNullable<MotionQaState['foreground']>
  try {
    away = await waitFor('focus never left AIRI', foreground => !foreground.ownProcess)
  }
  finally {
    await helper.close()
  }
  const back = await waitFor('focus never returned to an AIRI window', foreground => foreground.ownProcess)
  return `focus left AIRI for ${away.exeName ?? 'an unnamed window'}, then returned to an AIRI window (${back.exeName ?? 'unnamed'})`
}

/** A bridge read that timed out: no sample was recorded for it. `atMs` is null before the first sample. */
export interface MissedSample {
  readonly atMs: number | null
  readonly message: string
}

/** A run of this many timed-out bridge reads in a row ends the observation as broken. */
export const MAX_CONSECUTIVE_MISSED_SAMPLES = 3

const timedOutPattern = /timed out after \d+ ?ms/

/**
 * Samples the bridge every 5 seconds for 180 seconds. The clock, bridge and `drive` are external boundaries, stubbed in
 * unit tests. A read that times out (a slow CDP evaluate under host load) is recorded in `missed` and retried at once;
 * the evaluation sees only the samples that arrived. Any other error, or the third timeout in a row, ends the run.
 */
export async function observeHost(options: {
  readState: () => Promise<Pick<MotionQaState, 'host' | 'desktopIdleSeconds' | 'performanceMode' | 'foreground'>>
  now: () => number
  sleep: (ms: number) => Promise<void>
  signal: AbortSignal
  samples: HostSample[]
  /** Runs after each recorded sample except the last, with that sample's index; the next sample waits for it. */
  drive?: (index: number) => Promise<void>
  missed?: MissedSample[]
}): Promise<void> {
  let start: number | undefined
  let consecutiveMissed = 0
  for (;;) {
    options.signal.throwIfAborted()
    let state: Awaited<ReturnType<typeof options.readState>>
    try {
      state = await options.readState()
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? ''
      if (options.signal.aborted || !timedOutPattern.test(message))
        throw error
      options.missed?.push({ atMs: start === undefined ? null : options.now() - start, message })
      consecutiveMissed += 1
      if (consecutiveMissed >= MAX_CONSECUTIVE_MISSED_SAMPLES)
        throw error
      continue
    }
    consecutiveMissed = 0
    const sampledAt = options.now()
    // The first request has variable latency; start the interval at its completed sample.
    start ??= sampledAt
    const atMs = sampledAt - start
    options.samples.push({ atMs, host: state.host, desktopIdleSeconds: state.desktopIdleSeconds, performanceMode: state.performanceMode, foreground: state.foreground })
    if (atMs >= 180_000)
      return
    await options.drive?.(options.samples.length - 1)
    await options.sleep(Math.min(5_000, 180_000 - atMs))
  }
}
