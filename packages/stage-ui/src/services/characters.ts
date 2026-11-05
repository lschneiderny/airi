import type { Character, CreateCharacterPayload } from '../types/character'

import { nanoid } from 'nanoid'
import { parse as parseValibot } from 'valibot'

import { CharacterWithRelationsSchema } from '../types/character'

/** Builds character records for the device-local character library. */
export function createCharactersService() {
  function buildLocal(userId: string, payload: CreateCharacterPayload): Character {
    const id = payload.character.id ?? nanoid()
    const now = new Date()

    return parseValibot(CharacterWithRelationsSchema, {
      id,
      version: payload.character.version,
      coverUrl: payload.character.coverUrl,
      avatarUrl: undefined,
      characterAvatarUrl: undefined,
      coverBackgroundUrl: undefined,
      creatorRole: undefined,
      priceCredit: '0',
      likesCount: 0,
      bookmarksCount: 0,
      interactionsCount: 0,
      forksCount: 0,
      creatorId: userId,
      ownerId: userId,
      characterId: payload.character.characterId,
      createdAt: now,
      updatedAt: now,
      deletedAt: undefined,
      capabilities: payload.capabilities?.map(capability => ({
        id: nanoid(),
        characterId: id,
        type: capability.type,
        config: capability.config,
      })),
      avatarModels: payload.avatarModels?.map(model => ({
        id: nanoid(),
        characterId: id,
        name: model.name,
        type: model.type,
        description: model.description,
        config: model.config,
        createdAt: now,
        updatedAt: now,
      })),
      i18n: payload.i18n?.map(item => ({
        id: nanoid(),
        characterId: id,
        language: item.language,
        name: item.name,
        description: item.description,
        tags: item.tags,
        createdAt: now,
        updatedAt: now,
      })),
      prompts: payload.prompts?.map(prompt => ({
        id: nanoid(),
        characterId: id,
        language: prompt.language,
        type: prompt.type,
        content: prompt.content,
      })),
      likes: [],
      bookmarks: [],
    })
  }

  return { buildLocal }
}

export const charactersService = createCharactersService()
