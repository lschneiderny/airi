import type { ClosenessStage } from '@proj-airi/stage-shared/character-state'

import type { RunHandle } from '../../evidence/run'
import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { AppRequest } from './app-request'
import type { ChatMessage, ChatOutcome } from './chat'
import type { HistoryMode } from './history'
import type { CheckResult, LoadedScenario } from './scenario'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { bucketsOf, DEFAULT_CHARACTER_PROFILE } from '@proj-airi/stage-shared/character-state'
import { STAGE_CONTRACT_EN_SHA256 } from '@proj-airi/stage-shared/stage-contract'

import { renderStage } from '../../character-state/cli'
import { createRun, sha256Buffer } from '../../evidence/run'
import { buildStageContract, buildSystemPrompt, renderDefaultCard } from '../stage-contract'
import { createTranscriptWriter } from '../transcript/jsonl'
import { replyIdFor } from '../transcript/schema'
import { loadAppRequest } from './app-request'
import { buildChatRequest, requestChat } from './chat'
import { firstSpeechMs, spokenText } from './first-speech'
import { HISTORY_MODES, historyText } from './history'
import { describeOllamaSnapshot, ollamaServerLog, probeOllama } from './ollama-probe'
import { evaluateChecks, loadScenario } from './scenario'
import { ToolStubs } from './tool-stubs'

/** One request may wait this long. A local model can spend most of a minute loading before its first token. */
const REQUEST_TIMEOUT_MS = 300_000

/** The values the app's Ollama provider sends as `reasoning_effort`; `none` turns reasoning off. */
const REASONING_EFFORTS = ['none', 'low', 'medium', 'high'] as const
/** Tool rounds of one turn under app conditions, after which the turn ends with whatever the model said. */
const DEFAULT_MAX_STEPS = 5

interface RunCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/** The `[YYYY-MM-DD HH:MM] ` clock of a scenario: the same wall-clock text in every time zone. */
function wallClockMs(startsAt: string, turn: number): number {
  const [year, month, day, hour, minute] = startsAt.split(/[-T:]/).map(Number)
  return new Date(year, month - 1, day, hour, minute + turn).getTime()
}

/**
 * Runs a scenario against a live chat endpoint and writes one transcript record per reply.
 *
 * Use when:
 * - A model's replies to the current system prompt must be captured for `qa:model score`.
 *
 * Returns:
 * - 0 when every request returned a reply, 1 when a request failed (the records written so far are kept), 2 for
 *   invalid arguments, an invalid scenario, or a stale build that would render an old contract.
 */
export async function runRunCli(
  argv: string[],
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  io: RunCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  let loaded: LoadedScenario
  let baseUrl: URL
  let model: string
  let configName: string
  let outDir: string | undefined
  let machineLabel: string
  let json: boolean
  let history: HistoryMode
  let formatTimePrefix: typeof import('@proj-airi/core-agent').formatTimePrefix
  let reasoning: typeof REASONING_EFFORTS[number] | undefined
  let appRequest: AppRequest | null = null
  let appRequestName: string | null = null
  let maxSteps = 1
  let ollamaLog: string | undefined
  /** The system prompt the run sends, its hash, and the version and hash of the stage contract inside it. */
  let prompt: { text: string, sha256: string, contract: { version: string, sha256: string } }
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        'scenario': { type: 'string' },
        'base-url': { type: 'string' },
        'model': { type: 'string' },
        'config': { type: 'string', default: 'default' },
        'history': { type: 'string', default: 'raw' },
        'reasoning': { type: 'string' },
        'app-request': { type: 'string' },
        'max-steps': { type: 'string' },
        'ollama-log': { type: 'string' },
        'out': { type: 'string' },
        'machine-label': { type: 'string' },
        'json': { type: 'boolean', default: false },
      },
    })
    for (const name of ['scenario', 'base-url', 'model'] as const) {
      if (!values[name]?.trim())
        throw new Error(`--${name} is required`)
    }
    if (values.out === '' || values['machine-label'] === '')
      throw new Error('option values must not be empty')
    model = values.model!
    configName = values.config
    json = values.json
    const historyMode = HISTORY_MODES.find(mode => mode === values.history)
    if (!historyMode)
      throw new Error(`--history must be one of ${HISTORY_MODES.join(', ')}`)
    history = historyMode
    ollamaLog = values['ollama-log'] === undefined ? undefined : resolve(repoRoot, values['ollama-log'])
    if (values.reasoning !== undefined) {
      reasoning = REASONING_EFFORTS.find(effort => effort === values.reasoning)
      if (!reasoning)
        throw new Error(`--reasoning must be one of ${REASONING_EFFORTS.join(', ')}`)
    }
    if (values['max-steps'] !== undefined && values['app-request'] === undefined)
      throw new Error('--max-steps needs --app-request: a run without the app\'s tools takes one step per turn')
    if (values['app-request'] !== undefined) {
      maxSteps = values['max-steps'] === undefined ? DEFAULT_MAX_STEPS : Number(values['max-steps'])
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20)
        throw new Error('--max-steps must be an integer from 1 to 20')
    }
    try {
      baseUrl = new URL(values['base-url']!)
    }
    catch {
      throw new Error(`--base-url is not a URL: ${values['base-url']}`)
    }
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
      throw new Error('--base-url must be an http or https URL, for example http://127.0.0.1:11434/v1')
    // Records and the run manifest name the base URL, so it must not carry a secret.
    if (baseUrl.username !== '' || baseUrl.password !== '')
      throw new Error('--base-url must not contain credentials')
    machineLabel = values['machine-label'] ?? baseUrl.host
    if (values.out !== undefined) {
      outDir = resolve(repoRoot, values.out)
      if (existsSync(outDir))
        throw new Error(`--out already exists: ${outDir}`)
    }
    loaded = await loadScenario(values.scenario!, repoRoot)
    if (!Object.hasOwn(loaded.scenario.configs, configName))
      throw new Error(`scenario ${loaded.scenario.id} has no config ${JSON.stringify(configName)}; it defines ${Object.keys(loaded.scenario.configs).join(', ')}`)
    try {
      // The package resolves to its build, so a missing build must refuse the run instead of breaking every command.
      const coreAgent = await import('@proj-airi/core-agent')
      formatTimePrefix = coreAgent.formatTimePrefix
      // An older build has no such export, and a canonical run would then send raw history under a canonical label.
      if (typeof coreAgent.canonicalCueText !== 'function')
        throw new Error('the build is older than the source')
    }
    catch (error) {
      throw new Error(`cannot load @proj-airi/core-agent (${errorMessageFrom(error) ?? 'import failed'}); run pnpm -F @proj-airi/core-agent build`)
    }
    const contract = buildStageContract('en')
    // The locale messages come from the i18n build. A stale build renders an older contract, and replies to it are
    // not comparable with replies to the current one.
    if (contract.warnings.length > 0 || contract.sha256 !== STAGE_CONTRACT_EN_SHA256)
      throw new Error(`the rendered stage contract ${contract.version} is not the current contract ${STAGE_CONTRACT_EN_SHA256.slice(0, 12)}; run pnpm -F @proj-airi/i18n build`)
    if (values['app-request'] !== undefined) {
      const path = resolve(repoRoot, values['app-request'])
      appRequest = await loadAppRequest(path)
      appRequestName = basename(path).replace(/\.json$/, '')
      // A capture holds the contract of the build it came from. Replies to an older contract are not comparable.
      if (!appRequest.system.includes(contract.text))
        throw new Error(`${path} does not carry the current stage contract ${contract.version}; capture the app's request again`)
      prompt = { text: appRequest.system, sha256: appRequest.systemSha256, contract: { version: contract.version, sha256: contract.sha256 } }
    }
    else {
      prompt = buildSystemPrompt({
        cardPrompt: loaded.cardPrompt ?? renderDefaultCard(),
        register: loaded.scenario.prompt.register,
        textingFlavor: loaded.scenario.prompt.textingFlavor,
        exposedActions: loaded.exposedActions,
      })
    }
  }
  catch (error) {
    stderr(`qa-tools model run: ${errorMessageFrom(error) ?? 'invalid arguments'}\n`)
    return 2
  }

  const { scenario } = loaded
  const config = reasoning === undefined ? scenario.configs[configName] : { ...scenario.configs[configName], reasoning_effort: reasoning }
  const tools = appRequest?.tools ?? []
  const stubs = new ToolStubs()
  const checks: { runKey: string, results: CheckResult[] }[] = []
  let run: RunHandle | undefined
  try {
    run = createRun({ tool: 'model-run', label: scenario.id, repoRoot, env, outDir })
    const writer = createTranscriptWriter(run.path('transcripts.jsonl'))
    let replies = 0
    let errors = 0
    try {
      const stages: (ClosenessStage | null)[] = scenario.stages ?? [null]
      for (const stage of stages) {
        // Every option that changes a request is part of the label, so records of two settings never share a run key
        // or a summary row.
        const configLabel = [
          configName,
          history === 'raw' ? null : `${history}-history`,
          reasoning === undefined ? null : `reasoning-${reasoning}`,
          appRequestName === null ? null : `app-${appRequestName}`,
        ].filter(Boolean).join('+')
        const label = stage === null ? configLabel : `${configLabel}@${stage}`
        const runKey = `${scenario.id}@${scenario.version}/${model}/${label}`
        // The app sends this text as its `system:character` runtime context. It is empty for a stranger at rest.
        const character = stage === null ? '' : renderStage(stage, bucketsOf(DEFAULT_CHARACTER_PROFILE.resting, null))
        const messages: ChatMessage[] = [{ role: 'system', content: prompt.text }]
        const spokenByTurn: string[] = []
        stubs.reset()
        for (const [index, user] of scenario.turns.entries()) {
          // A user message is its time prefix and text, then a blank line and the runtime context, as core-agent's
          // request assembly renders it (`renderSegmentText` in `packages/core-agent/src/messages/render-context.ts`).
          messages.push({ role: 'user', content: `${formatTimePrefix(wallClockMs(scenario.startsAt, index))}${user}${character === '' ? '' : `\n\n${character}`}` })
          const startedAt = new Date().toISOString()
          const { steps, outcome, bodies } = await runTurn(baseUrl.href, model, messages, config, { tools, maxTokens: appRequest?.maxTokens ?? undefined, maxSteps }, stubs)
          const endedAt = new Date().toISOString()
          const body = bodies[0]!
          const request = buildChatRequest(model, messages, config, { tools, max_tokens: appRequest?.maxTokens ?? undefined })

          const source = { kind: 'live' as const, file: loaded.file, fileSha256: loaded.fileSha256, rowIndex: index, path: `${runKey}/turns[${index}]@${startedAt}` }
          const { model: _model, messages: _messages, tools: _tools, ...options } = request
          const record: ReplyTranscriptRecord = {
            schema: 'airi.reply-transcript/v2',
            replyId: replyIdFor(source),
            set: scenario.id,
            runKey,
            source,
            // The endpoint shape reports no digest and no capabilities, so none are recorded.
            model: { id: model, provider: 'openai-compatible', digest: null, capabilities: [] },
            generation: { config: label, options, think: config.reasoning_effort ?? null, withTools: tools.length > 0 },
            prompt: { sha256: prompt.sha256, shaSource: 'recorded', toolsSha256: appRequest?.toolsSha256 ?? null, contractVersion: prompt.contract.version },
            machine: { label: machineLabel },
            conversation: { kind: 'turn', turn: index + 1, user, origin: 'user' },
            reply: { text: outcome.text, thinkingText: outcome.thinkingText, toolCalls: outcome.toolCalls, finish: outcome.finish, error: outcome.error, steps },
            timing: { ttftMs: outcome.ttftMs, totalMs: outcome.totalMs, firstSpeechMs: outcome.firstSpeechMs },
            usage: outcome.usage,
            live: {
              scenario: { id: scenario.id, version: scenario.version, stage },
              endpoint: { shape: 'openai-chat-completions', baseUrl: baseUrl.href },
              request: { model, bodySha256: sha256Buffer(Buffer.from(body, 'utf8')), startedAt },
              response: { status: outcome.status, id: outcome.id, model: outcome.model, systemFingerprint: outcome.systemFingerprint, endedAt },
              contractSha256: prompt.contract.sha256,
              ...(appRequest === null ? {} : { appRequest: { source: appRequest.source, systemSha256: appRequest.systemSha256, toolsSha256: appRequest.toolsSha256 } }),
            },
          }
          await writer.write(record)
          for (const [step, stepBody] of bodies.entries())
            await appendFile(run.path('requests.jsonl'), `{"replyId":${JSON.stringify(record.replyId)},"step":${step + 1},"body":${stepBody}}\n`)
          replies++
          const toolNote = outcome.toolCalls.length ? `, tools ${outcome.toolCalls.map(call => call.name).join(' ')}` : ''
          stderr(`${runKey} turn ${index + 1}/${scenario.turns.length}: ${outcome.error === null ? `${outcome.totalMs} ms, ${steps} step(s), finish ${outcome.finish}${toolNote}` : `error: ${outcome.error}`}\n`)
          if (outcome.error !== null) {
            // Later turns would continue from a reply that never arrived, so this conversation ends here.
            errors++
            break
          }
          spokenByTurn.push(await spokenText(outcome.text))
          // The history keeps the turn's words as one assistant message; the tool rounds of the turn are not replayed.
          messages.push({ role: 'assistant', content: await historyText(outcome.text, history) })
        }
        if (scenario.checks?.length) {
          const results = evaluateChecks(scenario, spokenByTurn)
          checks.push({ runKey, results })
          const passed = results.filter(result => result.passed).length
          stderr(`${runKey} recall: ${passed}/${results.length}${results.some(result => result.passed === false) ? `; missed ${results.filter(result => result.passed === false).map(result => `turn ${result.turn}`).join(', ')}` : ''}\n`)
        }
      }
    }
    finally {
      await writer.close()
    }
    run.addArtifact('transcripts.jsonl', 'model-transcripts')
    run.addArtifact('requests.jsonl', 'model-requests')
    if (checks.length) {
      await writeFile(run.path('checks.json'), `${JSON.stringify({ schema: 'airi.model-run-checks/v1', scenario: `${scenario.id}@${scenario.version}`, runs: checks }, null, 2)}\n`)
      run.addArtifact('checks.json', 'model-checks')
    }
    // Read while the model is still loaded, so the footprint and the context it was loaded with are on record.
    const server = await probeOllama(baseUrl.href, model, { serverLog: ollamaServerLog(baseUrl.href, ollamaLog) })
    if (server !== null) {
      await writeFile(run.path('server.json'), `${JSON.stringify(server, null, 2)}\n`)
      run.addArtifact('server.json', 'model-server')
      stderr(`${describeOllamaSnapshot(server)}\n`)
    }
    const exitCode = errors > 0 ? 1 : 0
    run.finish({ exitCode, summary: `${replies} replies, ${errors} failed; scenario ${scenario.id}@${scenario.version}, ${history} history${appRequestName === null ? '' : `, app request ${appRequestName}`}, contract ${prompt.contract.version}` })
    stdout(json
      ? `${JSON.stringify({ runDir: run.dir, transcripts: run.path('transcripts.jsonl'), replies, errors, history, contractVersion: prompt.contract.version })}\n`
      : `${run.path('transcripts.jsonl')}\n`)
    return exitCode
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'run failed'
    run?.finish({ exitCode: 1, summary: message })
    stderr(`qa-tools model run: ${message}\n`)
    return 1
  }
}

interface TurnOutcome {
  steps: number
  /** The turn as one reply: every step's text and tool calls in order, the first step's timing, and the summed time. */
  outcome: Omit<ChatOutcome, 'toolCallIds' | 'toolCallArguments' | 'textMarks'> & { firstSpeechMs: number | null }
  /** The body of each step's request, in order. */
  bodies: string[]
}

/**
 * Sends one user turn and, while the model calls tools, answers them with stubs and asks again, up to `maxSteps`
 * requests, as the app's chat loop does.
 */
async function runTurn(
  baseUrl: string,
  model: string,
  messages: readonly ChatMessage[],
  config: Parameters<typeof buildChatRequest>[2],
  options: { tools: readonly unknown[], maxTokens: number | undefined, maxSteps: number },
  stubs: ToolStubs,
): Promise<TurnOutcome> {
  const turn: ChatMessage[] = []
  const bodies: string[] = []
  const usages: Record<string, unknown>[] = []
  let result: TurnOutcome['outcome'] | undefined
  let elapsed = 0
  for (let step = 1; step <= options.maxSteps; step++) {
    const body = JSON.stringify(buildChatRequest(model, [...messages, ...turn], config, { tools: options.tools, max_tokens: options.maxTokens }))
    bodies.push(body)
    const outcome = await requestChat(baseUrl, body, REQUEST_TIMEOUT_MS)
    if (outcome.usage)
      usages.push(outcome.usage)
    const speechAt = result?.firstSpeechMs ?? await firstSpeechMs(outcome.text, outcome.textMarks)
    const firstSpeech = result?.firstSpeechMs ?? (speechAt === null ? null : elapsed + speechAt)
    result = result === undefined
      ? { ...outcome, firstSpeechMs: firstSpeech }
      : {
          ...result,
          text: result.text + outcome.text,
          thinkingText: result.thinkingText + outcome.thinkingText,
          toolCalls: [...result.toolCalls, ...outcome.toolCalls],
          finish: outcome.finish,
          error: outcome.error,
          status: outcome.status,
          totalMs: result.totalMs + outcome.totalMs,
          firstSpeechMs: firstSpeech,
        }
    elapsed += outcome.totalMs
    if (outcome.error !== null || !outcome.toolCalls.length || !options.tools.length || step === options.maxSteps)
      return { steps: step, outcome: withUsage(result, usages), bodies }
    const calls = outcome.toolCalls.map((call, position) => ({
      id: outcome.toolCallIds[position] ?? `call_${step}_${position}`,
      type: 'function' as const,
      function: { name: call.name, arguments: outcome.toolCallArguments[position] ?? '' },
    }))
    turn.push({ role: 'assistant', content: outcome.text, tool_calls: calls })
    for (const [position, call] of calls.entries())
      turn.push({ role: 'tool', tool_call_id: call.id, content: stubs.answer(call.function.name, outcome.toolCalls[position]!.arguments) })
  }
  throw new Error('unreachable: a turn takes at least one step')
}

/**
 * The usage of a turn: the first step's prompt size, which is what the history costs, and the completion tokens of all
 * steps. A one-step turn keeps the endpoint's usage as it came.
 */
function withUsage(outcome: TurnOutcome['outcome'], usages: readonly Record<string, unknown>[]): TurnOutcome['outcome'] {
  if (usages.length < 2)
    return { ...outcome, usage: usages[0] ?? outcome.usage }
  const completion = usages.reduce((sum, usage) => sum + (typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0), 0)
  return { ...outcome, usage: { prompt_tokens: usages[0]!.prompt_tokens ?? null, completion_tokens: completion, steps: usages } }
}
