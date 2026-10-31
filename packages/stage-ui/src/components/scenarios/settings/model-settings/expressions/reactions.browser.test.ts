import type { ExpressionPanelEntry } from './source'

import en from '@proj-airi/i18n/locales/en'

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

const angryMapping = { emotion: 'angry', weight: 1, minBand: 'clear' } as const
const happyMapping = { emotion: 'happy', weight: 1, minBand: 'clear' } as const

/** ForBOOTH-shaped fixture: the Angry row reads Angry, Disdain, Puff Cheeks ½ and Black Face; Happy has one combo. */
function boothEntries(): ExpressionEntry[] {
  return [
    expressionEntry({ id: 'angry.exp3.json', label: 'Angry', area: 'whole-look', mappings: [angryMapping], active: true }),
    expressionEntry({ id: 'disdain.exp3.json', label: 'Disdain', area: 'eyes', mappings: [angryMapping, { emotion: 'awkward', weight: 1, minBand: 'clear' }] }),
    expressionEntry({ id: 'puff.exp3.json', label: 'Puff Cheeks', area: 'cheeks', mappings: [{ emotion: 'angry', weight: 0.5, minBand: 'clear' }] }),
    expressionEntry({ id: 'black-face.exp3.json', label: 'Black Face', kind: 'effect', area: 'effects', mappings: [{ emotion: 'angry', weight: 1, minBand: 'strong' }] }),
    expressionEntry({ id: 'angry-copy.exp3.json', label: 'Angry copy', area: 'whole-look', mappings: [angryMapping], duplicateOf: 'angry.exp3.json' }),
    expressionEntry({ id: 'blush.exp3.json', label: 'Blush', area: 'cheeks' }),
    expressionEntry({ id: 'sparkle.exp3.json', label: 'Sparkle', kind: 'effect', area: 'effects' }),
    expressionEntry({ id: 'coat.exp3.json', label: 'Coat', kind: 'outfit', area: 'outfit-hair' }),
    expressionEntry({ id: 'exp7.exp3.json', label: 'exp7', kind: 'unsorted', area: 'hidden' }),
    expressionEntry({ id: 'custom:ParamTail', label: 'Tail', kind: 'face', area: 'props', mappings: [happyMapping] }),
    expressionEntry({ id: 'custom:ParamHat', label: 'Hat', kind: 'unsorted', area: 'hidden' }),
    expressionEntry({ id: 'custom:ParamCape', label: 'Cape', kind: 'outfit', area: 'outfit-hair' }),
    expressionEntry({
      id: 'combo:happy',
      label: 'Happy look',
      kind: 'combo',
      area: 'whole-look',
      members: [{ expressionId: 'blush.exp3.json', strength: 1 }, { expressionId: 'sparkle.exp3.json', strength: 0.5 }],
      slots: ['face', 'effect'],
      mappings: [happyMapping],
      exposedToLlm: true,
    }),
    expressionEntry({ id: 'combo:coat', label: 'Coat look', kind: 'combo', members: [{ expressionId: 'coat.exp3.json', strength: 1 }], slots: [] }),
  ]
}

const emotionOrder = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']

function emotion(key: string) {
  return t(`settings.live2d.expressions.emotions.${key}`)
}
function k(key: string, params: Record<string, string> = {}) {
  return t(`settings.live2d.expressions.reactions.${key}`, params)
}

async function renderReactions(entries: ExpressionEntry[]) {
  const { default: Reactions } = await import('./reactions.vue')
  await import('virtual:uno.css')
  const onCommand = vi.fn()
  const screen = await render(Reactions, {
    props: { entries, onCommand },
    global: { plugins: [createPinia(), createTestI18n()] },
  })
  return { screen, onCommand }
}

/** The row for one emotion, so chips and controls can be asserted inside it. */
function rowOf(screen: Awaited<ReturnType<typeof renderReactions>>['screen'], key: string) {
  return screen.getByRole('region', { name: emotion(key), exact: true })
}

describe('live2D expression reactions', () => {
  beforeAll(async () => {
    await Promise.all([
      import('./reactions.vue'),
      import('virtual:uno.css'),
    ])
    for (const key of ['title', 'description', 'empty', 'add', 'remove', 'preview', 'select', 'make-combo', 'make-combo-hint'])
      expect(k(key)).not.toBe(`settings.live2d.expressions.reactions.${key}`)
    expect(t('settings.live2d.expressions.kinds.combo')).not.toBe('settings.live2d.expressions.kinds.combo')
  }, 60_000)

  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('dark')
  })

  it('lists every emotion in order with chips for its mapped entries, combos included', async () => {
    const { screen } = await renderReactions(boothEntries())
    const rows = screen.getByRole('region').all().map(row => row.element().getAttribute('aria-label'))
    expect(rows).toEqual(emotionOrder.map(emotion))

    const angry = rowOf(screen, 'angry')
    const chipLabels = angry.getByRole('switch').all().map(chip => chip.element().getAttribute('aria-label'))
    expect(chipLabels).toEqual(['Angry', 'Disdain', 'Puff Cheeks', 'Black Face'].map(label => k('select', { label })))
    await expect.element(angry.getByText(t('settings.live2d.expressions.areas.cheeks'), { exact: true })).toBeVisible()

    const happy = rowOf(screen, 'happy')
    await expect.element(happy.getByText('Happy look', { exact: true })).toBeVisible()
    await expect.element(happy.getByText(t('settings.live2d.expressions.kinds.combo'), { exact: true })).toBeVisible()
    await expect.element(rowOf(screen, 'sad').getByText(k('empty'), { exact: true })).toBeVisible()
  })

  it('leaves duplicates out of the rows and the picker', async () => {
    const { screen } = await renderReactions(boothEntries())
    const angry = rowOf(screen, 'angry')
    await expect.element(angry.getByRole('switch', { name: k('select', { label: 'Angry' }), exact: true })).toBeVisible()
    await expect.element(angry.getByRole('switch', { name: k('select', { label: 'Angry copy' }), exact: true })).not.toBeInTheDocument()
    await rowOf(screen, 'sad').getByRole('combobox', { name: k('add') }).click()
    await expect.element(screen.getByRole('option', { name: 'Angry', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: 'Angry copy', exact: true })).not.toBeInTheDocument()
  })

  it('marks a mapping below weight 1 with ½', async () => {
    const { screen } = await renderReactions(boothEntries())
    const angry = rowOf(screen, 'angry')
    const half = angry.getByText('½', { exact: true })
    await expect.element(half).toBeVisible()
    expect(half.all()).toHaveLength(1)
    expect(half.element().closest('.rounded-md')?.textContent).toContain('Puff Cheeks')
  })

  it('previews through set-active and shows the pressed state', async () => {
    const { screen, onCommand } = await renderReactions(boothEntries())
    const angry = rowOf(screen, 'angry')
    const angryPreview = angry.getByRole('button', { name: k('preview', { label: 'Angry' }), exact: true })
    await expect.element(angryPreview).toHaveAttribute('aria-pressed', 'true')
    const disdainPreview = angry.getByRole('button', { name: k('preview', { label: 'Disdain' }), exact: true })
    await expect.element(disdainPreview).toHaveAttribute('aria-pressed', 'false')
    await disdainPreview.click()
    await angryPreview.click()
    expect(onCommand.mock.calls).toEqual([
      [{ type: 'set-active', id: 'disdain.exp3.json', active: true }],
      [{ type: 'set-active', id: 'angry.exp3.json', active: false }],
    ])
  })

  it('removes a mapping through update-entry, update-combo or update-custom by id', async () => {
    const { screen, onCommand } = await renderReactions(boothEntries())
    await rowOf(screen, 'angry').getByRole('button', { name: k('remove', { label: 'Disdain', emotion: emotion('angry') }), exact: true }).click()
    await rowOf(screen, 'happy').getByRole('button', { name: k('remove', { label: 'Happy look', emotion: emotion('happy') }), exact: true }).click()
    await rowOf(screen, 'happy').getByRole('button', { name: k('remove', { label: 'Tail', emotion: emotion('happy') }), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([
      [{ type: 'update-entry', id: 'disdain.exp3.json', patch: { mappings: [{ emotion: 'awkward', weight: 1, minBand: 'clear' }] } }],
      [{ type: 'update-combo', id: 'combo:happy', patch: { mappings: [] } }],
      [{ type: 'update-custom', id: 'custom:ParamTail', patch: { mappings: [] } }],
    ])
  })

  it('adds a custom face through update-custom and offers neither unsorted nor outfit customs', async () => {
    const { screen, onCommand } = await renderReactions(boothEntries())
    await rowOf(screen, 'sad').getByRole('combobox', { name: k('add') }).click()
    await expect.element(screen.getByRole('option', { name: 'Tail', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: 'Hat', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Cape', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Coat', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'exp7', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Coat look', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Happy look', exact: true })).toBeVisible()
    await screen.getByRole('option', { name: 'Tail', exact: true }).click()
    expect(onCommand.mock.calls).toEqual([
      [{ type: 'update-custom', id: 'custom:ParamTail', patch: { mappings: [happyMapping, { emotion: 'sad', weight: 1, minBand: 'clear' }] } }],
    ])
  })

  it('adds a cheeks entry at weight 0.5 and an effect at the strong band', async () => {
    const { screen, onCommand } = await renderReactions(boothEntries())
    await rowOf(screen, 'love').getByRole('combobox', { name: k('add') }).click()
    await screen.getByRole('option', { name: 'Blush', exact: true }).click()
    // The fixture is static: the store, not this component, drops a mapped entry from the picker on the next snapshot.
    await rowOf(screen, 'love').getByRole('combobox', { name: k('add') }).click()
    await screen.getByRole('option', { name: 'Sparkle', exact: true }).click()
    await rowOf(screen, 'love').getByRole('combobox', { name: k('add') }).click()
    await screen.getByRole('option', { name: 'Happy look', exact: true }).click()
    expect(onCommand.mock.calls).toEqual([
      [{ type: 'update-entry', id: 'blush.exp3.json', patch: { mappings: [{ emotion: 'love', weight: 0.5, minBand: 'clear' }] } }],
      [{ type: 'update-entry', id: 'sparkle.exp3.json', patch: { mappings: [{ emotion: 'love', weight: 1, minBand: 'strong' }] } }],
      [{ type: 'update-combo', id: 'combo:happy', patch: { mappings: [happyMapping, { emotion: 'love', weight: 1, minBand: 'clear' }] } }],
    ])
  })

  it('keeps Make combo disabled until a chip is selected, then prefills the editor and creates the combo', async () => {
    const { screen, onCommand } = await renderReactions(boothEntries())
    const angry = rowOf(screen, 'angry')
    const makeCombo = angry.getByRole('button', { name: k('make-combo'), exact: true })
    await expect.element(makeCombo).toBeDisabled()
    await expect.element(angry.getByText(k('make-combo-hint'), { exact: true })).toBeVisible()

    await angry.getByRole('switch', { name: k('select', { label: 'Angry' }), exact: true }).click()
    await angry.getByRole('switch', { name: k('select', { label: 'Puff Cheeks' }), exact: true }).click()
    await expect.element(makeCombo).toBeEnabled()
    await expect.element(angry.getByText(k('make-combo-hint'), { exact: true })).not.toBeInTheDocument()
    await makeCombo.click()

    await expect.element(angry.getByRole('slider', { name: /Angry/ })).toBeVisible()
    await expect.element(angry.getByRole('slider', { name: /Puff Cheeks/ })).toBeVisible()
    const label = angry.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true })
    await expect.element(label).toHaveValue(t('settings.live2d.expressions.combos.default-label', { emotion: emotion('angry') }))
    await angry.getByRole('button', { name: t('settings.live2d.expressions.combos.save'), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{
      type: 'create-combo',
      combo: {
        label: t('settings.live2d.expressions.combos.default-label', { emotion: emotion('angry') }),
        members: [{ expressionId: 'angry.exp3.json', strength: 1 }, { expressionId: 'puff.exp3.json', strength: 1 }],
        mappings: [{ emotion: 'angry', weight: 1, minBand: 'clear' }],
      },
    }]])
    await expect.element(angry.getByRole('slider', { name: /Angry/ })).not.toBeInTheDocument()
    await expect.element(makeCombo).toBeDisabled()
  })

  it('does not carry a selected combo chip into the new combo as a member', async () => {
    const { screen } = await renderReactions(boothEntries())
    const happy = rowOf(screen, 'happy')
    await happy.getByRole('switch', { name: k('select', { label: 'Happy look' }), exact: true }).click()
    await happy.getByRole('switch', { name: k('select', { label: 'Tail' }), exact: true }).click()
    await happy.getByRole('button', { name: k('make-combo'), exact: true }).click()
    await expect.element(happy.getByRole('slider', { name: /Tail/ })).toBeVisible()
    await expect.element(happy.getByRole('slider', { name: /Happy look/ })).not.toBeInTheDocument()
  })

  it('renders the Expressions tab as Reactions, then Combos, then Everything else', async () => {
    const { default: Section } = await import('./panel.vue')
    await import('virtual:uno.css')
    const screen = await render(Section, {
      props: { snapshot: { entries: boothEntries(), groups: [], activeIds: [], restIds: [], freeParameters: [] }, enabled: true, search: '', showAll: false, onCommand: vi.fn() },
      global: { plugins: [createPinia(), createTestI18n()] },
    })
    const headings = screen.getByRole('heading', { level: 3 }).all().map(heading => heading.element().textContent?.trim())
    expect(headings).toEqual([k('title'), t('settings.live2d.expressions.combos.title'), t('settings.live2d.expressions.areas.title')])
  })

  it.each([
    { width: 1280, theme: 'light', size: 'desktop' },
    { width: 1280, theme: 'dark', size: 'desktop' },
    { width: 390, theme: 'light', size: 'mobile' },
    { width: 390, theme: 'dark', size: 'mobile' },
  ])('keeps the Angry row inside the viewport ($size $theme)', async ({ width, theme }) => {
    await page.viewport(width, 1200)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.className = 'bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4'
    const { screen } = await renderReactions(boothEntries())
    const angry = rowOf(screen, 'angry')
    for (const control of [
      angry.getByRole('switch', { name: k('select', { label: 'Black Face' }), exact: true }),
      angry.getByRole('button', { name: k('remove', { label: 'Black Face', emotion: emotion('angry') }), exact: true }),
      angry.getByRole('button', { name: k('make-combo'), exact: true }),
      angry.getByRole('combobox', { name: k('add') }),
    ]) {
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeGreaterThanOrEqual(20)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  })
})
