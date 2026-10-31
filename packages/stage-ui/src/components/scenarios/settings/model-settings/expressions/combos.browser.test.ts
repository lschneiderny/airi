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

function expressionEntry(overrides: Partial<ExpressionEntry>): ExpressionEntry {
  return {
    id: 'entry.exp3.json',
    name: 'entry',
    label: 'entry',
    kind: 'face',
    group: null,
    confirmed: true,
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

const blush = expressionEntry({ id: 'blush.exp3.json', name: 'blush', label: 'Blush', kind: 'face' })
const sparkle = expressionEntry({ id: 'sparkle.exp3.json', name: 'sparkle', label: 'Sparkle', kind: 'effect', usesOverwrite: true })
const coat = expressionEntry({ id: 'coat.exp3.json', name: 'coat', label: 'Coat', kind: 'outfit' })
const blushCopy = expressionEntry({ id: 'blush2.exp3.json', name: 'blush2', label: 'Blush copy', kind: 'face', duplicateOf: 'blush.exp3.json' })

const happyLook = expressionEntry({
  id: 'combo:happy',
  name: 'combo:happy',
  label: 'Happy look',
  kind: 'combo',
  members: [{ expressionId: 'blush.exp3.json', strength: 1 }, { expressionId: 'sparkle.exp3.json', strength: 0.5 }],
  slots: ['face', 'effect'],
  mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }],
  exposedToLlm: true,
  isDefault: true,
  active: true,
  effective: true,
})
const coatLook = expressionEntry({
  id: 'combo:coat',
  name: 'combo:coat',
  label: 'Coat look',
  kind: 'combo',
  members: [{ expressionId: 'coat.exp3.json', strength: 1 }, { expressionId: 'blush.exp3.json', strength: 1 }],
  slots: [],
  exposedToLlm: false,
})

const baseEntries = [blush, sparkle, coat, blushCopy]

async function renderCombos(entries: ExpressionEntry[]) {
  const { default: Combos } = await import('./combos.vue')
  await import('virtual:uno.css')
  const onCommand = vi.fn()
  const screen = await render(Combos, {
    props: { entries, onCommand },
    global: { plugins: [createPinia(), createTestI18n()] },
  })
  return { screen, onCommand }
}

const k = (key: string) => t(`settings.live2d.expressions.combos.${key}`)

describe('live2D expression combos', () => {
  beforeAll(async () => {
    await Promise.all([
      import('./combos.vue'),
      import('virtual:uno.css'),
    ])
    for (const key of ['title', 'description', 'empty', 'new', 'members', 'add-member', 'strength-hint', 'manual-only', 'save', 'cancel', 'delete', 'delete-confirm', 'marker-ai', 'marker-default'])
      expect(k(key)).not.toBe(`settings.live2d.expressions.combos.${key}`)
  }, 60_000)

  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('dark')
  })

  it('shows the empty state without combos', async () => {
    const { screen } = await renderCombos(baseEntries)
    await expect.element(screen.getByText(k('empty'), { exact: true })).toBeVisible()
  })

  it('renders a card with member chips, percentages, mapped emotions and markers', async () => {
    const { screen } = await renderCombos([...baseEntries, happyLook])
    await expect.element(screen.getByText('Happy look', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Blush', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Sparkle 50%', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.live2d.expressions.emotions.happy'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(k('marker-ai'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(k('marker-default'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(k('manual-only'), { exact: true })).not.toBeInTheDocument()
  })

  it('shows the manual-only note and no AI marker for a combo with an outfit member', async () => {
    const { screen } = await renderCombos([...baseEntries, coatLook])
    await expect.element(screen.getByText(k('manual-only'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(k('marker-ai'), { exact: true })).not.toBeInTheDocument()
  })

  it('emits set-active from the on/off switch', async () => {
    const { screen, onCommand } = await renderCombos([...baseEntries, happyLook])
    const toggle = screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Happy look` })
    await expect.element(toggle).toBeChecked()
    await toggle.click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'combo:happy', active: false })
  })

  it('creates a combo with members and strengths, and keeps Save disabled while the label is empty', async () => {
    const { screen, onCommand } = await renderCombos(baseEntries)
    await screen.getByRole('button', { name: k('new'), exact: true }).click()
    const save = screen.getByRole('button', { name: k('save'), exact: true })
    await expect.element(save).toBeDisabled()

    const picker = screen.getByRole('combobox', { name: k('add-member') })
    await picker.click()
    await screen.getByRole('option', { name: 'Blush', exact: true }).click()
    await expect.element(screen.getByRole('slider', { name: /Blush/ })).toBeVisible()
    await expect.element(save).toBeDisabled()

    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Soft blush')
    await expect.element(save).toBeEnabled()

    // The Range primitive scales its native input to 0..10000, so 5000 is a strength of 0.5.
    await screen.getByRole('slider', { name: /Blush/ }).fill('5000')
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await screen.getByRole('button', { name: t('settings.live2d.expressions.add-mapping'), exact: true }).click()
    const weight = screen.getByRole('spinbutton', { name: `${t('settings.live2d.expressions.fields.weight')} 1` })
    await expect.element(weight).toHaveValue(1)
    await weight.fill('0')
    await expect.element(screen.getByText(t('settings.live2d.expressions.validation.weight-range', { min: 0.1, max: 5 }), { exact: true })).toBeVisible()
    await expect.element(save).toBeDisabled()
    await weight.fill('2')
    await expect.element(save).toBeEnabled()

    await save.click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'create-combo',
      combo: { label: 'Soft blush', members: [{ expressionId: 'blush.exp3.json', strength: 0.5 }], mappings: [{ emotion: 'happy', weight: 2, minBand: 'clear' }] },
    })
    await expect.element(screen.getByRole('button', { name: k('new'), exact: true })).toBeVisible()
  })

  it('offers only non-combo, non-duplicate, non-member entries as new members', async () => {
    const { screen } = await renderCombos([...baseEntries, happyLook, coatLook])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).first().click()
    await screen.getByRole('combobox', { name: k('add-member') }).click()
    await expect.element(screen.getByRole('option', { name: 'Coat', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: 'Blush', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Sparkle', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Blush copy', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: 'Coat look', exact: true })).not.toBeInTheDocument()
  })

  it('shows the Overwrite strength hint only under a member that uses Overwrite', async () => {
    const { screen } = await renderCombos([...baseEntries, happyLook])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const hints = screen.getByText(k('strength-hint'), { exact: true })
    await expect.element(hints).toBeVisible()
    expect(hints.all()).toHaveLength(1)
    const sparkleField = screen.getByRole('slider', { name: /Sparkle/ }).element().closest('.rounded-lg')
    expect(sparkleField?.textContent).toContain(k('strength-hint'))
    const blushField = screen.getByRole('slider', { name: /Blush/ }).element().closest('.rounded-lg')
    expect(blushField?.textContent).not.toContain(k('strength-hint'))
  })

  it('saves update-combo for an existing combo with the AI toggle', async () => {
    const { screen, onCommand } = await renderCombos([...baseEntries, happyLook])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('switch', { name: t('settings.live2d.expressions.llm-exposed'), exact: true }).click()
    await screen.getByRole('button', { name: k('save'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update-combo',
      id: 'combo:happy',
      patch: {
        label: 'Happy look',
        members: [{ expressionId: 'blush.exp3.json', strength: 1 }, { expressionId: 'sparkle.exp3.json', strength: 0.5 }],
        mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }],
        exposedToLlm: false,
      },
    })
  })

  it('offers Area for a new combo and sends it on create', async () => {
    const { screen, onCommand } = await renderCombos(baseEntries)
    await screen.getByRole('button', { name: k('new'), exact: true }).click()
    await screen.getByRole('combobox', { name: k('add-member') }).click()
    await screen.getByRole('option', { name: 'Blush', exact: true }).click()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Soft blush')
    await screen.getByRole('combobox', { name: new RegExp(t('settings.live2d.expressions.fields.area')) }).click()
    await screen.getByRole('option', { name: t('settings.live2d.expressions.areas.cheeks'), exact: true }).click()
    await screen.getByRole('button', { name: k('save'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({
      type: 'create-combo',
      combo: { label: 'Soft blush', members: [{ expressionId: 'blush.exp3.json', strength: 1 }], mappings: [], area: 'cheeks' },
    })
  })

  it('sends area null when None is picked on a combo that has an area', async () => {
    const { screen, onCommand } = await renderCombos([...baseEntries, { ...happyLook, area: 'cheeks' }])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('combobox', { name: new RegExp(t('settings.live2d.expressions.fields.area')) }).click()
    await screen.getByRole('option', { name: t('settings.live2d.expressions.group-none'), exact: true }).click()
    await screen.getByRole('button', { name: k('save'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'update-combo', id: 'combo:happy', patch: expect.objectContaining({ area: null }) }))
  })

  it('sends no area key when a combo is re-saved with the Area select untouched', async () => {
    const { screen, onCommand } = await renderCombos([...baseEntries, { ...happyLook, area: 'cheeks' }])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('button', { name: k('save'), exact: true }).click()
    expect(onCommand.mock.calls[0][0].patch).not.toHaveProperty('area')
  })

  it('asks before deleting and sends delete-combo only when confirmed', async () => {
    const { screen, onCommand } = await renderCombos([...baseEntries, coatLook])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('button', { name: k('delete'), exact: true }).click()
    const question = screen.getByText(t('settings.live2d.expressions.combos.delete-confirm', { label: 'Coat look' }), { exact: true })
    await expect.element(question).toBeVisible()
    expect(onCommand).not.toHaveBeenCalled()

    await screen.getByRole('alertdialog').getByRole('button', { name: k('cancel'), exact: true }).click()
    await expect.element(question).not.toBeInTheDocument()
    expect(onCommand).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: k('delete'), exact: true }).click()
    await screen.getByRole('alertdialog').getByRole('button', { name: k('delete'), exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({ type: 'delete-combo', id: 'combo:coat' })
  })

  it.each([
    { width: 1280, theme: 'light', size: 'desktop' },
    { width: 1280, theme: 'dark', size: 'desktop' },
    { width: 390, theme: 'light', size: 'mobile' },
    { width: 390, theme: 'dark', size: 'mobile' },
  ])('keeps two cards inside the viewport ($size $theme)', async ({ width, theme }) => {
    await page.viewport(width, 1000)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.className = 'bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4'
    const { screen } = await renderCombos([...baseEntries, happyLook, coatLook])
    await expect.element(screen.getByText(k('manual-only'), { exact: true })).toBeVisible()
    for (const control of [
      screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Happy look` }),
      screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Coat look` }),
      screen.getByRole('button', { name: k('new'), exact: true }),
    ]) {
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeGreaterThanOrEqual(20)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  })
})
