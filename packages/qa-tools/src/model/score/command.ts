import type { RunHandle } from '../../evidence/run'
import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { RunScore } from './aggregate'
import type { cueContractScorer, ReplyScore } from './cue-contract'
import type { ScoreContext } from './scorer'
import type { StyleScore } from './style'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, open, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { createRun } from '../../evidence/run'
import { captureClosure } from '../../motion/cache/closure'
import { sha256Bytes } from '../../motion/cache/key'
import { renderSummaryMarkdown } from '../report/markdown'
import { buildStageContract, extractExampleLines } from '../stage-contract'
import { readTranscript } from '../transcript/jsonl'
import { aggregateRun } from './aggregate'
import { SCORE_CLOSURE_FILES } from './closure-files'
import { scoreStyle } from './style'

interface ScoreCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  /** Filesystem clock seam: accepts either the dist file or the runtime source directory. */
  newestMtime?: (path: string) => number | undefined
  /** Runtime boundary seam for proving fixture failures refuse scoring. */
  fixtureScore?: typeof cueContractScorer.score
}

function newestMtime(path: string): number | undefined {
  if (!existsSync(path))
    return undefined
  if (statSync(path).isFile())
    return statSync(path).mtimeMs
  let newest: number | undefined
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile())
      continue
    const mtime = statSync(join(entry.parentPath, entry.name)).mtimeMs
    newest = newest === undefined ? mtime : Math.max(newest, mtime)
  }
  return newest
}

/** Scores saved replies through the runtime, refusing invalid input before creating evidence. */
export async function runScoreCli(
  argv: string[],
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  io: ScoreCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  let input: string
  let label: string
  let setDir: string | undefined
  let json: boolean
  let context: ScoreContext
  let scorer: typeof cueContractScorer
  let fixtures: typeof import('@proj-airi/core-agent').cueContractFixtures
  let provenance: Pick<RunScore, 'scorer' | 'sources' | 'fixtures'>
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        'label': { type: 'string', default: 'score' },
        'set': { type: 'string' },
        'example-lines-from': { type: 'string' },
        'json': { type: 'boolean', default: false },
      },
    })
    if (positionals.length !== 1)
      throw new Error('expected exactly one transcripts.jsonl path')
    label = values.label
    json = values.json
    for (const [name, value] of [['label', label], ['set', values.set]]) {
      if (value !== undefined && (!/^[\w.-]+$/.test(value) || value.includes('..')))
        throw new Error(`invalid ${name}: use letters, digits, '.', '_' and '-' only`)
    }
    input = resolve(repoRoot, positionals[0])
    if (!(await stat(input)).isFile())
      throw new Error(`transcript input is not a file: ${input}`)
    if (values.set !== undefined) {
      setDir = resolve(repoRoot, 'packages/qa-tools/model-eval/sets', values.set)
      if (!(await stat(join(setDir, 'transcripts.jsonl'))).isFile())
        throw new Error(`${setDir} lacks transcripts.jsonl`)
    }
    const dist = resolve(repoRoot, 'packages/core-agent/dist/index.mjs')
    const runtime = resolve(repoRoot, 'packages/core-agent/src/runtime')
    const mtime = io.newestMtime ?? newestMtime
    const distMtime = mtime(dist)
    const sourceMtime = mtime(runtime)
    if (distMtime === undefined || (sourceMtime !== undefined && distMtime < sourceMtime)) {
      throw new Error(`${dist} is ${distMtime === undefined ? 'missing' : 'older than packages/core-agent/src/runtime'}; run pnpm -F @proj-airi/core-agent build`)
    }
    // Import the dist-backed scorer only after the guard, so missing dist gets the same actionable refusal.
    const scoring = await import('./cue-contract')
    scorer = scoring.cueContractScorer
    const { CUE_CONTRACT_FIXTURES, cueContractFixtures } = await import('@proj-airi/core-agent')
    fixtures = cueContractFixtures
    const contract = buildStageContract('en')
    context = {
      contract: {
        text: contract.text,
        exampleLines: values['example-lines-from'] === undefined
          ? contract.exampleLines
          : extractExampleLines(await readFile(resolve(repoRoot, values['example-lines-from']), 'utf8')),
      },
    }
    const absolutePaths = SCORE_CLOSURE_FILES.map(path => resolve(repoRoot, path))
    for (const path of absolutePaths) {
      if (!(await stat(path)).isFile())
        throw new Error(`closure source is not a file: ${path}`)
    }
    const files = captureClosure(absolutePaths, repoRoot)
    if (files.length !== SCORE_CLOSURE_FILES.length)
      throw new Error('scorer closure is incomplete')
    provenance = {
      scorer: { ...scoring.CUE_CONTRACT_SCORER, fileSha: sha256Bytes(await readFile(resolve(repoRoot, 'packages/qa-tools/src/model/score/cue-contract.ts'))) },
      sources: {
        files,
        closureDigest: sha256Bytes(Buffer.from(JSON.stringify(files))),
        coreAgentDistSha256: sha256Bytes(await readFile(dist)),
      },
      fixtures: { ...CUE_CONTRACT_FIXTURES, passed: 0, total: fixtures.length },
    }
    let count = 0
    for await (const _record of readTranscript(input))
      count++
    if (!count)
      throw new Error('transcript input is empty')
  }
  catch (error) {
    stderr(`qa-tools model score: ${errorMessageFrom(error) ?? 'invalid input'}\n`)
    return 2
  }

  let run: RunHandle | undefined
  try {
    const failures: string[] = []
    const fixtureScore = io.fixtureScore ?? scorer.score
    for (const row of fixtures) {
      const record: ReplyTranscriptRecord = {
        schema: 'airi.reply-transcript/v1',
        replyId: String(row.id),
        set: 'fixtures',
        runKey: 'fixtures',
        source: { kind: 'live', file: 'cue-contract-fixtures', fileSha256: '', rowIndex: row.id, path: 'reply' },
        model: { id: 'fixture', provider: 'fixture', digest: null, capabilities: [] },
        generation: { config: 'fixture', options: {}, think: false, withTools: false },
        prompt: { sha256: null, shaSource: 'unknown', toolsSha256: null, contractVersion: null },
        machine: { label: 'fixture' },
        conversation: { kind: 'turn', turn: 0, user: 'hello', origin: 'user' },
        reply: { text: row.text, thinkingText: row.thinkingText ?? '', toolCalls: [], finish: null, error: null, steps: null },
        timing: { ttftMs: null, totalMs: null },
        usage: null,
      }
      const score = await fixtureScore(record, context)
      const expected = row.expect
      const matches = score.cueStats.act === expected.act
        && score.cueStats.recovered === expected.recovered
        && score.cueStats.stripped === expected.stripped
        && score.stageRejected === expected.stageRejected
        && score.outcome === expected.outcome
        && score.leadCue === expected.leadCue
        && score.chunkInvariant === (expected.chunkInvariant ?? true)
        && score.passes.whole && score.passes.perChar
        && JSON.stringify(score.unknownMarkers) === JSON.stringify(expected.unknownMarkers ?? [])
        && (expected.spoken === undefined || score.spokenText === expected.spoken)
        && (expected.residualChars === undefined || score.residualChars === expected.residualChars)
      if (matches)
        provenance.fixtures.passed++
      else
        failures.push(`fixture ${row.id}`)
    }
    if (failures.length)
      throw new Error(`cue contract fixture parity failed: ${failures.join(', ')}`)

    run = createRun({
      tool: 'model-score',
      label,
      repoRoot,
      env,
      gate: { ...provenance.scorer, version: String(provenance.scorer.version) },
    })
    const records: ReplyTranscriptRecord[] = []
    const cues: ReplyScore[] = []
    const styles: StyleScore[] = []
    const replies = await open(run.path('replies.jsonl'), 'w')
    try {
      for await (const record of readTranscript(input)) {
        const cue = await scorer.score(record, context)
        const style = scoreStyle(cue.spokenText, context)
        await replies.writeFile(`${JSON.stringify({ replyId: record.replyId, cue, style })}\n`)
        records.push(record)
        cues.push(cue)
        styles.push(style)
      }
    }
    finally {
      await replies.close()
    }
    const summary = aggregateRun(records, cues, styles, provenance)
    await writeFile(run.path('summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    await writeFile(run.path('summary.md'), renderSummaryMarkdown(summary))
    for (const [name, kind] of [['replies.jsonl', 'model-replies'], ['summary.json', 'model-summary'], ['summary.md', 'model-summary-markdown']])
      run.addArtifact(name, kind)
    if (setDir !== undefined) {
      for (const name of ['summary.json', 'summary.md'])
        await copyFile(run.path(name), join(setDir, name))
    }
    run.finish({ exitCode: 0, summary: `scored ${records.length} replies; closure ${provenance.sources.closureDigest}` })
    stdout(json
      ? `${JSON.stringify({ runDir: run.dir, replies: records.length, closureDigest: provenance.sources.closureDigest })}\n`
      : `${run.dir}\n`)
    return 0
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'scoring failed'
    run?.finish({ exitCode: 1, summary: message })
    stderr(`qa-tools model score: ${message}\n`)
    return 1
  }
}
