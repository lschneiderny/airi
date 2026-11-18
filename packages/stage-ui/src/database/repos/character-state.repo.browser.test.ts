import localforage from 'localforage'

import { DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '@proj-airi/stage-shared/character-state'
import { afterEach, expect, it } from 'vitest'

import { characterStateContext } from '../../stores/character-state'
import { characterStateRepo as repo } from './character-state.repo'

// Builds before the unstorage migration wrote the records with localforage.
const previousRelease = localforage.createInstance({ name: 'airi-character-state', storeName: 'cards' })

function record(cardId: string) {
  return initialCharacterState(cardId, DEFAULT_CHARACTER_PROFILE, characterStateContext(1))
}

afterEach(async () => {
  await repo.clear()
})

it('reads the records that an earlier build wrote', async () => {
  await previousRelease.setItem('default', record('default'))
  await previousRelease.setItem('another-card', record('another-card'))

  expect(await repo.load('default')).toEqual(record('default'))
  expect(await repo.loadAll()).toEqual(expect.arrayContaining([record('default'), record('another-card')]))
  expect(await repo.loadAll()).toHaveLength(2)
  expect(await repo.load('missing-card')).toBeNull()
})

it('saves and removes records so that an earlier build reads the result', async () => {
  await repo.save(record('default'))
  await repo.save(record('another-card'))
  expect(await previousRelease.getItem('default')).toEqual(record('default'))

  await repo.remove('default')

  expect(await previousRelease.getItem('default')).toBeNull()
  expect(await previousRelease.getItem('another-card')).toEqual(record('another-card'))
})
