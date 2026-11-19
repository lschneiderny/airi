import type { ReplyTranscriptRecord } from '../transcript/schema'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runJudgeCli } from './command'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

function record(model: string, turn: number, text: string): ReplyTranscriptRecord {
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: `${model}-${turn}`,
    set: 'judge-test',
    runKey: `judge-test@1/${model}/seed-1`,
    source: { kind: 'live', file: 'test', fileSha256: 'source', rowIndex: turn, path: 'reply' },
    model: { id: model, provider: 'test', digest: null, capabilities: [] },
    generation: { config: 'seed-1', options: {}, think: null, withTools: false },
    prompt: { sha256: null, shaSource: 'recorded', toolsSha256: null, contractVersion: null },
    machine: { label: 'test' },
    conversation: { kind: 'turn', turn, user: `turn ${turn}`, origin: 'user' },
    reply: { text, thinkingText: '', toolCalls: [], finish: 'stop', error: null, steps: 1 },
    timing: { ttftMs: null, totalMs: null },
    usage: null,
  }
}

describe('qa:model judge', () => {
  let dir: string
  let transcripts: string
  let out: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-model-judge-'))
    transcripts = join(dir, 'transcripts.jsonl')
    out = join(dir, 'judgments.jsonl')
    const rows = [
      record('model-a', 1, '<|ACT {"emotion":"happy"}|> Good morning!'),
      record('model-a', 2, 'I am fine.'),
      record('model-b', 1, 'Hello, how can I assist you today?'),
      record('model-b', 2, '<|ACT {"emotion":"curious"}|> Oh? Tell me more!'),
    ]
    writeFileSync(transcripts, rows.map(row => JSON.stringify(row)).join('\n'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function startServe(extra: string[] = []) {
    const stdout: string[] = []
    const stderr: string[] = []
    let stop!: () => void
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    let exit!: Promise<number>
    const url = await new Promise<string>((resolve, reject) => {
      exit = runJudgeCli(['serve', transcripts, '--out', out, '--seed', '1', ...extra], repoRoot, {}, {
        stdout: (text) => {
          stdout.push(text)
          resolve(text.trim())
        },
        stderr: text => stderr.push(text),
        stop: stopped,
      })
      // A refusal settles the command before it ever listens; surface it instead of waiting.
      exit.catch(reject)
    })
    return { url, stderr, exit, stop }
  }

  it('serves blind pairs of spoken text, saves verdicts, and resumes without repeating them', async () => {
    const session = await startServe()
    const next = await (await fetch(`${session.url}api/next`)).json()

    expect(next.progress).toEqual({ done: 0, remaining: 2 })
    expect(JSON.stringify(next.pair)).not.toContain('model-')
    expect([next.pair.left.spoken, next.pair.right.spoken]).toContain('Good morning!')
    expect([...next.pair.left.cues, ...next.pair.right.cues].join(' ')).toContain('happy')

    const saved = await fetch(`${session.url}api/judgment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairId: next.pair.id, verdict: 'left', leftTags: ['warm'], rightTags: [], note: 'livelier', elapsedMs: 1200 }),
    })
    const result = await saved.json()

    expect(saved.status).toBe(200)
    expect(new Set([result.reveal.left, result.reveal.right])).toEqual(new Set(['model-a · default', 'model-b · default']))
    expect(result.progress).toEqual({ done: 1, remaining: 1 })
    const [line] = readFileSync(out, 'utf8').trim().split('\n').map(text => JSON.parse(text))
    expect(line.schema).toBe('airi.persona-judgment/v1')
    expect(line.verdict).toBe('left')
    expect(line.left.tags).toEqual(['warm'])
    expect(line.note).toBe('livelier')

    session.stop()
    await expect(session.exit).resolves.toBe(0)

    const resumed = await startServe()
    const after = await (await fetch(`${resumed.url}api/next`)).json()
    expect(after.progress).toEqual({ done: 1, remaining: 1 })
    expect(after.pair.id).not.toBe(next.pair.id)
    resumed.stop()
    await resumed.exit
  })

  it('refuses writes from another origin and stale pair ids', async () => {
    const session = await startServe()
    const { pair } = await (await fetch(`${session.url}api/next`)).json()
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${session.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

    expect((await post('api/skip', { pairId: pair.id }, { Origin: 'https://example.com' })).status).toBe(403)
    expect((await post('api/skip', { pairId: pair.id })).status).toBe(200)
    expect((await post('api/skip', { pairId: pair.id })).status).toBe(409)
    expect((await post('api/judgment', { pairId: 'x', verdict: 'maybe', leftTags: [], rightTags: [], note: '', elapsedMs: null })).status).toBe(400)
    session.stop()
    await session.exit
  })

  it('reports saved judgments as standings', async () => {
    const session = await startServe()
    for (let i = 0; i < 2; i++) {
      const { pair } = await (await fetch(`${session.url}api/next`)).json()
      await fetch(`${session.url}api/judgment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairId: pair.id, verdict: 'tie', leftTags: [], rightTags: [], note: '', elapsedMs: null }),
      })
    }
    session.stop()
    await session.exit

    const stdout: string[] = []
    await expect(runJudgeCli(['report', out, '--json'], repoRoot, {}, { stdout: text => stdout.push(text) })).resolves.toBe(0)
    const report = JSON.parse(stdout.join(''))
    expect(report.judgments).toBe(2)
    expect(report.standings.map((s: { ties: number }) => s.ties)).toEqual([2, 2])
  })
})
