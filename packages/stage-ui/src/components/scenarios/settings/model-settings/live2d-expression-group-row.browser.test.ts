import type { Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

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

type ExpressionEntry = Live2DExpressionSettingsSnapshot['groups'][number]

function expressionEntry(overrides: Partial<ExpressionEntry>): ExpressionEntry {
  return {
    id: 'entry.exp3.json',
    name: 'entry',
    label: 'entry',
    kind: 'outfit',
    group: 'Hair',
    confirmed: true,
    exposedToLlm: false,
    mappings: [],
    fileName: 'entry.exp3.json',
    parameterIds: [],
    active: false,
    effective: overrides.active ?? false,
    overriddenBy: null,
    via: [],
    isDefault: false,
    ...overrides,
  }
}

const hairLabels = ['Black braids', 'White hair braids', 'White hair', 'White ponytail']

function hairMembers(activeId: string | null) {
  return hairLabels.map(label => expressionEntry({ id: `${label}.exp3.json`, name: label, label, active: label === activeId }))
}

async function renderGroupRow(members: ExpressionEntry[]) {
  const { default: GroupRow } = await import('./live2d-expression-group-row.vue')
  await import('virtual:uno.css')
  const onCommand = vi.fn()
  const screen = await render(GroupRow, {
    props: { group: 'Hair', members, groups: [{ name: 'Hair', labels: hairLabels }], onCommand },
    global: { plugins: [createPinia(), createTestI18n()] },
  })
  return { screen, onCommand }
}

describe('live2D expression group row', () => {
  beforeAll(async () => {
    await Promise.all([
      import('./live2d-expression-group-row.vue'),
      import('virtual:uno.css'),
    ])
    for (const key of ['group-select', 'group-option-none', 'group-members', 'group-members-close'])
      expect(t(`settings.live2d.expressions.${key}`)).not.toBe(`settings.live2d.expressions.${key}`)
  }, 60_000)

  afterEach(() => {
    cleanup()
  })

  it('shows the derived group name and the active member in the picker', async () => {
    const { screen } = await renderGroupRow(hairMembers('White hair'))
    await expect.element(screen.getByText('Black braids / White hair braids +2', { exact: true })).toBeVisible()
    const picker = screen.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') })
    await expect.element(picker).toHaveTextContent('White hair')
  })

  it('emits set-active true when another member is chosen', async () => {
    const { screen, onCommand } = await renderGroupRow(hairMembers('White hair'))
    await screen.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') }).click()
    await page.getByRole('option', { name: 'White ponytail', exact: true }).click()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'White ponytail.exp3.json', active: true })
  })

  it('emits exactly one set-active false per active member when None is chosen', async () => {
    const { screen, onCommand } = await renderGroupRow(hairMembers('White hair'))
    await screen.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') }).click()
    await page.getByRole('option', { name: t('settings.live2d.expressions.group-option-none'), exact: true }).click()
    expect(onCommand.mock.calls).toEqual([[{ type: 'set-active', id: 'White hair.exp3.json', active: false }]])
  })

  it('reveals the member rows behind the members toggle and forwards their commands', async () => {
    const { screen, onCommand } = await renderGroupRow(hairMembers(null))
    const switchName = `${t('settings.live2d.expressions.switch')}: Black braids`
    await expect.element(screen.getByRole('switch', { name: switchName, exact: true })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: t('settings.live2d.expressions.group-members'), exact: true })
    await toggle.click()
    await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.group-members-close'), exact: true })).toBeVisible()
    for (const label of hairLabels)
      await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: ${label}`, exact: true })).toBeVisible()
    await screen.getByRole('switch', { name: switchName, exact: true }).click()
    expect(onCommand).toHaveBeenCalledWith({ type: 'set-active', id: 'Black braids.exp3.json', active: true })
  })
})
