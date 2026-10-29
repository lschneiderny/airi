import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { buildSystemPrompt } from './stage-contract'

interface PromptCliIo {
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/** Writes prompt bytes or JSON to stdout; diagnostics and plain-mode hashes go only to stderr. */
export async function runPromptCli(
  argv: string[],
  repoRoot: string,
  _env: NodeJS.ProcessEnv,
  io: PromptCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  let values
  try {
    values = parseArgs({
      args: argv,
      options: {
        locale: { type: 'string', default: 'en' },
        card: { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  }
  catch (error) {
    stderr(`qa-tools model prompt: ${errorMessageFrom(error) ?? 'invalid arguments'}\n`)
    return 2
  }

  let cardPrompt = ''
  if (values.card !== undefined) {
    try {
      cardPrompt = await readFile(resolve(repoRoot, values.card), 'utf8')
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        stderr(`qa-tools model prompt: ${errorMessageFrom(error) ?? 'card file not found'}\n`)
        return 2
      }
      throw error
    }
  }

  const prompt = buildSystemPrompt({ locale: values.locale, cardPrompt })
  const metadata = {
    promptSha256: prompt.sha256,
    contractSha256: prompt.contract.sha256,
    contractVersion: prompt.contract.version,
  }
  if (values.json) {
    stdout(`${JSON.stringify({ ...metadata, text: prompt.text })}\n`)
  }
  else {
    stdout(prompt.text)
    stderr(Object.entries(metadata).map(([key, value]) => `${key} ${value}\n`).join(''))
  }
  return 0
}
