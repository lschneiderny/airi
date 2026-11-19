import type { VerdictFile } from '../verdicts'

import * as v from 'valibot'

/** Line statuses that make a report's verdict fail; the receipt lists their ids for every report. */
const FAILING = ['FAIL', 'NOT-EXERCISED']

const verdictSummarySchema = v.strictObject({
  file: v.string(),
  report: v.string(),
  version: v.nullable(v.number()),
  verdict: v.string(),
  exitCode: v.number(),
  /** `<run folder name>:<line id> <status>` of every FAIL or NOT-EXERCISED line. */
  failing: v.array(v.string()),
  refusals: v.array(v.string()),
})
const commandSchema = v.strictObject({
  id: v.string(),
  kind: v.picklist(['run', 'copy', 'report']),
  criterion: v.nullable(v.string()),
  /** The argument vector exactly as spawned; for a copied run, the folder it was copied from. */
  argv: v.array(v.string()),
  exitCode: v.nullable(v.number()),
  durationMs: v.number(),
  verdict: v.optional(verdictSummarySchema),
  errors: v.array(v.string()),
})
export const receiptSchema = v.strictObject({
  kind: v.literal('motion3d-matrix-receipt'),
  version: v.literal(1),
  matrix: v.strictObject({ path: v.string(), sha256: v.string() }),
  commit: v.string(),
  dirty: v.boolean(),
  allowDirty: v.boolean(),
  startedAt: v.string(),
  endedAt: v.string(),
  rigs: v.record(v.string(), v.strictObject({ source: v.string(), path: v.string(), sha256: v.string() })),
  runsFrom: v.nullable(v.string()),
  memory: v.string(),
  failOn: v.array(v.string()),
  commands: v.array(commandSchema),
  exitCode: v.number(),
})
export type MatrixReceipt = v.InferOutput<typeof receiptSchema>
export type CommandRecord = v.InferOutput<typeof commandSchema>
export type VerdictSummary = v.InferOutput<typeof verdictSummarySchema>

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** The receipt's reading of one verdict file, taken from its JSON fields only. */
export function summarizeVerdict(file: string, verdict: VerdictFile): VerdictSummary {
  return {
    file,
    report: verdict.report,
    version: verdict.reportVersion,
    verdict: verdict.verdict,
    exitCode: verdict.exitCode,
    failing: verdict.lines.filter(line => FAILING.includes(line.status)).map(line => `${folderName(line.run)}:${line.id} ${line.status}`),
    refusals: verdict.refusals,
  }
}

/**
 * What makes a report command's record an error: no readable verdict file, a verdict whose recorded exit code is not the
 * process's, or a verdict that judged a folder the command was not given. Each is a receipt error, never a pass.
 */
export function reportErrors(exitCode: number, verdict: VerdictFile | string, given: readonly string[]): string[] {
  if (typeof verdict === 'string')
    return [`no readable verdict file: ${verdict}`]
  const errors = verdict.exitCode === exitCode ? [] : [`the verdict file records exit ${verdict.exitCode}, the command exited ${exitCode}`]
  for (const input of verdict.inputs.filter(input => !given.includes(input.run)))
    errors.push(`the verdict judged ${input.run}, which the command was not given`)
  return errors
}

/** 0 when every command ran and every verdict was read; 1 on an error, or on a verdict `failOn` names. */
export function receiptExitCode(commands: readonly CommandRecord[], failOn: readonly string[]): number {
  const errors = commands.some(command => command.errors.length > 0 || command.exitCode === null)
  const failing = commands.some(command => command.verdict && failOn.includes(command.verdict.verdict))
  return errors || failing ? 1 : 0
}

export interface ComparisonRow {
  readonly id: string
  readonly then: string
  readonly now: string
  readonly same: boolean
}

function reading(command: CommandRecord | undefined): string {
  if (!command)
    return 'absent'
  const verdict = command.verdict ? ` ${command.verdict.verdict} [${command.verdict.failing.join(', ')}]` : ''
  return `exit ${command.exitCode ?? '-'}${verdict}${command.errors.length ? ` errors ${command.errors.length}` : ''}`
}

/** Per command id, in the order of `then` and then any id only `now` has: exit code, verdict and failing lines. */
export function compareReceipts(then: MatrixReceipt, now: MatrixReceipt): ComparisonRow[] {
  const ids = [...new Set([...then.commands.map(c => c.id), ...now.commands.map(c => c.id)])]
  return ids.map((id) => {
    const a = reading(then.commands.find(c => c.id === id))
    const b = reading(now.commands.find(c => c.id === id))
    return { id, then: a, now: b, same: a === b }
  })
}

export function formatReceipt(receipt: MatrixReceipt): string {
  const cell = (text: string) => text.replaceAll('|', '\\|')
  return `${[
    `# qa:motion3d matrix receipt`,
    '',
    `matrix ${receipt.matrix.path} (sha256 ${receipt.matrix.sha256})`,
    `commit ${receipt.commit}, dirty ${receipt.dirty}${receipt.allowDirty ? ' (--allow-dirty)' : ''}, ${receipt.startedAt} to ${receipt.endedAt}`,
    `runs: ${receipt.runsFrom ? `copied from ${receipt.runsFrom}` : 'made by this matrix'}; ${receipt.memory}`,
    ...Object.entries(receipt.rigs).map(([rig, model]) => `rig ${rig}: ${model.path} (${model.source}), sha256 ${model.sha256}`),
    `exit ${receipt.exitCode}${receipt.failOn.length ? `; --fail-on ${receipt.failOn.join(',')}` : ''}`,
    '',
    '| id | criterion | exit | seconds | report | verdict | failing lines and refusals | errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...receipt.commands.map(c => `| ${c.id} | ${c.criterion ?? ''} | ${c.exitCode ?? '-'} | ${(c.durationMs / 1000).toFixed(1)} | ${c.verdict ? `${c.verdict.report} v${c.verdict.version ?? '-'}` : ''} | ${c.verdict?.verdict ?? ''} | ${cell([...c.verdict?.failing ?? [], ...c.verdict?.refusals ?? []].join('; '))} | ${cell(c.errors.join('; '))} |`),
    '',
    '## Commands as run',
    '',
    ...receipt.commands.map(c => `- ${c.id}: \`${c.argv.map(arg => /[\s"'$]/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}\``),
  ].join('\n')}\n`
}
