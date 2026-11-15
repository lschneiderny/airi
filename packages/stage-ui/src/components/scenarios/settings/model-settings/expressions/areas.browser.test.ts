import type { CatalogEntry, TagSuggestion } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionPanelEntry, ExpressionPanelFreeParameter } from './source'

import en from '@proj-airi/i18n/locales/en'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  })
}

const { t } = createTestI18n().global

type ExpressionEntry = ExpressionPanelEntry
type FreeParameter = ExpressionPanelFreeParameter

function expressionEntry(overrides: Partial<ExpressionEntry> & Pick<ExpressionEntry, 'id' | 'label'>): ExpressionEntry {
  return {
    name: overrides.label,
    kind: 'face',
    group: null,
    confirmed: true,
    exposedToLlm: false,
    mappings: [],
    fileName: `${overrides.id}.exp3.json`,
    parameterIds: [],
    active: false,
    effective: overrides.active ?? false,
    overriddenBy: null,
    via: [],
    usesOverwrite: false,
    isDefault: false,
    ...overrides,
  }
}

/**
 * ForBOOTH-shaped fixture: eyes, mouth, cheeks, outfit & hair, four unsorted entries, one duplicate folded into its primary.
 * Like the store snapshot, `overriddenBy` carries the overriding entry's label, not its id.
 */
function boothEntries(): ExpressionEntry[] {
  return [
    expressionEntry({ id: 'eyes-closed', label: 'Eyes closed', area: 'eyes', active: true }),
    expressionEntry({ id: 'eyes-sparkle', label: 'Eyes sparkle', area: 'eyes', mappings: [{ emotion: 'love', weight: 1, minBand: 'clear' }] }),
    expressionEntry({ id: 'mouth-open', label: 'Mouth open', area: 'mouth', aliases: ['mouth-open-copy'], mappings: [{ emotion: 'surprised', weight: 1, minBand: 'clear' }] }),
    expressionEntry({ id: 'mouth-open-copy', label: 'Mouth open copy', area: 'mouth', duplicateOf: 'mouth-open' }),
    expressionEntry({ id: 'blush', label: 'Blush', area: 'cheeks', mappings: [{ emotion: 'flustered', weight: 1, minBand: 'clear' }], overriddenBy: 'Pale' }),
    expressionEntry({ id: 'pale', label: 'Pale', area: 'cheeks', active: true }),
    expressionEntry({ id: 'hair-black', label: 'Black braids', kind: 'outfit', area: 'outfit-hair', group: 'Hair', active: true }),
    expressionEntry({ id: 'hair-white', label: 'White ponytail', kind: 'outfit', area: 'outfit-hair', group: 'Hair' }),
    expressionEntry({ id: 'look', label: 'Festival look', kind: 'combo', area: 'whole-look', members: [{ expressionId: 'blush', strength: 1 }], active: true }),
    expressionEntry({ id: 'exp7', label: 'exp7', kind: 'unsorted', area: 'hidden' }),
    expressionEntry({ id: 'exp8', label: 'exp8', kind: 'unsorted', area: 'hidden' }),
    expressionEntry({ id: 'exp9', label: 'exp9', kind: 'unsorted', area: 'hidden' }),
    expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'unsorted', area: 'hidden' }),
  ]
}

const freeParameters: FreeParameter[] = [
  { id: 'ParamTail', name: 'Tail wag', min: 0, max: 30, default: 0 },
  { id: 'ParamHat', name: 'ParamHat', min: -1, max: 1, default: 0 },
]

async function renderAreas(entries: ExpressionEntry[], options: { freeParameters?: FreeParameter[], showAll?: boolean, supportsIdleUse?: boolean, suggest?: (entries: readonly CatalogEntry[], signal: AbortSignal) => Promise<TagSuggestion[]> } = {}) {
  const { default: Areas } = await import('./areas.vue')
  await import('virtual:uno.css')
  const onCommand = vi.fn()
  const screen = await render(Areas, {
    props: {
      snapshot: { entries, groups: [], activeIds: [], restIds: [], freeParameters: options.freeParameters ?? [], ...options.supportsIdleUse ? { supportsIdleUse: true } : {} },
      search: '',
      showAll: options.showAll ?? false,
      suggest: options.suggest,
      onCommand,
    },
    global: { plugins: [createPinia(), createTestI18n()] },
  })
  return { screen, onCommand }
}

function area(key: string) {
  return t(`settings.live2d.expressions.areas.${key}`)
}

/** The area heading button and the list that follows it, so rows can be asserted inside their section. */
function sectionOf(screen: { getByRole: typeof page.getByRole }, key: string) {
  const heading = screen.getByRole('button', { name: new RegExp(`^${area(key)}\\b`) }).element()
  const container = heading.parentElement
  if (!container)
    throw new Error(`the ${key} heading has no section container`)
  return page.elementLocator(container)
}

describe('live2D expression areas', () => {
  beforeAll(async () => {
    await Promise.all([
      import('./areas.vue'),
      import('virtual:uno.css'),
    ])
    for (const key of ['areas.title', 'areas.eyes', 'areas.mouth', 'areas.cheeks', 'areas.outfit-hair', 'areas.unsorted', 'areas.unsorted-description', 'duplicates.also', 'duplicates.keep-separate', 'overridden-by', 'custom.add', 'custom.parameter', 'custom.value', 'custom.label', 'custom.create', 'custom.none-free', 'custom.delete', 'fields.area', 'fields.kind', 'kinds.unsorted', 'group-select', 'group-none', 'fields.group'])
      expect(t(`settings.live2d.expressions.${key}`)).not.toBe(`settings.live2d.expressions.${key}`)
  }, 60_000)

  afterEach(() => {
    cleanup()
  })

  it('lands single rows in their area sections and skips combos and empty areas', async () => {
    const { screen } = await renderAreas(boothEntries(), { showAll: true })
    await expect.element(sectionOf(screen, 'eyes').getByText('Eyes closed', { exact: true })).toBeVisible()
    await expect.element(sectionOf(screen, 'eyes').getByText('Eyes sparkle', { exact: true })).toBeVisible()
    await expect.element(sectionOf(screen, 'mouth').getByText('Mouth open', { exact: true })).toBeVisible()
    await expect.element(sectionOf(screen, 'cheeks').getByText('Blush', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Festival look', { exact: true })).not.toBeInTheDocument()
    for (const key of ['whole-look', 'effects', 'props', 'hidden'])
      await expect.element(screen.getByRole('button', { name: new RegExp(`^${area(key)}\\b`) })).not.toBeInTheDocument()
  })

  it('renders a custom outfit from the real store inside Outfit & hair, not Whole looks', async () => {
    const pinia = createPinia()
    const store = useExpressionStore(pinia)
    localStorage.removeItem('expression-catalog:custom-area')
    const params = [{ id: 'Param7', name: 'Earphones', min: -1, max: 2, default: 0.5 }]
    store.registerDefinitions('custom-area', [], [], undefined, undefined, params, params)
    store.applySettingsCommand({ type: 'create-custom', custom: { label: 'Earphones', parameterId: 'Param7', target: 1 } })
    store.applySettingsCommand({ type: 'update-custom', id: store.catalog.at(-1)!.id, patch: { kind: 'outfit', exposedToLlm: false } })
    const { default: Areas } = await import('./areas.vue')
    await import('virtual:uno.css')
    const screen = await render(Areas, {
      props: { snapshot: store.settingsSnapshot, search: '', showAll: true, onCommand: vi.fn() },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await expect.element(sectionOf(screen, 'outfit-hair').getByText('Earphones', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: new RegExp(`^${area('whole-look')}\\b`) })).not.toBeInTheDocument()
    localStorage.removeItem('expression-catalog:custom-area')
  })

  it('renders a choose-one row inside its area', async () => {
    const { screen } = await renderAreas(boothEntries())
    const outfit = sectionOf(screen, 'outfit-hair')
    await expect.element(outfit.getByText('Black braids / White ponytail', { exact: true })).toBeVisible()
    await expect.element(outfit.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') })).toHaveTextContent('Black braids')
    await expect.element(sectionOf(screen, 'eyes').getByText('Black braids / White ponytail', { exact: true })).not.toBeInTheDocument()
  })

  it('shows Unsorted with its count, assigns a kind through the select, and opens the row editor', async () => {
    const { screen, onCommand } = await renderAreas(boothEntries())
    // Every unsorted kind picker also reads "Unsorted", so the section is found through its description.
    const unsorted = screen.getByText(t('settings.live2d.expressions.areas.unsorted-description'), { exact: true }).element().closest('section')
    if (!unsorted)
      throw new Error('the Unsorted description is not inside a section')
    const section = page.elementLocator(unsorted)
    await expect.element(section.getByText(area('unsorted'), { exact: true }).first()).toBeVisible()
    await expect.element(section.getByText('4', { exact: true })).toBeVisible()
    for (const label of ['exp7', 'exp8', 'exp9', 'Tail'])
      await expect.element(section.getByText(label, { exact: true })).toBeVisible()

    const kindName = (label: string) => `${t('settings.live2d.expressions.fields.kind')}: ${label}`
    await section.getByRole('combobox', { name: kindName('exp7') }).click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.kinds.face'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-entry', id: 'exp7', patch: { kind: 'face', exposedToLlm: true } })
    await expect.element(section.getByRole('button', { name: t('settings.live2d.expressions.close-editor'), exact: true })).toBeVisible()
    await expect.element(section.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true })).toHaveValue('exp7')

    await section.getByRole('combobox', { name: kindName('exp8') }).click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.kinds.outfit'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-entry', id: 'exp8', patch: { kind: 'outfit', exposedToLlm: false } })

    await section.getByRole('combobox', { name: kindName('Tail') }).click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.kinds.prop'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-custom', id: 'custom:ParamTail', patch: { kind: 'prop', exposedToLlm: true } })
    expect(onCommand).toHaveBeenCalledTimes(3)
  })

  it('hides duplicates behind their primary, lists them as Also, and keeps one separate on request', async () => {
    // showAll keeps the in-use filter out of the way: only duplicate folding can hide the idle, unmapped copy.
    const { screen, onCommand } = await renderAreas(boothEntries(), { showAll: true })
    await expect.element(sectionOf(screen, 'mouth').getByText('Mouth open', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Mouth open copy', { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText(t('settings.live2d.expressions.duplicates.also', { labels: 'Mouth open copy' }), { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.duplicates.keep-separate', { label: 'Mouth open copy' }), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{ type: 'update-entry', id: 'mouth-open-copy', patch: { keepSeparate: true } }]])
  })

  it('tells which active entry hides an overridden one', async () => {
    const { screen } = await renderAreas(boothEntries())
    await expect.element(screen.getByText(t('settings.live2d.expressions.overridden-by', { label: 'Pale' }), { exact: true })).toBeVisible()
  })

  it('sends the chosen area with the applied patch', async () => {
    const { screen, onCommand } = await renderAreas([expressionEntry({ id: 'blush', label: 'Blush', area: 'cheeks', active: true })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    // The field label and its Select share one container, so the picker is found through that container.
    const areaField = screen.getByText(t('settings.live2d.expressions.fields.area'), { exact: true }).element().parentElement
    if (!areaField)
      throw new Error('the area label has no field container')
    await page.elementLocator(areaField).getByRole('combobox').click()
    await page.getByRole('option', { name: area('eyes'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'blush',
      patch: { label: 'Blush', kind: 'face', group: null, confirmed: true, inverted: false, mappings: [], area: 'eyes' },
    })
  })

  it('offers the on-her-own choice only when the renderer supports it, and sends a changed choice', async () => {
    const game = expressionEntry({ id: 'game', label: 'Game', kind: 'prop', area: 'props', active: true })
    const plain = await renderAreas([game])
    await plain.screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await expect.element(plain.screen.getByText(t('settings.live2d.expressions.fields.area'), { exact: true })).toBeVisible()
    expect(plain.screen.container.textContent).not.toContain(t('settings.live2d.expressions.fields.idle-use'))
    cleanup()

    const { screen, onCommand } = await renderAreas([game, expressionEntry({ id: 'pillow', label: 'Pillow', kind: 'prop', area: 'props', idleUse: 'sleep' })], { supportsIdleUse: true, showAll: true })
    await expect.element(screen.getByText(t('settings.live2d.expressions.idle-use.tags.sleep'), { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).first().click()
    const field = screen.getByText(t('settings.live2d.expressions.fields.idle-use'), { exact: true }).element().parentElement
    if (!field)
      throw new Error('the on-her-own label has no field container')
    await page.elementLocator(field).getByRole('combobox').click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.idle-use.options.activity'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'game',
      patch: { label: 'Game', kind: 'prop', group: null, confirmed: true, inverted: false, mappings: [], idleUse: 'activity' },
    })
  })

  it('shows a pastime\'s occasions and which occasions the model covers, and sends a changed choice', async () => {
    const bread = expressionEntry({ id: 'bread', label: 'Bread', kind: 'prop', area: 'props', idleUse: 'activity', occasions: ['morning'] })
    const { screen, onCommand } = await renderAreas([bread], { supportsIdleUse: true, showAll: true })
    const occasion = (name: string) => t(`settings.live2d.expressions.occasions.options.${name}`)
    await expect.element(screen.getByText(`${t('settings.live2d.expressions.idle-use.tags.activity')}: ${occasion('morning')}`, { exact: true })).toBeVisible()
    const coverage = screen.getByTestId('expression-occasions-coverage')
    await expect.element(coverage).toHaveTextContent(`${occasion('morning')}: Bread`)
    await expect.element(coverage).toHaveTextContent(occasion('gaming'))

    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const occasions = screen.getByTestId('expression-occasions')
    await expect.element(occasions.getByRole('button', { name: occasion('morning'), exact: true })).toHaveAttribute('aria-pressed', 'true')
    await occasions.getByRole('button', { name: occasion('gaming'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'bread',
      patch: { label: 'Bread', kind: 'prop', group: null, confirmed: true, inverted: false, mappings: [], occasions: ['morning', 'gaming'] },
    })
  })

  it('tags an entry with moments whatever its on-her-own choice, and lists the moments the model covers', async () => {
    const wink = expressionEntry({ id: 'wink', label: 'Wink', area: 'eyes', moments: ['check-in'] })
    const { screen, onCommand } = await renderAreas([wink], { supportsIdleUse: true, showAll: true })
    const moment = (name: string) => t(`settings.live2d.expressions.moments.options.${name}`)
    await expect.element(screen.getByText(t('settings.live2d.expressions.moments.tag', { moments: moment('check-in') }), { exact: true })).toBeVisible()
    await expect.element(screen.getByTestId('expression-moments-coverage')).toHaveTextContent(`${moment('check-in')}: Wink`)

    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    // Occasions belong to a pastime, which this entry is not.
    expect(screen.container.querySelector('[data-testid="expression-occasions"]')).toBeNull()
    await screen.getByTestId('expression-moments').getByRole('button', { name: moment('poked'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'wink',
      patch: { label: 'Wink', kind: 'face', group: null, confirmed: true, inverted: false, mappings: [], moments: ['check-in', 'poked'] },
    })
  })

  it('shows the chat model\'s tag suggestions for review and applies only the ones left on', async () => {
    const bread = expressionEntry({ id: 'bread', label: 'Bread', kind: 'prop', area: 'props' })
    const game = expressionEntry({ id: 'game', label: 'Game', kind: 'prop', area: 'props', idleUse: 'activity' })
    const tail = expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'prop', area: 'props' })
    const suggest = vi.fn(async (): Promise<TagSuggestion[]> => [
      { id: 'bread', label: 'Bread', idleUse: 'activity', occasions: ['morning'], moments: [], reason: 'a slice of bread', replaces: false },
      { id: 'game', label: 'Game', idleUse: 'activity', occasions: ['gaming'], moments: [], reason: '', replaces: true },
      { id: 'custom:ParamTail', label: 'Tail', idleUse: 'never', occasions: [], moments: ['petted'], reason: '', replaces: false },
    ])
    const { screen, onCommand } = await renderAreas([bread, game, tail], { supportsIdleUse: true, showAll: true, suggest })
    const s = (key: string, values: Record<string, unknown> = {}) => t(`settings.live2d.expressions.suggestions.${key}`, values)
    // Nothing is asked until the user asks.
    expect(suggest).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: s('ask'), exact: true }).click()
    const panel = screen.getByTestId('expression-tag-suggestions')
    await expect.element(panel).toHaveTextContent('a slice of bread')
    expect(suggest).toHaveBeenCalledTimes(1)
    // A suggestion is only a proposal until it is applied.
    expect(onCommand).not.toHaveBeenCalled()
    await expect.element(panel.getByRole('switch', { name: s('accept', { label: 'Bread' }), exact: true })).toBeChecked()
    // The game already carries the user's choice, so its suggestion starts off.
    await expect.element(panel.getByRole('switch', { name: s('accept', { label: 'Game' }), exact: true })).not.toBeChecked()
    await expect.element(panel).toHaveTextContent(s('replaces'))

    await panel.getByRole('button', { name: s('apply', { count: 2 }), exact: true }).click()
    expect(onCommand.mock.calls.map(call => call[0])).toEqual([
      { type: 'update-entry', id: 'bread', patch: { idleUse: 'activity', occasions: ['morning'], moments: [] } },
      { type: 'update-custom', id: 'custom:ParamTail', patch: { idleUse: 'never', occasions: [], moments: ['petted'] } },
    ])
    await expect.element(screen.getByRole('button', { name: s('ask'), exact: true })).toBeVisible()
  })

  it('changes nothing when the suggestions are dismissed or the request fails', async () => {
    const bread = expressionEntry({ id: 'bread', label: 'Bread', kind: 'prop', area: 'props' })
    const suggest = vi.fn<(entries: readonly CatalogEntry[], signal: AbortSignal) => Promise<TagSuggestion[]>>()
    suggest.mockResolvedValueOnce([{ id: 'bread', label: 'Bread', idleUse: 'activity', occasions: [], moments: [], reason: '', replaces: false }])
    suggest.mockRejectedValueOnce(new Error('rate limited'))
    const { screen, onCommand } = await renderAreas([bread], { supportsIdleUse: true, showAll: true, suggest })
    const s = (key: string, values: Record<string, unknown> = {}) => t(`settings.live2d.expressions.suggestions.${key}`, values)
    await screen.getByRole('button', { name: s('ask'), exact: true }).click()
    await screen.getByRole('button', { name: s('dismiss'), exact: true }).click()
    await screen.getByRole('button', { name: s('ask'), exact: true }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent(s('failed', { error: 'rate limited' }))
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('routes a custom entry through update-custom and offers delete-custom', async () => {
    const { screen, onCommand } = await renderAreas([expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'prop', area: 'props', active: true })])
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Tail` })).toBeVisible()
    await screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Tail` }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-custom', id: 'custom:ParamTail', patch: { exposedToLlm: true } })

    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await expect.element(screen.getByText(t('settings.live2d.expressions.fields.group'), { exact: true })).not.toBeInTheDocument()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Tail wag')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'update-custom', id: 'custom:ParamTail', patch: { label: 'Tail wag', kind: 'prop', mappings: [] } })

    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.custom.delete'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'delete-custom', id: 'custom:ParamTail' })
    expect(onCommand).toHaveBeenCalledTimes(3)
  })

  it('sends no area when a custom is edited with the Area select untouched', async () => {
    const { screen, onCommand } = await renderAreas([expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'outfit', area: 'outfit-hair', active: true })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Tail wag')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{ type: 'update-custom', id: 'custom:ParamTail', patch: { label: 'Tail wag', kind: 'outfit', mappings: [] } }]])
  })

  it('moves a custom to its new kind section when Kind changes with the Area untouched', async () => {
    const pinia = createPinia()
    const store = useExpressionStore(pinia)
    localStorage.removeItem('expression-catalog:custom-kind-move')
    const params = [{ id: 'Param7', name: 'Earphones', min: -1, max: 2, default: 0.5 }]
    store.registerDefinitions('custom-kind-move', [], [], undefined, undefined, params, params)
    store.applySettingsCommand({ type: 'create-custom', custom: { label: 'Earphones face', parameterId: 'Param7', target: 1 } })
    const id = store.catalog.at(-1)!.id
    store.applySettingsCommand({ type: 'update-custom', id, patch: { kind: 'face' } })
    const onCommand = vi.fn((command: Parameters<typeof store.applySettingsCommand>[0]) => store.applySettingsCommand(command))
    const { default: Areas } = await import('./areas.vue')
    await import('virtual:uno.css')
    const screen = await render(Areas, {
      props: { snapshot: store.settingsSnapshot, search: '', showAll: true, onCommand },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await expect.element(sectionOf(screen, 'hidden').getByText('Earphones face', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('combobox').first().click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.kinds.outfit'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand.mock.calls[0][0]).toEqual({ type: 'update-custom', id, patch: { label: 'Earphones face', kind: 'outfit', mappings: [] } })
    expect(store.curated.customs?.[0].area).toBeUndefined()
    expect(store.settingsSnapshot.entries.find(entry => entry.id === id)).toMatchObject({ kind: 'outfit', area: 'outfit-hair' })
    localStorage.removeItem('expression-catalog:custom-kind-move')
  })

  it('sends area null when None is picked on a custom with a stored area', async () => {
    const { screen, onCommand } = await renderAreas([expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'prop', area: 'props', active: true })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const areaField = screen.getByText(t('settings.live2d.expressions.fields.area'), { exact: true }).element().parentElement
    if (!areaField)
      throw new Error('the area label has no field container')
    await page.elementLocator(areaField).getByRole('combobox').click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.areas.none'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{ type: 'update-custom', id: 'custom:ParamTail', patch: { label: 'Tail', kind: 'prop', mappings: [], area: null } }]])
  })

  it('creates a custom switch from a free parameter only', async () => {
    const { screen, onCommand } = await renderAreas(boothEntries(), { freeParameters })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.custom.add'), exact: true }).click()
    // The label wraps the input, so the accessible name also carries the current value.
    const parameter = screen.getByRole('combobox', { name: new RegExp(`^${t('settings.live2d.expressions.custom.parameter')}`) })
    await expect.element(parameter).toHaveValue('Tail wag (ParamTail)')
    await parameter.click()
    await expect.element(page.getByRole('option', { name: 'ParamHat', exact: true })).toBeVisible()
    await expect.element(page.getByRole('option', { name: /Eyes closed/ })).not.toBeInTheDocument()
    await page.getByRole('option', { name: 'ParamHat', exact: true }).click()
    await expect.element(screen.getByRole('textbox', { name: t('settings.live2d.expressions.custom.label'), exact: true })).toHaveValue('ParamHat')
    await expect.element(screen.getByText('1.00', { exact: true })).toBeVisible()

    const label = screen.getByRole('textbox', { name: t('settings.live2d.expressions.custom.label'), exact: true })
    await label.fill('')
    await expect.element(screen.getByText(t('settings.live2d.expressions.validation.label-required'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.custom.create'), exact: true })).toBeDisabled()
    await label.fill('Hat')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.custom.create'), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{ type: 'create-custom', custom: { label: 'Hat', parameterId: 'ParamHat', target: 1 } }]])
    await expect.element(screen.getByRole('textbox', { name: t('settings.live2d.expressions.custom.label'), exact: true })).not.toBeInTheDocument()
  })

  it('explains when no free parameter is left and disables create', async () => {
    const { screen } = await renderAreas(boothEntries())
    await screen.getByRole('button', { name: t('settings.live2d.expressions.custom.add'), exact: true }).click()
    await expect.element(screen.getByText(t('settings.live2d.expressions.custom.none-free'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.custom.create'), exact: true })).toBeDisabled()
  })

  it('never shows the word group anywhere in the panel, editors included', async () => {
    const { screen } = await renderAreas(boothEntries(), { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.group-members'), exact: true }).click()
    for (const edit of screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).all())
      await edit.click()
    await expect.element(screen.getByText(t('settings.live2d.expressions.fields.group'), { exact: true }).first()).toBeVisible()
    expect(screen.container.textContent?.toLowerCase()).not.toContain('group')
  })
})
