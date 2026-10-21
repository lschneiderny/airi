import type { ActComplianceRecord } from '@proj-airi/stage-ui/stores/devtools/act-compliance'

import en from '@proj-airi/i18n/locales/en'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import SituationActCompliance from './situation-act-compliance.vue'

import 'virtual:uno.css'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

function record(turnId: string, overrides: Partial<ActComplianceRecord> = {}): ActComplianceRecord {
  return { turnId, atMs: T0, origin: 'user', declined: false, act: 0, recovered: 0, rejected: 0, rejectedTokens: [], stripped: 0, noAct: true, ...overrides }
}

describe('situation ACT compliance panel', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a turn whose only cue was stripped as rejected', async () => {
    const strippedLabel = t('tamagotchi.settings.devtools.pages.situation.act-compliance.stripped')
    // A missing locale entry renders the key, which the text query would still match.
    expect(strippedLabel).not.toBe('tamagotchi.settings.devtools.pages.situation.act-compliance.stripped')

    const records = [
      record('turn-stripped', { atMs: T0 + 2, stripped: 1 }),
      record('turn-parsed', { atMs: T0 + 1, act: 1, stripped: 1, noAct: false }),
      record('turn-none'),
    ]
    const screen = await render(SituationActCompliance, { props: { records }, global: { plugins: [i18n()] } })

    const table = screen.getByTestId('act-compliance-turns')
    await expect.element(table.getByText(strippedLabel, { exact: true })).toBeInTheDocument()
    const rows = table.getByRole('row')
    await expect.element(rows.nth(1)).toHaveTextContent(/turn-stripped\s*user\s*rejected\s*0\s*0\s*0\s*1/)
    await expect.element(rows.nth(2)).toHaveTextContent(/turn-parsed\s*user\s*parsed\s*1\s*0\s*0\s*1/)
    await expect.element(rows.nth(3)).toHaveTextContent(/turn-none\s*user\s*none\s*0\s*0\s*0\s*0/)

    const rates = screen.getByTestId('act-compliance-rates')
    await expect.element(rates.getByText('Rejected')).toBeVisible()
    expect(rates.element().querySelector('[data-outcome="rejected"]')?.textContent).toMatch(/Rejected\s*1\s*33%/)
    expect(rates.element().querySelector('[data-outcome="none"]')?.textContent).toMatch(/None\s*1\s*33%/)
  })
})
