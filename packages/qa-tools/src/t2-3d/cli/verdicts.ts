import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { VerdictFile } from '../verdicts'

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { verdictFileSchema } from '../verdicts'

const usage = 'Usage: qa:motion3d verdicts <verdict file or folder>... [--fail-on <status>[,<status>...]] (default FAIL,REFUSED; folders contribute their *.verdict.json files)'
const DEFAULT_FAIL_ON = ['FAIL', 'REFUSED']

async function verdictFiles(path: string): Promise<{ files: string[], error?: string }> {
  let info
  try {
    info = await stat(path)
  }
  catch (error) {
    return { files: [], error: errorMessageFrom(error) ?? 'cannot read' }
  }
  if (!info.isDirectory())
    return { files: [path] }
  const files = (await readdir(path)).filter(name => name.endsWith('.verdict.json')).sort().map(name => join(path, name))
  return files.length ? { files } : { files: [], error: 'folder holds no *.verdict.json file' }
}

async function readVerdict(path: string): Promise<VerdictFile | string> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    return errorMessageFrom(error) ?? 'unreadable'
  }
  const parsed = v.safeParse(verdictFileSchema, json)
  return parsed.success ? parsed.output : `not a motion3d verdict file: ${v.summarize(parsed.issues)}`
}

/**
 * `qa:motion3d verdicts`: one line per verdict file, never cut, with the id and run of every line whose status
 * `--fail-on` names. Exit 0 when nothing matches, 1 when a file verdict or a line status matches, 2 when a file is
 * missing, unparsable or not a verdict file, because a verdict that cannot be read is never a pass.
 */
export async function verdictsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const paths: string[] = []
  let failOn = DEFAULT_FAIL_ON
  let unknownOption = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fail-on' && args[i + 1] && !args[i + 1].startsWith('-'))
      failOn = args[++i].split(',').map(status => status.trim().toUpperCase()).filter(Boolean)
    else if (args[i].startsWith('-'))
      unknownOption = true
    else
      paths.push(resolve(context.cwd, args[i]))
  }
  if (!paths.length || !failOn.length || unknownOption) {
    console.error(usage)
    return 2
  }

  let errors = 0
  let matched = 0
  let files = 0
  for (const path of paths) {
    const found = await verdictFiles(path)
    if (found.error) {
      errors++
      console.info(`ERROR ${path}: ${found.error}`)
    }
    for (const file of found.files) {
      files++
      const verdict = await readVerdict(file)
      if (typeof verdict === 'string') {
        errors++
        console.info(`ERROR ${file}: ${verdict}`)
        continue
      }
      const hits = verdict.lines.filter(line => failOn.includes(line.status))
      const hit = failOn.includes(verdict.verdict) || hits.length > 0
      matched += hit ? 1 : 0
      const runs = verdict.inputs.map(input => `${basename(input.run)}${input.seed === null ? '' : ` seed ${input.seed}`}`).join(', ') || 'no runs'
      const lines = hits.length ? hits.map(line => `${line.id} ${line.status} [${basename(line.run)}]`).join(', ') : 'none'
      const refusals = verdict.refusals.length ? `; refusals: ${verdict.refusals.join(' | ')}` : ''
      console.info(`${verdict.verdict} ${verdict.report} version ${verdict.reportVersion ?? '-'} exit ${verdict.exitCode} ${file}; runs: ${runs}; lines with ${failOn.join('/')}: ${lines}${refusals}`)
    }
  }
  console.info(`verdict files: ${files}; matching --fail-on ${failOn.join(',')}: ${matched}; errors: ${errors}`)
  return errors ? 2 : matched ? 1 : 0
}
