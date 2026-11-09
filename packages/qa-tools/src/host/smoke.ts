import type { HostCapabilities, HostFacts, HostSignal, SignalStatus } from '@proj-airi/stage-shared/host-capabilities'
import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import { isDeepStrictEqual } from 'node:util'

import { HostReasons, idleAdvances } from '@proj-airi/stage-shared/host-capabilities'

/** Runner facts describe a healthy host; runtime binding failures must fail the comparison. */
export function expectedHostFacts(input: {
  platform: HostFacts['platform']
  env: Readonly<Record<string, string | undefined>>
  xwayland: boolean
  macosVersion: string | null
}): HostFacts {
  const waylandSession = input.platform === 'linux'
    && (Boolean(input.env.WAYLAND_DISPLAY) || input.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland')
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
  }
}
export interface HostSample {
  readonly atMs: number
  readonly host: HostCapabilities | null
  readonly desktopIdleSeconds: number | null
  readonly performanceMode: MotionQaState['performanceMode']
}

export interface SmokeResult {
  readonly exitCode: 0 | 1
  readonly idleOutcome: 'idle-verified' | 'idle-unverified' | 'idle-unavailable' | 'idle-failed'
  readonly failures: readonly string[]
}

function unverified(status: SignalStatus): boolean {
  return status.kind === 'unavailable' && status.reason === HostReasons.WaylandIdleUnverified
}

/** Checks every observed snapshot, including status reversals and a frozen live idle sensor. */
export function evaluateHostSmoke(input: {
  expected: HostCapabilities
  expectIdle?: 'verified' | 'unverified'
  samples: readonly HostSample[]
}): SmokeResult {
  const { expected, samples } = input
  const failures = new Set<string>()
  if (samples.length < 2 || samples[samples.length - 1].atMs - samples[0].atMs < 180_000)
    failures.add('systemIdleTime: observation did not span 180 seconds')
  for (const sample of samples) {
    const actual = sample.host
    if (!actual) {
      failures.add('host: bridge snapshot is null')
      continue
    }
    if (actual.host !== expected.host)
      failures.add(`host: expected ${expected.host}, received ${actual.host}`)
    for (const signal of Object.keys(expected.signals) as HostSignal[]) {
      const status = actual.signals[signal]
      if (signal === 'systemIdleTime' && expected.host === 'linux-wayland') {
        if (status.kind === 'live' || unverified(status))
          continue
      }
      else if (isDeepStrictEqual(status, expected.signals[signal])) {
        continue
      }
      failures.add(`${signal}: expected ${JSON.stringify(expected.signals[signal])}, received ${JSON.stringify(status)}`)
    }
  }

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
      failures.add('systemIdleTime: invalid Wayland transition or idle readings did not advance while live')
    if (input.expectIdle && idleOutcome !== `idle-${input.expectIdle}`)
      failures.add(`systemIdleTime: expected idle-${input.expectIdle}, received ${idleOutcome}`)
  }
  else if (expected.signals.systemIdleTime.kind === 'live') {
    idleOutcome = advancing ? 'idle-verified' : 'idle-failed'
    if (!advancing)
      failures.add('systemIdleTime: live idle readings did not advance')
  }
  else if (samples.some(sample => sample.desktopIdleSeconds !== null)) {
    idleOutcome = 'idle-failed'
    failures.add('systemIdleTime: unavailable idle signal emitted a reading')
  }
  return { exitCode: failures.size ? 1 : 0, idleOutcome, failures: [...failures] }
}

/** Observes without driving input. The clock and bridge are external boundaries, stubbed in unit tests. */
export async function observeHost(options: {
  readState: () => Promise<Pick<MotionQaState, 'host' | 'desktopIdleSeconds' | 'performanceMode'>>
  now: () => number
  sleep: (ms: number) => Promise<void>
  signal: AbortSignal
  samples: HostSample[]
}): Promise<void> {
  let start: number | undefined
  for (;;) {
    options.signal.throwIfAborted()
    const state = await options.readState()
    const sampledAt = options.now()
    // The first request has variable latency; start the interval at its completed sample.
    start ??= sampledAt
    const atMs = sampledAt - start
    options.samples.push({ atMs, host: state.host, desktopIdleSeconds: state.desktopIdleSeconds, performanceMode: state.performanceMode })
    if (atMs >= 180_000)
      return
    await options.sleep(Math.min(5_000, 180_000 - atMs))
  }
}
