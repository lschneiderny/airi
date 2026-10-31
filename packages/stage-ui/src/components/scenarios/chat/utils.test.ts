import type { ChatHistoryItem } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { getChatHistoryItemCopyText, getChatHistoryItemKey, getUnpromptedCueKind, getWordlessCueWords, isWordlessReply, splitSlicesIntoBubbles } from './utils'

describe('getChatHistoryItemCopyText', () => {
  it('maps an unprompted trigger to its topic text instead of the prompt sent to the model', () => {
    const cue: ChatHistoryItem = {
      role: 'user',
      content: '(A quiet moment. Nobody said anything. What is on your mind right now: QA topic)',
      origin: 'unprompted',
      trigger: { topicKey: 'qa', text: 'QA topic' },
    }

    expect(getChatHistoryItemCopyText(cue)).toBe('QA topic')
  })

  it('returns no text for an unprompted message without a trigger', () => {
    const cue: ChatHistoryItem = { role: 'user', content: '(A quiet moment.)', origin: 'unprompted' }

    expect(getChatHistoryItemCopyText(cue)).toBe('')
  })

  it('keeps the content of a written user message', () => {
    expect(getChatHistoryItemCopyText({ role: 'user', content: 'hi' })).toBe('hi')
  })

  it('joins the text slices of a burst with blank lines and ignores its breaks', () => {
    const burst: ChatHistoryItem = {
      role: 'assistant',
      content: 'One\n\nTwo',
      slices: [{ type: 'text', text: 'One' }, { type: 'break', seconds: 1 }, { type: 'text', text: 'Two' }],
      tool_results: [],
    }

    expect(getChatHistoryItemCopyText(burst)).toBe('One\n\nTwo')
  })

  it('copies nothing from a wordless reply', () => {
    expect(getChatHistoryItemCopyText({ role: 'assistant', content: '', slices: [], tool_results: [], wordless: { cues: [{ emotion: 'happy' }] } })).toBe('')
  })
})

describe('splitSlicesIntoBubbles', () => {
  it('opens a bubble after each break and keeps the slice indexes', () => {
    const bubbles = splitSlicesIntoBubbles([
      { type: 'text', text: 'One' },
      { type: 'break', seconds: 1 },
      { type: 'tool-call', toolCall: { toolCallId: 'c', toolCallType: 'function', toolName: 'weather', args: '{}' } },
      { type: 'text', text: 'Two' },
    ])

    expect(bubbles.map(bubble => bubble.map(({ index }) => index))).toEqual([[0], [2, 3]])
  })

  it('drops the empty bubbles of a leading, doubled, or trailing break', () => {
    const bubbles = splitSlicesIntoBubbles([
      { type: 'break', seconds: 1 },
      { type: 'text', text: 'One' },
      { type: 'break', seconds: 1 },
      { type: 'break', seconds: 1 },
      { type: 'text', text: 'Two' },
      { type: 'break', seconds: 1 },
    ])

    expect(bubbles.map(bubble => bubble.map(({ slice }) => slice.type === 'text' ? slice.text : slice.type))).toEqual([['One'], ['Two']])
    expect(splitSlicesIntoBubbles([])).toEqual([])
  })
})

describe('wordless replies', () => {
  it('names each cue by its gesture, else its emotion, and skips an ACT with neither', () => {
    const reply: ChatHistoryItem = {
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      wordless: { cues: [{ emotion: 'happy', gesture: { kind: 'nod', count: 2 } }, { emotion: 'curious' }, {}] },
    }

    expect(isWordlessReply(reply)).toBe(true)
    expect(getWordlessCueWords(reply)).toEqual(['nod', 'curious'])
  })

  it('treats a spoken reply and a user message as not wordless', () => {
    expect(isWordlessReply({ role: 'assistant', content: 'hi', slices: [], tool_results: [] })).toBe(false)
    expect(isWordlessReply({ role: 'user', content: 'hi' })).toBe(false)
    expect(getWordlessCueWords(undefined)).toEqual([])
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
