import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices } from '../../../types/chat'

function isTextPart(part: unknown): part is { type: 'text', text?: string } {
  return typeof part === 'object'
    && part !== null
    && 'type' in part
    && part.type === 'text'
    && 'text' in part
}

function getTextFromContentParts(parts: unknown[]): string {
  return parts.reduce<string[]>((texts, part) => {
    if (!isTextPart(part))
      return texts

    const text = part.text?.trim()
    if (text)
      texts.push(text)

    return texts
  }, []).join('\n\n')
}

/** The trigger of a turn the character started without user input. History shows it as a cue, not as a user message. */
export function isUnpromptedCue(message: ChatHistoryItem | undefined): message is Extract<ChatHistoryItem, { role: 'user' }> & { origin: 'unprompted' } {
  return message?.role === 'user' && message.origin === 'unprompted'
}

/** The reason the character reached out, when the host recorded one on the trigger. */
export function getUnpromptedCueKind(message: ChatHistoryItem | undefined): string | undefined {
  return isUnpromptedCue(message) ? message.trigger?.kind : undefined
}

/** A reply that answered a user turn with a cue or with nothing. History shows it as a chip, never as a bubble. */
export function isWordlessReply(message: ChatHistoryItem | undefined): message is ChatAssistantMessage & { wordless: NonNullable<ChatAssistantMessage['wordless']> } {
  return message?.role === 'assistant' && message.wordless !== undefined
}

/**
 * The words of a wordless reply's cues, one per ACT that named a gesture or an emotion, in reply order.
 * A gesture names the cue when both are present; an ACT with neither field contributes nothing.
 */
export function getWordlessCueWords(message: ChatHistoryItem | undefined): string[] {
  if (!isWordlessReply(message))
    return []

  return message.wordless.cues.flatMap(cue => cue.gesture?.kind ?? cue.emotion ?? [])
}

/** A slice with its index in the message, which tool results are looked up by. */
export interface ChatBubbleSlice {
  slice: ChatSlices
  index: number
}

/**
 * Groups the slices of one reply into bubbles. A break slice closes the bubble before it; a bubble without slices
 * (a break before any slice, two adjacent breaks, or a trailing break) is dropped, so a trailing break renders one bubble.
 */
export function splitSlicesIntoBubbles(slices: ChatSlices[]): ChatBubbleSlice[][] {
  const bubbles: ChatBubbleSlice[][] = []
  let current: ChatBubbleSlice[] = []
  for (const [index, slice] of slices.entries()) {
    if (slice.type === 'break') {
      if (current.length)
        bubbles.push(current)
      current = []
      continue
    }
    current.push({ slice, index })
  }
  if (current.length)
    bubbles.push(current)
  return bubbles
}

export function getChatHistoryItemCopyText(message: ChatHistoryItem): string {
  // The trigger content is the instruction sent to the model; the cue stands for its topic.
  if (isUnpromptedCue(message))
    return message.trigger?.text ?? ''

  if (message.role === 'error')
    return message.content

  if (message.role === 'assistant') {
    if (message.slices?.length) {
      const text = message.slices
        .filter(slice => slice.type === 'text')
        .map(slice => slice.text.trim())
        .filter(Boolean)
        .join('\n\n')

      if (text)
        return text
    }

    if (typeof message.content === 'string')
      return message.content

    if (Array.isArray(message.content)) {
      return getTextFromContentParts(message.content)
    }

    return ''
  }

  if (typeof message.content === 'string')
    return message.content

  if (Array.isArray(message.content)) {
    return getTextFromContentParts(message.content)
  }

  return ''
}

export function getChatHistoryItemKey(message: ChatHistoryItem | undefined, index: number): string | number {
  if (!message)
    return index

  if (message.id)
    return message.id

  if (message.createdAt != null)
    return `${message.role}:${message.createdAt}:${index}`

  return `${message.role}:${index}`
}
