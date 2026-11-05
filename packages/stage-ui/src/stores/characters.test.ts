import type { CreateCharacterPayload } from '../types/character'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { charactersModel } from '../models/characters'
import { useCharacterStore } from './characters'

vi.mock('../models/characters', () => ({
  charactersModel: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
}))

const character = {
  id: 'character-1',
  version: '1',
  coverUrl: 'cover.png',
  avatarUrl: undefined,
  characterAvatarUrl: undefined,
  coverBackgroundUrl: undefined,
  creatorRole: undefined,
  priceCredit: '0',
  likesCount: 0,
  bookmarksCount: 0,
  interactionsCount: 0,
  forksCount: 0,
  creatorId: 'user-1',
  ownerId: 'user-1',
  characterId: 'airi',
  createdAt: new Date('2026-05-08T00:00:00.000Z'),
  updatedAt: new Date('2026-05-08T00:00:00.000Z'),
  deletedAt: undefined,
  capabilities: [],
  avatarModels: [],
  i18n: [],
  prompts: [],
  likes: [],
  bookmarks: [],
}

const payload = {
  character: { version: '1', coverUrl: 'cover.png', characterId: 'airi' },
  capabilities: [],
  avatarModels: [],
  i18n: [],
  prompts: [],
} satisfies CreateCharacterPayload

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('local character library', () => {
  it('loads saved characters without requesting hosted data', async () => {
    vi.mocked(charactersModel.list).mockResolvedValue([character])
    const store = useCharacterStore()
    await store.fetchList()
    expect(store.getCharacter(character.id)).toEqual(character)
    expect(await store.fetchById(character.id)).toEqual(character)
  })

  it('persists creation, edits, bookmarks, likes, and removal locally', async () => {
    const store = useCharacterStore()
    const created = await store.create(payload)
    expect(created?.ownerId).toBe('local')
    expect(created).toBeDefined()
    const id = created!.id
    await store.update(id, { version: '2' })
    expect(store.getCharacter(id)?.version).toBe('2')
    await store.like(id)
    await store.like(id)
    await store.bookmark(id)
    expect(store.getCharacter(id)?.likesCount).toBe(1)
    expect(store.getCharacter(id)?.bookmarksCount).toBe(1)
    expect(charactersModel.upsert).toHaveBeenLastCalledWith(store.getCharacter(id))
    await store.remove(id)
    expect(store.getCharacter(id)).toBeUndefined()
    expect(charactersModel.remove).toHaveBeenCalledWith(id)
  })
})
