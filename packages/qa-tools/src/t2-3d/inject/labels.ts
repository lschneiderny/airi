import type { VerdictFile } from '../verdicts'

import * as v from 'valibot'

import { operationSchema } from './operations'

/** Single-run commands that read only `trace.json` and `summary.json`, so an edited copy needs no other report first. */
export const INJECT_COMMANDS = ['gate', 'pops', 'walk-form', 'gaze-order', 'rest'] as const

const sha256 = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
const caseId = v.pipe(v.string(), v.regex(/^[\w.-]+$/))
/** `unchanged`: the edited copy reads the same status and value as the unedited copy of the same run. */
const expectedStatus = v.picklist(['PASS', 'FAIL', 'NOT-EXERCISED', 'REPORT', 'SKIPPED', 'REFUSED', 'unchanged'])
const caseSchema = v.strictObject({
  id: caseId,
  note: v.optional(v.string()),
  /** A stored run folder, relative to the labels file. It is copied, never written. */
  source: v.pipe(v.string(), v.minLength(1)),
  operations: v.array(operationSchema),
  report: v.strictObject({
    command: v.picklist(INJECT_COMMANDS),
    flags: v.optional(v.pipe(v.array(v.string()), v.check(flags => !flags.includes('--json'), 'the harness owns --json'))),
  }),
  expect: v.strictObject({
    verdict: v.optional(v.picklist(['PASS', 'FAIL', 'REFUSED', 'REPORT'])),
    lines: v.record(v.pipe(v.string(), v.minLength(1)), expectedStatus),
  }),
})
export const labelsFileSchema = v.pipe(
  v.strictObject({ kind: v.literal('motion3d-inject-labels'), version: v.literal(1), cases: v.pipe(v.array(caseSchema), v.minLength(1)) }),
  v.check(file => new Set(file.cases.map(c => c.id)).size === file.cases.length, 'case ids must be unique'),
)
export type LabelsFile = v.InferOutput<typeof labelsFileSchema>
export type LabelledCase = LabelsFile['cases'][number]

/** Written by `inject --seal` beside the labels file. The source hashes stop a labelled run from changing after the seal. */
export const sealFileSchema = v.strictObject({
  kind: v.literal('motion3d-inject-seal'),
  version: v.literal(1),
  sha256,
  sealedAt: v.pipe(v.string(), v.isoTimestamp()),
  sources: v.array(v.strictObject({ source: v.string(), traceSha256: sha256 })),
})
export type SealFile = v.InferOutput<typeof sealFileSchema>
export interface SourceHash { readonly source: string, readonly traceSha256: string }

export const sealPath = (labelsPath: string): string => `${labelsPath}.seal.json`

export function sealFor(labelsSha256: string, sources: readonly SourceHash[], sealedAt: Date): SealFile {
  return { kind: 'motion3d-inject-seal', version: 1, sha256: labelsSha256, sealedAt: sealedAt.toISOString(), sources: [...sources] }
}

/** Every reason scoring must refuse; empty when the labels file and every source trace are what was sealed. */
export function sealRefusals(seal: SealFile | null, labelsSha256: string, sources: readonly SourceHash[]): string[] {
  if (!seal)
    return ['no seal: run qa:motion3d inject --seal <labels file> before scoring']
  const refusals = seal.sha256 === labelsSha256 ? [] : [`labels file changed after its seal: sha256 ${labelsSha256}, sealed ${seal.sha256} at ${seal.sealedAt}`]
  for (const { source, traceSha256 } of sources) {
    const sealed = seal.sources.find(entry => entry.source === source)
    if (!sealed)
      refusals.push(`source ${source} is not in the seal`)
    else if (sealed.traceSha256 !== traceSha256)
      refusals.push(`source ${source} trace.json changed after the seal: sha256 ${traceSha256}, sealed ${sealed.traceSha256}`)
  }
  return refusals
}

export interface ScoreRow {
  readonly line: string
  readonly expected: string
  /** What the edited copy read: a line status, `REFUSED` for a refused command, `missing`, or `ERROR` for an unreadable verdict. */
  readonly read: string
  readonly unedited: string
  readonly match: boolean
}

function statusOf(file: VerdictFile | string, line: string): { status: string, value: string | null } {
  if (typeof file === 'string')
    return { status: 'ERROR', value: file }
  if (file.verdict === 'REFUSED')
    return { status: 'REFUSED', value: file.refusals.join(' | ') }
  const found = file.lines.find(entry => entry.id === line)
  return found ? { status: found.status, value: found.value } : { status: 'missing', value: null }
}

const verdictOf = (file: VerdictFile | string): string => typeof file === 'string' ? 'ERROR' : file.verdict

/** Expected against read for one case: the command's verdict when labelled, then every labelled line in file order. */
export function scoreCase(labelled: LabelledCase, edited: VerdictFile | string, unedited: VerdictFile | string): ScoreRow[] {
  const rows: ScoreRow[] = []
  if (labelled.expect.verdict)
    rows.push({ line: '(verdict)', expected: labelled.expect.verdict, read: verdictOf(edited), unedited: verdictOf(unedited), match: verdictOf(edited) === labelled.expect.verdict })
  for (const [line, expected] of Object.entries(labelled.expect.lines)) {
    const now = statusOf(edited, line)
    const before = statusOf(unedited, line)
    const match = expected === 'unchanged'
      ? now.status === before.status && now.value === before.value && !['ERROR', 'missing'].includes(now.status)
      : now.status === expected
    const read = expected === 'unchanged' ? `${now.status} ${now.value ?? ''}`.trim() : now.status
    rows.push({ line, expected, read, unedited: expected === 'unchanged' ? `${before.status} ${before.value ?? ''}`.trim() : before.status, match })
  }
  return rows
}
