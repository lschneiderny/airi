import type { ItemExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Pinia } from 'pinia'

import type { ExpressionPanelEntry, ExpressionPanelItem, ExpressionPanelSnapshot } from './source'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import { storage } from '../../../../../database/storage'
import { useStageItemLibraryStore } from '../../../../../stores/stage-item-library'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en } })
}

const { t } = createTestI18n().global
const s = (key: string, values: Record<string, unknown> = {}) => t(`settings.live2d.expressions.items.${key}`, values)

const canvas = { width: 1200, height: 1800 }
const pinias: Pinia[] = []

async function png(name: string, width: number, height: number): Promise<File> {
  const surface = new OffscreenCanvas(width, height)
  const context = surface.getContext('2d')!
  context.fillStyle = '#3080ff'
  context.fillRect(0, 0, width, height)
  return new File([await surface.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' })
}

function textFile(name: string): File {
  return new File(['not an image'], name, { type: 'text/plain' })
}

function snapshot(overrides: Partial<ExpressionPanelSnapshot> = {}): ExpressionPanelSnapshot {
  return { entries: [], groups: [], activeIds: [], restIds: [], items: [], canvas, ...overrides }
}

function itemDocument(overrides: Partial<ItemExpressionDocument> & Pick<ItemExpressionDocument, 'id' | 'assetId'>): ItemExpressionDocument {
  return {
    label: 'Hat',
    kind: 'prop',
    mappings: [],
    exposedToLlm: false,
    placement: { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' } },
    hides: [],
    link: 'none',
    ...overrides,
  }
}

function itemEntry(document: ItemExpressionDocument, overrides: Partial<ExpressionPanelEntry> = {}): ExpressionPanelEntry {
  return {
    id: document.id,
    label: document.label,
    name: document.label,
    kind: document.kind,
    area: document.kind === 'outfit' ? 'outfit-hair' : 'props',
    group: null,
    confirmed: true,
    exposedToLlm: document.exposedToLlm,
    mappings: [],
    fileName: '',
    parameterIds: [],
    active: true,
    effective: true,
    overriddenBy: null,
    via: [],
    isDefault: false,
    ...overrides,
  }
}

async function renderStageItems(snapshotValue: ExpressionPanelSnapshot) {
  const { default: StageItems } = await import('./stage-items.vue')
  await import('virtual:uno.css')
  const pinia = createPinia()
  pinias.push(pinia)
  const onCommand = vi.fn()
  const screen = await render(StageItems, {
    props: { snapshot: snapshotValue, onCommand },
    global: { plugins: [pinia, createTestI18n()] },
  })
  return { screen, onCommand, pinia }
}

async function renderAreas(entries: ExpressionPanelEntry[], items: ExpressionPanelItem[]) {
  const { default: Areas } = await import('./areas.vue')
  await import('virtual:uno.css')
  const pinia = createPinia()
  pinias.push(pinia)
  const onCommand = vi.fn()
  const screen = await render(Areas, {
    props: { snapshot: snapshot({ entries, items, supportsIdleUse: true }), search: '', showAll: true, onCommand },
    global: { plugins: [pinia, createTestI18n()] },
  })
  return { screen, onCommand }
}

describe('stage items in the expressions panel', () => {
  beforeAll(async () => {
    await Promise.all([import('./stage-items.vue'), import('./areas.vue'), import('virtual:uno.css')])
    for (const key of ['title', 'import', 'library-empty', 'add', 'add-no-canvas', 'remove', 'remove-confirm', 'remove-confirm-unused', 'confirm', 'cancel', 'refused', 'refusals.unsupported-type', 'states.missing-asset', 'states.reattached', 'delete', 'system-off-hint'])
      expect(s(key)).not.toBe(`settings.live2d.expressions.items.${key}`)
  }, 60_000)

  beforeEach(async () => {
    await storage.clear('stage-items')
    for (const key of ['expression-catalog:items-a', 'expression-catalog:items-b'])
      localStorage.removeItem(key)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    for (const pinia of pinias.splice(0))
      disposePinia(pinia)
  })

  it('imports the good file of a batch and names each refused file with its reason', async () => {
    const { screen } = await renderStageItems(snapshot())
    await expect.element(screen.getByText(s('library-empty'), { exact: true })).toBeVisible()
    await screen.getByLabelText(s('import'), { exact: true }).upload([await png('hat.png', 64, 64), textFile('notes.txt')])
    const refusals = screen.getByTestId('stage-items-refusals')
    await expect.element(refusals).toHaveTextContent(s('refused', { name: 'notes.txt', reason: s('refusals.unsupported-type') }))
    expect(refusals.element().querySelectorAll('li')).toHaveLength(1)
    await expect.element(screen.getByRole('listitem').filter({ hasText: 'hat.png' })).toBeVisible()
    await expect.element(screen.getByRole('listitem').filter({ hasText: 'hat.png' })).toHaveTextContent(s('size', { width: 64, height: 64 }))
    await expect.element(screen.getByRole('img', { name: 'hat.png' })).toBeVisible()
  })

  it('shows an oversize image refusal and renders a script-like file name as plain text', async () => {
    const { screen } = await renderStageItems(snapshot())
    const name = '<b onload="x">tag.png</b>'
    await screen.getByLabelText(s('import'), { exact: true }).upload([await png(name, 5000, 8), await png('ok.png', 8, 8)])
    await expect.element(screen.getByTestId('stage-items-refusals')).toHaveTextContent(s('refused', { name, reason: s('refusals.too-large') }))
    expect(screen.container.querySelector('b')).toBeNull()
    const okRow = screen.getByRole('listitem').filter({ hasText: 'ok.png' })
    await expect.element(okRow).toBeVisible()
    await screen.getByLabelText(s('import'), { exact: true }).upload(await png('<script>alert(1)</script>.png', 8, 8))
    await expect.element(screen.getByRole('listitem').filter({ hasText: '<script>alert(1)</script>.png' })).toBeVisible()
    expect(screen.container.querySelector('script')).toBeNull()
  })

  it('adds a library asset to the model as a prop in front, centered, one third of her canvas wide, hidden from the chat model', async () => {
    const { screen, onCommand, pinia } = await renderStageItems(snapshot())
    const library = useStageItemLibraryStore(pinia)
    const [result] = await library.importFiles([await png('hat.png', 300, 150)])
    if (!result.ok)
      throw new Error(`import refused: ${result.reason}`)
    await screen.getByRole('button', { name: `${s('add')}: hat.png`, exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{
      type: 'create-item',
      item: {
        assetId: result.asset.id,
        label: 'hat',
        kind: 'prop',
        mappings: [],
        placement: { x: 600, y: 900, rotation: 0, scale: 400 / 300, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' } },
      },
    }]])
    // `exposedToLlm` is left to the store's default, which is off.
    expect(onCommand.mock.calls[0][0].item).not.toHaveProperty('exposedToLlm')
  })

  it('creates one object URL per thumbnail across overlapping library updates and revokes every one on unmount', async () => {
    const { screen, pinia } = await renderStageItems(snapshot())
    const library = useStageItemLibraryStore(pinia)
    const created = vi.spyOn(URL, 'createObjectURL')
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    // The first asset's blob read stays open until the second asset has arrived, so the watch runs again mid-flight.
    const blobOf = library.blobOf
    let releaseFirst = () => {}
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const reads = vi.spyOn(library, 'blobOf').mockImplementation(async (id) => {
      if (reads.mock.calls.length === 1)
        await firstRead
      return blobOf(id)
    })
    await library.importFiles([await png('first.png', 8, 8)])
    await expect.element(screen.getByRole('listitem').filter({ hasText: 'first.png' })).toBeVisible()
    await library.importFiles([await png('second.png', 8, 8)])
    await expect.element(screen.getByRole('img', { name: 'second.png' })).toBeVisible()
    expect(screen.getByRole('img').all()).toHaveLength(1)
    releaseFirst()
    await expect.element(screen.getByRole('img', { name: 'first.png' })).toBeVisible()
    expect(reads).toHaveBeenCalledTimes(2)
    expect(created).toHaveBeenCalledTimes(2)
    expect(revoked).not.toHaveBeenCalled()
    const live = screen.getByRole('img').all().map(img => img.element().getAttribute('src'))
    expect(new Set(live).size).toBe(2)
    expect(created.mock.results.map(result => result.value).sort()).toEqual([...live].sort())

    screen.unmount()
    expect(revoked.mock.calls.map(call => call[0]).sort()).toEqual([...live].sort())
  })

  it('offers no Add while her canvas is unknown', async () => {
    const { screen, pinia } = await renderStageItems(snapshot({ canvas: undefined }))
    await useStageItemLibraryStore(pinia).importFiles([await png('hat.png', 8, 8)])
    await expect.element(screen.getByRole('button', { name: `${s('add')}: hat.png`, exact: true })).toBeDisabled()
    await expect.element(screen.getByRole('note')).toHaveTextContent(s('add-no-canvas'))
  })

  it('asks before removing, names how many models place the asset, and drops the row on confirm', async () => {
    const { screen, pinia } = await renderStageItems(snapshot())
    const library = useStageItemLibraryStore(pinia)
    const [result] = await library.importFiles([await png('hat.png', 8, 8)])
    if (!result.ok)
      throw new Error(`import refused: ${result.reason}`)
    for (const modelId of ['items-a', 'items-b'])
      localStorage.setItem(`expression-catalog:${modelId}`, JSON.stringify({ version: 1, overrides: [], items: [itemDocument({ id: `item:${modelId}`, assetId: result.asset.id })] }))

    await screen.getByRole('button', { name: s('remove', { name: 'hat.png' }), exact: true }).click()
    await expect.element(screen.getByRole('status')).toHaveTextContent(s('remove-confirm', { name: 'hat.png', count: 2 }))
    await screen.getByRole('button', { name: s('cancel'), exact: true }).click()
    await expect.element(screen.getByRole('listitem').filter({ hasText: 'hat.png' })).toBeVisible()

    await screen.getByRole('button', { name: s('remove', { name: 'hat.png' }), exact: true }).click()
    await screen.getByRole('button', { name: s('confirm'), exact: true }).click()
    await expect.element(screen.getByText(s('library-empty'), { exact: true })).toBeVisible()
    expect(library.assets).toEqual([])
  })

  it('edits an item entry with item kinds only, hides the chat-model switch for an outfit, and deletes through delete-item', async () => {
    const hat = itemDocument({ id: 'item:hat', assetId: 'asset-hat' })
    const coat = itemDocument({ id: 'item:coat', assetId: 'asset-coat', label: 'Coat', kind: 'outfit' })
    const { screen, onCommand } = await renderAreas(
      [itemEntry(hat), itemEntry(coat)],
      [{ document: hat, available: true, shown: true, state: 'reattached' }, { document: coat, available: false, shown: false, state: null }],
    )
    const llm = (label: string) => `${t('settings.live2d.expressions.llm-exposed')}: ${label}`
    await expect.element(screen.getByRole('switch', { name: llm('Hat'), exact: true })).toBeVisible()
    expect(screen.container.querySelector(`[aria-label="${llm('Coat')}"]`)).toBeNull()
    expect(screen.getByTestId('item-state').all().map(badge => badge.element().textContent).sort()).toEqual([s('states.missing-asset'), s('states.reattached')].sort())

    await screen.getByRole('switch', { name: llm('Hat'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-item', id: 'item:hat', patch: { exposedToLlm: true } })

    const hatRow = screen.getByRole('listitem').filter({ hasText: 'Hat' })
    await hatRow.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await expect.element(hatRow.getByText(s('llm-exposed-description'), { exact: true })).toBeVisible()
    expect(hatRow.element().textContent).not.toContain(t('settings.live2d.expressions.fields.group'))
    // Kind is the editor's first picker; Area follows it, and items get no choose-one set.
    await hatRow.getByRole('combobox').first().click()
    expect(page.getByRole('option').all()).toHaveLength(3)
    for (const kind of ['prop', 'effect', 'outfit'])
      await expect.element(page.getByRole('option', { name: t(`settings.live2d.expressions.kinds.${kind}`), exact: true })).toBeVisible()
    expect(page.getByRole('option', { name: t('settings.live2d.expressions.kinds.face'), exact: true }).all()).toHaveLength(0)
    await page.getByRole('option', { name: t('settings.live2d.expressions.kinds.effect'), exact: true }).click()
    await hatRow.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-item', id: 'item:hat', patch: { label: 'Hat', kind: 'effect', mappings: [] } })

    await hatRow.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await hatRow.getByRole('button', { name: s('delete'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'delete-item', id: 'item:hat' })
    expect(onCommand).toHaveBeenCalledTimes(3)
  })
})
