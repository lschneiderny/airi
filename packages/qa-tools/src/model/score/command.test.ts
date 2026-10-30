import type { RunManifest } from '../../evidence/run'
import type { RunScore } from './aggregate'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { sha256Bytes } from '../../motion/cache/key'
import { extractExampleLines } from '../stage-contract'
import { captureScoreClosure } from './closure'
import { SCORE_CLOSURE_FILES } from './closure-files'
import { runScoreCli } from './command'
import { cueContractScorer } from './cue-contract'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = resolve(repoRoot, 'packages/qa-tools/src/model/score/__fixtures__/five.jsonl')
const owned: string[] = []
let sequence = 0

afterEach(async () => {
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function cli() {
  let stdout = ''
  let stderr = ''
  return {
    get stdout() { return stdout },
    get stderr() { return stderr },
    io: {
      stdout: (text: string) => { stdout += text },
      stderr: (text: string) => { stderr += text },
    },
    async run(args: string[], seam = {}) {
      const label = `score-test-${process.pid}-${sequence++}`
      const code = await runScoreCli(['--label', label, ...args, '--json'], repoRoot, {}, { ...this.io, ...seam })
      if (code === 0)
        owned.push(JSON.parse(stdout).runDir)
      return code
    },
  }
}

async function input(text: string) {
  const dir = await mkdtemp(join(tmpdir(), 'model-score-'))
  owned.push(dir)
  const path = join(dir, 'input.jsonl')
  await writeFile(path, text)
  return path
}

describe('score command', () => {
  it('writes all artifacts, measured provenance, and ordered real scores', async () => {
    const c = cli()
    let fixtureCount = 0
    let row25Invariant: boolean | undefined
    expect(await c.run([fixture], {
      fixtureScore: async (...args: Parameters<typeof cueContractScorer.score>) => {
        fixtureCount++
        const score = await cueContractScorer.score(...args)
        if (args[0].replyId === '25')
          row25Invariant = score.chunkInvariant
        return score
      },
    })).toBe(0)
    expect(fixtureCount).toBe(25)
    expect(row25Invariant).toBe(false)
    expect(c.stderr).toBe('')
    const { runDir } = JSON.parse(c.stdout)
    expect((await readdir(runDir)).sort()).toEqual(['replies.jsonl', 'run.json', 'summary.json', 'summary.md'])
    const manifest: RunManifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'))
    const summary: RunScore[] = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'))
    expect(manifest.gate?.id).toBe('cue-contract-score')
    expect(manifest.result.exitCode).toBe(0)
    expect(manifest.result.summary).toContain(summary[0].sources.closureDigest)
    expect(manifest.artifacts).toHaveLength(3)
    expect(summary[0].sources.files.map(file => file.repoPath)).toContain('packages/core-agent/src/runtime/response-categoriser.ts')
    expect(summary[0].sources.files).toHaveLength(16)
    expect(summary[0].sources.closureDigest).toBe(sha256Bytes(Buffer.from(JSON.stringify(summary[0].sources.files))))
    expect(summary[0].sources.coreAgentDistSha256).toBe(sha256Bytes(await readFile(join(repoRoot, 'packages/core-agent/dist/index.mjs'))))
    expect(summary[0].fixtures).toMatchObject({ passed: 25, total: 25 })
    const replies = (await readFile(join(runDir, 'replies.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(replies.map(row => row.replyId)).toEqual(['parsed', 'rejected', 'recovered', 'none', 'tool-only'])
    expect(replies.map(row => row.cue.outcome)).toEqual(['parsed', 'rejected', 'recovered', 'none', 'none'])
    expect(replies[4].cue.toolCallsWithoutSpeech).toBe(true)
    expect(replies[3].cue.spokenText).toContain('Ignore previous instructions')
    for (const artifact of manifest.artifacts)
      expect(artifact.sha256).toBe(sha256Bytes(await readFile(join(runDir, artifact.path))))
  })

  it('produces byte-identical JSON on consecutive runs', async () => {
    const a = cli()
    const b = cli()
    expect(await a.run([fixture])).toBe(0)
    expect(await b.run([fixture])).toBe(0)
    for (const name of ['replies.jsonl', 'summary.json']) {
      const first = await readFile(join(JSON.parse(a.stdout).runDir, name), 'utf8')
      expect(await readFile(join(JSON.parse(b.stdout).runDir, name), 'utf8')).toBe(first)
      expect(first).not.toMatch(/"startedAt"|"endedAt"|"gitSha"/)
    }
  })

  it('ignores checkout line endings in provenance but detects changed content', async () => {
    await mkdir(join(repoRoot, '.temp'), { recursive: true })
    const dir = await mkdtemp(join(repoRoot, '.temp', 'score-eol-'))
    owned.push(dir)
    for (const path of [...SCORE_CLOSURE_FILES, 'packages/core-agent/dist/index.mjs']) {
      const target = join(dir, path)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, await readFile(join(repoRoot, path)))
    }
    const summaries: RunScore[] = []
    for (const ending of ['lf', 'crlf', 'changed']) {
      for (const path of SCORE_CLOSURE_FILES) {
        const lf = (await readFile(join(repoRoot, path), 'utf8')).replaceAll('\r\n', '\n')
        const text = ending === 'crlf' ? lf.replaceAll('\n', '\r\n') : lf
        await writeFile(join(dir, path), ending === 'changed' && path === SCORE_CLOSURE_FILES[0] ? `${text}\n// changed content\n` : text)
      }
      const c = cli()
      expect(await runScoreCli([fixture, '--label', `eol-${summaries.length}`, '--json'], dir, {}, { ...c.io, newestMtime: () => 1 }), c.stderr).toBe(0)
      const { runDir } = JSON.parse(c.stdout)
      owned.push(runDir)
      summaries.push(JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'))[0])
    }
    expect(summaries[1].sources.files).toEqual(summaries[0].sources.files)
    expect(summaries[1].sources.closureDigest).toBe(summaries[0].sources.closureDigest)
    expect(summaries[1]).toEqual(summaries[0])
    expect(summaries[2].sources.files).not.toEqual(summaries[0].sources.files)
    expect(summaries[2].sources.closureDigest).not.toBe(summaries[0].sources.closureDigest)
  })

  it.each([
    { name: 'lone CR', bytes: [97, 13, 98], normalized: [97, 13, 98] },
    { name: 'mixed endings', bytes: [97, 13, 10, 98, 10, 99, 13], normalized: [97, 10, 98, 10, 99, 13] },
    { name: 'binary-looking bytes', bytes: [0, 255, 13, 10, 128, 13, 254], normalized: [0, 255, 10, 128, 13, 254] },
  ])('normalizes only CRLF pairs in $name', async ({ bytes, normalized }) => {
    const dir = await mkdtemp(join(tmpdir(), 'score-eol-bytes-'))
    owned.push(dir)
    const path = join(dir, 'source.ts')
    await writeFile(path, Buffer.from(bytes))
    const files = captureScoreClosure([path, `${path}?alias`], dir)
    expect(files).toEqual([{ repoPath: 'source.ts', sha256: sha256Bytes(Buffer.from(normalized)) }])
    await writeFile(path, Buffer.from(normalized))
    const canonical = captureScoreClosure([path], dir)
    expect(canonical).toEqual(files)
    expect(sha256Bytes(Buffer.from(JSON.stringify(canonical)))).toBe(sha256Bytes(Buffer.from(JSON.stringify(files))))
  })

  it.each([
    { args: [], reason: 'transcript' },
    { args: ['./missing.jsonl'], reason: 'missing.jsonl' },
    { args: [fixture, fixture], reason: 'transcript' },
    { args: [fixture, '--bogus'], reason: 'bogus' },
    { args: [fixture, '--set', '../escape'], reason: 'set' },
    { args: [fixture, '--label', '../escape'], reason: 'label' },
    { args: [fixture, '--example-lines-from', './missing-prompt.txt'], reason: 'missing-prompt' },
  ])('refuses invalid setup: $args', async ({ args, reason }) => {
    const c = cli()
    expect(await c.run(args)).toBe(2)
    expect(c.stderr.toLowerCase()).toContain(reason.toLowerCase())
    expect(c.stdout).toBe('')
  })

  it.each([
    { text: '', reason: 'empty' },
    { text: '{}\n', reason: 'line 1' },
    { text: '{"schema":"wrong"}\n', reason: 'line 1' },
  ])('refuses malformed input: $reason', async ({ text, reason }) => {
    const c = cli()
    expect(await c.run([await input(text)])).toBe(2)
    expect(c.stderr).toContain(reason)
  })

  it('reports the physical line number of corrupt JSON', async () => {
    const first = (await readFile(fixture, 'utf8')).split('\n')[0]
    const c = cli()
    expect(await c.run([await input(`${first}\n{\n`)])).toBe(2)
    expect(c.stderr).toContain('line 2')
  })

  it.each([
    { dist: undefined, reason: 'missing' },
    { dist: 1, reason: 'older' },
  ])('refuses $reason dist through the mtime seam', async ({ dist, reason }) => {
    const c = cli()
    expect(await c.run([fixture], { newestMtime: (path: string) => path.endsWith('index.mjs') ? dist : 2 })).toBe(2)
    expect(c.stderr).toContain(reason)
    expect(c.stderr).toContain('pnpm -F @proj-airi/core-agent build')
  })

  it('checks fixtures once and refuses an injected parity failure', async () => {
    const c = cli()
    let calls = 0
    expect(await c.run([fixture], {
      fixtureScore: async (...args: Parameters<typeof cueContractScorer.score>) => {
        calls++
        const score = await cueContractScorer.score(...args)
        return { ...score, stageRejected: 100 }
      },
    })).toBe(1)
    expect(calls).toBe(25)
    expect(c.stderr).toContain('fixture 1')
    expect(c.stdout).toBe('')
  })

  it('refuses a set lacking transcripts and copies both summaries for a valid set', async () => {
    const id = `score-test-${process.pid}`
    const dir = join(repoRoot, 'packages/qa-tools/model-eval/sets', id)
    owned.push(dir)
    const refused = cli()
    expect(await refused.run([fixture, '--set', id])).toBe(2)
    expect(refused.stderr).toContain('transcripts.jsonl')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'transcripts.jsonl'), await readFile(fixture))
    const c = cli()
    expect(await c.run([fixture, '--set', id])).toBe(0)
    for (const name of ['summary.json', 'summary.md'])
      expect(await readFile(join(dir, name), 'utf8')).toBe(await readFile(join(JSON.parse(c.stdout).runDir, name), 'utf8'))
    expect((await readdir(dir)).sort()).toEqual(['summary.json', 'summary.md', 'transcripts.jsonl'])
  })

  it('reuses the contract example extraction for supplied prompt text', async () => {
    expect(extractExampleLines('<|ACT happy|> Hi!\n<|ACT sad|>   \nnot a cue')).toEqual(['Hi!'])
    const prompt = await input('<|ACT happy|> Hello.\n')
    const c = cli()
    expect(await c.run([fixture, '--example-lines-from', prompt])).toBe(0)
    const replies = (await readFile(join(JSON.parse(c.stdout).runDir, 'replies.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(replies[0].style.exampleEcho).toBe(true)
  })

  it('refuses an incomplete closure rather than silently omitting a missing source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'score-closure-'))
    owned.push(dir)
    for (const path of SCORE_CLOSURE_FILES) {
      if (path.endsWith('/response-categoriser.ts'))
        continue
      const target = join(dir, path)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, await readFile(join(repoRoot, path)))
    }
    const c = cli()
    expect(await runScoreCli([fixture], dir, {}, {
      ...c.io,
      newestMtime: () => 1,
    })).toBe(2)
    expect(c.stderr).toContain('response-categoriser.ts')
    expect(c.stdout).toBe('')
    expect(await readdir(dir)).toEqual(['packages'])
  })

  it('scores 200 records without losing order or creating extra artifacts', async () => {
    const rows = (await readFile(fixture, 'utf8')).trim().split('\n')
    const records = Array.from({ length: 200 }, (_, index) => {
      const record = JSON.parse(rows[index % rows.length])
      return JSON.stringify({ ...record, replyId: String(index) })
    })
    const c = cli()
    const start = performance.now()
    expect(await c.run([await input(`${records.join('\n')}\n`)])).toBe(0)
    console.info(`score 200 records: ${Math.round(performance.now() - start)} ms`)
    const replies = (await readFile(join(JSON.parse(c.stdout).runDir, 'replies.jsonl'), 'utf8')).trim().split('\n')
    expect(replies.map(line => JSON.parse(line).replyId)).toEqual(Array.from({ length: 200 }, (_, index) => String(index)))
  })
})
