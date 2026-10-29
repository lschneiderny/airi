import type { ReplyTranscriptRecord } from '../transcript/schema'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readTranscript } from '../transcript/jsonl'
import { runImportOllamaBenchCli } from './ollama-bench'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('./__fixtures__/', import.meta.url))
const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const dir = await mkdtemp(resolve(tmpdir(), 'ollama-import-'))
  dirs.push(dir)
  await cp(fixtures, resolve(dir, 'results'), { recursive: true })
  return { dir, results: resolve(dir, 'results'), out: resolve(dir, 'out.jsonl') }
}

describe('ollama-bench import', () => {
  it('maps all sources, hashes, capabilities and request options deterministically', async () => {
    const { results, out } = await setup()
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const args = [results, '--set', 'fixture', '--out', out, '--server-version', '0.34.3', '--mem-gb', '16']
    expect(await runImportOllamaBenchCli(args, repoRoot, {})).toBe(0)
    const first = await readFile(out, 'utf8')
    const records: ReplyTranscriptRecord[] = []
    for await (const record of readTranscript(out))
      records.push(record)
    expect(records).toHaveLength(6)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toEqual({
      rows: 5,
      replies: 6,
      bySource: { 'bench.jsonl': 3, 'sweep.jsonl': 2, 'flash-attention.jsonl': 1 },
    })
    expect(new Set(records.map(r => r.replyId)).size).toBe(6)
    for (const r of records) {
      expect(r.set).toBe('fixture')
      expect(r.generation.options.num_ctx).toBe(8192)
      expect(r.machine).toEqual({ label: basename(results), serverVersion: '0.34.3', memGb: 16 })
      expect(r.source.fileSha256).toBe(createHash('sha256').update(await readFile(resolve(results, basename(r.source.file)))).digest('hex'))
      expect(r.prompt.shaSource).toBe('repo-file-at-commit')
      expect(r.prompt.contractVersion).toBeNull()
      expect(r.prompt.sha256).toBe(createHash('sha256').update(await readFile(resolve(repoRoot, 'scripts/ollama-bench/inputs/shuka-system-prompt.txt'))).digest('hex'))
      expect(r.prompt.toolsSha256).toBe(createHash('sha256').update(await readFile(resolve(repoRoot, 'scripts/ollama-bench/inputs/tools.json'))).digest('hex'))
    }
    expect(records[0].reply.text).toBe('<|ACT happy|> $(echo injected)')
    expect(records[0].timing).toEqual({ ttftMs: 0, totalMs: 12 })
    expect(records[1].reply.toolCalls).toEqual([{ name: 'wave', arguments: { hand: 'left' } }])
    expect(records[1].reply.steps).toBe(2)
    expect(records[2].conversation).toEqual({ kind: 'probe', turn: null, user: 'hey', origin: 'user' })
    for (const index of [1, 2, 5]) {
      expect(records[index].model.capabilities).toContain('thinking')
      expect(records[index].generation.think).toBe(false)
    }
    expect(records[3].model).toMatchObject({ digest: 'abcdef', family: 'reason', parameterSize: '2B', quantization: 'Q4_K_M', capabilities: ['tools', 'thinking'] })
    expect(records[4].generation.think).toBe(true)
    expect(records[5].generation.options).toEqual({ num_ctx: 8192, OLLAMA_FLASH_ATTENTION: 1, OLLAMA_KV_CACHE_TYPE: 'q8_0' })
    expect(await runImportOllamaBenchCli(args, repoRoot, {})).toBe(0)
    expect(await readFile(out, 'utf8')).toBe(first)
  })

  it.each([
    ['corrupt', 'bench.jsonl', '{\n'],
    ['missing turns', 'bench.jsonl', '{"model":"x","caps":[],"withTools":false,"probes":[]}\n'],
    ['missing replies', 'sweep.jsonl', '{"model":"x","config":"defaults","options":{},"think":false,"withTools":false,"details":{}}\n'],
  ])('rejects %s with source and physical line', async (_, file, content) => {
    const { results, out } = await setup()
    await writeFile(resolve(results, file), content)
    await expect(runImportOllamaBenchCli([results, '--set', 'x', '--out', out], repoRoot, {})).rejects.toThrow(new RegExp(`${file}.*line 1`))
  })

  it.each(['unknown.jsonl', 'unknown.txt'])('rejects unknown file %s and empty directories loudly', async (file) => {
    const { results, dir, out } = await setup()
    await writeFile(resolve(results, file), '{}\n')
    await expect(runImportOllamaBenchCli([results, '--set', 'x', '--out', out], repoRoot, {})).rejects.toThrow(new RegExp(`${file}.*line 1`))
    await rm(results, { recursive: true })
    // A newly created directory is empty, not a missing-directory argument error.
    const empty = await mkdtemp(resolve(dir, 'empty-'))
    await expect(runImportOllamaBenchCli([empty, '--set', 'x', '--out', out], repoRoot, {})).rejects.toThrow(/line 1.*empty/)
  })

  it('creates the default dataset path and omits unrecorded machine fields', async () => {
    const { dir, results } = await setup()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await cp(resolve(repoRoot, 'scripts/ollama-bench/inputs'), resolve(dir, 'scripts/ollama-bench/inputs'), { recursive: true })
    expect(await runImportOllamaBenchCli([results, '--set', 'default', '--machine-label', 'fixture-machine'], dir, {})).toBe(0)
    const out = resolve(dir, 'packages/qa-tools/model-eval/sets/default/transcripts.jsonl')
    let count = 0
    for await (const record of readTranscript(out)) {
      expect(record.machine).toEqual({ label: 'fixture-machine' })
      count++
    }
    expect(count).toBe(6)
  })

  it.each([[], ['missing', '--set', 'x'], ['.', '--set', '../x'], ['.', '--set', 'x', '--mem-gb', 'NaN'], ['.', '--set', 'x', '--unknown']].map(args => ({ args })))('returns 2 for invalid arguments $args', async ({ args }) => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await runImportOllamaBenchCli(args, repoRoot, {})).toBe(2)
  })
})
