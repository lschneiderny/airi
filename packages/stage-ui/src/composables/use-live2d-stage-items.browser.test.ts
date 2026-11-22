import type { Pinia } from 'pinia'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

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
async function openStage() {
  pinia = createPinia()
  setActivePinia(pinia)
  const library = useStageItemLibraryStore(pinia)
  await library.load()
  const expressions = useExpressionStore(pinia)
  scope = effectScope()
  const stage = scope.run(() => {
    useStageItemPruning()
    return useLive2DStageItems({ active: () => true })
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

describe('useLive2DStageItems', () => {
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
