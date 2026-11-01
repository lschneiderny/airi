/**
 * Segment order of a character turn's system prompt. The prefix tier (`format`, `card`, `register`, `contract`) changes
 * only when the card, the conversation register, or the contract changes, so it stays first and cacheable. The register
 * section belongs to the character prompt, so the contract text never depends on it. The tail tier follows in this order.
 */
export const PROMPT_SEGMENT_ORDER = ['format', 'card', 'register', 'contract', 'memory', 'toolset', 'account', 'voice', 'control', 'unprompted', 'plugin', 'stickers', 'spark'] as const

export type PromptSegmentId = typeof PROMPT_SEGMENT_ORDER[number]
export type PromptTier = 'prefix' | 'tail'
/**
 * What happens when a segment exceeds its budget. `fixed` segments are host-written constants without a budget,
 * `warn` keeps the text and flags it, `truncate` cuts it, `drop-oldest` drops list entries from the front.
 */
export type OverflowPolicy = 'fixed' | 'warn' | 'truncate' | 'drop-oldest'

type PromptSegmentBudget
  = | { tier: PromptTier, policy: 'fixed' }
    | { tier: PromptTier, policy: 'warn' | 'truncate', maxChars: number }
    | { tier: PromptTier, policy: 'drop-oldest', maxEntries: number, maxChars?: number }

/**
 * Char budgets per segment. A `drop-oldest` char budget counts the entries joined by newlines, not the header.
 * Sizes are chars, not tokens, so the composer needs no tokenizer.
 */
export const PROMPT_SEGMENT_BUDGETS = {
  format: { tier: 'prefix', policy: 'fixed' },
  // The card is only flagged: cutting it would change the character and the cacheable prefix.
  card: { tier: 'prefix', policy: 'warn', maxChars: 8000 },
  register: { tier: 'prefix', policy: 'fixed' },
  contract: { tier: 'prefix', policy: 'fixed' },
  memory: { tier: 'tail', policy: 'drop-oldest', maxEntries: 40, maxChars: 6000 },
  toolset: { tier: 'tail', policy: 'warn', maxChars: 2000 },
  account: { tier: 'tail', policy: 'warn', maxChars: 2000 },
  voice: { tier: 'tail', policy: 'truncate', maxChars: 1000 },
  control: { tier: 'tail', policy: 'truncate', maxChars: 1500 },
  unprompted: { tier: 'tail', policy: 'fixed' },
  // Plugin text keeps system authority, so its size is capped.
  plugin: { tier: 'tail', policy: 'truncate', maxChars: 2000 },
  stickers: { tier: 'tail', policy: 'drop-oldest', maxEntries: 12 },
  spark: { tier: 'tail', policy: 'fixed' },
} as const satisfies Record<PromptSegmentId, PromptSegmentBudget>

/** Ends a truncated segment. It counts inside the budget, so a truncated segment is exactly `maxChars` long. */
export const PROMPT_TRUNCATION_MARKER = '…[truncated]'

type ListSegmentId = { [Id in PromptSegmentId]: typeof PROMPT_SEGMENT_BUDGETS[Id]['policy'] extends 'drop-oldest' ? Id : never }[PromptSegmentId]

/**
 * One part of the system prompt. List segments take their entries oldest first; the optional header renders above
 * them and stays when every entry is dropped. An empty segment renders nothing.
 */
export type PromptSegment
  = | { id: Exclude<PromptSegmentId, ListSegmentId>, text: string }
    | { id: ListSegmentId, text: readonly string[], header?: string }

export interface PromptSegmentReport {
  id: PromptSegmentId
  /** Length of the rendered segment, header included. */
  chars: number
  /** `ceil(chars / 4)`, a rough size for display only. */
  estimatedTokens: number
  /** Entries dropped by `drop-oldest`. */
  dropped: number
  truncated: boolean
  /** The input exceeded the budget, whatever the policy did about it. */
  overBudget: boolean
}

export interface ComposedPrompt {
  text: string
  prefix: string
  tail: string
  /** One entry per supplied segment, in segment order. */
  report: PromptSegmentReport[]
}

const segmentRank = new Map<string, number>(PROMPT_SEGMENT_ORDER.map((id, index) => [id, index]))

function truncate(text: string, maxChars: number) {
  if (text.length <= maxChars)
    return { text, truncated: false }

  let cut = maxChars - PROMPT_TRUNCATION_MARKER.length
  const last = text.charCodeAt(cut - 1)
  // Do not leave half of a surrogate pair before the marker.
  if (last >= 0xD800 && last <= 0xDBFF)
    cut -= 1
  return { text: `${text.slice(0, cut)}${PROMPT_TRUNCATION_MARKER}`, truncated: true }
}

function dropOldest(entries: readonly string[], maxEntries: number, maxChars: number | undefined) {
  const charCap = maxChars ?? Number.POSITIVE_INFINITY
  let start = 0
  let length = entries.reduce((sum, entry) => sum + entry.length, 0) + Math.max(entries.length - 1, 0)
  while (start < entries.length && (entries.length - start > maxEntries || length > charCap)) {
    length -= entries[start].length + (entries.length - start > 1 ? 1 : 0)
    start += 1
  }
  return { entries: entries.slice(start), dropped: start }
}

function fitSegment(segment: PromptSegment) {
  const budget: PromptSegmentBudget = PROMPT_SEGMENT_BUDGETS[segment.id]
  const text = segment.text

  if (typeof text !== 'string') {
    const header = 'header' in segment ? segment.header : undefined
    const { entries, dropped } = budget.policy === 'drop-oldest'
      ? dropOldest(text, budget.maxEntries, budget.maxChars)
      : { entries: text, dropped: 0 }
    return { text: (header ? [header, ...entries] : entries).join('\n'), dropped, truncated: false, overBudget: dropped > 0 }
  }

  switch (budget.policy) {
    case 'warn':
      return { text, dropped: 0, truncated: false, overBudget: text.length > budget.maxChars }
    case 'truncate': {
      const result = truncate(text, budget.maxChars)
      return { text: result.text, dropped: 0, truncated: result.truncated, overBudget: result.truncated }
    }
    default:
      return { text, dropped: 0, truncated: false, overBudget: false }
  }
}

function join(parts: readonly { id: PromptSegmentId, text: string }[]) {
  let joined = ''
  let previous: PromptSegmentId | undefined
  for (const part of parts) {
    // The format rules end with their own newline and the card follows them directly; this keeps the bytes of the
    // prefix that `composeSystemPrompt` produced before the composer existed.
    const separator = previous === undefined ? '' : previous === 'format' && part.id === 'card' ? '' : '\n\n'
    joined += separator + part.text
    previous = part.id
  }
  return joined
}

/**
 * Composes a system prompt from segments in `PROMPT_SEGMENT_ORDER`, whatever their input order, fitting each segment
 * to its budget. Non-empty segments are joined by a blank line. Pure: it reads no locale, store, or clock.
 *
 * @throws When a segment id is unknown or supplied twice. Overflow never throws.
 */
export function composePrompt(segments: readonly PromptSegment[]): ComposedPrompt {
  const seen = new Set<string>()
  for (const segment of segments) {
    if (!segmentRank.has(segment.id))
      throw new Error(`Unknown prompt segment "${segment.id}"`)
    if (seen.has(segment.id))
      throw new Error(`Duplicate prompt segment "${segment.id}"`)
    seen.add(segment.id)
  }

  const fitted = [...segments]
    .sort((left, right) => (segmentRank.get(left.id) ?? 0) - (segmentRank.get(right.id) ?? 0))
    .map(segment => ({ id: segment.id, tier: PROMPT_SEGMENT_BUDGETS[segment.id].tier, ...fitSegment(segment) }))
  const rendered = fitted.filter(part => part.text !== '')

  return {
    text: join(rendered),
    prefix: join(rendered.filter(part => part.tier === 'prefix')),
    tail: join(rendered.filter(part => part.tier === 'tail')),
    report: fitted.map(({ id, text, dropped, truncated, overBudget }) => ({
      id,
      chars: text.length,
      estimatedTokens: Math.ceil(text.length / 4),
      dropped,
      truncated,
      overBudget,
    })),
  }
}
