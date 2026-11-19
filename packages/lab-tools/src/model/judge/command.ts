import type { PersonaJudgment, SpokenReply } from './pairs'

import process from 'node:process'

import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { readTranscript } from '@proj-airi/qa-tools/model/transcript/jsonl'
import { mulberry32 } from '@proj-airi/stage-shared/perf/usage'
import { STAGE_RUNTIME_CONFIG } from '@proj-airi/stage-shared/stage-contract'

import * as v from 'valibot'

import { assertCoreAgentDistCurrent } from '../core-agent-dist'
import { resolveTranscriptInput } from '../inputs'
import { buildJudgeReplies, pairKey, PersonaJudgmentSchema, planPairs } from './pairs'
import { buildJudgmentReport, renderJudgmentMarkdown } from './report'
import { JudgeServer } from './server'

export const judgeUsage = `Usage:
  pnpm lab:model judge serve <transcripts.jsonl|run dir|set id>... [--out <judgments.jsonl>] [--judge <label>] [--contenders <a,b,...>] [--port <n>] [--seed <n>]
  pnpm lab:model judge report <judgments.jsonl>... [--json]
`

/** Where judgments go without --out: one stable file, so a later session resumes where the last one stopped. */
const DEFAULT_OUT = '.temp/qa/judge/judgments.jsonl'

export interface JudgeCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  /** Resolves when `serve` should stop. Defaults to the first SIGINT or SIGTERM. */
  stop?: Promise<unknown>
}

/**
 * Runs `lab:model judge`: `serve` starts a blind pairwise judging page for saved replies, and `report` aggregates
 * saved judgments.
 *
 * Returns:
 * - 0 on success. Invalid arguments throw, and the `lab:model` router reports them.
 */
export async function runJudgeCli(argv: string[], repoRoot: string, _env: NodeJS.ProcessEnv, io: JudgeCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  const [command, ...rest] = argv
  if (command === 'serve')
    return serve(rest, repoRoot, stdout, stderr, io.stop)
  if (command === 'report')
    return report(rest, repoRoot, stdout)
  throw new Error(`${command === undefined ? 'missing judge command' : `unknown judge command ${JSON.stringify(command)}`}\n\n${judgeUsage}`)
}

async function serve(argv: string[], repoRoot: string, stdout: (text: string) => void, stderr: (text: string) => void, stop?: Promise<unknown>): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: DEFAULT_OUT },
      judge: { type: 'string', default: 'owner' },
      contenders: { type: 'string' },
      port: { type: 'string', default: '0' },
      seed: { type: 'string' },
    },
  })
  if (!positionals.length)
    throw new Error(`expected at least one transcript input\n\n${judgeUsage}`)
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`invalid --port ${JSON.stringify(values.port)}`)
  const seed = values.seed === undefined ? undefined : Number(values.seed)
  if (seed !== undefined && !Number.isInteger(seed))
    throw new Error(`invalid --seed ${JSON.stringify(values.seed)}`)
  if (!values.judge.trim())
    throw new Error('--judge must not be empty')

  const inputs = await Promise.all(positionals.map(input => resolveTranscriptInput(repoRoot, input)))
  assertCoreAgentDistCurrent(repoRoot)
  // Import the dist-backed replay only after the guard, so a missing build gets the guard's refusal.
  const { replayReply } = await import('@proj-airi/core-agent')
  const spoken: SpokenReply[] = []
  for (const input of inputs) {
    for await (const record of readTranscript(input)) {
      const replay = await replayReply({ text: record.reply.text, thinkingText: record.reply.thinkingText, origin: record.conversation.origin, stickers: record.stickers, stage: STAGE_RUNTIME_CONFIG, chunks: 'whole' })
      spoken.push({ record, spoken: tidySpeech(replay.literals.join('')), cues: replay.specials.map(special => special.value) })
    }
  }

  const out = resolve(repoRoot, values.out)
  const earlier = await readJudgments(out, true)
  const pairs = planPairs(buildJudgeReplies(spoken), {
    random: seed === undefined ? Math.random : mulberry32(seed),
    judged: new Set(earlier.map(j => pairKey(j.slot.key, j.left.replyId, j.right.replyId))),
    contenders: values.contenders?.split(',').map(part => part.trim()).filter(Boolean),
  })
  stderr(`lab:model judge: ${spoken.length} replies, ${pairs.length} pairs to judge, ${earlier.length} judged before; writing to ${out}\n`)
  if (!pairs.length) {
    stderr('lab:model judge: nothing to judge: no two contenders answered the same turn, or every pair is judged\n')
    return 0
  }

  const page = await readFile(new URL('./page.html', import.meta.url), 'utf8')
  const server = new JudgeServer({ pairs, out, judge: values.judge.trim(), page, judgedBefore: earlier.length })
  const url = await server.listen(port)
  stdout(`${url}\n`)
  try {
    await (stop ?? Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]))
  }
  finally {
    await server.close()
  }
  return 0
}

async function report(argv: string[], repoRoot: string, stdout: (text: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: { json: { type: 'boolean', default: false } } })
  if (!positionals.length)
    throw new Error(`expected at least one judgments.jsonl\n\n${judgeUsage}`)
  const judgments: PersonaJudgment[] = []
  for (const path of positionals)
    judgments.push(...await readJudgments(resolve(repoRoot, path), false))
  const result = buildJudgmentReport(judgments)
  stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : renderJudgmentMarkdown(result))
  return 0
}

/** Reads and validates a judgments file. A missing file is empty only when `missingIsEmpty` (a new session's output). */
async function readJudgments(path: string, missingIsEmpty: boolean): Promise<PersonaJudgment[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (missingIsEmpty && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return []
    throw error
  }
  return text.split('\n').flatMap((line, index) => {
    if (!line.trim())
      return []
    const parsed = v.safeParse(PersonaJudgmentSchema, JSON.parse(line))
    if (!parsed.success)
      throw new Error(`${path}: line ${index + 1} is not a persona judgment (${parsed.issues[0].message})`)
    return [parsed.output]
  })
}

/** Speech as a listener hears it: the runtime's literals with the spacing that removed cues leave behind collapsed. */
function tidySpeech(literals: string): string {
  return literals.replace(/[ \t]+/g, ' ').replace(/ *\n\s*/g, '\n').trim()
}
