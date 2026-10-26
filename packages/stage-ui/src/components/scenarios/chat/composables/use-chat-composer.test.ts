import type { ChatHistoryReplyPayload } from '../reply'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { chatComposerActivityChangedEvent, chatComposerSentEvent, getSpeechBusContext } from '../../../../services/speech/bus'
import { useChatComposer } from './use-chat-composer'

describe('useChatComposer', () => {
  it('sends a native reply without changing the draft text', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn().mockResolvedValue(undefined)
    const composer = useChatComposer({ activeSessionId, send })
    const target: ChatHistoryReplyPayload = {
      label: 'AIRI',
      message: { id: 'assistant-1', role: 'assistant', content: 'Reply target', slices: [], tool_results: [] },
    }
    composer.draft.value = 'My answer'
    composer.selectReply(target)

    await expect(composer.submit()).resolves.toBe('sent')

    expect(send).toHaveBeenCalledWith({
      attachments: [],
      sessionId: 'session-1',
      replyToMessageId: 'assistant-1',
      text: 'My answer',
    })
    expect(composer.draft.value).toBe('')
    expect(composer.replyTarget.value).toBeUndefined()
  })

  it('captures the submission before awaiting pre-send work', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn().mockResolvedValue(undefined)
    const composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'Interrupt here'

    await composer.submit({
      beforeSend: async (submission) => {
        activeSessionId.value = 'session-2'
        expect(submission.sessionId).toBe('session-1')
        expect(submission.text).toBe('Interrupt here')
      },
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      text: 'Interrupt here',
    }))
  })

  it('announces that sending started after invoking the send boundary', async () => {
    const events: string[] = []
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn(async () => {
      events.push('send-started')
    })
    const composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'Interrupt here'

    await composer.submit({
      afterSendStarted: () => events.push('announced'),
    })

    expect(events).toEqual(['send-started', 'announced'])
  })

  it('restores a failed send without replacing newer input state', async () => {
    const activeSessionId = shallowRef('session-1')
    const firstTarget: ChatHistoryReplyPayload = {
      label: 'AIRI',
      message: { id: 'assistant-1', role: 'assistant', content: 'First', slices: [], tool_results: [] },
    }
    const secondTarget: ChatHistoryReplyPayload = {
      label: 'You',
      message: { id: 'user-2', role: 'user', content: 'Second' },
    }
    let composer: ReturnType<typeof useChatComposer>
    const send = vi.fn(async () => {
      composer.draft.value = 'New draft'
      composer.selectReply(secondTarget)
      throw new Error('Provider failed')
    })
    composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'My answer'
    composer.selectReply(firstTarget)

    await expect(composer.submit()).resolves.toBe('restored')

    expect(composer.draft.value).toBe('My answer\nNew draft')
    expect(composer.replyTarget.value).toStrictEqual(secondTarget)
  })

  it('discards a failed snapshot after the active session changes', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn(async () => {
      activeSessionId.value = 'session-2'
      throw new Error('Provider failed')
    })
    const composer = useChatComposer<string>({ activeSessionId, send })
    composer.draft.value = 'Old draft'
    composer.addAttachments('blob:old')

    await expect(composer.submit()).resolves.toBe('discarded')

    expect(composer.draft.value).toBe('')
    expect(composer.attachments.value).toEqual([])
  })

  it('clears only the reply target that matches the deleted message', () => {
    const target: ChatHistoryReplyPayload = {
      label: 'AIRI',
      message: { id: 'assistant-2', role: 'assistant', content: 'Target', slices: [], tool_results: [] },
    }
    const composer = useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn() })
    composer.selectReply(target)

    composer.clearReplyForMessage({ id: 'user-1', role: 'user', content: 'Earlier message' })
    expect(composer.replyTarget.value).toStrictEqual(target)

    composer.clearReplyForMessage({ id: 'assistant-2', role: 'assistant', content: 'Updated target', slices: [], tool_results: [] })
    expect(composer.replyTarget.value).toBeUndefined()
  })
})

describe('useChatComposer activity reports', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Collects the composer activity reports this window sends on the speech bus. */
  function recordReports() {
    const reports: { hasDraft: boolean, lastInputAtMs: number }[] = []
    const stop = getSpeechBusContext().on(chatComposerActivityChangedEvent, ({ body }) => {
      if (body)
        reports.push({ hasDraft: body.hasDraft, lastInputAtMs: body.lastInputAtMs })
    })
    return { reports, stop }
  }

  it('reports writing at most once per second, repeats it while a draft exists, and clears it on close', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { reports, stop } = recordReports()
    const scope = effectScope()
    const composer = scope.run(() => useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn() }))!

    composer.draft.value = 'H'
    await vi.advanceTimersByTimeAsync(300)
    composer.draft.value = 'Hi'
    await vi.advanceTimersByTimeAsync(0)
    expect(reports).toEqual([{ hasDraft: true, lastInputAtMs: 1_000_000 }])

    // The second keystroke is reported once the second has passed.
    await vi.advanceTimersByTimeAsync(700)
    expect(reports.at(-1)).toEqual({ hasDraft: true, lastInputAtMs: 1_000_300 })

    // An idle draft is reported again every 5 s, keeping its last input time.
    const count = reports.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reports.slice(count)).toEqual([
      { hasDraft: true, lastInputAtMs: 1_000_300 },
      { hasDraft: true, lastInputAtMs: 1_000_300 },
    ])

    composer.draft.value = ''
    await vi.advanceTimersByTimeAsync(0)
    expect(reports.at(-1)).toEqual({ hasDraft: false, lastInputAtMs: Date.now() })
    const afterClear = reports.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reports).toHaveLength(afterClear)

    composer.draft.value = 'Again'
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reports.at(-1)?.hasDraft).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
})

describe('useChatComposer sent events', () => {
  /** Collect the typed-send events this window sends on the speech bus. */
  function recordSentEvents() {
    const events: { sourceId: string, words: number }[] = []
    const stop = getSpeechBusContext().on(chatComposerSentEvent, ({ body }) => {
      if (body)
        events.push(body)
    })
    return { events, stop }
  }

  it('reports the word count and only the allowed payload keys once for a typed send', async () => {
    const { events, stop } = recordSentEvents()
    const composer = useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn().mockResolvedValue(undefined) })
    composer.draft.value = 'hello there world'

    await expect(composer.submit()).resolves.toBe('sent')

    expect(events).toHaveLength(1)
    expect(events[0]?.words).toBe(3)
    expect(typeof events[0]?.sourceId).toBe('string')
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(['sourceId', 'words'])
    stop()
  })

  it('reports zero words for an attachments-only send', async () => {
    const { events, stop } = recordSentEvents()
    const composer = useChatComposer<string>({ activeSessionId: shallowRef('session-1'), send: vi.fn().mockResolvedValue(undefined) })
    composer.addAttachments('attachment')

    await expect(composer.submit()).resolves.toBe('sent')

    expect(events).toHaveLength(1)
    expect(events[0]?.words).toBe(0)
    stop()
  })

  it('does not report ignored whitespace-only submissions', async () => {
    const { events, stop } = recordSentEvents()
    const send = vi.fn().mockResolvedValue(undefined)
    const composer = useChatComposer({ activeSessionId: shallowRef('session-1'), send })
    composer.draft.value = ' \n\t '

    await expect(composer.submit()).resolves.toBe('ignored')

    expect(send).not.toHaveBeenCalled()
    expect(events).toEqual([])
    stop()
  })
})
