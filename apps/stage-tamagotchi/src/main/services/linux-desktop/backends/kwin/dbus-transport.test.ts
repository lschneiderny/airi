import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbusTransport } from '../../dbus/transport'
import { KwinBackend } from './index'

// A fake compositor on a second connection drives the backend through the real transport.
describe('kwinBackend on DbusTransport and a private daemon', () => {
  let daemon: ChildProcessWithoutNullStreams
  let app: DbusTransport
  let kwin: DbusTransport
  let appOwner: string
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-kwin-dbus-'))
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: 'pipe' })
    const lines = createInterface({ input: daemon.stdout })
    try {
      const [address] = await once(lines, 'line', { signal: AbortSignal.timeout(2000) })
      if (typeof address !== 'string' || !address.startsWith('unix:'))
        throw new Error(`Unexpected private bus address: ${address}`)
      app = await DbusTransport.session(address)
      kwin = await DbusTransport.session(address)
      expect(await app.requestName('ai.airi.KwinBackendTest')).toBe(true)
      expect(await kwin.requestName('org.kde.KWin')).toBe(true)
      const owner = await kwin.getNameOwner('ai.airi.KwinBackendTest')
      if (owner === null)
        throw new Error('Private app connection did not acquire its name')
      appOwner = owner
    }
    finally {
      lines.close()
    }
  }, 5000)

  afterAll(async () => {
    try {
      await kwin?.close()
      await app?.close()
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

  it('replies to OwnPids with its JSON string and accepts pushes without data', async () => {
    const loaded = new Set<string>()
    const replies = Promise.withResolvers<{ hello: unknown, ownPids: unknown }>()
    const backend = new KwinBackend({ transport: app, tempDir: directory, ownPids: () => [4242], onMessage: () => {}, onFailure: () => {} })
    const bridge = { destination: backend.busName, path: '/bridge', interface: 'ai.moeru.airi.LinuxDesktop1' }
    const allowedSender = { allowedSender: () => appOwner }
    const unexportScripting = kwin.exportObject('/Scripting', {
      name: 'org.kde.kwin.Scripting',
      methods: {
        loadScript: { signature: 'ss', outSignature: 'i', handler: (_path, name) => {
          loaded.add(String(name))
          return 1
        } },
        isScriptLoaded: { signature: 's', outSignature: 'b', handler: name => loaded.has(String(name)) },
        unloadScript: { signature: 's', outSignature: 'b', handler: name => loaded.delete(String(name)) },
      },
    }, allowedSender)
    // Like KWin's callDBus, the script reports after run returns.
    const unexportScript = kwin.exportObject('/Scripting/Script1', {
      name: 'org.kde.kwin.Script',
      methods: {
        run: { signature: '', outSignature: '', handler: () => {
          (async () => {
            const hello = await kwin.call({ ...bridge, member: 'Hello', signature: 's', body: [JSON.stringify({ api: 'plasma6' })] })
            const ownPids = await kwin.call({ ...bridge, member: 'OwnPids' })
            replies.resolve({ hello, ownPids })
          })().catch(replies.reject)
        } },
      },
    }, allowedSender)
    try {
      await backend.start()
      expect(await replies.promise).toEqual({ hello: undefined, ownPids: '[4242]' })
      expect(loaded).toEqual(new Set([backend.bridgeName]))
      await backend.stop()
      expect(loaded.size).toBe(0)
    }
    finally {
      await backend.stop()
      unexportScript()
      unexportScripting()
    }
  }, 5000)
})
