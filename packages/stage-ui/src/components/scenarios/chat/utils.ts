import type { ChatHistoryItem } from '../../../types/chat'

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
