import type { Character, CreateCharacterPayload, UpdateCharacterPayload } from '../types/character'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { charactersModel as model } from '../models/characters'
import { charactersService as service } from '../services/characters'

/** Owns the local character library. Character cards and chat sessions stay on this device. */
export const useCharacterStore = defineStore('characters', () => {
  const characters = ref<Map<string, Character>>(new Map())

  async function fetchList() {
    const stored = await model.list()
    characters.value = new Map(stored.map(character => [character.id, character]))
    return stored
  }

  async function fetchById(id: string) {
    const cached = characters.value.get(id) ?? (await model.list()).find(character => character.id === id)
    if (cached)
      characters.value.set(cached.id, cached)
    return cached
  }

  async function create(payload: CreateCharacterPayload) {
    const localCharacter = service.buildLocal('local', payload)
    characters.value.set(localCharacter.id, localCharacter)
    await model.upsert(localCharacter)
    return localCharacter
  }

  async function update(id: string, payload: UpdateCharacterPayload) {
    const character = characters.value.get(id)
    if (!character)
      return

    const localCharacter = {
      ...character,
      ...(payload.version !== undefined ? { version: payload.version } : {}),
      ...(payload.coverUrl !== undefined ? { coverUrl: payload.coverUrl } : {}),
      ...(payload.characterId !== undefined ? { characterId: payload.characterId } : {}),
      updatedAt: new Date(),
    }
    characters.value.set(localCharacter.id, localCharacter)
    await model.upsert(localCharacter)
  }

  async function remove(id: string) {
    characters.value.delete(id)
    await model.remove(id)
  }

  async function like(id: string) {
    const character = characters.value.get(id)
    if (!character)
      return

    const likes = character.likes ?? []
    if (!likes.some(item => item.userId === 'local')) {
      const localCharacter = {
        ...character,
        likes: [...likes, { userId: 'local', characterId: id }],
        likesCount: character.likesCount + 1,
        updatedAt: new Date(),
      }
      characters.value.set(localCharacter.id, localCharacter)
      await model.upsert(localCharacter)
    }
  }

  async function bookmark(id: string) {
    const character = characters.value.get(id)
    if (!character)
      return

    const bookmarks = character.bookmarks ?? []
    if (!bookmarks.some(item => item.userId === 'local')) {
      const localCharacter = {
        ...character,
        bookmarks: [...bookmarks, { userId: 'local', characterId: id }],
        bookmarksCount: character.bookmarksCount + 1,
        updatedAt: new Date(),
      }
      characters.value.set(localCharacter.id, localCharacter)
      await model.upsert(localCharacter)
    }
  }

  function getCharacter(id: string) {
    return characters.value.get(id)
  }

  return { characters, fetchList, fetchById, create, update, remove, like, bookmark, getCharacter }
})
