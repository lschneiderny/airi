import type { ClosenessStage } from '@proj-airi/stage-shared/character-state'

import type { RunHandle } from '../../evidence/run'
import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { ChatMessage } from './chat'
import type { LoadedScenario } from './scenario'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { bucketsOf, DEFAULT_CHARACTER_PROFILE } from '@proj-airi/stage-shared/character-state'
import { STAGE_CONTRACT_EN_SHA256, STAGE_RUNTIME_CONFIG } from '@proj-airi/stage-shared/stage-contract'

import { renderStage } from '../../character-state/cli'
import { createRun, sha256Buffer } from '../../evidence/run'
import { buildSystemPrompt, renderDefaultCard } from '../stage-contract'
import { createTranscriptWriter } from '../transcript/jsonl'
import { replyIdFor } from '../transcript/schema'
import { buildChatRequest, requestChat } from './chat'
import { loadScenario } from './scenario'

/** One request may wait this long. A local model can spend most of a minute loading before its first token. */
const REQUEST_TIMEOUT_MS = 300_000

/**
 * How an earlier reply joins the history of the next request. `raw` sends it as the model wrote it. `canonical`
 * sends it as the app does since it rewrites recovered cues: through core-agent's `canonicalCueText`.
 */
const HISTORY_MODES = ['raw', 'canonical'] as const
type HistoryMode = typeof HISTORY_MODES[number]

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
  let canonicalCueText: typeof import('@proj-airi/core-agent').canonicalCueText
  let prompt: ReturnType<typeof buildSystemPrompt>
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
      ;({ formatTimePrefix, canonicalCueText } = await import('@proj-airi/core-agent'))
      // An older build has no such export, and a canonical run would then send raw history under a canonical label.
      if (typeof canonicalCueText !== 'function')
        throw new Error('the build is older than the source')
    }
    catch (error) {
      throw new Error(`cannot load @proj-airi/core-agent (${errorMessageFrom(error) ?? 'import failed'}); run pnpm -F @proj-airi/core-agent build`)
    }
    prompt = buildSystemPrompt({
      cardPrompt: loaded.cardPrompt ?? renderDefaultCard(),
      register: loaded.scenario.prompt.register,
      textingFlavor: loaded.scenario.prompt.textingFlavor,
      exposedActions: loaded.exposedActions,
    })
    // The locale messages come from the i18n build. A stale build renders an older contract, and replies to it are
    // not comparable with replies to the current one.
    if (prompt.contract.warnings.length > 0 || prompt.contract.sha256 !== STAGE_CONTRACT_EN_SHA256)
      throw new Error(`the rendered stage contract ${prompt.contract.version} is not the current contract ${STAGE_CONTRACT_EN_SHA256.slice(0, 12)}; run pnpm -F @proj-airi/i18n build`)
  }
  catch (error) {
    stderr(`qa-tools model run: ${errorMessageFrom(error) ?? 'invalid arguments'}\n`)
    return 2
  }

  const { scenario } = loaded
  const config = scenario.configs[configName]
  let run: RunHandle | undefined
  try {
    run = createRun({ tool: 'model-run', label: scenario.id, repoRoot, env, outDir })
    const writer = createTranscriptWriter(run.path('transcripts.jsonl'))
    let replies = 0
    let errors = 0
    try {
      const stages: (ClosenessStage | null)[] = scenario.stages ?? [null]
      for (const stage of stages) {
        // The history mode is part of the label, so records of the two modes never share a run key or a summary row.
        const configLabel = history === 'raw' ? configName : `${configName}+${history}-history`
        const label = stage === null ? configLabel : `${configLabel}@${stage}`
        const runKey = `${scenario.id}@${scenario.version}/${model}/${label}`
        // The app sends this text as its `system:character` runtime context. It is empty for a stranger at rest.
        const character = stage === null ? '' : renderStage(stage, bucketsOf(DEFAULT_CHARACTER_PROFILE.resting, null))
        const messages: ChatMessage[] = [{ role: 'system', content: prompt.text }]
        for (const [index, user] of scenario.turns.entries()) {
          // A user message is its time prefix and text, then a blank line and the runtime context, as core-agent's
          // request assembly renders it (`renderSegmentText` in `packages/core-agent/src/messages/render-context.ts`).
          messages.push({ role: 'user', content: `${formatTimePrefix(wallClockMs(scenario.startsAt, index))}${user}${character === '' ? '' : `\n\n${character}`}` })
          const request = buildChatRequest(model, messages, config)
          const body = JSON.stringify(request)
          const startedAt = new Date().toISOString()
          const outcome = await requestChat(baseUrl.href, body, REQUEST_TIMEOUT_MS)
          const endedAt = new Date().toISOString()

          const source = { kind: 'live' as const, file: loaded.file, fileSha256: loaded.fileSha256, rowIndex: index, path: `${runKey}/turns[${index}]@${startedAt}` }
          const { model: _model, messages: _messages, ...options } = request
          const record: ReplyTranscriptRecord = {
            schema: 'airi.reply-transcript/v2',
            replyId: replyIdFor(source),
            set: scenario.id,
            runKey,
            source,
            // The endpoint shape reports no digest and no capabilities, so none are recorded.
            model: { id: model, provider: 'openai-compatible', digest: null, capabilities: [] },
            generation: { config: label, options, think: config.reasoning_effort ?? null, withTools: false },
            prompt: { sha256: prompt.sha256, shaSource: 'recorded', toolsSha256: null, contractVersion: prompt.contract.version },
            machine: { label: machineLabel },
            conversation: { kind: 'turn', turn: index + 1, user, origin: 'user' },
            reply: { text: outcome.text, thinkingText: outcome.thinkingText, toolCalls: outcome.toolCalls, finish: outcome.finish, error: outcome.error, steps: 1 },
            timing: { ttftMs: outcome.ttftMs, totalMs: outcome.totalMs },
            usage: outcome.usage,
            live: {
              scenario: { id: scenario.id, version: scenario.version, stage },
              endpoint: { shape: 'openai-chat-completions', baseUrl: baseUrl.href },
              request: { model, bodySha256: sha256Buffer(Buffer.from(body, 'utf8')), startedAt },
              response: { status: outcome.status, id: outcome.id, model: outcome.model, systemFingerprint: outcome.systemFingerprint, endedAt },
              contractSha256: prompt.contract.sha256,
            },
          }
          await writer.write(record)
          await appendFile(run.path('requests.jsonl'), `{"replyId":${JSON.stringify(record.replyId)},"body":${body}}\n`)
          replies++
          stderr(`${runKey} turn ${index + 1}/${scenario.turns.length}: ${outcome.error === null ? `${outcome.totalMs} ms, finish ${outcome.finish}` : `error: ${outcome.error}`}\n`)
          if (outcome.error !== null) {
            // Later turns would continue from a reply that never arrived, so this conversation ends here.
            errors++
            break
          }
          messages.push({ role: 'assistant', content: history === 'canonical' ? await canonicalCueText(outcome.text, STAGE_RUNTIME_CONFIG.recoverCueNames) : outcome.text })
        }
      }
    }
    finally {
      await writer.close()
    }
    run.addArtifact('transcripts.jsonl', 'model-transcripts')
    run.addArtifact('requests.jsonl', 'model-requests')
    const exitCode = errors > 0 ? 1 : 0
    run.finish({ exitCode, summary: `${replies} replies, ${errors} failed; scenario ${scenario.id}@${scenario.version}, ${history} history, contract ${prompt.contract.version}` })
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
