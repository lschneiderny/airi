import type { HostCapabilities, HostFacts, HostId } from '@proj-airi/stage-shared/host-capabilities'

import type { HostSample } from './smoke'

import { capabilitiesForHost, HostReasons, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'
import { describe, expect, it } from 'vitest'

import { evaluateHostSmoke, expectedHostFacts, observeHost } from './smoke'

describe('expectedHostFacts', () => {
  it.each<{
    platform: HostFacts['platform']
    env: Record<string, string>
    xwayland: boolean
    host: HostId
  }>([
    { platform: 'win32', env: {}, xwayland: false, host: 'windows' },
    { platform: 'darwin', env: {}, xwayland: false, host: 'macos' },
    { platform: 'linux', env: {}, xwayland: false, host: 'linux-x11' },
    { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, xwayland: false, host: 'linux-wayland' },
    { platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, xwayland: true, host: 'linux-xwayland' },
    { platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, xwayland: false, host: 'linux-wayland' },
    { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-1', XDG_SESSION_TYPE: 'x11' }, xwayland: true, host: 'linux-xwayland' },
  ])('detects $host from runner facts', ({ host, ...input }) => {
    const facts = expectedHostFacts({ ...input, macosVersion: input.platform === 'darwin' ? '14.2' : null })
    expect(resolveHostCapabilities(facts, 0).host).toBe(host)
  })

  it.each([
    ['13.6', { kind: 'degraded', reason: HostReasons.MacosCaptureAudioRequires14_2 }],
    ['14.2', { kind: 'live' }],
  ])('uses macOS %s for the audio capture oracle', (macosVersion, status) => {
    const facts = expectedHostFacts({ platform: 'darwin', env: {}, xwayland: false, macosVersion })
    expect(resolveHostCapabilities(facts, 0).signals.systemAudioCapture).toEqual(status)
  })

  it('refuses an unreadable macOS version instead of claiming audio support', () => {
    expect(() => expectedHostFacts({ platform: 'darwin', env: {}, xwayland: false, macosVersion: null })).toThrow('macosVersion')
  })
})

async function sequence(host: HostId, stateAt: (index: number, caps: HostCapabilities) => Pick<HostSample, 'host' | 'desktopIdleSeconds'>) {
  let clock = 0
  let index = 0
  const samples: HostSample[] = []
  await observeHost({
    readState: async () => ({ ...stateAt(index++, capabilitiesForHost(host)), performanceMode: 'idle' }),
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    signal: new AbortController().signal,
    samples,
  })
  return samples
}

function live(caps: HostCapabilities): HostCapabilities {
  return { ...caps, signals: { ...caps.signals, systemIdleTime: { kind: 'live' } } }
}

describe('host smoke observation', () => {
  it.each(['linux-x11', 'linux-xwayland', 'linux-wayland'] as const)('accepts bridge verification and proven lock on %s during rollout', async (hostId) => {
    const samples = await sequence(hostId, (index, host) => ({
      host: {
        ...host,
        signals: {
          ...host.signals,
          foregroundWindow: { kind: 'unavailable', reason: index === 0 ? HostReasons.LinuxBridgeStarting : HostReasons.LinuxForegroundVerifying },
          cursorScreenPoint: { kind: 'unavailable', reason: HostReasons.LinuxCursorVerifying },
          windowOrigin: { kind: 'unavailable', reason: HostReasons.LinuxGeometryVerifying },
          screenLock: { kind: 'live' },
        },
      },
      desktopIdleSeconds: hostId === 'linux-x11' ? index * 5 : null,
    }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost(hostId), samples }).failures).toEqual([])
  })

  it.each([
    ['linux-wayland', 'foregroundWindow', HostReasons.LinuxBridgeFailed],
    ['linux-wayland', 'globalKeyUp', HostReasons.LinuxBridgeStarting],
    ['windows', 'foregroundWindow', HostReasons.LinuxForegroundVerifying],
    ['linux-wayland', 'systemAudioCapture', HostReasons.LinuxGeometryVerifying],
  ] as const)('rejects rollout tolerance for %s %s %s', async (hostId, signal, reason) => {
    const samples = await sequence(hostId, (index, host) => ({
      host: { ...host, signals: { ...host.signals, [signal]: { kind: 'unavailable', reason } } },
      desktopIdleSeconds: hostId === 'windows' ? index * 5 : null,
    }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost(hostId), samples }).failures)
      .toContainEqual(expect.objectContaining({ code: 'signal-mismatch', signal }))
  })

  it('accepts matching healthy host signals with advancing raw idle samples', async () => {
    const samples = await sequence('windows', index => ({ host: capabilitiesForHost('windows'), desktopIdleSeconds: index * 5 }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples })).toEqual({
      exitCode: 0,
      idleOutcome: 'idle-verified',
      failures: [],
    })
    expect(samples.map(sample => sample.atMs)).toEqual(Array.from({ length: 37 }, (_, index) => index * 5_000))
    expect(samples.at(-1)?.desktopIdleSeconds).toBe(180)
  })

  it('names systemIdleTime when a live sensor stays at 42', async () => {
    const samples = await sequence('windows', (_, host) => ({ host, desktopIdleSeconds: 42 }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'idle-not-advancing', signal: 'systemIdleTime' }))
  })

  it.each([
    ['once after attachment', 5],
    ['before attachment', 0],
  ])('verifies Wayland idle that becomes live %s', async (_, flipAt) => {
    const samples = await sequence('linux-wayland', (index, host) => ({
      host: index >= flipAt ? live(host) : host,
      desktopIdleSeconds: index >= flipAt ? index * 5 : null,
    }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), expectIdle: 'verified', samples })).toEqual({
      exitCode: 0,
      idleOutcome: 'idle-verified',
      failures: [],
    })
  })

  it('accepts unverified Wayland only with null readings throughout', async () => {
    const samples = await sequence('linux-wayland', (_, host) => ({ host, desktopIdleSeconds: null }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), expectIdle: 'unverified', samples })).toEqual({
      exitCode: 0,
      idleOutcome: 'idle-unverified',
      failures: [],
    })
    const mismatch = evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), expectIdle: 'verified', samples })
    expect(mismatch.exitCode).toBe(1)
    expect(mismatch.failures).toContainEqual(expect.objectContaining({ code: 'idle-outcome-mismatch', signal: 'systemIdleTime', expected: 'idle-verified', received: 'idle-unverified' }))
  })

  it.each([
    ['live to unavailable', (index: number) => index < 10],
    ['two flips', (index: number) => index >= 5 && index < 20],
    ['second promotion', (index: number) => (index >= 5 && index < 15) || index >= 20],
  ])('rejects the Wayland %s sequence', async (_, isLive) => {
    const samples = await sequence('linux-wayland', (index, host) => ({
      host: isLive(index) ? live(host) : host,
      desktopIdleSeconds: isLive(index) ? index * 5 : null,
    }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'wayland-idle-invalid', signal: 'systemIdleTime' }))
  })

  it('fails a forced host mismatch and names the XWayland idle reason', async () => {
    const samples = await sequence('linux-xwayland', (_, host) => ({ host, desktopIdleSeconds: null }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'host-mismatch', expected: 'linux-wayland', received: 'linux-xwayland' }))
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: 'signal-mismatch',
      signal: 'systemIdleTime',
      received: { kind: 'unavailable', reason: HostReasons.XwaylandIdleConstantZero },
    }))
  })

  it.each([
    ['globalKeyUp', HostReasons.GlobalInputHookLoadFailed],
    ['foregroundWindow', HostReasons.ForegroundBindingLoadFailed],
  ] as const)('fails and names a runtime %s binding failure', async (signal, reason) => {
    const samples = await sequence('windows', (index, host) => ({
      host: { ...host, signals: { ...host.signals, [signal]: { kind: 'unavailable', reason } } },
      desktopIdleSeconds: index * 5,
    }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'signal-mismatch', signal, received: { kind: 'unavailable', reason } }))
  })

  it('checks snapshots after the initial sample for runtime changes', async () => {
    const samples = await sequence('windows', (index, host) => ({
      host: index === 20 ? { ...host, signals: { ...host.signals, windowOrigin: { kind: 'unavailable', reason: HostReasons.WaylandWindowOriginHidden } } } : host,
      desktopIdleSeconds: index * 5,
    }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'signal-mismatch', signal: 'windowOrigin' }))
  })

  it.each(['linux-wayland', 'linux-xwayland'] as const)('rejects a fabricated unavailable idle reading on %s', async (hostId) => {
    const samples = await sequence(hostId, (_, host) => ({ host, desktopIdleSeconds: 0 }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost(hostId), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ signal: 'systemIdleTime' }))
  })

  it('rejects a different unavailable Wayland reason', async () => {
    const samples = await sequence('linux-wayland', (_, host) => ({
      host: { ...host, signals: { ...host.signals, systemIdleTime: { kind: 'unavailable', reason: HostReasons.XwaylandIdleConstantZero } } },
      desktopIdleSeconds: null,
    }))
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('linux-wayland'), samples }).exitCode).toBe(1)
  })

  it('rejects an incomplete observation', async () => {
    const samples = await sequence('linux-xwayland', (_, host) => ({ host, desktopIdleSeconds: null }))
    const result = evaluateHostSmoke({ expected: capabilitiesForHost('linux-xwayland'), samples: samples.slice(0, 10) })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'observation-too-short', signal: 'systemIdleTime' }))
  })

  it('observes a full interval after the first bridge request finishes', async () => {
    let clock = 0
    let index = 0
    const samples: HostSample[] = []
    await observeHost({
      readState: async () => {
        clock += index === 0 ? 2 : 0.2
        return { host: capabilitiesForHost('windows'), desktopIdleSeconds: index++ * 5, performanceMode: 'idle' }
      },
      now: () => clock,
      sleep: async (ms) => { clock += ms },
      signal: new AbortController().signal,
      samples,
    })
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples }).exitCode).toBe(0)
  })

  it('retains raw samples when interruption stops observation', async () => {
    const controller = new AbortController()
    const samples: HostSample[] = []
    await expect(observeHost({
      readState: async () => ({ host: capabilitiesForHost('linux-xwayland'), desktopIdleSeconds: null, performanceMode: 'idle' }),
      now: () => 0,
      sleep: async () => { controller.abort(new Error('SIGINT')) },
      signal: controller.signal,
      samples,
    })).rejects.toThrow('SIGINT')
    expect(samples).toHaveLength(1)
  })
})
