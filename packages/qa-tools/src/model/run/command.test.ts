import type { RunManifest } from '../../evidence/run'
import type { RunScore } from '../score/aggregate'
import type { ReplyTranscriptRecord } from '../transcript/schema'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bucketsOf, DEFAULT_CHARACTER_PROFILE } from '@proj-airi/stage-shared/character-state'
import { STAGE_CONTRACT_EN_SHA256 } from '@proj-airi/stage-shared/stage-contract'
import { afterEach, describe, expect, it } from 'vitest'

import { renderStage } from '../../character-state/cli'
import { sha256Buffer } from '../../evidence/run'
import { parseScript, ReplayScript } from '../../llm/script'
import { ReplayServer } from '../../llm/server'
import { runScoreCli } from '../score/command'
import { buildSystemPrompt, renderDefaultCard } from '../stage-contract'
import { readTranscript } from '../transcript/jsonl'
import { runRunCli } from './command'

type LiveRecord = Extract<ReplyTranscriptRecord, { schema: 'airi.reply-transcript/v2' }>

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const scenarios = resolve(repoRoot, 'packages/qa-tools/fixtures/model/scenarios')
const owned: string[] = []
const servers: ReplayServer[] = []
let sequence = 0

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** Starts the replay server as the model, with a script file or inline entries. */
async function replay(source: string | unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'model-run-'))
  owned.push(dir)
  const text = typeof source === 'string' ? await readFile(source, 'utf8') : JSON.stringify(source)
  const script = new ReplayScript(parseScript(text, 'test.json'), 'test.json')
  const server = new ReplayServer({ script, log: join(dir, 'requests.jsonl') })
  servers.push(server)
  const baseUrl = await server.listen()
  return {
    baseUrl,
    script,
    out: join(dir, 'run'),
    async bodies() {
      return (await readFile(join(dir, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).body)
    },
  }
}

async function run(args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runRunCli(args, repoRoot, {}, {
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })
  return { code, stdout, stderr }
}

async function records(path: string): Promise<LiveRecord[]> {
  const rows: LiveRecord[] = []
  for await (const record of readTranscript(path)) {
    if (record.schema !== 'airi.reply-transcript/v2')
      throw new Error(`expected a live record, got ${record.schema}`)
    rows.push(record)
  }
  return rows
}

describe('run command', () => {
  it('sends the composed prompt and the configured options, and records what was sent and returned', async () => {
    const endpoint = await replay(join(scenarios, 'replay/general.json'))

    const result = await run(['--scenario', 'general', '--base-url', endpoint.baseUrl, '--model', 'test-model', '--config', 'temp-0.6', '--out', endpoint.out])

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(`${join(endpoint.out, 'transcripts.jsonl')}\n`)
    const prompt = buildSystemPrompt({ cardPrompt: renderDefaultCard(), register: 'talking', exposedActions: [{ label: 'wave', kind: 'gesture' }] })
    const bodies = await endpoint.bodies()
    expect(bodies).toHaveLength(6)
    // The wire: the system prompt of the app, the scenario's options, no tools, and the app's user message shape.
    expect(bodies[0]).toEqual({
      model: 'test-model',
      messages: [{ role: 'system', content: prompt.text }, { role: 'user', content: '[2026-11-10 09:00] hey, good morning!' }],
      max_tokens: 320,
      temperature: 0.6,
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(prompt.text).toContain('Add "action" set to one of wave inside the ACT JSON')
    // Each turn continues the conversation with the replies the endpoint gave.
    expect(bodies[5].messages).toHaveLength(12)
    expect(bodies[5].messages[2]).toEqual({ role: 'assistant', content: '<|ACT happy|>Good morning! I just woke up too, so we match.' })
    expect(bodies[5].messages[11].content).toBe('[2026-11-10 09:05] what\'s the difference between a planet and a dwarf planet?')

    const rows = await records(join(endpoint.out, 'transcripts.jsonl'))
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map(row => row.replyId)).size).toBe(6)
    expect(rows[0]).toMatchObject({
      set: 'general',
      runKey: 'general@1/test-model/temp-0.6',
      source: { kind: 'live', file: 'packages/qa-tools/fixtures/model/scenarios/general.json', rowIndex: 0 },
      // The requested id names the model; the id the endpoint reported is kept beside it.
      model: { id: 'test-model', provider: 'openai-compatible', digest: null, capabilities: [] },
      generation: { config: 'temp-0.6', options: { max_tokens: 320, temperature: 0.6, stream: true, stream_options: { include_usage: true } }, think: null, withTools: false },
      prompt: { sha256: prompt.sha256, shaSource: 'recorded', toolsSha256: null, contractVersion: STAGE_CONTRACT_EN_SHA256.slice(0, 12) },
      machine: { label: new URL(endpoint.baseUrl).host },
      conversation: { kind: 'turn', turn: 1, user: 'hey, good morning!', origin: 'user' },
      reply: { text: '<|ACT happy|>Good morning! I just woke up too, so we match.', thinkingText: '', toolCalls: [], finish: 'stop', error: null, steps: 1 },
      usage: { prompt_tokens: 1510, completion_tokens: 16, total_tokens: 1526 },
      live: {
        scenario: { id: 'general', version: 1, stage: null },
        endpoint: { shape: 'openai-chat-completions', baseUrl: endpoint.baseUrl },
        request: { model: 'test-model' },
        response: { status: 200, id: 'chatcmpl-replay-0', model: 'airi-replay', systemFingerprint: 'airi-replay' },
        contractSha256: STAGE_CONTRACT_EN_SHA256,
      },
    })
    expect(rows[0].source.fileSha256).toBe(sha256Buffer(await readFile(join(scenarios, 'general.json'))))
    expect(Date.parse(rows[0].live.request.startedAt)).toBeLessThanOrEqual(Date.parse(rows[0].live.response.endedAt))
    expect(rows[0].timing.totalMs).toBeGreaterThanOrEqual(rows[0].timing.ttftMs ?? Number.NaN)

    // `requests.jsonl` holds the body of each record under its reply id and hash.
    const requests = (await readFile(join(endpoint.out, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.replyId)).toEqual(rows.map(row => row.replyId))
    expect(requests.map(request => request.body)).toEqual(bodies)
    expect(requests.map(request => sha256Buffer(Buffer.from(JSON.stringify(request.body))))).toEqual(rows.map(row => row.live.request.bodySha256))

    const manifest: RunManifest = JSON.parse(await readFile(join(endpoint.out, 'run.json'), 'utf8'))
    expect(manifest).toMatchObject({ tool: 'model-run', label: 'general', result: { exitCode: 0 } })
    expect(manifest.artifacts.map(artifact => [artifact.path, artifact.kind])).toEqual([['transcripts.jsonl', 'model-transcripts'], ['requests.jsonl', 'model-requests']])
    expect(manifest.artifacts[0].sha256).toBe(sha256Buffer(await readFile(join(endpoint.out, 'transcripts.jsonl'))))
  })

  it('runs the same turns as a new conversation at each relationship stage, and the result scores as one run per stage', async () => {
    const endpoint = await replay(join(scenarios, 'replay/relationship-stages.json'))

    const result = await run(['--scenario', 'relationship-stages', '--base-url', endpoint.baseUrl, '--model', 'airi-replay', '--out', endpoint.out, '--json'])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ runDir: endpoint.out, replies: 16, errors: 0, contractVersion: STAGE_CONTRACT_EN_SHA256.slice(0, 12) })
    expect(endpoint.script.remaining).toBe(0)
    const rows = await records(join(endpoint.out, 'transcripts.jsonl'))
    const stages = ['stranger', 'friendly', 'close', 'intimate'] as const
    expect(rows.map(row => row.live.scenario.stage)).toEqual(stages.flatMap(stage => [stage, stage, stage, stage]))
    expect(rows.map(row => row.conversation.turn)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])
    expect(rows[8]).toMatchObject({ runKey: 'relationship-stages@1/airi-replay/default@close', generation: { config: 'default@close' } })
    // The scripted replies carry no usage, so none is recorded.
    expect(rows.every(row => row.usage === null)).toBe(true)

    const bodies = await endpoint.bodies()
    const resting = bucketsOf(DEFAULT_CHARACTER_PROFILE.resting, null)
    for (const [index, stage] of stages.entries()) {
      const first = bodies[index * 4]
      const character = renderStage(stage, resting)
      // A stranger at rest has no character text, as in the app; every other stage states where the two stand.
      expect(character === '').toBe(stage === 'stranger')
      expect(first.messages).toHaveLength(2)
      expect(first.messages[1].content).toBe(`[2026-11-10 19:30] hey, i'm back${character === '' ? '' : `\n\n${character}`}`)
      // The stage is context of every user turn; the system prompt is the same at each stage.
      expect(bodies[index * 4 + 3].messages[7].content).toBe(`[2026-11-10 19:33] what should we do tonight?${character === '' ? '' : `\n\n${character}`}`)
      expect(first.messages[0]).toEqual(bodies[0].messages[0])
    }

    const label = `run-test-${process.pid}-${sequence++}`
    let scored = ''
    const scoreIo = {
      stdout: (text: string) => {
        scored += text
      },
      stderr: () => {},
    }
    expect(await runScoreCli([join(endpoint.out, 'transcripts.jsonl'), '--label', label, '--json'], repoRoot, {}, scoreIo)).toBe(0)
    const { runDir } = JSON.parse(scored)
    owned.push(runDir)
    const summary: RunScore[] = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'))
    expect(summary.map(score => [score.set, score.config, score.replies, score.errors, score.outcomes.parsed])).toEqual([
      ['relationship-stages', 'default@close', 4, 0, 4],
      ['relationship-stages', 'default@friendly', 4, 0, 4],
      ['relationship-stages', 'default@intimate', 4, 0, 4],
      ['relationship-stages', 'default@stranger', 4, 0, 4],
    ])
    expect(summary.every(score => score.prompt.contractVersion === STAGE_CONTRACT_EN_SHA256.slice(0, 12))).toBe(true)
  })

  it('records an endpoint error with nulls for what never arrived, ends that conversation, and exits 1', async () => {
    const endpoint = await replay([{ content: '<|ACT happy|>Morning!' }])

    const result = await run(['--scenario', 'general', '--base-url', endpoint.baseUrl, '--model', 'airi-replay', '--out', endpoint.out, '--machine-label', 'bench-box'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('turn 2/6: error: HTTP 409: test.json: exhausted at index 1')
    const rows = await records(join(endpoint.out, 'transcripts.jsonl'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ machine: { label: 'bench-box' }, reply: { error: null }, usage: null })
    expect(rows[1]).toMatchObject({
      conversation: { turn: 2, user: 'i\'m kinda nervous about my presentation tomorrow' },
      reply: { text: '', thinkingText: '', toolCalls: [], finish: null, error: 'HTTP 409: test.json: exhausted at index 1', steps: 1 },
      timing: { ttftMs: null },
      usage: null,
      live: { request: { model: 'airi-replay' }, response: { status: 409, id: null, model: null, systemFingerprint: null } },
    })
    expect(await endpoint.bodies()).toHaveLength(2)
    const manifest: RunManifest = JSON.parse(await readFile(join(endpoint.out, 'run.json'), 'utf8'))
    expect(manifest.result).toEqual({ exitCode: 1, summary: `2 replies, 1 failed; scenario general@1, contract ${STAGE_CONTRACT_EN_SHA256.slice(0, 12)}` })
  })

  it('runs a scenario file with its own card and records the reasoning effort it sent', async () => {
    const endpoint = await replay([{ content: '<|ACT happy|>hi!' }])
    const dir = await mkdtemp(join(tmpdir(), 'model-run-'))
    owned.push(dir)
    await writeFile(join(dir, 'card.txt'), 'You are Shuka.')
    await writeFile(join(dir, 'custom.json'), JSON.stringify({
      schema: 'airi.model-scenario/v1',
      id: 'custom',
      version: 3,
      description: 'One turn with a card file.',
      prompt: { cardFile: 'card.txt', register: 'texting', textingFlavor: 'discord' },
      startsAt: '2026-01-02T23:59',
      configs: { quiet: { reasoning_effort: 'none', seed: 7 } },
      turns: ['hey'],
    }))

    const result = await run(['--scenario', join(dir, 'custom.json'), '--base-url', endpoint.baseUrl, '--model', 'airi-replay', '--config', 'quiet', '--out', endpoint.out])

    expect(result.code).toBe(0)
    const [body] = await endpoint.bodies()
    const prompt = buildSystemPrompt({ cardPrompt: 'You are Shuka.', register: 'texting', textingFlavor: 'discord' })
    expect(body).toMatchObject({ reasoning_effort: 'none', seed: 7, messages: [{ role: 'system', content: prompt.text }, { role: 'user', content: '[2026-01-02 23:59] hey' }] })
    expect(body).not.toHaveProperty('max_tokens')
    const [row] = await records(join(endpoint.out, 'transcripts.jsonl'))
    expect(row).toMatchObject({
      runKey: 'custom@3/airi-replay/quiet',
      generation: { config: 'quiet', options: { reasoning_effort: 'none', seed: 7, stream: true }, think: 'none' },
      prompt: { sha256: prompt.sha256 },
      live: { scenario: { id: 'custom', version: 3, stage: null } },
    })
  })

  it.each([
    ['a missing model', ['--scenario', 'general', '--base-url', 'http://127.0.0.1:9/v1'], '--model is required'],
    ['an unknown scenario', ['--scenario', 'absent', '--base-url', 'http://127.0.0.1:9/v1', '--model', 'm'], 'absent.json'],
    ['an unknown config', ['--scenario', 'general', '--base-url', 'http://127.0.0.1:9/v1', '--model', 'm', '--config', 'hot'], 'has no config "hot"; it defines default, temp-0.6'],
    ['a base URL that is not http', ['--scenario', 'general', '--base-url', 'ftp://127.0.0.1/v1', '--model', 'm'], 'must be an http or https URL'],
    ['a base URL with credentials', ['--scenario', 'general', '--base-url', 'http://user:secret@127.0.0.1:9/v1', '--model', 'm'], 'must not contain credentials'],
    ['an output directory that exists', ['--scenario', 'general', '--base-url', 'http://127.0.0.1:9/v1', '--model', 'm', '--out', tmpdir()], '--out already exists'],
    ['an unknown flag', ['--scenario', 'general', '--base-url', 'http://127.0.0.1:9/v1', '--model', 'm', '--tools', 'x'], '--tools'],
  ])('exits 2 for %s without sending a request or creating a run', async (_name, args, message) => {
    const dir = await mkdtemp(join(tmpdir(), 'model-run-'))
    owned.push(dir)
    const out = join(dir, 'run')

    const result = await run(args.includes('--out') ? args : [...args, '--out', out])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(message)
    expect(result.stdout).toBe('')
    expect(existsSync(out)).toBe(false)
  })
})
