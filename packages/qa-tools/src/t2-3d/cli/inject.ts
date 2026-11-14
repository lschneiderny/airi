import type { Buffer } from 'node:buffer'

import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { LabelledCase, LabelsFile, ScoreRow, SealFile, SourceHash } from '../inject/labels'

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { encodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

import { sha256 } from '../gate/load'
import { labelsFileSchema, scoreCase, sealFileSchema, sealFor, sealPath, sealRefusals } from '../inject/labels'
import { applyOperations, InjectRefusal } from '../inject/operations'
import { MotionTraceRefusal, parseTrace } from '../read-trace'
import { runMotion3dChild } from './motion3d-child'
import { readVerdict } from './verdicts'

const usage = 'Usage: qa:motion3d inject --seal <labels file> | qa:motion3d inject <labels file> --out <new directory>'
/** Files a copied run carries; report outputs of the source are left behind so every report reads the copy fresh. */
const RUN_FILES = ['trace.json', 'summary.json', 'run.json']

class Refusal extends Error {
  override readonly name = 'Refusal'
}

async function readLabels(path: string): Promise<{ labels: LabelsFile, bytes: Buffer }> {
  let bytes: Buffer
  let json: unknown
  try {
    bytes = await readFile(path)
    json = JSON.parse(bytes.toString('utf8'))
  }
  catch (error) {
    throw new Refusal(`cannot read labels file ${path}: ${errorMessageFrom(error) ?? 'unreadable'}`)
  }
  const parsed = v.safeParse(labelsFileSchema, json)
  if (!parsed.success)
    throw new Refusal(`${path} is not a motion3d-inject-labels file: ${v.summarize(parsed.issues)}`)
  return { labels: parsed.output, bytes }
}

async function sourceHashes(labels: LabelsFile, base: string): Promise<SourceHash[]> {
  const sources = [...new Set(labels.cases.map(c => c.source))]
  return Promise.all(sources.map(async (source) => {
    const path = join(resolve(base, source), 'trace.json')
    if (!existsSync(path))
      throw new Refusal(`source ${source} has no trace.json (${path})`)
    return { source, traceSha256: sha256(await readFile(path)) }
  }))
}

async function seal(path: string): Promise<number> {
  const { labels, bytes } = await readLabels(path)
  if (existsSync(sealPath(path)))
    throw new Refusal(`${sealPath(path)} already exists; a seal is never rewritten. Remove it by hand only for a new, unscored labels file`)
  const record = sealFor(sha256(bytes), await sourceHashes(labels, dirname(path)), new Date())
  await writeFile(sealPath(path), `${JSON.stringify(record, null, 2)}\n`)
  console.info(`sealed ${path}: sha256 ${record.sha256} at ${record.sealedAt}; ${record.sources.length} source traces`)
  return 0
}

async function readSeal(path: string): Promise<SealFile | null> {
  if (!existsSync(sealPath(path)))
    return null
  const parsed = v.safeParse(sealFileSchema, JSON.parse(await readFile(sealPath(path), 'utf8')))
  if (!parsed.success)
    throw new Refusal(`${sealPath(path)} is not a motion3d-inject-seal file: ${v.summarize(parsed.issues)}`)
  return parsed.output
}

async function prepareCase(labelled: LabelledCase, base: string, out: string): Promise<{ unedited: string, edited: string }> {
  const source = resolve(base, labelled.source)
  const dirs = { unedited: join(out, labelled.id, 'unedited'), edited: join(out, labelled.id, 'edited') }
  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
    for (const name of RUN_FILES.filter(name => existsSync(join(source, name))))
      await copyFile(join(source, name), join(dir, name))
  }
  const json: unknown = JSON.parse(await readFile(join(source, 'trace.json'), 'utf8'))
  const input = parseTrace(json)
  const blocks = applyOperations(input, labelled.operations)
  const edited = { ...input.trace, frames: blocks.frames, rot: encodeBlock(blocks.rot), root: encodeBlock(blocks.root), channels: encodeBlock(blocks.channels) }
  parseTrace(edited)
  await writeFile(join(dirs.edited, 'trace.json'), `${JSON.stringify(edited)}\n`)
  return dirs
}

async function newestFile(dir: string): Promise<{ path: string, mtime: string } | null> {
  let newest: { path: string, ms: number } | null = null
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile())
      continue
    const path = join(entry.parentPath, entry.name)
    const { mtimeMs } = await stat(path)
    if (!newest || mtimeMs > newest.ms)
      newest = { path, ms: mtimeMs }
  }
  return newest && { path: relative(dir, newest.path), mtime: new Date(newest.ms).toISOString() }
}

const row = (r: ScoreRow) => `  ${r.match ? 'OK      ' : 'MISMATCH'} ${r.line}: expected ${r.expected}, read ${r.read} (unedited ${r.unedited})`

async function score(path: string, out: string, signal: AbortSignal): Promise<number> {
  if (existsSync(out))
    throw new Refusal(`--out already exists: ${out}`)
  const { labels, bytes } = await readLabels(path)
  const sealed = await readSeal(path)
  const labelsSha256 = sha256(bytes)
  const refusals = sealRefusals(sealed, labelsSha256, await sourceHashes(labels, dirname(path)))
  if (refusals.length)
    throw new Refusal(`refusing to score: ${refusals.join('; ')}`)
  await mkdir(out, { recursive: true })
  const prepared = []
  for (const labelled of labels.cases)
    prepared.push({ labelled, dirs: await prepareCase(labelled, dirname(path), out) })
  const cases = []
  for (const { labelled, dirs } of prepared) {
    const verdicts = []
    for (const [name, dir] of Object.entries(dirs)) {
      const file = join(out, labelled.id, `${name}.verdict.json`)
      const child = await runMotion3dChild([labelled.report.command, dir, ...labelled.report.flags ?? [], '--json', file], join(out, labelled.id, `${name}.out`), signal)
      if (signal.aborted)
        return 130
      verdicts.push({ name, command: child.argv, exitCode: child.exitCode, verdict: await readVerdict(file) })
    }
    const rows = scoreCase(labelled, verdicts[1].verdict, verdicts[0].verdict)
    cases.push({ id: labelled.id, source: labelled.source, operations: labelled.operations, commands: verdicts.map(({ name, command, exitCode }) => ({ name, command, exitCode })), rows, match: rows.every(r => r.match) })
    console.info(`case ${labelled.id} (${labelled.report.command}, ${labelled.operations.length} operations): ${cases.at(-1)?.match ? 'as labelled' : 'MISMATCH'}`)
    rows.forEach(r => console.info(row(r)))
  }
  const mismatches = cases.filter(c => !c.match).length
  const receipt = { kind: 'motion3d-inject-receipt', version: 1, labels: path, labelsSha256, seal: sealed, newestOutput: await newestFile(out), cases, mismatches, exitCode: mismatches ? 1 : 0 }
  await writeFile(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.info(`labels sealed ${sealed?.sealedAt} (sha256 ${labelsSha256}); newest scored output ${receipt.newestOutput?.mtime} (${receipt.newestOutput?.path}); ${cases.length} cases, ${mismatches} mismatched`)
  return receipt.exitCode
}

/**
 * `qa:motion3d inject`: scores labelled fault cases on copies of stored runs. Exit 0 when every case reads as labelled,
 * 1 on a mismatch, 2 when it refuses (no seal, a labels file or source trace changed after its seal, an operation the
 * trace cannot take, an existing `--out`) or on a usage error.
 */
export async function injectMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const sealing = args[0] === '--seal'
  const rest = sealing ? args.slice(1) : args
  const outAt = rest.indexOf('--out')
  const out = outAt < 0 ? undefined : rest[outAt + 1]
  const positional = rest.filter((_, i) => outAt < 0 || (i !== outAt && i !== outAt + 1))
  if (positional.length !== 1 || positional[0].startsWith('-') || (sealing ? outAt >= 0 : !out || out.startsWith('-'))) {
    console.error(usage)
    return 2
  }
  const labelsPath = resolve(context.cwd, positional[0])
  try {
    return sealing || !out ? await seal(labelsPath) : await score(labelsPath, resolve(context.cwd, out), context.signal)
  }
  catch (error) {
    if (!(error instanceof Refusal) && !(error instanceof InjectRefusal) && !(error instanceof MotionTraceRefusal))
      throw error
    console.error(`qa:motion3d inject: ${error.message}`)
    return 2
  }
}
