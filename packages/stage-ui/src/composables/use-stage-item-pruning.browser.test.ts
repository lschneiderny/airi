import type { Pinia } from 'pinia'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useStageItemLibraryStore } from '../stores/stage-item-library'
import { useStageItemPruning } from './use-stage-item-pruning'

const placement = { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' as const } }

let pinia: Pinia | undefined
const scope = effectScope()

afterEach(() => {
  scope.stop()
  if (pinia)
    disposePinia(pinia)
  pinia = undefined
  localStorage.clear()
})

describe('useStageItemPruning', () => {
  it('strips assets that another window removed from the loaded model and from stored models', async () => {
    pinia = createPinia()
    const expressions = useExpressionStore(pinia)
    const library = useStageItemLibraryStore(pinia)
    await library.load()
    scope.run(() => useStageItemPruning())

    expressions.registerDefinitions('loaded', [{ id: 'smile', name: 'smile', parameters: [{ id: 'ParamMouthForm', value: 1, blend: 'Add' }] }])
    const hat = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: 'asset-hat', label: 'Hat', kind: 'prop', mappings: [], placement } }) as string
    const book = expressions.applySettingsCommand({ type: 'create-item', item: { assetId: 'asset-book', label: 'Book', kind: 'prop', mappings: [], placement } }) as string
    expressions.setAvailableItemAssets(new Set(['asset-hat', 'asset-book']))
    expressions.activate(hat)
    expressions.saveDefaults()
    localStorage.setItem('expression-catalog:stored', JSON.stringify({ version: 1, overrides: [], items: [{ id: 'item:stored-hat', assetId: 'asset-hat', label: 'Hat', kind: 'prop', mappings: [], exposedToLlm: false, placement, hides: [], link: 'none' }] }))
    localStorage.setItem('expression-rest:stored', JSON.stringify({ version: 1, active: ['item:stored-hat'] }))

    // The library reports a removal from another window after it reloads; pruning subscribed first, so it ran by then.
    const reported = new Promise<readonly string[]>(resolve => library.onAssetsRemoved(resolve))
    const otherWindow = new BroadcastChannel('airi:stage-item-library')
    otherWindow.postMessage({ removed: ['asset-hat'] })
    otherWindow.close()
    expect(await reported).toEqual(['asset-hat'])

    expect(JSON.parse(localStorage.getItem('expression-catalog:loaded')!).items.map((item: { id: string }) => item.id)).toEqual([book])
    expect(JSON.parse(localStorage.getItem('expression-rest:loaded')!).active).toEqual([])
    expect(expressions.itemTargets).toEqual([])
    expect(JSON.parse(localStorage.getItem('expression-catalog:stored')!).items).toEqual([])
    expect(JSON.parse(localStorage.getItem('expression-rest:stored')!).active).toEqual([])
  })
})
