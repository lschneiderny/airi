import type { AddressInfo } from 'node:net'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ollamaServerLog, probeOllama } from './ollama-probe'

const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function serve(routes: Record<string, unknown>): Promise<string> {
  const server = createServer((request, response) => {
    const body = routes[request.url ?? '']
    if (body === undefined) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise(resolve => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}

describe('probeOllama', () => {
  it('records the version, the model details, and the GPU share of the loaded model', async () => {
    const baseUrl = await serve({
      '/api/version': { version: '0.40.16' },
      '/api/tags': { models: [{ name: 'other:1b', digest: 'aaa' }, { name: 'small:4b', model: 'small:4b', digest: 'bbb' }] },
      '/api/show': { details: { family: 'gemma', parameter_size: '4.3B', quantization_level: 'Q4_K_M' }, capabilities: ['completion', 'tools'] },
      '/api/ps': { models: [{ name: 'small:4b', model: 'small:4b', size: 6_000, size_vram: 4_500, context_length: 8192 }] },
    })

    await expect(probeOllama(baseUrl, 'small:4b')).resolves.toEqual({
      schema: 'airi.ollama-snapshot/v1',
      version: '0.40.16',
      model: 'small:4b',
      digest: 'bbb',
      family: 'gemma',
      parameterSize: '4.3B',
      quantization: 'Q4_K_M',
      capabilities: ['completion', 'tools'],
      loaded: { size: 6_000, sizeVram: 4_500, contextLength: 8192 },
      load: null,
    })
  })

  it('reads the buffers of the model\'s load from the server log', async () => {
    const blob = 'c'.repeat(64)
    const baseUrl = await serve({
      '/api/version': { version: '0.40.16' },
      '/api/show': { modelfile: `# Modelfile\nFROM /home/user/.ollama/models/blobs/sha256-${blob}\nFROM /home/user/.ollama/models/blobs/sha256-${'d'.repeat(64)}\n` },
      '/api/ps': { models: [] },
    })
    const dir = await mkdtemp(join(tmpdir(), 'ollama-log-'))
    closers.push(() => rm(dir, { recursive: true, force: true }))
    const log = join(dir, 'server.log')
    await writeFile(log, `msg="starting llama-server" cmd="llama-server --model /home/user/.ollama/models/blobs/sha256-${blob} -c 4096"\nload_tensors:  MTL0_Mapped model buffer size =   100.00 MiB\n`)

    const snapshot = await probeOllama(baseUrl, 'small:4b', { serverLog: log })

    expect(snapshot?.load).toMatchObject({ gpuWeightsMiB: 100, contextLength: 4096 })
    await expect(probeOllama(baseUrl, 'small:4b', { serverLog: join(dir, 'absent.log') })).resolves.toMatchObject({ load: null })
  })

  it('records an unloaded model and missing details as null', async () => {
    const baseUrl = await serve({ '/api/version': { version: '0.34.3' }, '/api/ps': { models: [] } })

    const snapshot = await probeOllama(baseUrl, 'small:4b')

    expect(snapshot?.loaded).toBeNull()
    expect(snapshot?.digest).toBeNull()
    expect(snapshot?.quantization).toBeNull()
  })

  it('returns null for a server that is not Ollama', async () => {
    const baseUrl = await serve({})

    await expect(probeOllama(baseUrl, 'airi-replay')).resolves.toBeNull()
  })
})

describe('ollamaServerLog', () => {
  it('uses an explicit log, the default log for a loopback server, and none for a remote one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ollama-home-'))
    closers.push(() => rm(home, { recursive: true, force: true }))

    expect(ollamaServerLog('http://192.0.2.1:11434/v1', '/logs/server.log', home)).toBe('/logs/server.log')
    expect(ollamaServerLog('http://127.0.0.1:11434/v1', undefined, home)).toBeUndefined()
    await mkdir(join(home, '.ollama', 'logs'), { recursive: true })
    await writeFile(join(home, '.ollama', 'logs', 'server.log'), '')
    expect(ollamaServerLog('http://127.0.0.1:11434/v1', undefined, home)).toBe(join(home, '.ollama', 'logs', 'server.log'))
    expect(ollamaServerLog('http://192.0.2.1:11434/v1', undefined, home)).toBeUndefined()
  })
})
