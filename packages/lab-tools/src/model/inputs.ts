import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Resolves a transcript input of a `lab:model` command: a transcript file, a run directory holding `transcripts.jsonl`,
 * or the id of a committed model-eval set. Relative paths resolve against the repository root.
 *
 * Throws:
 * - An `Error` naming the input when none of those exists.
 */
export async function resolveTranscriptInput(repoRoot: string, input: string): Promise<string> {
  const direct = resolve(repoRoot, input)
  const info = await stat(direct).catch(() => undefined)
  if (info?.isFile())
    return direct
  if (info?.isDirectory())
    return join(direct, 'transcripts.jsonl')
  if (/^[\w.-]+$/.test(input) && !input.includes('..')) {
    const set = resolve(repoRoot, 'packages/lab-tools/model-eval/sets', input, 'transcripts.jsonl')
    if ((await stat(set).catch(() => undefined))?.isFile())
      return set
  }
  throw new Error(`transcript input not found: ${input} (expected a transcripts.jsonl file, a run directory, or a set id)`)
}
