import type { ItemExpressionDocument } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DItemEditor } from '@proj-airi/stage-ui-live2d/composables/live2d/items/editor'

import type { StageItemAsset } from '../../../../../database/repos/stage-items.repo'
import type { ExpressionPanelItem, ExpressionPanelItemCommand } from './source'

import en from '@proj-airi/i18n/locales/en'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, reactive } from 'vue'
import { createI18n } from 'vue-i18n'

import ItemPlacement from './item-placement.vue'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en } })
const { t } = i18n.global
const s = (key: string, values: Record<string, unknown> = {}) => t(`settings.live2d.expressions.items.placement.${key}`, values)

const herCanvas = { width: 400, height: 400 }
/** The only mesh of the stub model: a head box; a point outside it is empty canvas. */
const head = { left: 100, top: 50, right: 300, bottom: 250 }

function hatDocument(): ItemExpressionDocument {
  return {
    id: 'item:hat',
    assetId: 'asset-hat',
    label: 'Hat',
    kind: 'prop',
    mappings: [],
    exposedToLlm: false,
    placement: { x: 200, y: 200, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' } },
    hides: [],
    link: 'none',
  }
}

function imageAsset(): StageItemAsset {
  return { id: 'asset-hat', name: 'hat.png', format: 'image', mime: 'image/png', width: 100, height: 100, importedAt: 0 }
}

function live2dAsset(): StageItemAsset {
  return { id: 'asset-hat', name: 'coat.zip', format: 'live2d-zip', mime: 'application/zip', width: 200, height: 300, canvas: { width: 200, height: 300 }, importedAt: 0 }
}

/** Canvas units map one to one onto the overlay's CSS pixels, so a drag of n pixels reads as n units. */
function stubEditor(): Live2DItemEditor {
  return {
    canvas: herCanvas,
    parts: [
      { id: 'PartBody', name: 'Body', parentId: null, depth: 0 },
      { id: 'PartHead', name: 'Head', parentId: 'PartBody', depth: 1 },
    ],
    drawables: [{ id: 'ArtBody', partId: 'PartBody' }, { id: 'ArtHead', partId: 'PartHead' }],
    pickPin: (point) => {
      if (point.x < head.left || point.x > head.right || point.y < head.top || point.y > head.bottom)
        return undefined
      return { drawableId: 'ArtHead', vertices: [0, 1, 2], weights: [1, 0, 0], reference: [0, 0, 1, 0, 0, 1], vertexCount: 3, modelPoint: { x: point.x, y: point.y } }
    },
    canvasToView: point => ({ ...point }),
    viewToCanvas: point => ({ ...point }),
    poseOf: () => undefined,
  }
}

function renderEditor(options: { asset?: StageItemAsset, enabled?: boolean, refusal?: 'item-limit' | null, editor?: Live2DItemEditor | undefined } = {}) {
  const onCommand = vi.fn<(command: ExpressionPanelItemCommand) => void>()
  const onDraft = vi.fn<(document: ItemExpressionDocument) => void>()
  const onClose = vi.fn()
  // Reactive, as the runtime snapshot the Live2D section passes is; the editor must clone through the proxy.
  const item = reactive<ExpressionPanelItem>({ document: hatDocument(), available: true, shown: true, state: 'attached' })
  const editor = 'editor' in options ? options.editor : stubEditor()
  const screen = render(defineComponent({
    render: () => h('div', { style: 'width: 480px; padding: 8px' }, [
      h(ItemPlacement, {
        item,
        asset: options.asset ?? imageAsset(),
        editorSource: () => editor,
        enabled: options.enabled ?? true,
        refusal: options.refusal ?? null,
        onCommand,
        onDraft,
        onClose,
      }, () => h('div', { 'data-testid': 'fake-preview', 'style': 'width: 100%; height: 100%; background: #eee' })),
    ]),
  }), { global: { plugins: [i18n] } })
  return { screen, onCommand, onDraft, onClose }
}

function updates(onCommand: ReturnType<typeof vi.fn<(command: ExpressionPanelItemCommand) => void>>) {
  return onCommand.mock.calls.map(([command]) => command).filter(command => command.type === 'update-item')
}

/** The last `update-item`, which must also survive the settings runtime channel: no reactive proxy inside. */
async function waitForUpdate(onCommand: ReturnType<typeof vi.fn<(command: ExpressionPanelItemCommand) => void>>, count = 1) {
  await vi.waitFor(() => expect(updates(onCommand).length).toBeGreaterThanOrEqual(count))
  const last = updates(onCommand).at(-1)!
  expect(() => structuredClone(last)).not.toThrow()
  return last
}

describe('item placement editor', () => {
  beforeAll(async () => {
    await import('virtual:uno.css')
    for (const key of ['title', 'done', 'hint', 'pin.click', 'pin.no-mesh', 'hides.title', 'link.align', 'refused-limit', 'fields.rotation'])
      expect(s(key)).not.toBe(`settings.live2d.expressions.items.placement.${key}`)
  }, 60_000)

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('moves the item by the dragged distance in canvas units, one update per frame', async () => {
    const { screen, onCommand } = renderEditor()
    await vi.waitFor(() => expect(screen.container.querySelector('polygon')?.getAttribute('points')).toContain('150,150'))
    const polygon = screen.container.querySelector('polygon')!
    const box = polygon.getBoundingClientRect()
    const target = document.createElement('div')
    target.dataset.testid = 'drop-target'
    target.style.cssText = `position: fixed; width: 2px; height: 2px; left: ${box.left + box.width / 2 + 9}px; top: ${box.top + box.height / 2 + 9}px`
    document.body.append(target)
    try {
      await userEvent.dragAndDrop(page.elementLocator(polygon), page.getByTestId('drop-target'))
    }
    finally {
      target.remove()
    }
    const last = await waitForUpdate(onCommand)
    expect(last.type).toBe('update-item')
    if (last.type !== 'update-item' || !last.patch.placement)
      throw new Error('expected a placement update')
    expect(last.patch.placement.x).toBeCloseTo(210, 0)
    expect(last.patch.placement.y).toBeCloseTo(210, 0)
    expect(last.id).toBe('item:hat')
    // Several pointer moves land in one drag, yet the queue sends at most one patch per animation frame.
    expect(updates(onCommand).length).toBeLessThanOrEqual(4)
  })

  it('stores a typed rotation in radians and keeps the placement for an unusable number', async () => {
    const { screen, onCommand } = renderEditor()
    const rotation = screen.getByRole('textbox', { name: s('fields.rotation'), exact: true })
    await rotation.fill('90')
    await userEvent.keyboard('{Enter}')
    const turned = await waitForUpdate(onCommand)
    if (turned.type !== 'update-item' || !turned.patch.placement)
      throw new Error('expected a placement update')
    expect(turned.patch.placement.rotation).toBeCloseTo(Math.PI / 2)

    const scale = screen.getByRole('textbox', { name: s('fields.scale'), exact: true })
    await scale.fill('-1')
    await userEvent.keyboard('{Enter}')
    await expect.element(scale).toHaveValue('1.000')
    expect(updates(onCommand)).toHaveLength(1)
  })

  it('pins at a click on her mesh, says so over empty canvas, and unpins where the item draws', async () => {
    const { screen, onCommand } = renderEditor()
    const preview = screen.getByTestId('placement-preview')
    await screen.getByRole('button', { name: s('pin.click'), exact: true }).click()
    await expect.element(screen.getByRole('status').filter({ hasText: s('pin.picking') })).toBeVisible()
    await preview.click({ position: { x: 20, y: 380 } })
    await expect.element(screen.getByTestId('placement-no-mesh')).toHaveTextContent(s('pin.no-mesh'))
    expect(updates(onCommand)).toHaveLength(0)
    await expect.element(screen.getByTestId('placement-pin-state')).toHaveTextContent(s('pin.unpinned'))

    // The click lands on the item's own frame, which must let it through to the mesh while pinning.
    await screen.getByRole('button', { name: s('pin.click'), exact: true }).click()
    await preview.click({ position: { x: 200, y: 200 } })
    const pinned = await waitForUpdate(onCommand)
    if (pinned.type !== 'update-item' || !pinned.patch.placement?.pin)
      throw new Error('expected a pinned placement')
    expect(pinned.patch.placement.pin.drawableId).toBe('ArtHead')
    expect(pinned.patch.placement.pin.modelPoint).toEqual({ x: 200, y: 200 })
    await expect.element(screen.getByTestId('placement-pin-state')).toHaveTextContent(s('pin.pinned', { drawable: 'ArtHead' }))

    await screen.getByRole('button', { name: s('pin.unpin'), exact: true }).click()
    const released = await waitForUpdate(onCommand, 2)
    if (released.type !== 'update-item' || !released.patch.placement)
      throw new Error('expected a placement update')
    expect(released.patch.placement).not.toHaveProperty('pin')
    expect(released.patch.placement.x).toBe(200)
  })

  it('hides a checked part and aligns a Live2D item to her canvas', async () => {
    const { screen, onCommand, onDraft } = renderEditor({ asset: live2dAsset() })
    await screen.getByRole('button', { name: s('hides.title') }).click()
    await screen.getByTestId('placement-hides').getByRole('switch', { name: 'Head', exact: true }).click()
    const hidden = await waitForUpdate(onCommand)
    expect(hidden).toEqual({ type: 'update-item', id: 'item:hat', patch: { hides: ['PartHead'] } })

    await screen.getByRole('button', { name: s('link.align'), exact: true }).click()
    const aligned = await waitForUpdate(onCommand, 2)
    if (aligned.type !== 'update-item')
      throw new Error('expected an update')
    expect(aligned.patch.placement).toEqual({ x: 200, y: 200, rotation: 0, scale: 2, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' } })
    // The draft the preview draws carries both edits.
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({ hides: ['PartHead'], placement: { scale: 2 } })

    await screen.getByRole('switch', { name: s('link.title'), exact: true }).click()
    const linked = await waitForUpdate(onCommand, 3)
    expect(linked).toEqual({ type: 'update-item', id: 'item:hat', patch: { link: 'parameters' } })
  })

  it('shows the cap refusal and disables every control without a runtime', async () => {
    const refused = renderEditor({ refusal: 'item-limit' })
    await expect.element(refused.screen.getByTestId('placement-refusal')).toHaveTextContent(s('refused-limit'))
    cleanup()

    const { screen, onCommand } = renderEditor({ enabled: false })
    await expect.element(screen.getByText(s('no-runtime'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: s('pin.click'), exact: true })).toBeDisabled()
    await expect.element(screen.getByRole('textbox', { name: s('fields.x'), exact: true })).toBeDisabled()
    expect(screen.container.querySelector('polygon')).toBeNull()
    expect(onCommand).not.toHaveBeenCalled()
  })
})
