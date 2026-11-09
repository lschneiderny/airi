import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DbusTransport } from '../../apps/stage-tamagotchi/src/main/services/linux-desktop/dbus/transport'

const root = resolve(import.meta.dirname, '../..')
const busName = 'org.freedesktop.DBus'
const busPath = '/org/freedesktop/DBus'

/** A compositor peer that owns org.kde.KWin on the private bus and answers the scripting calls the backend makes. */
async function fakeKwin(address: string, options: { releaseNameOnUnload?: boolean } = {}) {
  const kwin = await DbusTransport.session(address)
  const calls: string[] = []
  const loaded = new Set<string>()
  let app: { name: string, owner: string } | undefined
  kwin.onSignal({ sender: busName, path: busPath, interface: busName, member: 'NameOwnerChanged' }, ([name, _old, owner]) => {
    if (typeof name === 'string' && name.startsWith('ai.moeru.airi.LinuxDesktop.p') && typeof owner === 'string' && owner)
      app = { name, owner }
  })
  expect(await kwin.requestName('org.kde.KWin')).toBe(true)
  const allowedSender = { allowedSender: () => app?.owner ?? null }
  kwin.exportObject('/Scripting', {
    name: 'org.kde.kwin.Scripting',
    methods: {
      loadScript: { signature: 'ss', outSignature: 'i', handler: (_path, name) => {
        calls.push('loadScript')
        loaded.add(String(name))
        return 1
      } },
      isScriptLoaded: { signature: 's', outSignature: 'b', handler: (name) => {
        calls.push('isScriptLoaded')
        return loaded.has(String(name))
      } },
      unloadScript: { signature: 's', outSignature: 'b', handler: async (name) => {
        calls.push('unloadScript')
        if (options.releaseNameOnUnload)
          await kwin.call({ destination: busName, path: busPath, interface: busName, member: 'ReleaseName', signature: 's', body: ['org.kde.KWin'] })
        return loaded.delete(String(name))
      } },
    },
  }, allowedSender)
  kwin.exportObject('/Scripting/Script1', {
    name: 'org.kde.kwin.Script',
    methods: {
      run: { signature: '', outSignature: '', handler: () => {
        calls.push('run')
        // Like KWin's callDBus, the bridge reports after run returns.
        const bridge = { destination: app?.name ?? '', path: '/bridge', interface: 'ai.moeru.airi.LinuxDesktop1', signature: 's' }
        void kwin.call({ ...bridge, member: 'Hello', body: [JSON.stringify({ api: 'plasma6' })] })
      } },
    },
  }, allowedSender)
  return { calls, close: () => kwin.close() }
}

/** Runs the real CLI. Once it prints Hello, SIGTERM ends the run, so no test waits on a timer. */
async function runProbe(args: string[], env: NodeJS.ProcessEnv) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev-tools/kwin-probe.ts', '--seconds', '60', ...args], { cwd: root, env, stdio: 'pipe' })
  const stdout: string[] = []
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    stdout.push(line)
    if (line.includes('"method":"Hello"'))
      child.kill('SIGTERM')
  })
  try {
    const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(15_000) })
    return { code: code as number | null, stdout, stderr }
  }
  finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
  }
}

describe('kwin-probe CLI on a private daemon', () => {
  let daemon: ChildProcessWithoutNullStreams
  let address: string
  let directory: string
  let env: NodeJS.ProcessEnv
  let kwin: Awaited<ReturnType<typeof fakeKwin>> | undefined

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-kwin-probe-'))
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: 'pipe' })
    const lines = createInterface({ input: daemon.stdout })
    try {
      const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(2000) })
      if (typeof line !== 'string' || !line.startsWith('unix:'))
        throw new Error(`Unexpected private bus address: ${line}`)
      address = line
    }
    finally {
      lines.close()
    }
    const { AIRI_QA_DISPLAY_SESSION: _marker, ...inherited } = process.env
    // The private bus plays the inherited session bus; the marker is absent like on the user's desktop.
    env = { ...inherited, DBUS_SESSION_BUS_ADDRESS: address, XDG_RUNTIME_DIR: directory }
  }, 5000)

  afterEach(async () => {
    await kwin?.close()
    kwin = undefined
  })

  afterAll(async () => {
    try {
      await rm(directory, { recursive: true, force: true })
    }
    finally {
      if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
        const exited = once(daemon, 'exit', { signal: AbortSignal.timeout(2000) })
        daemon.kill()
        await exited
      }
    }
  })

  it('refuses the inherited bus without a QA session marker before calling KWin', async () => {
    kwin = await fakeKwin(address)
    const result = await runProbe([], env)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('pnpm qa:display run --')
    expect(result.stdout).toEqual([])
    expect(kwin.calls).toEqual([])
  }, 20_000)

  it('refuses a marker that names no running QA session', async () => {
    kwin = await fakeKwin(address)
    const result = await runProbe([], { ...env, AIRI_QA_DISPLAY_SESSION: 'kwin-probe-test-absent' })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('is not running')
    expect(kwin.calls).toEqual([])
  }, 20_000)

  it('runs on an explicit --bus and verifies cleanup with KWin', async () => {
    kwin = await fakeKwin(address)
    const result = await runProbe(['--bus', address], env)
    expect(result.stdout).toEqual(['{"method":"Hello","payload":{"api":"plasma6"}}', 'scripts-unloaded: true'])
    expect(result.code).toBe(0)
  }, 20_000)

  it('exits 1 with an unverified receipt when KWin leaves during stop', async () => {
    kwin = await fakeKwin(address, { releaseNameOnUnload: true })
    const result = await runProbe(['--bus', address], env)
    expect(kwin.calls).toContain('unloadScript')
    expect(result.stdout.at(-1)).toBe('scripts-unloaded: unverified')
    expect(result.code).toBe(1)
  }, 20_000)
})
