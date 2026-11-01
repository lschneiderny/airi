import type { PromptSegment } from '@proj-airi/stage-shared/stage-contract'

import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { array, object, optional, parse, strictObject, string } from 'valibot'

import { buildSystemPrompt } from './stage-contract'

const listSegmentSchema = strictObject({ header: optional(string()), entries: array(string()) })
const fixtureSchema = strictObject({
  memory: optional(listSegmentSchema),
  toolset: optional(string()),
  account: optional(string()),
  voice: optional(string()),
  control: optional(string()),
  unprompted: optional(string()),
  plugin: optional(string()),
  stickers: optional(strictObject({ header: optional(string()), entries: array(object({ id: string(), description: string() })) })),
})

/**
 * Builds the tail segments of a fixture in the shapes that stage-ui's chat prompt builds: a memory header with its
 * entries oldest first, one text per plain segment, and one `<|STICKER id|>` line per catalog entry.
 * qa-tools cannot import stage-ui, so a test pins this mirror against the composer.
 */
export function segmentsFromFixture(value: unknown): PromptSegment[] {
  const fixture = parse(fixtureSchema, value)
  const segments: PromptSegment[] = []
  if (fixture.memory)
    segments.push({ id: 'memory', header: fixture.memory.header, text: fixture.memory.entries })
  for (const id of ['toolset', 'account', 'voice', 'control', 'unprompted', 'plugin'] as const) {
    const text = fixture[id]
    if (text !== undefined)
      segments.push({ id, text })
  }
  if (fixture.stickers)
    segments.push({ id: 'stickers', header: fixture.stickers.header, text: fixture.stickers.entries.map(sticker => `<|STICKER ${sticker.id}|>: ${sticker.description}`) })
  return segments
}

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
        full: { type: 'string' },
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

  let segments: PromptSegment[] = []
  if (values.full !== undefined) {
    try {
      segments = segmentsFromFixture(JSON.parse(await readFile(resolve(repoRoot, values.full), 'utf8')))
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        stderr(`qa-tools model prompt: fixture file not found: ${values.full}\n`)
        return 2
      }
      stderr(`qa-tools model prompt: invalid --full fixture ${values.full}: ${errorMessageFrom(error) ?? 'unreadable'}\n`)
      return 2
    }
  }

  const prompt = buildSystemPrompt({ locale: values.locale, cardPrompt, segments })
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
