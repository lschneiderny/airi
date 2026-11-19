import process from 'node:process'

import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { appRequestFromLog } from './app-request'

export const captureUsage = `Usage:
  pnpm lab:model capture <qa:app run dir|requests.jsonl> --out <app-request.json>
`

/**
 * Runs `lab:model capture`: saves the system prompt and tools of the app's first chat request from a replay request
 * log, for `lab:model run --app-request`.
 *
 * Returns:
 * - 0 after writing the capture. Invalid arguments and a log without a chat request throw, and the `lab:model` router
 *   reports them.
 */
export async function runCaptureCli(argv: string[], repoRoot: string, _env: NodeJS.ProcessEnv, io: { stdout?: (text: string) => void } = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const { values, positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: { out: { type: 'string' } } })
  if (positionals.length !== 1 || !values.out)
    throw new Error(`expected one input and --out\n\n${captureUsage}`)
  const input = resolve(repoRoot, positionals[0]!)
  const log = (await stat(input)).isDirectory() ? join(input, 'requests.jsonl') : input
  const out = resolve(repoRoot, values.out)
  if (existsSync(out))
    throw new Error(`--out already exists: ${out}`)
  const lines = (await readFile(log, 'utf8')).split('\n')
  const capture = appRequestFromLog(lines, relative(repoRoot, log).replaceAll('\\', '/'), new Date().toISOString())
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(capture, null, 2)}\n`)
  stdout(`${out}\n`)
  process.stderr.write(`lab:model capture: system prompt ${capture.system.length} characters, ${capture.tools.length} tools (${capture.tools.map(tool => tool.function.name).join(', ')})\n`)
  return 0
}
