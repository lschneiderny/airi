import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Replace the IDB-backed storage with an in-memory driver for tests; the
// repo's behavior is identical regardless of the underlying driver.
vi.mock('../storage', () => ({
  storage: createStorage({ driver: memoryDriver() }),
}))
vi.mock('./chat-assets.repo')

const { chatSessionsRepo } = await import('./chat-sessions.repo')
const { storage } = await import('../storage')

beforeEach(async () => {
  await storage.clear()
})

describe('chatSessionsRepo.clear', () => {
  /**
   * @example
   * clear() removes the index and session payloads.
   */
  it('removes the local index and sessions', async () => {
    await chatSessionsRepo.saveIndex({
      userId: 'user-1',
      characters: { 'char-a': { activeSessionId: 's1', sessions: { s1: { sessionId: 's1', userId: 'user-1', characterId: 'char-a', createdAt: 0, updatedAt: 0 } } } },
    })
    await chatSessionsRepo.saveSession('s1', { meta: { sessionId: 's1', userId: 'user-1', characterId: 'char-a', createdAt: 0, updatedAt: 0 }, messages: [] })

    await chatSessionsRepo.clear('user-1')

    expect(await chatSessionsRepo.getIndex('user-1')).toBeNull()
    expect(await chatSessionsRepo.getSession('s1')).toBeNull()
  })
})

describe('chatSessionsRepo local persistence', () => {
  it('loads stored history carrying obsolete cloud metadata without changing its messages', async () => {
    const meta = { sessionId: 'local-session', userId: 'local', characterId: 'default', createdAt: 1, updatedAt: 2, cloudChatId: 'obsolete', cloudMaxSeq: 3 }
    const messages = [{ id: 'kept-message', role: 'user' as const, content: 'Keep my local history' }]
    await storage.setItemRaw('local:chat/index/local', { userId: 'local', characters: { default: { activeSessionId: meta.sessionId, sessions: { [meta.sessionId]: meta } } } })
    await storage.setItemRaw('local:chat/sessions/local-session', { meta, messages })

    expect((await chatSessionsRepo.getIndex('local'))?.characters.default.activeSessionId).toBe(meta.sessionId)
    expect((await chatSessionsRepo.getSession(meta.sessionId))?.messages).toEqual(messages)
  })

  it('round-trips local session messages and metadata', async () => {
    const record = { meta: { sessionId: 'saved-local', userId: 'local', characterId: 'default', createdAt: 1, updatedAt: 2 }, messages: [{ id: 'local-message', role: 'user' as const, content: 'Saved locally' }] }
    await chatSessionsRepo.saveSession(record.meta.sessionId, record)

    expect(await chatSessionsRepo.getSession(record.meta.sessionId)).toEqual(record)
  })
})
