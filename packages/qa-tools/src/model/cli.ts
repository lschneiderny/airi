import process from 'node:process'

import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { runImportOllamaBenchCli } from './import/ollama-bench'
import { runPromptCli } from './prompt'
import { runScoreCli } from './score/command'

export const modelUsage = `Usage: pnpm qa:model <command> [options]

Commands:
  score <transcripts.jsonl> [--set <id>] [--label <l>]   score a transcript file with the real runtime replay
  prompt [--locale en] [--card <file>] [--json]          print the system prompt the app sends and its hashes
  import-ollama-bench <dir> --set <id>                   convert legacy ollama-bench results into transcripts
  help                                                   print this usage

Exit codes: 0 success, 1 command failure, 2 invalid arguments.
`

export type ModelCommandHandler = (argv: string[], repoRoot: string, env: NodeJS.ProcessEnv) => Promise<number>

export interface ModelCliIo {
  handlers?: {
    prompt: ModelCommandHandler
    score: ModelCommandHandler
    importOllamaBench: ModelCommandHandler
  }
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/**
 * Dispatches `qa:model` subcommands.
 *
 * Use when:
 * - `bin/model.ts` or a test needs the subcommand router with injectable handlers and output.
 *
 * Returns:
 * - 0 on success, 2 with usage on stderr for invalid arguments, 1 when a handler throws.
 */
export async function runModelCli(
  argv: string[],
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  io: ModelCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))
  const handlers = io.handlers ?? {
    prompt: runPromptCli,
    score: runScoreCli,
    importOllamaBench: runImportOllamaBenchCli,
  }

  const [command, ...rest] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    try {
      parseArgs({ args: rest, strict: true, allowPositionals: false })
    }
    catch (error) {
      stderr(`qa-tools model: ${errorMessageFrom(error) ?? 'invalid arguments'}\n\n${modelUsage}`)
      return 2
    }
    stdout(modelUsage)
    return 0
  }

  const handler = command === 'prompt'
    ? handlers.prompt
    : command === 'score'
      ? handlers.score
      : command === 'import-ollama-bench'
        ? handlers.importOllamaBench
        : undefined
  if (!handler) {
    stderr(`qa-tools model: ${command === undefined ? 'missing command' : `unknown command ${JSON.stringify(command)}`}\n\n${modelUsage}`)
    return 2
  }

  try {
    return await handler(rest, repoRoot, env)
  }
  catch (error) {
    stderr(`qa-tools model ${command}: ${errorMessageFrom(error) ?? 'model command failed'}\n`)
    return 1
  }
}
