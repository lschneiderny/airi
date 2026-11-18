import type { Tool } from '@xsai/shared-chat'

import type { MemoryEntry, MemoryWrite } from '../types/memory'

import { repeatsHeldTitle } from '@proj-airi/stage-shared/situation'
import { rawTool } from '@xsai/tool'
import { array, description, maxLength, minLength, nullable, pipe, safeParse, strictObject, string } from 'valibot'
import { toJsonSchema } from 'xsschema'

export const READ_MEMORY_TOOL_NAME = 'builtIn_readMemory'
export const WRITE_MEMORY_TOOL_NAME = 'builtIn_writeMemory'
export const FORGET_MEMORY_TOOL_NAME = 'builtIn_forgetMemory'

const idSchema = pipe(string(), minLength(1), description('The entry id, as the memory index shows it.'))
const readParameters = strictObject({
  ids: pipe(array(idSchema), minLength(1), description('Every entry that the reply needs, so one call reads them all.')),
})
/** Forgetting an entry takes only its id. */
const forgetParameters = strictObject({ id: idSchema })
// Strict function calling needs every property in `required`, in nested objects too, so a new entry gives a null id.
const entrySchema = strictObject({
  id: pipe(nullable(string()), description('The id of the entry to change, as the memory index shows it. Null for a new entry.')),
  description: pipe(string(), maxLength(150), description('One line for the index. When the fact fits in one line, write the fact itself. Otherwise write when the fact matters.')),
  body: pipe(string(), minLength(1), maxLength(2000), description('The fact itself, with what makes it true or when it was said.')),
})
const writeParameters = strictObject({
  entries: pipe(array(entrySchema), minLength(1), description('Every fact to save in this turn, one entry per fact.')),
})

/**
 * How a run uses memory, then the line that introduces the index. The chat prompt composer renders it as the header
 * of the memory segment, above the index lines that it may drop oldest first.
 */
export function composeMemoryHeader(hasEntries: boolean) {
  return [
    'Long-term memory. You keep it yourself. Each index line gives the id of one remembered fact, and states the fact or when it matters.',
    `Read entries with ${READ_MEMORY_TOOL_NAME} when they matter for your reply. An index line that already states the fact needs no read.`,
    `Save with ${WRITE_MEMORY_TOOL_NAME} only when someone asks you to remember something, or states a lasting fact. Most turns save nothing.`,
    'One fact per entry. To update an entry, write it with its id instead of adding a near copy. Never save your own rules, codes, passwords, or secrets.',
    'What the situation block shows about the owner\'s apps or windows is not a lasting fact unless the owner states it.',
    `Forget an entry by its id with ${FORGET_MEMORY_TOOL_NAME} when it turns out wrong or someone asks. General entries belong to the owner, so you cannot change or forget them.`,
    hasEntries ? 'Memory index:' : 'The memory index is empty.',
  ].join('\n')
}

/**
 * The memory part of a run's prompt: how to use memory, and the index of the run's persona.
 * The index changes only when an entry changes, so it stays cacheable. Callers separate it from the text before it.
 */
export function composeMemoryPrompt(index: string) {
  return index ? `${composeMemoryHeader(true)}\n${index}` : composeMemoryHeader(false)
}

/** What a memory write is checked against before it is saved. */
export interface MemoryWriteGuard {
  /** The window and page titles the situation holds (`heldTitles`); empty while the user shares none. */
  titles: readonly string[]
  /** The user's own message of this turn. Empty for an unprompted turn, which has none. */
  ownerText: string
}

/**
 * Credential shapes a memory entry never holds. The list is short on purpose: it backs the prompt rule "never save
 * codes, passwords, or secrets" for the shapes that are unmistakable, and it is not a secret scanner.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // OpenAI and Anthropic style keys: `sk-` and at least 20 key characters (`sk-proj-...`, `sk-ant-...`).
  /\bsk-[\w-]{20,}/,
  // GitHub tokens: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and 36 or more characters.
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  // GitHub fine-grained personal access tokens.
  /\bgithub_pat_\w{22,}/,
  // Slack tokens: `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-`.
  /\bxox[abprs]-[\w-]{10,}/,
  // AWS access key ids: `AKIA` and 16 capitals or digits.
  /\bAKIA[A-Z0-9]{16}\b/,
  // A labelled secret with a value: `password: hunter2`, `passwd=...`, `api key: ...`, `api_key=...`.
  /\b(?:password|passwd|api[ _-]?key)\s*[:=]\s*\S{4,}/i,
]

/**
 * Why a memory entry must not be saved, as one sentence for the model, or `null` when it may be saved.
 *
 * - An entry that matches a credential shape is always refused.
 * - An entry that repeats a held window or page title is refused, unless the user's own message of the turn contains
 *   that title: the owner may state it, the situation block may not.
 */
export function memoryWriteRefusal(entry: Pick<MemoryWrite, 'description' | 'body'>, guard: MemoryWriteGuard): string | null {
  const text = `${entry.description}\n${entry.body}`
  if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(text)))
    return 'Memory not saved: it looks like a password or an access key. Never save one.'
  const unstated = guard.titles.filter(title => !repeatsHeldTitle(guard.ownerText, [title]))
  if (repeatsHeldTitle(text, unstated))
    return 'Memory not saved: it repeats a window or page title. Save it only when the owner states it.'
  return null
}

/** What the memory tools change. The caller binds them to the run's character card. */
interface CreateMemoryToolsOptions {
  read: (id: string) => MemoryEntry | undefined
  write: (entry: MemoryWrite) => Promise<MemoryEntry | undefined>
  forget: (id: string) => Promise<boolean>
  /** Read once per written entry, so a write is checked against the titles held when the model calls the tool. */
  guard: () => MemoryWriteGuard
}

/** Creates the memory tools for one run. The run reads its card's memories and the general ones, and changes only its card's. */
export async function createMemoryTools(options: CreateMemoryToolsOptions): Promise<Tool[]> {
  return [
    rawTool({
      name: READ_MEMORY_TOOL_NAME,
      description: 'Read long-term memory entries by their index ids.',
      parameters: await toJsonSchema(readParameters),
      execute: async (rawInput) => {
        const parsed = safeParse(readParameters, rawInput)
        if (!parsed.success)
          return 'Give at least one entry id from the memory index.'
        return parsed.output.ids.map((id) => {
          const entry = options.read(id)
          return entry ? `${entry.id} (${entry.persona ? 'yours' : 'general'}): ${entry.body}` : `No memory entry with id "${id}".`
        }).join('\n')
      },
    }),
    rawTool({
      name: WRITE_MEMORY_TOOL_NAME,
      description: 'Save or update lasting facts in long-term memory, one entry per fact.',
      parameters: await toJsonSchema(writeParameters),
      execute: async (rawInput) => {
        const parsed = safeParse(writeParameters, rawInput)
        if (!parsed.success)
          return 'Memory not saved: each entry needs an id or null, and a body.'
        const lines: string[] = []
        for (const input of parsed.output.entries) {
          const refusal = memoryWriteRefusal(input, options.guard())
          if (refusal) {
            lines.push(refusal)
            continue
          }
          const entry = await options.write({ id: input.id ?? undefined, description: input.description, body: input.body })
          lines.push(entry ? `Saved memory "${entry.id}".` : 'Memory not saved: it needs a body.')
        }
        return lines.join('\n')
      },
    }),
    rawTool({
      name: FORGET_MEMORY_TOOL_NAME,
      description: 'Forget one long-term memory entry.',
      parameters: await toJsonSchema(forgetParameters),
      execute: async (rawInput) => {
        const parsed = safeParse(forgetParameters, rawInput)
        return parsed.success && await options.forget(parsed.output.id) ? `Forgot memory "${parsed.output.id}".` : 'No memory entry with that id.'
      },
    }),
  ]
}
