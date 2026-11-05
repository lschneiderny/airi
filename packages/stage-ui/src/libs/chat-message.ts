import type { ChatAssistantMessage, ChatHistoryItem } from '@proj-airi/core-agent'

/** Returns readable message text for local previews and unprompted outcomes, preserving burst breaks. */
export function extractMessageText(message: ChatHistoryItem): string {
  if (message.role === 'assistant') {
    // The discriminated union narrows `message` to a shape that includes
    // `slices`; reading via the narrowed alias keeps tsc happy without an
    // `as` cast.
    const assistant: ChatAssistantMessage = message
    if (Array.isArray(assistant.slices) && assistant.slices.some(slice => slice.type === 'break') && typeof assistant.content === 'string')
      return assistant.content
    if (Array.isArray(assistant.slices) && assistant.slices.length > 0) {
      const text = assistant.slices
        .filter((slice): slice is { type: 'text', text: string } => slice.type === 'text')
        .map(slice => slice.text)
        .join('')
      if (text)
        return text
    }
  }
  if (typeof message.content === 'string')
    return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string')
          return part
        if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part)
          return String(part.text ?? '')
        return ''
      })
      .join('')
  }
  return ''
}
