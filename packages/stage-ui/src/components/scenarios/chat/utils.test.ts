import type { ChatHistoryItem } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { getChatHistoryItemCopyText, getChatHistoryItemKey, getUnpromptedCueKind } from './utils'

describe('getChatHistoryItemCopyText', () => {
  it('maps an unprompted trigger to its topic text instead of the prompt sent to the model', () => {
    const cue: ChatHistoryItem = {
      role: 'user',
      content: '(No one spoke to you. You may speak up about: QA topic)',
      origin: 'unprompted',
      trigger: { topicKey: 'qa', text: 'QA topic' },
    }

    expect(getChatHistoryItemCopyText(cue)).toBe('QA topic')
  })

  it('returns no text for an unprompted message without a trigger', () => {
    const cue: ChatHistoryItem = { role: 'user', content: '(No one spoke to you.)', origin: 'unprompted' }

    expect(getChatHistoryItemCopyText(cue)).toBe('')
  })

  it('keeps the content of a written user message', () => {
    expect(getChatHistoryItemCopyText({ role: 'user', content: 'hi' })).toBe('hi')
  })
})

describe('getUnpromptedCueKind', () => {
  it('carries the trigger kind of an unprompted cue', () => {
    const cue: ChatHistoryItem = {
      role: 'user',
      content: '(A quiet moment.)',
      origin: 'unprompted',
      trigger: { topicKey: 'qa', text: 'QA topic', kind: 'ritual-greeting' },
    }

    expect(getUnpromptedCueKind(cue)).toBe('ritual-greeting')
  })

  it('returns no kind without a trigger kind or for a written message', () => {
    expect(getUnpromptedCueKind({ role: 'user', content: 'x', origin: 'unprompted', trigger: { topicKey: 'qa', text: 'QA topic' } })).toBeUndefined()
    expect(getUnpromptedCueKind({ role: 'user', content: 'hi' })).toBeUndefined()
    expect(getUnpromptedCueKind(undefined)).toBeUndefined()
  })
})

describe('getChatHistoryItemKey', () => {
  it('prefers stable message ids when available', () => {
    const createdAt = 1700000000000

    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi', createdAt, id: 'user-1' }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', createdAt, id: 'assistant-1', slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user-1')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant-1')
  })

  it('falls back to a role + timestamp + index composite when ids are missing', () => {
    const createdAt = 1700000000000

    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi', createdAt }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', createdAt, slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user:1700000000000:0')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant:1700000000000:1')
  })

  it('falls back to index when message is missing', () => {
    expect(getChatHistoryItemKey(undefined, 0)).toBe(0)
    expect(getChatHistoryItemKey(undefined, 1)).toBe(1)
  })

  it('falls back to a role + index composite when ids and timestamps are missing', () => {
    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi' }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user:0')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant:1')
  })
})
