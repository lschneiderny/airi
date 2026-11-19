import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { appRequestFromLog, loadAppRequest, toolsSha256 } from './app-request'

const tool = { type: 'function', function: { name: 'builtIn_readMemory', description: 'Read memory', parameters: { type: 'object' } } }
const line = (value: unknown) => JSON.stringify(value)
const owned: string[] = []
afterEach(async () => {
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('appRequestFromLog', () => {
  it('takes the first chat request with a system message and skips other requests', () => {
    const lines = [
      line({ method: 'GET', path: '/v1/models', body: null }),
      line({ method: 'POST', path: '/v1/chat/completions', body: { messages: [{ role: 'user', content: 'validation ping' }] } }),
      line({ method: 'POST', path: '/v1/chat/completions', body: { max_tokens: 320, tools: [tool], messages: [{ role: 'system', content: 'You are Iru.' }, { role: 'user', content: 'hello' }] } }),
      line({ method: 'POST', path: '/v1/chat/completions', body: { messages: [{ role: 'system', content: 'Later prompt' }] } }),
      '',
    ]

    const capture = appRequestFromLog(lines, 'run/requests.jsonl', '2026-11-18T12:00:00.000Z')

    expect(capture).toMatchObject({ schema: 'airi.app-request/v1', source: 'run/requests.jsonl', system: 'You are Iru.', tools: [tool], maxTokens: 320, toolsSha256: toolsSha256([tool]) })
    expect(capture.systemSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a log without such a request', () => {
    expect(() => appRequestFromLog([line({ method: 'GET', path: '/v1/models', body: null })], 'x', '2026-11-18T12:00:00.000Z')).toThrow('no chat request')
  })
})

describe('loadAppRequest', () => {
  it('loads a capture and refuses one whose text was edited after capture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'app-request-'))
    owned.push(dir)
    const capture = appRequestFromLog([line({ method: 'POST', path: '/v1/chat/completions', body: { messages: [{ role: 'system', content: 'Prompt' }] } })], 'x', '2026-11-18T12:00:00.000Z')
    const path = join(dir, 'capture.json')
    await writeFile(path, JSON.stringify(capture))
    await expect(loadAppRequest(path)).resolves.toEqual(capture)

    await writeFile(path, JSON.stringify({ ...capture, system: 'Edited prompt' }))
    await expect(loadAppRequest(path)).rejects.toThrow('capture it again')
  })
})
