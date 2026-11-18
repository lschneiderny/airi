import type { ReplyTranscriptRecord } from '../transcript/schema'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { runCompareCli } from './command'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const owned: string[] = []
afterEach(async () => {
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function record(model: string, config: string, turn: number, text: string): ReplyTranscriptRecord {
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: `${model}-${config}-${turn}`,
    set: 'compare-test',
    runKey: `compare-test@1/${model}/${config}`,
    source: { kind: 'live', file: 'test', fileSha256: 'source', rowIndex: turn, path: 'reply' },
    model: { id: model, provider: 'test', digest: null, capabilities: [] },
    generation: { config, options: {}, think: null, withTools: false },
    prompt: { sha256: null, shaSource: 'recorded', toolsSha256: null, contractVersion: 'contract-a' },
    machine: { label: 'test' },
    conversation: { kind: 'turn', turn, user: `turn ${turn}`, origin: 'user' },
    reply: { text, thinkingText: '', toolCalls: [], finish: 'stop', error: null, steps: 1 },
    timing: { ttftMs: 100 * turn, totalMs: 500 * turn },
    usage: { prompt_tokens: 1000, completion_tokens: 20 },
  }
}

describe('qa:model compare', () => {
  it('scores every input together and adds the memory and recall each run directory recorded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'model-compare-'))
    owned.push(dir)
    const runA = join(dir, 'a')
    const runB = join(dir, 'b')
    await mkdir(runA)
    await mkdir(runB)
    const a = [record('small', 'seed-1', 1, '<|ACT {"emotion":"happy"}|> Hi!'), record('small', 'seed-1', 2, '<|look: you|> Biscuit!')]
    const b = [record('large', 'seed-1', 1, 'Hello, how can I assist you?')]
    await writeFile(join(runA, 'transcripts.jsonl'), a.map(row => JSON.stringify(row)).join('\n'))
    await writeFile(join(runB, 'transcripts.jsonl'), b.map(row => JSON.stringify(row)).join('\n'))
    await writeFile(join(runA, 'server.json'), JSON.stringify({ schema: 'airi.ollama-snapshot/v1', version: '0.40.16', loaded: null, load: { gpuWeightsMiB: 1024, cpuWeightsMiB: 0, gpuCacheMiB: 0, gpuComputeMiB: 0, contextLength: 4096 } }))
    await writeFile(join(runA, 'checks.json'), JSON.stringify({ runs: [{ runKey: a[0]!.runKey, results: [{ turn: 2, any: ['biscuit'], passed: true }] }] }))
    // A snapshot from before server-log buffers existed has no `load`.
    await writeFile(join(runB, 'server.json'), JSON.stringify({ version: '0.40.16', loaded: { size: 2 ** 30, sizeVram: 2 ** 30, contextLength: 8192 } }))

    let stdout = ''
    const code = await runCompareCli([runA, runB, '--json'], repoRoot, {}, {
      stdout: (text) => {
        stdout += text
      },
      stderr: () => {},
    })

    expect(code).toBe(0)
    const { rows, contractVersions } = JSON.parse(stdout)
    expect(contractVersions).toEqual(['contract-a'])
    expect(rows.map((row: { contender: string }) => row.contender).sort()).toEqual(['large · default', 'small · default'])
    const small = rows.find((row: { contender: string }) => row.contender === 'small · default')
    expect(small).toMatchObject({ runs: 1, replies: 2, recall: { passed: 1, total: 1 }, memory: { gpuGiB: 1, source: 'server-log', contextLength: 4096 } })
    expect(small.unknownMarkers).toEqual([['<|look: you|>', 1]])
    const large = rows.find((row: { contender: string }) => row.contender === 'large · default')
    expect(large).toMatchObject({ recall: null, memory: { gpuGiB: 1, source: 'api-ps' } })
  })
})
