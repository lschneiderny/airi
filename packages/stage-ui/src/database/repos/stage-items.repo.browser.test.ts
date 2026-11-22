import type { StageItemAsset } from './stage-items.repo'

import { beforeEach, expect, it } from 'vitest'

import { storage } from '../storage'
import { stageItemsRepo as repo } from './stage-items.repo'

function asset(id: string): StageItemAsset {
  return { id, name: `${id}.png`, format: 'image', mime: 'image/png', width: 4, height: 4, importedAt: 1 }
}

beforeEach(async () => {
  await storage.clear('stage-items')
})

it('stores an asset with its file and lists it', async () => {
  expect(await repo.add(asset('asset-a'), new Blob(['bytes of a']), 200)).toBe(true)

  expect(await repo.list()).toEqual([asset('asset-a')])
  expect(await (await repo.file('asset-a'))?.text()).toBe('bytes of a')
})

it('stores assets up to the limit and refuses the one past it without writing', async () => {
  expect(await repo.add(asset('asset-a'), new Blob(['a']), 2)).toBe(true)
  expect(await repo.add(asset('asset-b'), new Blob(['b']), 2)).toBe(true)

  expect(await repo.add(asset('asset-c'), new Blob(['c']), 2)).toBe(false)

  expect((await repo.list()).map(stored => stored.id).sort()).toEqual(['asset-a', 'asset-b'])
  expect(await repo.file('asset-c')).toBeNull()
})

it('removes an asset entry and its file', async () => {
  await repo.add(asset('asset-a'), new Blob(['a']), 200)

  expect(await repo.remove('asset-a')).toBe(true)

  expect(await repo.list()).toEqual([])
  expect(await repo.file('asset-a')).toBeNull()
  expect(await repo.remove('asset-a')).toBe(false)
})

it('clears every entry and file and returns the removed ids', async () => {
  await repo.add(asset('asset-a'), new Blob(['a']), 200)
  await repo.add(asset('asset-b'), new Blob(['b']), 200)

  expect((await repo.clear()).sort()).toEqual(['asset-a', 'asset-b'])

  expect(await storage.getKeys('stage-items')).toEqual([])
})
