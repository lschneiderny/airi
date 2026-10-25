import type { Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { Pinia } from 'pinia'
import type { Locator } from 'vitest/browser'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import en from '@proj-airi/i18n/locales/en'

import { errorMessageFrom } from '@moeru/std'
import { createPinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { nextTick, watch } from 'vue'
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

type ExpressionEntry = Live2DExpressionSettingsSnapshot['entries'][number]

function expressionEntry(overrides: Partial<ExpressionEntry>): ExpressionEntry {
  return {
    id: 'entry.exp3.json',
    name: 'entry',
    label: 'entry',
    kind: 'face',
    group: null,
    confirmed: false,
    exposedToLlm: false,
    mappings: [],
    fileName: 'entry.exp3.json',
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

function remoteSnapshot(groups: ExpressionEntry[]): ModelSettingsRuntimeSnapshot {
  return {
    ownerInstanceId: 'stage-owner',
    modelId: 'test-model',
    renderer: 'live2d',
    phase: 'mounted',
    controlsLocked: false,
    previewAvailable: true,
    canCapturePreview: false,
    updatedAt: 1,
    live2dExpressions: { entries: groups, freeParameters: [] },
  }
}

/** Rows the in-use filter hides for a fixture without groups: inactive entries that carry no mapping. */
function hiddenEntryCount(groups: ExpressionEntry[]) {
  return groups.filter(entry => entry.group === null && !(entry.kind === 'system' ? entry.active : entry.active || entry.mappings.length > 0)).length
}

/** Renders the panel over a remote snapshot and, when `showAll` is set, reveals the rows the in-use filter hides. */
async function renderRemoteExpressions(groups: ExpressionEntry[], options: { showAll?: boolean } = {}) {
  Object.assign(window, { Live2DCubismCore: {} })
  const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
    import('@proj-airi/stage-ui-live2d'),
    import('./live2d.vue'),
  ])
  await import('virtual:uno.css')
  const pinia = createPinia()
  useSettingsLive2d(pinia).live2dExpressionEnabled = true
  const onLive2dExpressionCommand = vi.fn()
  const screen = await render(Live2DSettings, {
    props: { palette: [], runtimeSnapshot: remoteSnapshot(groups), onLive2dExpressionCommand },
    global: { plugins: [pinia, createTestI18n()] },
  })
  await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
  if (options.showAll)
    await screen.getByRole('button', { name: t('settings.live2d.expressions.show-all', { count: hiddenEntryCount(groups) }), exact: true }).click()
  return { screen, pinia, onLive2dExpressionCommand }
}

/** Renders the settings, selects Natural through its radio, and expands the Emotion strength group. */
async function renderNaturalEmotionStrength(pinia: Pinia, errorHandler?: (error: unknown) => void) {
  Object.assign(window, { Live2DCubismCore: {} })
  const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
    import('@proj-airi/stage-ui-live2d'),
    import('./live2d.vue'),
  ])
  await import('virtual:uno.css')
  const settings = useSettingsLive2d(pinia)
  settings.resetState()
  const screen = await render(Live2DSettings, {
    props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
    global: { plugins: [pinia, createTestI18n()], config: { errorHandler } },
  })
  await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
  await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
  await screen.getByRole('button', { name: t('settings.live2d.animation.natural-emotion-strength.title') }).click()
  return { screen, settings }
}

/** The labelled field around a slider, so its formatted value can be read without matching every field. */
function fieldOf(slider: Locator) {
  const field = slider.element().closest('label')
  if (!field)
    throw new Error('the slider is not inside a labelled field')
  return page.elementLocator(field)
}

/** The Everything-else section element, so row text can be asserted apart from the Reactions chips that repeat the same labels. */
function everythingElseOf(screen: { getByRole: typeof page.getByRole }) {
  const section = screen.getByRole('heading', { name: t('settings.live2d.expressions.areas.title'), exact: true }).element().closest('section')
  if (!section)
    throw new Error('the Everything else heading is not inside a section')
  return section
}

interface ExpressionScreen { getByRole: typeof page.getByRole, getByText: typeof page.getByText }

/** How many exact-text matches exist in the DOM inside Everything else, hidden ones included. Absence checks use this so a row that is merely hidden still fails, as `.not.toBeInTheDocument()` did. A generated element locator goes stale when the section re-renders, so this re-resolves on every poll. */
function inEverythingElse(screen: ExpressionScreen, text: string) {
  const section = everythingElseOf(screen)
  return screen.getByText(text, { exact: true }).all().filter(locator => section.contains(locator.element())).length
}

/** The single exact-text match inside Everything else, as a locator. Presence checks assert it with `toBeVisible()`, which rejects `display: none`, `visibility: hidden`, and zero-size elements; `opacity: 0` still counts as visible there. The section locator is built right before each assertion because the section's content changes between them. */
function rowInEverythingElse(screen: ExpressionScreen, text: string) {
  return page.elementLocator(everythingElseOf(screen)).getByText(text, { exact: true })
}

describe('live2D model settings', () => {
  // The first import of the settings module graph transforms it cold: 6-8 s alone, over 15 s under load.
  // Loading it here keeps that one-time cost out of the first test's timeout; later imports hit the module cache.
  beforeAll(async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
      import('../../../../features/performance/settings'),
      import('virtual:uno.css'),
    ])
  }, 60_000)

  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.body.className = ''
  })

  // https://github.com/moeru-ai/airi/issues/2450
  it('renders a remote expression snapshot and emits a command without changing the local store', async () => {
    // ROOT CAUSE:
    //
    // The Electron stage renderer loaded the model and registered its expressions.
    // The separate settings renderer read a different Pinia store, so the list stayed empty.
    //
    // We fixed this by sending a serializable expression snapshot from the stage owner.
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionStore, useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')

    const pinia = createPinia()
    const live2dSettings = useSettingsLive2d(pinia)
    live2dSettings.live2dExpressionEnabled = true

    const runtimeSnapshot = {
      ownerInstanceId: 'stage-owner',
      modelId: 'test-model',
      renderer: 'live2d',
      phase: 'mounted',
      controlsLocked: false,
      previewAvailable: true,
      canCapturePreview: false,
      updatedAt: 1,
      live2dExpressions: {
        freeParameters: [],
        entries: [
          { id: 'happy.exp3.json', name: 'happy', label: 'happy', kind: 'face', group: null, confirmed: false, exposedToLlm: false, mappings: [], fileName: 'happy.exp3.json', parameterIds: [], active: false, effective: false, overriddenBy: null, via: [], usesOverwrite: false, isDefault: false },
          { id: 'surprised.exp3.json', name: 'surprised', label: 'surprised', kind: 'face', group: null, confirmed: false, exposedToLlm: false, mappings: [], fileName: 'surprised.exp3.json', parameterIds: [], active: true, effective: true, overriddenBy: null, via: [], usesOverwrite: false, isDefault: false },
        ],
      },
    } satisfies ModelSettingsRuntimeSnapshot

    const onLive2dExpressionCommand = vi.fn()

    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot,
        onLive2dExpressionCommand,
      },
      global: {
        plugins: [pinia, createTestI18n()],
      },
    })

    await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
    // `happy` is inactive and unmapped, so the in-use filter hides it until Show all.
    await screen.getByRole('button', { name: t('settings.live2d.expressions.show-all', { count: 1 }), exact: true }).click()
    await expect.element(screen.getByText('happy', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('surprised', { exact: true })).toBeVisible()

    await screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: happy` }).click()

    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'happy.exp3.json', active: true })
    expect(useExpressionStore(pinia).definitions).toEqual([])
  })

  it('renders slim rows with a mapping summary, and offers the AI toggle only for face, effect, and prop', async () => {
    const group = 'group:cheeks-blush.exp3.json'
    const { screen } = await renderRemoteExpressions([
      expressionEntry({ id: 'a', label: 'Cheeks Blush', kind: 'face', group, confirmed: true, mappings: [{ emotion: 'angry', weight: 1, minBand: 'clear' }, { emotion: 'angry', weight: 2, minBand: 'strong' }, { emotion: 'flustered', weight: 1, minBand: 'clear' }] }),
      expressionEntry({ id: 'c', label: 'Cheeks Pale', kind: 'face', group }),
      expressionEntry({ id: 'b', label: 'Hat', kind: 'outfit' }),
    ], { showAll: true })
    for (const key of ['kinds.face', 'kinds.outfit', 'emotions.angry', 'emotions.flustered', 'group-members'])
      expect(t(`settings.live2d.expressions.${key}`)).not.toBe(`settings.live2d.expressions.${key}`)
    // The group row carries the readable name, never the stored group id.
    await expect.element(rowInEverythingElse(screen, 'Cheeks')).toBeVisible()
    await expect.poll(() => inEverythingElse(screen, group)).toBe(0)
    await expect.poll(() => inEverythingElse(screen, 'Cheeks Blush')).toBe(0)
    await expect.element(rowInEverythingElse(screen, 'Hat')).toBeVisible()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Hat` })).not.toBeInTheDocument()

    await screen.getByRole('button', { name: t('settings.live2d.expressions.group-members'), exact: true }).click()
    await expect.element(rowInEverythingElse(screen, 'Cheeks Blush')).toBeVisible()
    await expect.element(rowInEverythingElse(screen, `${t('settings.live2d.expressions.emotions.angry')}, ${t('settings.live2d.expressions.emotions.flustered')}`)).toBeVisible()
    await expect.poll(() => inEverythingElse(screen, t('settings.live2d.expressions.kinds.face'))).toBe(0)
    await expect.poll(() => inEverythingElse(screen, t('settings.live2d.expressions.kinds.outfit'))).toBe(0)
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Cheeks Blush` })).toBeVisible()

    // The expanded member row shows neither the stored group id nor its former prefix-stripped chip text, nor a review chip.
    const memberRow = screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Cheeks Blush` }).element().closest('[class*="rounded-lg"]')
    if (!memberRow)
      throw new Error('the member switch is not inside a row')
    const member = page.elementLocator(memberRow)
    await expect.element(member.getByText('Cheeks Blush', { exact: true })).toBeVisible()
    await expect.element(member.getByText(group, { exact: true })).not.toBeInTheDocument()
    await expect.element(member.getByText(group.replace(/^group:/, ''), { exact: true })).not.toBeInTheDocument()
    await expect.element(member.getByText('Confirmed', { exact: true })).not.toBeInTheDocument()
  })

  describe('relevance view', () => {
    /** Bear-like fixture: anger mapped, coat unmapped, watermark system, hair group of two. */
    function bearSnapshot(overrides: Partial<Record<'anger' | 'coat' | 'watermark', Partial<ExpressionEntry>>> = {}) {
      return [
        expressionEntry({ id: 'anger.exp3.json', label: 'anger', kind: 'face', mappings: [{ emotion: 'angry', weight: 1, minBand: 'clear' }], ...overrides.anger }),
        expressionEntry({ id: 'coat.exp3.json', label: 'coat', kind: 'outfit', ...overrides.coat }),
        expressionEntry({ id: 'watermark.exp3.json', label: 'watermark', kind: 'system', ...overrides.watermark }),
        expressionEntry({ id: 'hair1.exp3.json', label: 'Hair 1', kind: 'outfit', group: 'group:hair1.exp3.json' }),
        expressionEntry({ id: 'hair2.exp3.json', label: 'Hair 2', kind: 'outfit', group: 'group:hair1.exp3.json' }),
      ]
    }
    // 5 entries produce 4 rows (the hair pair is one row); coat and watermark are the 2 the in-use filter hides.
    const hiddenRowCount = 2

    /** The leading label of every rendered Everything-else row, group rows included, in document order. */
    function expressionRowLabels(screen: Awaited<ReturnType<typeof renderRemoteExpressions>>['screen']) {
      return [...everythingElseOf(screen).querySelectorAll('[role="listitem"]')].map(row => row.querySelector('span')?.textContent?.trim() ?? '')
    }

    it('shows only in-use rows by default and reveals the rest through Show all', async () => {
      for (const key of ['show-all', 'show-fewer', 'none-in-use', 'no-match', 'search'])
        expect(t(`settings.live2d.expressions.${key}`)).not.toBe(`settings.live2d.expressions.${key}`)
      const { screen } = await renderRemoteExpressions(bearSnapshot())
      await expect.element(rowInEverythingElse(screen, 'anger')).toBeVisible()
      await expect.element(rowInEverythingElse(screen, 'Hair')).toBeVisible()
      await expect.poll(() => inEverythingElse(screen, 'coat')).toBe(0)
      await expect.poll(() => inEverythingElse(screen, 'watermark')).toBe(0)

      const showAll = screen.getByRole('button', { name: t('settings.live2d.expressions.show-all', { count: hiddenRowCount }), exact: true })
      await expect.element(showAll).toBeVisible()
      await showAll.click()
      await expect.element(rowInEverythingElse(screen, 'coat')).toBeVisible()
      await expect.element(rowInEverythingElse(screen, 'watermark')).toBeVisible()
      await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.show-fewer'), exact: true })).toBeVisible()
    })

    it('searches every row regardless of the in-use filter and reports no match', async () => {
      const { screen } = await renderRemoteExpressions(bearSnapshot())
      const search = screen.getByRole('searchbox', { name: t('settings.live2d.expressions.search'), exact: true })
      await search.fill('coat')
      await expect.element(rowInEverythingElse(screen, 'coat')).toBeVisible()
      await expect.poll(() => inEverythingElse(screen, 'anger')).toBe(0)
      await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.show-all', { count: hiddenRowCount }), exact: true })).not.toBeInTheDocument()

      await search.fill('zzzz')
      await expect.element(rowInEverythingElse(screen, t('settings.live2d.expressions.no-match'))).toBeVisible()
      await expect.poll(() => inEverythingElse(screen, 'coat')).toBe(0)
    })

    it('keeps the search text and Show all after collapsing and reopening the Expressions section', async () => {
      const { screen } = await renderRemoteExpressions(bearSnapshot(), { showAll: true })
      const searchName = t('settings.live2d.expressions.search')
      await screen.getByRole('searchbox', { name: searchName, exact: true }).fill('c')

      const title = screen.getByText(t('settings.live2d.expressions.title'), { exact: true })
      await title.click()
      await expect.element(screen.getByRole('searchbox', { name: searchName, exact: true })).not.toBeInTheDocument()
      await title.click()

      await expect.element(screen.getByRole('searchbox', { name: searchName, exact: true })).toHaveValue('c')
      await screen.getByRole('searchbox', { name: searchName, exact: true }).clear()
      await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.show-fewer'), exact: true })).toBeVisible()
      await expect.element(screen.getByText('coat', { exact: true })).toBeVisible()
    })

    it('shows an active system entry by default', async () => {
      const { screen } = await renderRemoteExpressions(bearSnapshot({ watermark: { active: true } }))
      await expect.element(screen.getByText('watermark', { exact: true })).toBeVisible()
      await expect.element(screen.getByText('coat', { exact: true })).not.toBeInTheDocument()
    })

    it('renders an empty-named group as one group row', async () => {
      const { screen } = await renderRemoteExpressions([
        expressionEntry({ id: 'blank1.exp3.json', label: 'Blank 1', kind: 'outfit', group: '' }),
        expressionEntry({ id: 'blank2.exp3.json', label: 'Blank 2', kind: 'outfit', group: '' }),
      ])
      await expect.element(screen.getByText('Blank', { exact: true })).toBeVisible()
      await expect.element(screen.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') })).toBeVisible()
      await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Blank 1` })).not.toBeInTheDocument()
      expect(expressionRowLabels(screen)).toEqual(['Blank'])
    })

    it('keeps catalog order and a mapped entry visible when it is toggled off in the in-use view', async () => {
      const { screen, onLive2dExpressionCommand, pinia } = await renderRemoteExpressions(bearSnapshot({ anger: { active: true } }))
      const { useExpressionStore } = await import('@proj-airi/stage-ui-live2d')
      await expect.element(rowInEverythingElse(screen, 'Hair')).toBeVisible()
      const before = expressionRowLabels(screen)
      expect(before).toEqual(['anger', 'Hair'])

      await screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: anger` }).click()
      expect(onLive2dExpressionCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'anger.exp3.json', active: false })
      expect(useExpressionStore(pinia).definitions).toEqual([])

      // The owner answers with a new snapshot; anger stays visible because it is mapped.
      await screen.rerender({ runtimeSnapshot: remoteSnapshot(bearSnapshot({ anger: { active: false } })) })
      await expect.element(rowInEverythingElse(screen, 'anger')).toBeVisible()
      expect(expressionRowLabels(screen)).toEqual(before)
    })
  })

  it('shows an inverted entry as on while inactive and turns it on through set-active', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([
      expressionEntry({ id: 'coat.exp3.json', label: 'coat', kind: 'outfit', inverted: true, active: false }),
    ], { showAll: true })
    const coat = screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: coat` })
    await expect.element(coat).toBeChecked()
    await coat.click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'coat.exp3.json', active: true })
  })

  it('emits update-entry when a label is edited and applied', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })], { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Blush')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'red.exp3.json',
      patch: { label: 'Blush', kind: 'face', group: null, confirmed: true, inverted: false, mappings: [] },
    })
  })

  it('sends no area key when the Area select is untouched', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red', area: 'cheeks' })], { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    const patch = onLive2dExpressionCommand.mock.calls[0][0].patch
    expect(patch).not.toHaveProperty('area')
  })

  it('sends the chosen area, and area null when None is picked', async () => {
    const area = new RegExp(t('settings.live2d.expressions.fields.area'))
    const first = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })], { showAll: true })
    await first.screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await first.screen.getByRole('combobox', { name: area }).click()
    await first.screen.getByRole('option', { name: t('settings.live2d.expressions.areas.eyes'), exact: true }).click()
    await first.screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(first.onLive2dExpressionCommand.mock.calls[0][0].patch).toMatchObject({ area: 'eyes' })
    cleanup()

    const second = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red', area: 'cheeks' })], { showAll: true })
    await second.screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await second.screen.getByRole('combobox', { name: area }).click()
    await second.screen.getByRole('option', { name: t('settings.live2d.expressions.areas.none'), exact: true }).click()
    await second.screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(second.onLive2dExpressionCommand.mock.calls[0][0].patch).toMatchObject({ area: null })
  })

  it('shows the overriding entry label even when it equals another entry id', async () => {
    const { screen } = await renderRemoteExpressions([
      expressionEntry({ id: 'hairA.exp3.json', label: 'Hair A', active: true, overriddenBy: 'Hair B' }),
      expressionEntry({ id: 'Hair B', label: 'Wrong label' }),
    ], { showAll: true })
    await expect.element(screen.getByText(t('settings.live2d.expressions.overridden-by', { label: 'Hair B' }), { exact: true })).toBeVisible()
  })

  it('includes the inverted checkbox in the applied patch', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'coat.exp3.json', label: 'coat', kind: 'outfit' })], { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    expect(t('settings.live2d.expressions.fields.inverted')).not.toBe('settings.live2d.expressions.fields.inverted')
    await expect.element(screen.getByText(t('settings.live2d.expressions.fields.inverted-description'), { exact: true })).toBeVisible()
    await screen.getByRole('switch', { name: t('settings.live2d.expressions.fields.inverted'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'coat.exp3.json',
      patch: { label: 'coat', kind: 'outfit', group: null, confirmed: true, inverted: true, mappings: [] },
    })
  })

  it('rejects an empty label and a mapping weight of 0 without emitting a command', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })], { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const apply = screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true })

    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('')
    await expect.element(screen.getByText(t('settings.live2d.expressions.validation.label-required'), { exact: true })).toBeVisible()
    await apply.click()
    expect(onLive2dExpressionCommand).not.toHaveBeenCalled()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Blush')

    await screen.getByRole('button', { name: t('settings.live2d.expressions.add-mapping'), exact: true }).click()
    const weight = screen.getByRole('spinbutton', { name: `${t('settings.live2d.expressions.fields.weight')} 1` })
    for (const invalid of ['0', '5.5', '-1']) {
      await weight.fill(invalid)
      await expect.element(screen.getByText(t('settings.live2d.expressions.validation.weight-range', { min: 0.1, max: 5 }), { exact: true })).toBeVisible()
      await apply.click()
    }
    expect(onLive2dExpressionCommand).not.toHaveBeenCalled()

    await weight.fill('1.5')
    await apply.click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
  })

  it('keeps an open draft when the snapshot changes and offers to reload it', async () => {
    const { screen } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })], { showAll: true })
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const label = screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true })
    await label.fill('Draft')
    await screen.rerender({ runtimeSnapshot: remoteSnapshot([expressionEntry({ id: 'red.exp3.json', label: 'Remote' })]) })
    await expect.element(screen.getByText(t('settings.live2d.expressions.stale'), { exact: true })).toBeVisible()
    await expect.element(label).toHaveValue('Draft')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.reload'), exact: true }).click()
    await expect.element(label).toHaveValue('Remote')
    await expect.element(screen.getByText(t('settings.live2d.expressions.stale'), { exact: true })).not.toBeInTheDocument()
  })

  it('updates the performance settings store from the Emotion performance switches', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionPerformanceSettings }, { default: Live2DSettings }] = await Promise.all([
      import('../../../../features/performance/settings'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const performance = useExpressionPerformanceSettings(pinia)
    const screen = await render(Live2DSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.performance.title'), { exact: true }).click()
    const bands = screen.getByRole('switch', { name: t('settings.live2d.performance.bands.title') })
    await expect.element(bands).toBeChecked()
    expect(performance.document.bands).toBe(true)
    const bandsChanged = new Promise<boolean>((resolve, reject) => {
      const stop = watch(() => performance.document.bands, (value) => {
        stop()
        resolve(value)
      }, { flush: 'sync' })
      AbortSignal.timeout(5000).addEventListener('abort', () => {
        stop()
        reject(new Error('performance.document.bands did not change after the switch click'))
      })
    })
    await bands.click()
    expect(await bandsChanged).toBe(false)
    expect(performance.document.bands).toBe(false)
    await expect.element(bands).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings/expression-performance') ?? '{}').bands).toBe(false)
    expect(performance.document.mood).toBe(true)
  })

  it('switches the expression decider between picker and planner', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionPerformanceSettings }, { default: Live2DSettings }] = await Promise.all([
      import('../../../../features/performance/settings'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const performance = useExpressionPerformanceSettings(pinia)
    const screen = await render(Live2DSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.performance.title'), { exact: true }).click()
    const picker = screen.getByRole('radio', { name: t('settings.live2d.performance.decider.options.picker.title'), exact: true })
    const planner = screen.getByRole('radio', { name: t('settings.live2d.performance.decider.options.planner.title'), exact: true })
    await expect.element(picker).toBeChecked()
    expect(performance.document.decider).toBe('picker')
    const deciderChanged = new Promise<string>((resolve, reject) => {
      const stop = watch(() => performance.document.decider, (value) => {
        stop()
        resolve(value)
      }, { flush: 'sync' })
      AbortSignal.timeout(5000).addEventListener('abort', () => {
        stop()
        reject(new Error('performance.document.decider did not change after the option click'))
      })
    })
    await planner.click()
    expect(await deciderChanged).toBe('planner')
    await expect.element(planner).toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings/expression-performance') ?? '{}').decider).toBe('planner')
    await picker.click()
    await expect.element(picker).toBeChecked()
    expect(performance.document.decider).toBe('picker')
  })

  it('awaits the leader-routed decider update so its rejection reaches Vue error handling', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const { default: Live2DSettings } = await import('./live2d.vue')
    await import('virtual:uno.css')
    // A follower-only renderer without a leader keeps the leader-routed RPC pending.
    // Disposing the runtime then rejects it, which only the awaiting caller propagates.
    const runtime = createSyncedPiniaPlugin({
      namespace: `live2d-settings:${crypto.randomUUID()}`,
      leadership: 'follower-only',
      callTimeout: 60_000,
    })
    const pinia = createPinia()
    pinia.use(runtime.plugin)
    const handledErrors: unknown[] = []
    let onHandledError: (() => void) | undefined
    const screen = await render(Live2DSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
      global: {
        plugins: [pinia, createTestI18n()],
        config: {
          errorHandler: (error) => {
            handledErrors.push(error)
            onHandledError?.()
          },
        },
      },
    })
    try {
      await screen.getByText(t('settings.live2d.performance.title'), { exact: true }).click()
      await screen.getByRole('radio', { name: t('settings.live2d.performance.decider.options.planner.title'), exact: true }).click()
      expect(handledErrors).toEqual([])

      const handled = new Promise<void>((resolve, reject) => {
        onHandledError = resolve
        AbortSignal.timeout(5000).addEventListener('abort', () => {
          reject(new Error('the rejected decider update never reached the Vue error handler'))
        })
      })
      runtime.dispose()
      await handled
      expect(handledErrors.map(error => errorMessageFrom(error))).toEqual(['Pinia sync runtime was disposed before the RPC completed.'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('selects Natural and preserves mode settings', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    settings.live2dEyeTracking = false
    localStorage.setItem('selected-runtime-motion', 'idle.motion3.json')
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    await expect.element(screen.getByRole('radio', { name: 'Universal', exact: true })).toBeChecked()
    for (const enabled of [false, true, false]) {
      await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
      const cursor = screen.getByRole('switch', { name: t('settings.live2d.animation.natural-cursor-attention.title') })
      await expect.element(cursor).toBeEnabled()
      if (settings.live2dNaturalCursorAttention !== enabled)
        await cursor.click()
      await nextTick()
      expect(settings.live2dNaturalCursorAttention).toBe(enabled)
      expect(localStorage.getItem('settings/live2d/motion-driver')).toBe('natural')
      expect(localStorage.getItem('settings/live2d/natural-cursor-attention')).toBe(String(enabled))
      expect(settings.live2dEyeTracking).toBe(false)
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.force-idle-eye-animation.title') })).toBeDisabled()
      await expect.element(screen.getByRole('combobox')).toBeDisabled()
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.blink-enable.title') })).toBeEnabled()
      if (enabled)
        await expect.element(screen.getByText(t('settings.live2d.animation.focus.offset'), { exact: true })).toBeVisible()
      else
        await expect.element(screen.getByText(t('settings.live2d.animation.focus.offset'), { exact: true })).not.toBeInTheDocument()
      await screen.getByRole('radio', { name: 'MAGIC', exact: true }).click()
      await expect.element(cursor).not.toBeInTheDocument()
      await screen.getByRole('radio', { name: 'Universal', exact: true }).click()
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.focus.title') })).not.toBeChecked()
      await expect.element(screen.getByRole('combobox')).toBeEnabled()
      expect(settings.live2dForceIdleEyeAnimation).toBe(true)
      expect(settings.live2dIdleAnimationEnabled).toBe(true)
      expect(localStorage.getItem('selected-runtime-motion')).toBe('idle.motion3.json')
    }
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
    const switches = screen.getByRole('switch').all()
    await expect.element(switches[switches.length - 1]).toBeEnabled()
    settings.resetState()
    await nextTick()
    await expect.element(screen.getByRole('radio', { name: 'Universal', exact: true })).toBeChecked()
    expect(settings.live2dNaturalCursorAttention).toBe(true)
    expect(settings.live2dEyeTracking).toBe(true)
  })

  it('hides eye tracking under Natural whether touch is on or off', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    settings.live2dNaturalTouch = true
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    const eyeTracking = screen.getByRole('switch', { name: t('settings.live2d.animation.focus.title') })
    await expect.element(eyeTracking).toBeInTheDocument()
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await expect.element(eyeTracking).not.toBeInTheDocument()
    // Natural replaces eye tracking with cursor attention, so turning touch off must not bring it back.
    await screen.getByRole('switch', { name: t('settings.live2d.animation.natural-touch.title') }).click()
    await nextTick()
    expect(settings.live2dNaturalTouch).toBe(false)
    await expect.element(eyeTracking).not.toBeInTheDocument()
    await screen.getByRole('radio', { name: 'MAGIC', exact: true }).click()
    await expect.element(eyeTracking).toBeInTheDocument()
  })

  it('shows the Energy slider only for Natural, persists it, and resets it to 0.5', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    // A missing locale entry renders the key, which the role query would still match.
    expect(t('settings.live2d.animation.natural-energy.title')).not.toBe('settings.live2d.animation.natural-energy.title')
    const energy = screen.getByRole('slider', { name: t('settings.live2d.animation.natural-energy.title') })
    await expect.element(energy).not.toBeInTheDocument()
    await screen.getByRole('radio', { name: 'MAGIC', exact: true }).click()
    await expect.element(energy).not.toBeInTheDocument()
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await expect.element(energy).toBeVisible()
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await energy.click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(screen.getByText('55%', { exact: true })).toBeVisible()
    expect(settings.live2dNaturalEnergy).toBe(0.55)
    const key = 'settings/live2d/natural-energy'
    expect(localStorage.getItem(key)).toBe('0.55')

    localStorage.setItem(key, '7')
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: '0.55', newValue: '7', storageArea: localStorage }))
    await expect.element(screen.getByText('100%', { exact: true })).toBeVisible()
    expect(settings.live2dNaturalEnergy).toBe(1)

    // Reset also restores the Universal driver, which hides the slider.
    settings.resetState()
    await nextTick()
    await expect.element(energy).not.toBeInTheDocument()
    expect(settings.live2dNaturalEnergy).toBe(0.5)
    expect(localStorage.getItem(key)).toBe('0.5')
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await screen.getByRole('radio', { name: 'Universal', exact: true }).click()
    await expect.element(energy).not.toBeInTheDocument()
  })

  it.each([
    'universal',
    'magic',
    'natural',
  ] as const)('restores stored %s through storage updates without migrating cursor preferences', async (driver) => {
    Object.assign(window, { Live2DCubismCore: {} })
    const { useSettingsLive2d } = await import('@proj-airi/stage-ui-live2d')
    const settings = useSettingsLive2d(createPinia())
    settings.resetState()
    await nextTick()
    for (const [key, newValue] of [
      ['settings/live2d/motion-driver', driver],
      ['settings/live2d/natural-cursor-attention', 'false'],
      ['settings/live2d/eye-tracking', 'true'],
    ]) {
      const oldValue = localStorage.getItem(key)
      localStorage.setItem(key, newValue)
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
    }
    await nextTick()
    expect(settings.live2dMotionDriver).toBe(driver)
    expect(settings.live2dNaturalCursorAttention).toBe(false)
    expect(settings.live2dEyeTracking).toBe(true)
  })

  it.each([
    { stored: 'abc', expected: 0.5 },
    { stored: '7', expected: 1 },
    { stored: '-2', expected: 0 },
    { stored: '0.35', expected: 0.35 },
  ])('reads a stored Natural energy of $stored as $expected', async ({ stored, expected }) => {
    Object.assign(window, { Live2DCubismCore: {} })
    const { useSettingsLive2d } = await import('@proj-airi/stage-ui-live2d')
    const settings = useSettingsLive2d(createPinia())
    settings.resetState()
    settings.live2dNaturalEnergy = 0.8
    await nextTick()
    const key = 'settings/live2d/natural-energy'
    const oldValue = localStorage.getItem(key)
    localStorage.setItem(key, stored)
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: stored, storageArea: localStorage }))
    await nextTick()
    expect(settings.live2dNaturalEnergy).toBe(expected)
  })

  it('writes the Love strength for the selected model only and resets that model', async () => {
    const pinia = createPinia()
    const { useSettingsStageModel } = await import('../../../../stores/settings/stage-model')
    const stageModel = useSettingsStageModel(pinia)
    const { screen, settings } = await renderNaturalEmotionStrength(pinia)
    const key = 'settings/live2d/natural-emotion-strength'
    const love = screen.getByRole('slider', { name: t('settings.live2d.expressions.emotions.love') })
    const reset = screen.getByRole('button', { name: t('settings.live2d.animation.natural-emotion-strength.reset'), exact: true })
    await expect.element(love).toBeVisible()
    await expect.element(fieldOf(love).getByText('1.00×', { exact: true })).toBeVisible()
    await expect.element(reset).toBeDisabled()
    expect(stageModel.stageModelSelected).toBe('preset-live2d-1')

    love.element().focus()
    for (let step = 0; step < 10; step++)
      await userEvent.keyboard('{ArrowRight}')
    await expect.element(fieldOf(love).getByText('1.50×', { exact: true })).toBeVisible()
    expect(settings.live2dNaturalEmotionStrength).toEqual({ 'preset-live2d-1': { love: 1.5 } })
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ 'preset-live2d-1': { love: 1.5 } })
    await expect.element(reset).toBeEnabled()

    stageModel.stageModelSelected = 'preset-live2d-2'
    await nextTick()
    await expect.element(fieldOf(love).getByText('1.00×', { exact: true })).toBeVisible()
    await expect.element(reset).toBeDisabled()
    expect(settings.live2dNaturalEmotionStrength).toEqual({ 'preset-live2d-1': { love: 1.5 } })

    stageModel.stageModelSelected = 'preset-live2d-1'
    await nextTick()
    await expect.element(fieldOf(love).getByText('1.50×', { exact: true })).toBeVisible()
    await reset.click()
    await expect.element(fieldOf(love).getByText('1.00×', { exact: true })).toBeVisible()
    await expect.element(reset).toBeDisabled()
    expect(settings.live2dNaturalEmotionStrength).toEqual({})
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({})
  })

  it('reads a stored Love strength of "x" as 1 without an error', async () => {
    const handledErrors: unknown[] = []
    const { screen, settings } = await renderNaturalEmotionStrength(createPinia(), error => handledErrors.push(error))
    const love = screen.getByRole('slider', { name: t('settings.live2d.expressions.emotions.love') })
    const sad = screen.getByRole('slider', { name: t('settings.live2d.expressions.emotions.sad') })
    const key = 'settings/live2d/natural-emotion-strength'
    const oldValue = localStorage.getItem(key)
    const newValue = '{"preset-live2d-1":{"love":"x","sad":1.5}}'
    const consoleError = vi.spyOn(console, 'error')
    try {
      localStorage.setItem(key, newValue)
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
      await nextTick()
      await expect.element(fieldOf(love).getByText('1.00×', { exact: true })).toBeVisible()
      await expect.element(fieldOf(sad).getByText('1.50×', { exact: true })).toBeVisible()
      expect(settings.live2dNaturalEmotionStrength).toEqual({ 'preset-live2d-1': { sad: 1.5 } })
      expect(handledErrors).toEqual([])
      expect(consoleError).not.toHaveBeenCalled()
    }
    finally {
      consoleError.mockRestore()
    }
  })

  it('toggles held emotions in the synced performance document', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionPerformanceSettings }, { default: Live2DSettings }] = await Promise.all([
      import('../../../../features/performance/settings'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const performance = useExpressionPerformanceSettings(pinia)
    const screen = await render(Live2DSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.performance.title'), { exact: true }).click()
    const held = screen.getByRole('switch', { name: t('settings.live2d.performance.held-emotions.title') })
    await expect.element(held).toBeChecked()
    expect(performance.document.heldEmotions).toBe(true)
    const heldChanged = new Promise<boolean>((resolve, reject) => {
      const stop = watch(() => performance.document.heldEmotions, (value) => {
        stop()
        resolve(value)
      }, { flush: 'sync' })
      AbortSignal.timeout(5000).addEventListener('abort', () => {
        stop()
        reject(new Error('performance.document.heldEmotions did not change after the switch click'))
      })
    })
    await held.click()
    expect(await heldChanged).toBe(false)
    await expect.element(held).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings/expression-performance') ?? '{}').heldEmotions).toBe(false)
    expect(performance.document.mood).toBe(true)
    await held.click()
    await expect.element(held).toBeChecked()
    expect(performance.document.heldEmotions).toBe(true)
  })

  it.each([
    { width: 1280, theme: 'light', size: 'desktop' },
    { width: 1280, theme: 'dark', size: 'desktop' },
    { width: 390, theme: 'light', size: 'mobile' },
    { width: 390, theme: 'dark', size: 'mobile' },
  ])('keeps natural controls usable at narrow width ($size $theme)', async ({ width, theme }) => {
    await page.viewport(width, 1000)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.className = 'bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4'
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    const cursor = screen.getByRole('switch', { name: t('settings.live2d.animation.natural-cursor-attention.title') })
    await expect.element(cursor).toBeChecked()
    const energy = screen.getByRole('slider', { name: t('settings.live2d.animation.natural-energy.title') })
    await expect.element(energy).toBeVisible()
    for (const control of [cursor, energy, screen.getByRole('radio', { name: 'Natural', exact: true })]) {
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeGreaterThanOrEqual(24)
      expect(bounds.width).toBeGreaterThanOrEqual(24)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  })

  // Each case mounts the settings page and makes three real clicks: CPU-bound main-thread work,
  // under 1 s when idle. Under 20x CDP CPU throttling a case took 11-16 s, or 23-26 s when it
  // opened the Animation section first, so it exceeded the 15 s default.
  it.each([
    { width: 1280, theme: 'light', size: 'desktop' },
    { width: 1280, theme: 'dark', size: 'desktop' },
    { width: 390, theme: 'light', size: 'mobile' },
    { width: 390, theme: 'dark', size: 'mobile' },
  ])('keeps the expanded Emotion strength group usable at narrow width ($size $theme)', async ({ width, theme }) => {
    // The expanded group is taller than a 1000px viewport; the element capture frames only visible pixels.
    await page.viewport(width, 2400)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.className = 'bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4'
    const { screen } = await renderNaturalEmotionStrength(createPinia())
    const emotions = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']
    const sliders = emotions.map(emotion => screen.getByRole('slider', { name: t(`settings.live2d.expressions.emotions.${emotion}`) }))
    const reset = screen.getByRole('button', { name: t('settings.live2d.animation.natural-emotion-strength.reset'), exact: true })
    for (const control of [...sliders, reset]) {
      await expect.element(control).toBeVisible()
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeGreaterThanOrEqual(24)
      expect(bounds.width).toBeGreaterThanOrEqual(24)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  }, 30_000)
})
