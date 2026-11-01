import type { PromptProjectionSnapshot } from '@proj-airi/stage-ui/stores/devtools/context-observability'

import en from '@proj-airi/i18n/locales/en'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ContextFlowPromptProjection from './context-flow-prompt-projection.vue'

import 'virtual:uno.css'

const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

function projection(overrides: Partial<PromptProjectionSnapshot> = {}): PromptProjectionSnapshot {
  return { capturedAt: Date.UTC(2026, 10, 1, 9, 0, 0), sessionId: 'session-a', message: 'hello', contexts: {}, promptText: '', ...overrides }
}

describe('context flow prompt projection', () => {
  afterEach(() => {
    cleanup()
  })

  it('lists one row per reported segment and marks the over-budget ones', async () => {
    const overBudgetLabel = t('tamagotchi.settings.devtools.pages.context-flow.prompt-report.over-budget')
    // A missing locale entry renders the key, which the text query would still match.
    expect(overBudgetLabel).not.toBe('tamagotchi.settings.devtools.pages.context-flow.prompt-report.over-budget')

    const lastProjection = projection({ promptReport: [
      { id: 'format', chars: 400, estimatedTokens: 100, dropped: 0, truncated: false, overBudget: false },
      { id: 'card', chars: 9000, estimatedTokens: 2250, dropped: 0, truncated: false, overBudget: true },
      { id: 'contract', chars: 1200, estimatedTokens: 300, dropped: 0, truncated: false, overBudget: false },
      { id: 'memory', chars: 5800, estimatedTokens: 1450, dropped: 3, truncated: false, overBudget: true },
      { id: 'voice', chars: 1000, estimatedTokens: 250, dropped: 0, truncated: true, overBudget: true },
      { id: 'unprompted', chars: 0, estimatedTokens: 0, dropped: 0, truncated: false, overBudget: false },
    ] })
    const screen = await render(ContextFlowPromptProjection, { props: { currentPromptText: '', currentSourceCount: 0, lastProjection }, global: { plugins: [i18n()] } })

    const table = screen.getByTestId('prompt-report-table')
    await expect.element(table).toBeInTheDocument()
    const body = table.element().querySelector('tbody')
    expect(body?.querySelectorAll('tr').length).toBe(6)
    expect([...body?.querySelectorAll('tr[data-over-budget]') ?? []].map(row => row.getAttribute('data-segment'))).toEqual(['card', 'memory', 'voice'])
    expect(body?.querySelector('tr[data-segment="card"]')?.textContent).toMatch(new RegExp(`card\\s*9000\\s*2250\\s*${overBudgetLabel}`))
    expect(body?.querySelector('tr[data-segment="memory"]')?.textContent).toContain(t('tamagotchi.settings.devtools.pages.context-flow.prompt-report.dropped', { count: 3 }))
    expect(body?.querySelector('tr[data-segment="voice"]')?.textContent).toContain(t('tamagotchi.settings.devtools.pages.context-flow.prompt-report.truncated'))
    expect(body?.querySelector('tr[data-segment="format"]')?.textContent).toMatch(/format\s*400\s*100\s*-/)
    await expect.element(screen.getByTestId('prompt-report-total')).toHaveTextContent(/17400\s*4350/)
  })

  it('shows the empty state when the projection carries no report', async () => {
    const screen = await render(ContextFlowPromptProjection, { props: { currentPromptText: '', currentSourceCount: 0, lastProjection: projection() }, global: { plugins: [i18n()] } })

    await expect.element(screen.getByTestId('prompt-report-empty')).toHaveTextContent(t('tamagotchi.settings.devtools.pages.context-flow.prompt-report.empty'))
    expect(screen.container.querySelector('[data-testid="prompt-report-table"]')).toBeNull()
  })
})
