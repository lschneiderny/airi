import type { ChatAssistantMessage, ChatHistoryItem } from '@proj-airi/core-agent'

import { describe, expect, it } from 'vitest'

import { extractMessageText } from './chat-message'

describe('extractMessageText', () => {
  /**
   * @example
   * User message with plain string content → returns the string verbatim.
   */
  it('returns the string content of user / system messages directly', () => {
    expect(extractMessageText({ role: 'user', content: 'hi there' })).toBe('hi there')
    expect(extractMessageText({ role: 'system', content: 'system prompt' })).toBe('system prompt')
  })

  /**
   * @example
   * Assistant message built from streaming has a slices array; we prefer it
   * over the legacy `content` string because slices carry the live transcript.
   */
  it('joins assistant text slices when present', () => {
    const assistant: ChatAssistantMessage = {
      role: 'assistant',
      content: 'old',
      slices: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
      tool_results: [],
    }
    expect(extractMessageText(assistant)).toBe('hello world')
  })

  /**
   * @example
   * A burst preserves the paragraph breaks the runtime wrote into content.
   */
  it('maps a burst to its content', () => {
    const burst: ChatAssistantMessage = {
      role: 'assistant',
      content: 'One\n\nTwo',
      slices: [
        { type: 'text', text: 'One' },
        { type: 'break', seconds: 1 },
        { type: 'text', text: 'Two' },
      ],
      tool_results: [],
    }
    expect(extractMessageText(burst)).toBe('One\n\nTwo')
  })

  /**
   * @example
   * User message with multimodal parts → only the text parts come back.
   */
  it('flattens content arrays into their text parts only', () => {
    const userWithImage: ChatHistoryItem = {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } } as never,
      ],
    }
    expect(extractMessageText(userWithImage)).toBe('look at this:')
  })
})
