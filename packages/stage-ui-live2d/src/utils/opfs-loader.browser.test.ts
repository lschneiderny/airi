import JSZip from 'jszip'

import { expect, it, onTestFinished } from 'vitest'

import { OPFSCache } from './opfs-loader'

type LoadContext = Parameters<typeof OPFSCache.checkMiddleware>[0]

// Two stages can load one model at the same time: the main stage and the settings preview, or two windows. Both
// missed the cache and both saved it, and the later save cleared the files that a load in between had read from the
// finished cache. Its texture images then failed with nothing awaiting them: `Texture loading error`.
it('makes a second load of a model wait for the save of the first load and read the saved files', async () => {
  const key = `opfs-loader-test-${crypto.randomUUID()}`
  const root = await navigator.storage.getDirectory()
  onTestFinished(() => root.removeEntry(key, { recursive: true }))
  const archive = new JSZip()
  archive.file('model.model3.json', JSON.stringify({ Version: 3 }))
  archive.file('textures/texture_00.png', new Uint8Array([1, 2, 3]))
  const url = URL.createObjectURL(await archive.generateAsync({ type: 'blob' }))
  onTestFinished(() => URL.revokeObjectURL(url))

  const first = { source: { id: key, url } } as LoadContext
  const second = { source: { id: key, url } } as LoadContext
  const firstMissed = Promise.withResolvers<void>()
  const firstMaySave = Promise.withResolvers<void>()
  const firstLoad = OPFSCache.checkMiddleware(first, async () => {
    firstMissed.resolve()
    await firstMaySave.promise
    await OPFSCache.saveMiddleware(first, async () => {})
  })
  await firstMissed.promise
  const secondLoad = OPFSCache.checkMiddleware(second, async () => {})
  firstMaySave.resolve()
  await Promise.all([firstLoad, secondLoad])

  const files = (second.source as File[]).toSorted((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath))
  expect(files.map(file => file.webkitRelativePath)).toEqual(['model.model3.json', 'textures/texture_00.png'])
  expect(second.opfsZipBlob).toBeUndefined()
  expect(new Uint8Array(await files[1].arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
})

it('lets the next load save the cache when a load fails before its save', async () => {
  const key = `opfs-loader-test-${crypto.randomUUID()}`
  const root = await navigator.storage.getDirectory()
  onTestFinished(() => root.removeEntry(key, { recursive: true }))
  const archive = new JSZip()
  archive.file('model.model3.json', JSON.stringify({ Version: 3 }))
  const url = URL.createObjectURL(await archive.generateAsync({ type: 'blob' }))
  onTestFinished(() => URL.revokeObjectURL(url))

  const failed = { source: { id: key, url } } as LoadContext
  await expect(OPFSCache.checkMiddleware(failed, async () => {
    throw new Error('Invalid archive')
  })).rejects.toThrow('Invalid archive')

  const next = { source: { id: key, url } } as LoadContext
  await OPFSCache.checkMiddleware(next, () => OPFSCache.saveMiddleware(next, async () => {}))

  expect((await OPFSCache.get(key, url))?.map(file => file.webkitRelativePath)).toEqual(['model.model3.json'])
})
