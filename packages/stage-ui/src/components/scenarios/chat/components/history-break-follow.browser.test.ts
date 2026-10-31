import type { ChatHistoryItem, StreamingAssistantMessage } from '../../../../types/chat'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import ChatHistory from './history.vue'

// NOTICE:
// virtua's 150 ms scroll-to disarm timer must run on the fake clock.
// virtua 0.50.4 binds `setTimeout` at module load.
// Source: node_modules/virtua/lib/vue/index.js (`g = setTimeout`, `g(o, 150)`).
// Remove once virtua reads timers at call time; then use a per-test fake clock as in history.browser.test.ts.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))
afterAll(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function createEnglishI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function assistant(id: string, slices: StreamingAssistantMessage['slices'], content = ''): StreamingAssistantMessage {
  return { id, role: 'assistant', content, slices, tool_results: [] }
}
function text(value: string) {
  return { type: 'text', text: value } as const
}
function bubbleTexts(container: Element) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-chat-bubble]')).map(bubble => bubble.textContent?.trim())
}

/** Frames stay real under the fake clock; the index scroll lands within a few of them. */
async function settleFrames() {
  for (let frame = 0; frame < 6; frame++)
    await new Promise(requestAnimationFrame)
}

// ROOT CAUSE:
//
// The history follows changes to the message list. A bubble revealed after a break changes nothing in
// the list, so the history stayed put and the bubble sat behind the composer, 2 px visible.
// See .omo/evidence/nonverbal-channels/task-20-ef-rerun-summary.md.
describe('chat history follow on a break reveal', () => {
  async function renderOverflowingBurst() {
    const filler = Array.from({ length: 12 }, (_, index): ChatHistoryItem => ({
      id: `user-${index}`,
      role: 'user',
      content: `Message ${index} `.repeat(8),
      createdAt: index,
    }))
    const screen = render(ChatHistory, {
      props: {
        messages: filler,
        sending: true,
        streamingMessage: assistant('burst', [text('One')], 'One'),
        style: 'height: 240px; width: 320px; overflow-y: auto;',
      },
      global: { plugins: [pinia, createEnglishI18n()] },
    })
    const history = screen.container.querySelector<HTMLElement>('.chat-history-list')
    if (!history)
      throw new Error('Expected a chat history viewport.')
    const atTail = () => history.scrollTop + history.clientHeight >= history.scrollHeight - 24
    await vi.waitFor(() => {
      expect(bubbleTexts(screen.container)).toEqual([expect.stringContaining('One')])
      expect(history.scrollHeight).toBeGreaterThan(history.clientHeight)
      expect(atTail()).toBe(true)
    })
    /** The break and the text after it arrive together; the list follows the stream as it already did. */
    const streamBreak = async () => {
      await screen.rerender({ sending: true, streamingMessage: assistant('burst', [text('One'), { type: 'break', seconds: 1 }, text('Two '.repeat(40))], 'One\n\nTwo') })
      await nextTick()
      expect(screen.container.querySelectorAll('[data-chat-bubble]')).toHaveLength(1)
      await settleFrames()
      expect(atTail()).toBe(true)
      // The virtualizer's own scroll-to loop disarms 150 ms after the stream scroll, well before the reveal.
      vi.advanceTimersByTime(150)
      await nextTick()
      await settleFrames()
    }
    /** At the one second mark the bubble after the break appears; nothing in the message list changes. */
    const revealSecondBubble = async () => {
      vi.advanceTimersByTime(850)
      await nextTick()
      expect(screen.container.querySelectorAll('[data-chat-bubble]')).toHaveLength(2)
      await settleFrames()
    }
    return { history, atTail, streamBreak, revealSecondBubble }
  }

  it('follows the bottom when a break bubble is revealed and the reader was at the bottom', async () => {
    const { history, atTail, streamBreak, revealSecondBubble } = await renderOverflowingBurst()
    await streamBreak()
    await revealSecondBubble()
    expect(history.scrollHeight - history.clientHeight - history.scrollTop).toBeLessThanOrEqual(24)
    expect(atTail()).toBe(true)
  })

  it('keeps a reader who scrolled up where they are when a break bubble is revealed', async () => {
    const { history, streamBreak, revealSecondBubble } = await renderOverflowingBurst()
    await streamBreak()
    history.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000 }))
    // Up by more than the 24 px tail tolerance, with the reply still in view: the virtualizer buffers only in
    // the scroll direction, so a reader further up has no reply mounted to reveal into.
    const readerPosition = history.scrollHeight - history.clientHeight - 60
    history.scrollTop = readerPosition
    history.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    expect(history.scrollTop).toBe(readerPosition)

    await revealSecondBubble()
    expect(history.scrollTop).toBe(readerPosition)
  })
})
