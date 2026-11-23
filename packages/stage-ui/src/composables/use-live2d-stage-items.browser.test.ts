import type { ItemExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Pinia } from 'pinia'

import type { StageItemAsset } from '../database/repos/stage-items.repo'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { storage } from '../database/storage'
import { useStageItemLibraryStore } from '../stores/stage-item-library'
import { useLive2DStageItems } from './use-live2d-stage-items'
import { useStageItemPruning } from './use-stage-item-pruning'

const placement = { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' as const } }

let pinia: Pinia | undefined
let scope: ReturnType<typeof effectScope> | undefined

async function png(name: string): Promise<File> {
  const canvas = new OffscreenCanvas(8, 8)
  const context = canvas.getContext('2d')!
  context.fillStyle = '#30c060'
  context.fillRect(0, 0, 8, 8)
  return new File([await canvas.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' })
}

/** The stage window's wiring: the library, its pruning of expression documents, and the scene's items. */
async function openStage(active: () => boolean = () => true) {
  pinia = createPinia()
  setActivePinia(pinia)
  const library = useStageItemLibraryStore(pinia)
  await library.load()
  const expressions = useExpressionStore(pinia)
  scope = effectScope()
  const stage = scope.run(() => {
    useStageItemPruning()
    return useLive2DStageItems({ active })
  })!
  return { library, expressions, items: stage.items }
}

async function importAsset(library: ReturnType<typeof useStageItemLibraryStore>, name: string) {
  const [result] = await library.importFiles([await png(name)])
  if (!result.ok)
    throw new Error(`The test image was refused: ${result.reason}`)
  return result.asset.id
}

beforeEach(async () => {
  await storage.clear('stage-items')
})

afterEach(() => {
  scope?.stop()
  scope = undefined
  if (pinia)
    disposePinia(pinia)
  pinia = undefined
  localStorage.clear()
  vi.restoreAllMocks()
})

/** Writes a library entry without its file; the library lists entries, and only drawing reads files. */
async function seedEntry(id: string, format: StageItemAsset['format']) {
  const asset: StageItemAsset = { id, name: `${id}.bin`, format, mime: format === 'live2d-zip' ? 'application/zip' : 'image/png', width: 8, height: 8, importedAt: 0 }
  await storage.setItemRaw(`stage-items:entries:${id}`, asset)
}

describe('useLive2DStageItems', () => {
  it('tells the store every library asset and, apart, the Live2D ones, and forwards the scene states', async () => {
    await seedEntry('asset-picture', 'image')
    await seedEntry('asset-animation', 'gif')
    await seedEntry('asset-model', 'live2d-zip')
    pinia = createPinia()
    setActivePinia(pinia)
    const library = useStageItemLibraryStore(pinia)
    await library.load()
    const expressions = useExpressionStore(pinia)
    const available = vi.spyOn(expressions, 'setAvailableItemAssets')
    const reported = vi.spyOn(expressions, 'reportItemStates')
    scope = effectScope()
    const stage = scope.run(() => useLive2DStageItems({ active: () => true }))!

    expect(available).toHaveBeenLastCalledWith(new Set(['asset-picture', 'asset-animation', 'asset-model']), new Set(['asset-model']))

    const states = { 'item:hat': 'attached', 'item:dress': 'missing-part' } as const
    stage.reportStates(states)
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(states)
  })

  it('draws nothing while inactive, revokes the URLs when it turns inactive, and opens them again after', async () => {
    const active = shallowRef(true)
    const { library, expressions, items } = await openStage(() => active.value)
    const hatAsset = await importAsset(library, 'hat.png')
    expressions.registerDefinitions('model-a', [])
    const hat = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: hatAsset, label: 'Hat', kind: 'prop', mappings: [], placement } }) as string
    expressions.activate(hat)
    await until(items).toMatch(list => list.length === 1, { timeout: 5000, throwOnTimeout: true })
    const url = items.value[0].url
    const revoked = vi.spyOn(URL, 'revokeObjectURL')

    active.value = false

    expect(items.value).toEqual([])
    expect(revoked).toHaveBeenCalledWith(url)
    active.value = true
    await until(items).toMatch(list => list.length === 1, { timeout: 5000, throwOnTimeout: true })
    expect(items.value[0].url).not.toBe(url)
  })

  it('opens one URL per shown asset and revokes it when the item hides, the model swaps, the asset leaves, and the stage goes', async () => {
    const created = vi.spyOn(URL, 'createObjectURL')
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    const { library, expressions, items } = await openStage()
    const hatAsset = await importAsset(library, 'hat.png')
    const bookAsset = await importAsset(library, 'book.png')
    expressions.registerDefinitions('model-a', [])
    const hat = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: hatAsset, label: 'Hat', kind: 'prop', mappings: [], placement } }) as string
    const book = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: bookAsset, label: 'Book', kind: 'prop', mappings: [], placement } }) as string

    expressions.activate(hat)
    await until(items).toMatch(list => list.length === 1, { timeout: 5000, throwOnTimeout: true })
    const firstUrl = items.value[0].url
    expect(items.value[0].document.id).toBe(hat)
    expect(items.value[0].format).toBe('image')
    expect(firstUrl).toMatch(/^blob:/)

    expressions.deactivate(hat)
    expect(items.value).toEqual([])
    expect(revoked).toHaveBeenCalledWith(firstUrl)

    expressions.activate(hat)
    await until(items).toMatch(list => list.length === 1, { timeout: 5000, throwOnTimeout: true })
    const secondUrl = items.value[0].url
    expressions.registerDefinitions('model-b', [])
    expect(items.value).toEqual([])
    expect(revoked).toHaveBeenCalledWith(secondUrl)

    expressions.registerDefinitions('model-a', [])
    expressions.activate(hat)
    expressions.activate(book)
    await until(items).toMatch(list => list.length === 2, { timeout: 5000, throwOnTimeout: true })
    const [hatUrl, bookUrl] = items.value.map(item => item.url)
    await library.remove(hatAsset)
    expect(items.value.map(item => item.document.id)).toEqual([book])
    expect(revoked).toHaveBeenCalledWith(hatUrl)
    expect(expressions.settingsSnapshot.items?.map(item => item.document.id)).toEqual([book])

    scope!.stop()
    expect(revoked).toHaveBeenCalledWith(bookUrl)
    expect(created).toHaveBeenCalledTimes(4)
    expect(revoked).toHaveBeenCalledTimes(4)
  })

  it('draws the documents a runtime-less window passes instead of its own store targets', async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    const library = useStageItemLibraryStore(pinia)
    await library.load()
    const hatAsset = await importAsset(library, 'hat.png')
    const expressions = useExpressionStore(pinia)
    expressions.registerDefinitions('model-a', [])
    const hat = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: hatAsset, label: 'Hat', kind: 'prop', mappings: [], placement } }) as string
    const stored = expressions.settingsSnapshot.items!.find(item => item.document.id === hat)!.document
    // The stage window shows the hat; this window's store does not.
    const shown = shallowRef<ItemExpressionDocument[] | undefined>([{ ...stored, placement: { ...placement, x: 42 } }])
    scope = effectScope()
    const { items } = scope.run(() => useLive2DStageItems({ active: () => true, documents: () => shown.value }))!

    expect(expressions.itemTargets).toEqual([])
    await until(items).toMatch(list => list.length === 1, { timeout: 5000, throwOnTimeout: true })
    expect(items.value[0].document.placement.x).toBe(42)
    const url = items.value[0].url

    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    shown.value = []
    expect(items.value).toEqual([])
    expect(revoked).toHaveBeenCalledWith(url)

    // Without the list the window falls back to its own store, which shows nothing here.
    shown.value = undefined
    expect(items.value).toEqual([])
  })

  it('refuses an item whose asset the library does not have, draws nothing, and opens no file', async () => {
    const created = vi.spyOn(URL, 'createObjectURL')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { expressions, items } = await openStage()
    expressions.registerDefinitions('model-a', [])
    const ghost = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: 'asset-unknown', label: 'Ghost', kind: 'prop', mappings: [], exposedToLlm: true, placement } }) as string

    expressions.activate(ghost)
    const refusals = expressions.applySlots([{ slot: 'prop', expressionId: ghost, holdSeconds: 5, until: 'hold' }], 0)

    expect(refusals).toEqual([{ entryId: ghost, reason: 'missing-asset' }])
    expect(expressions.itemTargets).toEqual([])
    expect(items.value).toEqual([])
    expect(created).not.toHaveBeenCalled()
    expect(expressions.settingsSnapshot.items).toMatchObject([{ document: { id: ghost }, available: false, shown: false }])
  })
})
