import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { array, object, parse, string } from 'valibot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryRepo } from '../../database/repos/memory.repo'
import { composeMemoryHeader } from '../../tools/memory'
import { useLlmToolsetPromptsStore } from '../ai/chat-llm/toolset-prompts'
import { useMemoryStore } from '../memory'
import { controlEventsText, stickerPromptSegment } from './prompt'

vi.mock('../../database/repos/memory.repo')

// The prompt module reads these stores only inside `useChatPrompt`; the parity checks call its plain functions.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return { useAiriCardStore: defineStore('airi-card', () => ({})) }
})

// NOTICE:
// lab-tools cannot import stage-ui, so its fixture repeats stage-ui's prompt text; this test fails when that text drifts.
// Source: packages/lab-tools/src/model/prompt.ts (segmentsFromFixture).
// Removal condition: lab-tools can import the stage-ui assembler.
const fixture = parse(object({
  toolset: string(),
  memory: object({ header: string(), entries: array(string()) }),
  stickers: object({ header: string(), entries: array(object({ id: string(), description: string() })) }),
}), JSON.parse(readFileSync(join(import.meta.dirname, '../../../../lab-tools/fixtures/model/full-prompt.json'), 'utf8')))

const probeSegments = parse(object({ controlPrefix: string() }), JSON.parse(readFileSync(join(import.meta.dirname, '../../../../lab-tools/fixtures/model/probe-segments.json'), 'utf8')))

describe('lab-tools full-prompt fixture parity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('carries the memory header that the chat prompt sends', () => {
    expect(fixture.memory.header).toBe(composeMemoryHeader(true))
  })

  it('carries the index lines that the memory store builds, a general one and one of the card', async () => {
    await memoryRepo.add([
      { id: 'm1', description: 'The owner prefers short replies.', body: 'Short.', updatedAt: 1 },
      { id: 'p2', description: 'The owner has a cat named Mochi.', body: 'Mochi.', persona: 'default', updatedAt: 2 },
    ])
    const memory = useMemoryStore()
    await memory.ready()

    expect(fixture.memory.entries).toEqual(memory.indexEntriesFor('default'))
  })

  it('carries the sticker header and marker lines that the sticker segment builds', () => {
    const segment = stickerPromptSegment(fixture.stickers.entries)

    expect(segment).toEqual({
      id: 'stickers',
      header: fixture.stickers.header,
      text: fixture.stickers.entries.map(sticker => `<|STICKER ${sticker.id}|>: ${sticker.description}`),
    })
  })

  it('carries the toolset text that the toolset store renders for its plugins', () => {
    const toolsets = useLlmToolsetPromptsStore()
    toolsets.registerToolsetPrompts('home-assistant', [{ id: 'home-assistant', title: 'Home Assistant', content: 'Control the lights and switches that the owner lists.' }])
    toolsets.registerToolsetPrompts('browser', [{ id: 'browser', title: 'Browser', content: 'Open a page when the owner asks for it.' }])

    expect(fixture.toolset).toBe(toolsets.activeToolsetPrompt)
  })

  it('carries the control segment preamble that the cache-event probe sends', () => {
    expect(controlEventsText([{ kind: 'voice-interruption' }])).toBe(`${probeSegments.controlPrefix}[{"kind":"voice-interruption"}]`)
  })
})
