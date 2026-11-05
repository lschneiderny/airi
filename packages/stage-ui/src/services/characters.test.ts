import type { CreateCharacterPayload } from '../types/character'

import { describe, expect, it } from 'vitest'

import { charactersService } from './characters'

const payload = {
  character: {
    version: '1',
    coverUrl: 'cover.png',
    characterId: 'airi',
  },
  capabilities: [],
  avatarModels: [],
  i18n: [],
  prompts: [],
} satisfies CreateCharacterPayload

/**
 * @example
 * describe('services characters', () => {})
 */
describe('services characters', () => {
  /**
   * @example
   * const character = charactersService.buildLocal('user-1', payload)
   */
  it('builds a schema-valid local character with owner fields', () => {
    const character = charactersService.buildLocal('user-1', payload)

    expect(character.id).toBeDefined()
    expect(character.creatorId).toBe('user-1')
    expect(character.ownerId).toBe('user-1')
    expect(character.characterId).toBe('airi')
    expect(character.likes).toEqual([])
    expect(character.bookmarks).toEqual([])
  })
})
