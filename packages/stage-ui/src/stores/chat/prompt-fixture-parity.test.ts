import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { array, object, parse, string } from 'valibot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryRepo } from '../../database/repos/memory.repo'
import { composeMemoryHeader } from '../../tools/memory'
import { useMemoryStore } from '../memory'
import { stickerPromptSegment } from './prompt'

vi.mock('../../database/repos/memory.repo')

// The prompt module reads these stores only inside `useChatPrompt`; the parity checks call its plain functions.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return { useAiriCardStore: defineStore('airi-card', () => ({})) }
})

// NOTICE:
// qa-tools cannot import stage-ui, so its fixture repeats stage-ui's prompt text; this test fails when that text drifts.
// Source: packages/qa-tools/src/model/prompt.ts (segmentsFromFixture).
// Removal condition: qa-tools can import the stage-ui assembler.
const fixture = parse(object({
  memory: object({ header: string(), entries: array(string()) }),
  stickers: object({ header: string(), entries: array(object({ id: string(), description: string() })) }),
}), JSON.parse(readFileSync(join(import.meta.dirname, '../../../../qa-tools/fixtures/model/full-prompt.json'), 'utf8')))

describe('qa-tools full-prompt fixture parity', () => {
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
})
