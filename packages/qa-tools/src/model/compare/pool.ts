import type { OllamaServerSnapshot } from '../run/ollama-probe'
import type { CheckResult } from '../run/scenario'
import type { RunScore } from '../score/aggregate'

import { contenderName } from '../contender'

/** One contender's pooled scores: every run of one model and config, across seeds and relationship stages. */
export interface CompareRow {
  contender: string
  /** Run keys pooled into the row: one per conversation. */
  runs: number
  replies: number
  errors: number
  blank: number
  /** Shares of the replies with spoken text, as in the score summary. */
  cue: { parsed: number, recovered: number, rejected: number, none: number, leadCue: number } | null
  unknownMarkers: [name: string, count: number][]
  inventedEmotions: [name: string, count: number][]
  style: { stageDirection: number, emoji: number, aiBreak: number, meanWords: number } | null
  /** Means weighted by the replies each run timed; `coldTtftMs` weighs each conversation once. */
  timing: { coldTtftMs: number | null, warmTtftMs: number | null, warmFirstSpeechMs: number | null, decodeTps: number | null, promptTokens: number | null }
  /** Recall checks passed and run, or `null` when no pooled run had checks. */
  recall: { passed: number, total: number } | null
  /**
   * The largest GPU footprint of a pooled run: the server log's buffers when the run read them, otherwise `/api/ps`.
   * `source` says which, because some Ollama versions misreport `/api/ps`.
   */
  memory: { gpuGiB: number, cpuWeightsGiB: number | null, contextLength: number | null, source: 'server-log' | 'api-ps' } | null
}

/** The parts of an Ollama snapshot that a comparison reads. */
export type ServerMemory = Pick<OllamaServerSnapshot, 'loaded'> & {
  load: Pick<NonNullable<OllamaServerSnapshot['load']>, 'gpuWeightsMiB' | 'cpuWeightsMiB' | 'gpuCacheMiB' | 'gpuComputeMiB' | 'contextLength'> | null
}

export interface CompareExtras {
  /** The Ollama snapshot of each run key, from the `server.json` beside its transcripts. */
  servers: ReadonlyMap<string, ServerMemory>
  /** The recall check results of each run key, from the `checks.json` beside its transcripts. */
  checks: ReadonlyMap<string, readonly CheckResult[]>
}

function weightedMean(pairs: readonly [value: number | null | undefined, weight: number][]): number | null {
  let sum = 0
  let weight = 0
  for (const [value, w] of pairs) {
    if (typeof value === 'number' && w > 0) {
      sum += value * w
      weight += w
    }
  }
  return weight ? sum / weight : null
}

function merged(lists: readonly (readonly [string, number][])[], limit: number): [string, number][] {
  const counts = new Map<string, number>()
  for (const list of lists) {
    for (const [name, count] of list)
      counts.set(name, (counts.get(name) ?? 0) + count)
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).slice(0, limit)
}

function memoryOf(server: ServerMemory): CompareRow['memory'] {
  if (server.load !== null) {
    const { load } = server
    return { gpuGiB: (load.gpuWeightsMiB + load.gpuCacheMiB + load.gpuComputeMiB) / 1024, cpuWeightsGiB: load.cpuWeightsMiB / 1024, contextLength: load.contextLength, source: 'server-log' }
  }
  if (server.loaded !== null)
    return { gpuGiB: server.loaded.sizeVram / 2 ** 30, cpuWeightsGiB: null, contextLength: server.loaded.contextLength, source: 'api-ps' }
  return null
}

/**
 * Pools score summary rows into one row per contender, in the order of the first run of each.
 *
 * Use when:
 * - Several runs of one model and config (seeds, relationship stages, separate run directories) should read as one
 *   result, beside the other contenders.
 */
export function poolRuns(runs: readonly RunScore[], extras: CompareExtras): CompareRow[] {
  const groups = new Map<string, RunScore[]>()
  for (const run of runs) {
    const name = contenderName(run.model, run.config)
    groups.set(name, [...(groups.get(name) ?? []), run])
  }
  return [...groups].map(([contender, group]) => {
    const sum = (pick: (run: RunScore) => number) => group.reduce((total, run) => total + pick(run), 0)
    const outcomes = { parsed: sum(run => run.outcomes.parsed), recovered: sum(run => run.outcomes.recovered), rejected: sum(run => run.outcomes.rejected), none: sum(run => run.outcomes.none) }
    const spoken = outcomes.parsed + outcomes.recovered + outcomes.rejected + outcomes.none
    const share = (count: number) => count / spoken
    const timed = group.filter(run => run.timing !== null)
    const checks = group.flatMap(run => extras.checks.get(run.runKey) ?? [])
    const memories = group.map(run => extras.servers.get(run.runKey)).filter(server => server !== undefined).map(memoryOf).filter(memory => memory !== null)
    return {
      contender,
      runs: group.length,
      replies: sum(run => run.replies),
      errors: sum(run => run.errors),
      blank: sum(run => run.blank),
      cue: spoken ? { parsed: share(outcomes.parsed), recovered: share(outcomes.recovered), rejected: share(outcomes.rejected), none: share(outcomes.none), leadCue: share(sum(run => run.leadCue)) } : null,
      unknownMarkers: merged(group.map(run => run.unknownMarkers), 3),
      inventedEmotions: merged(group.map(run => run.inventedEmotions), 3),
      style: spoken
        ? {
            stageDirection: share(sum(run => run.style.stageDirection)),
            emoji: share(sum(run => run.style.emoji)),
            aiBreak: sum(run => run.style.aiBreak),
            meanWords: weightedMean(group.map(run => [run.style.meanWords, run.outcomes.parsed + run.outcomes.recovered + run.outcomes.rejected + run.outcomes.none])) ?? 0,
          }
        : null,
      timing: {
        coldTtftMs: weightedMean(timed.map(run => [run.timing!.coldTtftMs, 1])),
        warmTtftMs: weightedMean(timed.map(run => [run.timing!.warmTtftMs, run.timing!.replies - 1])),
        warmFirstSpeechMs: weightedMean(timed.map(run => [run.timing!.warmFirstSpeechMs, run.timing!.replies - 1])),
        decodeTps: weightedMean(timed.map(run => [run.timing!.decodeTps, run.timing!.replies])),
        promptTokens: weightedMean(timed.map(run => [run.timing!.meanPromptTokens, run.timing!.replies])),
      },
      recall: checks.length ? { passed: checks.filter(check => check.passed === true).length, total: checks.length } : null,
      memory: memories.length ? memories.reduce((largest, memory) => memory.gpuGiB > largest.gpuGiB ? memory : largest) : null,
    }
  })
}

/** The rows as a Markdown table, with the caveats a reader needs beside it. */
export function renderCompareMarkdown(rows: readonly CompareRow[], meta: { contractVersions: string[], scorer: string }): string {
  const percent = (value: number | undefined) => value === undefined ? 'n/a' : `${Math.round(100 * value)}%`
  const seconds = (ms: number | null) => ms === null ? 'n/a' : (ms / 1000).toFixed(2)
  const fixed = (value: number | null | undefined, digits: number) => value === null || value === undefined ? 'n/a' : value.toFixed(digits)
  // A marker can hold newlines and run long; a cell keeps one line and the start of it.
  const cell = (text: string, limit = Infinity) => {
    const flat = text.replace(/\s+/g, ' ').trim()
    return (flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat).replaceAll('|', '&#124;')
  }
  const names = (list: readonly [string, number][]) => list.map(([name, count]) => `${cell(name, 40)}: ${count}`).join(', ') || '-'
  const header = ['Contender', 'runs', 'replies', 'errors', 'blank', 'parsed', 'recovered', 'rejected', 'no cue', 'lead cue', 'unknown markers', 'invented emotions', 'stage dir', 'emoji', 'AI break', 'words', 'cold TTFT s', 'warm TTFT s', 'warm speech s', 'decode tok/s', 'prompt tok', 'recall', 'GPU GiB', 'CPU weights GiB', 'context']
  const lines = [
    '# Model comparison',
    '',
    `Scorer ${meta.scorer}; contract ${meta.contractVersions.join(', ') || 'unknown'}. Each row pools every run of one model and config across seeds and relationship stages. Cue and style shares are of replies with spoken text. Timing means weigh each run by the replies it timed. GPU GiB is the largest pooled run's footprint, from Ollama's server log when the run read it (marked *), otherwise from \`/api/ps\`, which some versions misreport.`,
    '',
    `| ${header.join(' | ')} |`,
    `|${header.map(() => ' --- ').join('|')}|`,
  ]
  for (const row of rows) {
    lines.push(`| ${[
      cell(row.contender),
      row.runs,
      row.replies,
      row.errors,
      row.blank,
      percent(row.cue?.parsed),
      percent(row.cue?.recovered),
      percent(row.cue?.rejected),
      percent(row.cue?.none),
      percent(row.cue?.leadCue),
      names(row.unknownMarkers),
      names(row.inventedEmotions),
      percent(row.style?.stageDirection),
      percent(row.style?.emoji),
      row.style?.aiBreak ?? 'n/a',
      fixed(row.style?.meanWords, 1),
      seconds(row.timing.coldTtftMs),
      seconds(row.timing.warmTtftMs),
      seconds(row.timing.warmFirstSpeechMs),
      fixed(row.timing.decodeTps, 1),
      fixed(row.timing.promptTokens, 0),
      row.recall === null ? 'n/a' : `${row.recall.passed}/${row.recall.total}`,
      row.memory === null ? 'n/a' : `${row.memory.gpuGiB.toFixed(2)}${row.memory.source === 'server-log' ? '*' : ''}`,
      fixed(row.memory?.cpuWeightsGiB, 2),
      row.memory?.contextLength ?? 'n/a',
    ].join(' | ')} |`)
  }
  return `${lines.join('\n')}\n`
}
