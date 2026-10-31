import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { useChatStreamStore } from './stream-store'

const stores: ReturnType<typeof createPinia>[] = []

/** The session store behind the stream reads i18n, so the stores start inside a component. */
function setupStream() {
  const pinia = createPinia()
  stores.push(pinia)
  let stream: ReturnType<typeof useChatStreamStore> | undefined
  render(defineComponent({
    setup() {
      stream = useChatStreamStore()
      return () => h('div')
    },
  }), { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  if (!stream)
    throw new Error('Expected the stream store to start.')
  return stream
}

afterEach(() => {
  for (const pinia of stores.splice(0))
    disposePinia(pinia)
})

it('opens a new text slice after a break instead of merging into the text before it', () => {
  const stream = setupStream()
  stream.beginStream('turn-1')
  stream.appendStreamLiteral('One')
  stream.appendStreamLiteral(' line')
  stream.appendStreamBreak(1)
  stream.appendStreamLiteral('Two')
  stream.appendStreamLiteral('!')

  expect(stream.streamingMessage.slices).toEqual([
    { type: 'text', text: 'One line' },
    { type: 'break', seconds: 1 },
    { type: 'text', text: 'Two!' },
  ])
  expect(stream.streamingMessage.content).toBe('One line\n\nTwo!')
})

it('ignores a break before the first text, which has nothing to split', () => {
  const stream = setupStream()
  stream.beginStream('turn-1')
  stream.appendStreamBreak(2)
  stream.appendStreamLiteral('Only line')

  expect(stream.streamingMessage.slices).toEqual([{ type: 'text', text: 'Only line' }])
  expect(stream.streamingMessage.content).toBe('Only line')
})
