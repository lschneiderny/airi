import type { HostCapabilities, HostFacts, HostId, LinuxDesktopFacts } from '@proj-airi/stage-shared/host-capabilities'

import type { HostSample, LinuxDesktopExpectation } from './smoke'

import { capabilitiesForHost, HostReasons, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'
import { describe, expect, it } from 'vitest'

import { evaluateHostSmoke, expectedHostFacts, focusRoundTrip, hostSmokeExpectation, linuxDesktopFacts, linuxDriveSteps, observeHost, parseLinuxDesktopExpectation } from './smoke'

describe('parseLinuxDesktopExpectation', () => {
  it('parses the backend and verified list on Linux', () => {
    expect(parseLinuxDesktopExpectation('linux', 'kwin', 'foreground,cursor,geometry')).toEqual({ backend: 'kwin', verified: ['foreground', 'cursor', 'geometry'] })
    expect(parseLinuxDesktopExpectation('linux', 'none', undefined)).toEqual({ backend: 'none', verified: [] })
    expect(parseLinuxDesktopExpectation('win32', undefined, undefined)).toBeNull()
  })

  it.each([
    ['linux', undefined, undefined, /required on Linux/],
    ['linux', 'mutter', undefined, /Unknown --expect-backend/],
    ['linux', 'kwin', 'foreground,title', /Unknown --expect-verified fact: title/],
    ['linux', 'kwin', 'cursor,cursor', /twice/],
    ['darwin', 'kwin', undefined, /Linux only/],
    ['win32', undefined, 'foreground', /Linux only/],
  ] as const)('refuses %s --expect-backend %s --expect-verified %s', (platform, backend, verified, error) => {
    expect(() => parseLinuxDesktopExpectation(platform, backend, verified)).toThrow(error)
  })
})

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

  it('derives the Linux desktop facts from the expected backend and verified signals', () => {
    const facts = expectedHostFacts({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, xwayland: false, macosVersion: null, linuxDesktop: { backend: 'kwin', verified: ['foreground', 'cursor', 'geometry'] } })
    expect(facts.linuxDesktop).toMatchObject({ backend: 'kwin', bridge: 'ready', foregroundVerified: true, cursorVerified: true, geometryVerified: true, keepAboveVerified: false, lockSource: null, portalShortcuts: 'absent', systemAudioVerified: false })
    const host = resolveHostCapabilities(facts, 0)
    expect(host.linuxDesktopBackend).toBe('kwin')
    expect(host.signals).toMatchObject({ foregroundWindow: { kind: 'live' }, cursorScreenPoint: { kind: 'live' }, windowOrigin: { kind: 'live' } })
    expect(host).toEqual(capabilitiesForHost('linux-wayland', facts.linuxDesktop!))
  })

  it('refuses an unreadable macOS version instead of claiming audio support', () => {
    expect(() => expectedHostFacts({ platform: 'darwin', env: {}, xwayland: false, macosVersion: null })).toThrow('macosVersion')
  })
})

async function sequence(host: HostId, stateAt: (index: number, caps: HostCapabilities) => Pick<HostSample, 'host' | 'desktopIdleSeconds'> & Partial<Pick<HostSample, 'foreground'>>) {
  let clock = 0
  let index = 0
  const samples: HostSample[] = []
  await observeHost({
    readState: async () => ({ foreground: null, ...stateAt(index++, capabilitiesForHost(host)), performanceMode: 'idle' }),
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
  const kwin: LinuxDesktopExpectation = { backend: 'kwin', verified: ['foreground', 'cursor', 'geometry'] }
  const resolveOn = (host: HostId) => (desktop: LinuxDesktopFacts | null) => capabilitiesForHost(host, desktop ?? undefined)
  const fg = { exeName: 'electron', busy: 'accepts', ownProcess: true } as const

  /** Starting for two samples, verifying for two, then verified: the documented once-per-signal transition. */
  function rollout(host: HostId, desktop: LinuxDesktopExpectation) {
    return (index: number): HostCapabilities => {
      const unverified = { ...desktop, verified: [] }
      if (index < 2)
        return capabilitiesForHost(host, linuxDesktopFacts(unverified, 'starting'))
      if (index < 4)
        return capabilitiesForHost(host, linuxDesktopFacts(unverified))
      return capabilitiesForHost(host, linuxDesktopFacts(desktop))
    }
  }

  it.each<[HostId, LinuxDesktopExpectation]>([
    ['linux-wayland', kwin],
    ['linux-xwayland', { backend: 'kwin', verified: ['foreground', 'cursor'] }],
    ['linux-x11', { backend: 'x11-ewmh', verified: ['foreground'] }],
    ['linux-wayland', { backend: 'sway', verified: ['foreground', 'geometry'] }],
  ])('accepts %s %o that goes from starting through verifying to verified once', async (hostId, desktop) => {
    const at = rollout(hostId, desktop)
    const samples = await sequence(hostId, index => ({ host: at(index), desktopIdleSeconds: hostId === 'linux-x11' ? index * 5 : null, foreground: index >= 4 ? fg : null }))
    const expectation = hostSmokeExpectation(resolveOn(hostId), desktop)
    expect(evaluateHostSmoke({ ...expectation, expectIdle: hostId === 'linux-wayland' ? 'unverified' : undefined, samples }).failures).toEqual([])
  })

  it('rejects a second transition: verified foreground that falls back to verifying', async () => {
    const at = rollout('linux-wayland', kwin)
    const samples = await sequence('linux-wayland', index => ({ host: index === 20 ? at(3) : at(index), desktopIdleSeconds: null, foreground: fg }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), kwin), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'signal-mismatch', signal: 'foregroundWindow', received: { kind: 'unavailable', reason: HostReasons.LinuxForegroundVerifying } }))
  })

  it('names verification-missing when an expected verified signal never turns live', async () => {
    const stuck = { ...kwin, verified: ['cursor', 'geometry'] } as const
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts(stuck)), desktopIdleSeconds: null, foreground: null }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), kwin), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'verification-missing', signal: 'foregroundWindow' }))
    expect(result.failures.filter(failure => failure.code === 'signal-mismatch')).toEqual([])
  })

  it('names verification-missing when foreground is live but no foreground sample arrived', async () => {
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts(kwin)), desktopIdleSeconds: null, foreground: null }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), kwin), samples })
    expect(result.failures).toEqual([expect.objectContaining({ code: 'verification-missing', signal: 'foregroundWindow' })])
  })

  it('fails backend-mismatch when the app reports another backend', async () => {
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts(kwin)), desktopIdleSeconds: null, foreground: fg }))
    const sway: LinuxDesktopExpectation = { backend: 'sway', verified: ['foreground', 'geometry'] }
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), sway), samples })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'backend-mismatch', signal: 'host', expected: 'sway', received: 'kwin' }))
  })

  it('rejects a live screen lock the expectation does not name', async () => {
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts({ ...kwin, verified: [...kwin.verified, 'lock'] })), desktopIdleSeconds: null, foreground: fg }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), kwin), samples })
    expect(result.failures).toEqual([expect.objectContaining({ code: 'signal-mismatch', signal: 'screenLock', received: { kind: 'live' } })])
  })

  it('names verification-missing for an expected lock source that never appears', async () => {
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts(kwin)), desktopIdleSeconds: null, foreground: fg }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-wayland'), { ...kwin, verified: [...kwin.verified, 'lock'] }), samples })
    expect(result.failures).toEqual([expect.objectContaining({ code: 'verification-missing', signal: 'screenLock' })])
  })

  it('refuses a verified fact that changes no signal of that host and backend', () => {
    expect(() => hostSmokeExpectation(resolveOn('linux-x11'), { backend: 'x11-ewmh', verified: ['foreground', 'cursor'] })).toThrow(/cursor/)
    expect(() => hostSmokeExpectation(resolveOn('linux-wayland'), { backend: 'sway', verified: ['cursor'] })).toThrow(/cursor/)
  })

  it('rejects a bridge-owned signal stuck at starting when no verification is expected', async () => {
    const desktop: LinuxDesktopExpectation = { backend: 'x11-ewmh', verified: [] }
    const samples = await sequence('linux-x11', index => ({ host: capabilitiesForHost('linux-x11', linuxDesktopFacts(desktop, 'starting')), desktopIdleSeconds: index * 5 }))
    const result = evaluateHostSmoke({ ...hostSmokeExpectation(resolveOn('linux-x11'), desktop), samples })
    expect(result.failures).toContainEqual(expect.objectContaining({ code: 'signal-mismatch', signal: 'foregroundWindow', received: { kind: 'unavailable', reason: HostReasons.LinuxBridgeStarting } }))
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
        return { host: capabilitiesForHost('windows'), desktopIdleSeconds: index++ * 5, performanceMode: 'idle', foreground: null }
      },
      now: () => clock,
      sleep: async (ms) => { clock += ms },
      signal: new AbortController().signal,
      samples,
    })
    expect(evaluateHostSmoke({ expected: capabilitiesForHost('windows'), samples }).exitCode).toBe(0)
  })

  it('drives verification once per sample index after recording it', async () => {
    let clock = 0
    const driven: Array<[number, number]> = []
    const samples: HostSample[] = []
    await observeHost({
      readState: async () => ({ host: capabilitiesForHost('windows'), desktopIdleSeconds: clock / 1_000, performanceMode: 'idle', foreground: null }),
      now: () => clock,
      sleep: async (ms) => { clock += ms },
      signal: new AbortController().signal,
      samples,
      drive: async (index) => { driven.push([index, samples.length]) },
    })
    expect(driven).toEqual(samples.slice(0, -1).map((_, index) => [index, index + 1]))
  })

  it('retains raw samples when interruption stops observation', async () => {
    const controller = new AbortController()
    const samples: HostSample[] = []
    await expect(observeHost({
      readState: async () => ({ host: capabilitiesForHost('linux-xwayland'), desktopIdleSeconds: null, performanceMode: 'idle', foreground: null }),
      now: () => 0,
      sleep: async () => { controller.abort(new Error('SIGINT')) },
      signal: controller.signal,
      samples,
    })).rejects.toThrow('SIGINT')
    expect(samples).toHaveLength(1)
  })
})

describe('linux verification drive', () => {
  it('plans pointer moves only for cursor and the focus round trip only for foreground', () => {
    expect(linuxDriveSteps(['foreground', 'cursor', 'geometry'])).toEqual([
      { sample: 1, kind: 'pointer', x: 200, y: 200, signal: 'cursorScreenPoint' },
      { sample: 2, kind: 'pointer', x: 1000, y: 600, signal: 'cursorScreenPoint' },
      { sample: 3, kind: 'focus', signal: 'foregroundWindow' },
    ])
    expect(linuxDriveSteps(['geometry', 'lock'])).toEqual([])
  })

  /** A foreground reader that follows a scripted focus owner, and a clock that only moves when the drive sleeps. */
  function scripted(owner: () => 'airi' | 'helper') {
    let clock = 0
    const log: string[] = []
    return {
      log,
      now: () => clock,
      sleep: async (ms: number) => { clock += ms },
      readForeground: async () => owner() === 'airi' ? { exeName: 'electron', busy: 'accepts' as const, ownProcess: true } : { exeName: 'konsole', busy: 'accepts' as const, ownProcess: false },
    }
  }

  it('moves focus to the helper and back to AIRI, closing the helper in between', async () => {
    let focused: 'airi' | 'helper' = 'airi'
    const io = scripted(() => focused)
    const detail = await focusRoundTrip({
      ...io,
      openHelper: async () => {
        io.log.push('open')
        focused = 'helper'
        return {
          close: async () => {
            io.log.push('close')
            focused = 'airi'
          },
        }
      },
    })
    expect(io.log).toEqual(['open', 'close'])
    expect(detail).toBe('focus left AIRI for konsole, then returned to an AIRI window (electron)')
  })

  it('fails and still closes the helper when focus never leaves AIRI', async () => {
    const io = scripted(() => 'airi')
    const close = async () => {
      io.log.push('close')
    }
    await expect(focusRoundTrip({ ...io, openHelper: async () => ({ close }) }))
      .rejects
      .toThrow('focus never left AIRI')
    expect(io.log).toEqual(['close'])
  })

  it('fails when focus does not come back to AIRI after the helper closes', async () => {
    const io = scripted(() => 'helper')
    await expect(focusRoundTrip({ ...io, openHelper: async () => ({ close: async () => {} }) }))
      .rejects
      .toThrow('focus never returned to an AIRI window')
  })

  it('fails when the app reports no foreground sample', async () => {
    const io = { ...scripted(() => 'airi'), readForeground: async () => null }
    await expect(focusRoundTrip({ ...io, openHelper: async () => ({ close: async () => {} }) }))
      .rejects
      .toThrow('focus never left AIRI')
  })

  it('names drive-failed for a required step that failed or never ran', async () => {
    const desktop: LinuxDesktopExpectation = { backend: 'kwin', verified: ['foreground', 'cursor', 'geometry'] }
    const samples = await sequence('linux-wayland', () => ({ host: capabilitiesForHost('linux-wayland', linuxDesktopFacts(desktop)), desktopIdleSeconds: null, foreground: { exeName: 'electron', busy: 'accepts', ownProcess: true } }))
    const expectation = hostSmokeExpectation(desktop_ => capabilitiesForHost('linux-wayland', desktop_ ?? undefined), desktop)
    const drive = [
      { sample: 1, action: 'pointer 200,200', ok: true, detail: '' },
      { sample: 3, action: 'focus round trip', ok: false, detail: 'focus never left AIRI' },
    ]
    const result = evaluateHostSmoke({ ...expectation, samples, drive, driveSteps: linuxDriveSteps(desktop.verified) })
    expect(result.exitCode).toBe(1)
    expect(result.failures).toEqual([
      expect.objectContaining({ code: 'drive-failed', signal: 'cursorScreenPoint', message: expect.stringContaining('sample 2') }),
      expect.objectContaining({ code: 'drive-failed', signal: 'foregroundWindow', message: expect.stringContaining('focus never left AIRI') }),
    ])
    const passed = evaluateHostSmoke({ ...expectation, samples, drive: [1, 2, 3].map(sample => ({ sample, action: '', ok: true, detail: '' })), driveSteps: linuxDriveSteps(desktop.verified) })
    expect(passed.failures).toEqual([])
  })
})
