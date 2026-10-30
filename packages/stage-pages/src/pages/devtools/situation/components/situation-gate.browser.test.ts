import type { Reason, UrgeGateDecision, UrgeGateTrace } from '@proj-airi/stage-shared/situation'
import type { SituationUrgeInspection } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import en from '@proj-airi/i18n/locales/en'

import { initialUrgeMemory } from '@proj-airi/stage-shared/situation'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import SituationGate from './situation-gate.vue'

import { formatClock } from '../situation-format'

import 'virtual:uno.css'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

const GATE = 'tamagotchi.settings.devtools.pages.situation.gate'

/** Shipped English copy for a gate key; a missing locale entry renders the key, which would match nothing real. */
function gateText(key: string, params: Record<string, string> = {}): string {
  const text = t(`${GATE}.${key}`, params)
  expect(text).not.toContain(GATE)
  return text
}

function trace(overrides: Partial<UrgeGateTrace> = {}): UrgeGateTrace {
  return {
    nowMs: T0,
    chattiness: 0.5,
    hazardPerHour: { open: 0.25, continuation: 0, ritual: 0, due: 0.125, total: 0.375 },
    multipliers: { base: 0.6, pressure: 1, exchange: 1, clear: 1, damping: 0.5, floor: 1, game: 1 },
    urge: 0.3,
    urgeThreshold: 1.2,
    expectedWaitMs: 12 * 60_000,
    phase: 'continuation-window',
    unanswered: 1,
    reopenAtMs: T0 + 30 * 60_000,
    doubleTextDueAtMs: null,
    rituals: null,
    reasons: [],
    pick: { categoryRoll: 0.1234, reasonRoll: 0.5678, category: 'due', reasonKey: 'thread:abc' },
    firesLastHour: 2,
    pendingTopicKey: null,
    forceTiming: false,
    ...overrides,
  }
}

function urge(traceOverrides: Partial<UrgeGateTrace> = {}): SituationUrgeInspection {
  return {
    trace: trace(traceOverrides),
    decision: { fire: false, reason: 'awaiting-reply', category: null, topicKey: null, atMs: T0 },
    history: [{ fromMs: T0 - 60_000, toMs: T0, count: 61, fire: false, reason: 'awaiting-reply', category: null, topicKey: null }],
    memory: initialUrgeMemory,
  }
}

function renderGate(inspection: SituationUrgeInspection) {
  return render(SituationGate, { props: { urge: inspection, nowMs: T0, evaluating: false }, global: { plugins: [i18n()] } })
}

describe('situation gate panel', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the urge as a share of its threshold with the phase and the timing rows', async () => {
    const phaseLabel = t('tamagotchi.settings.devtools.pages.situation.gate.phase')
    // A missing locale entry renders the key, which the text query would still match.
    expect(phaseLabel).not.toBe('tamagotchi.settings.devtools.pages.situation.gate.phase')

    const screen = await renderGate(urge())

    await expect.element(screen.getByTestId('situation-gate-urge-percent')).toHaveTextContent('25%')
    const rows = screen.getByTestId('situation-gate-rows')
    await expect.element(rows.getByText(phaseLabel, { exact: true })).toBeVisible()
    expect(rows.element().querySelector('[data-row="phase"]')?.textContent).toMatch(/continuation-window/)
    expect(rows.element().querySelector('[data-row="expected-wait"]')?.textContent).toMatch(/~12 min/)
    expect(rows.element().querySelector('[data-row="reopen-at"]')?.textContent).toMatch(/in 30m 00s/)
    expect(rows.element().querySelector('[data-row="pick"]')?.textContent).toMatch(/due: thread:abc \(rolls 0\.123 \/ 0\.568\)/)
    const decisionRow = rows.element().querySelector('[data-row="decision"]')?.textContent
    expect(decisionRow).toContain('awaiting-reply')
    expect(decisionRow).toContain(gateText('reason-kinds.timing'))
    expect(decisionRow).not.toContain(gateText('reason-kinds.suppressor'))
    expect(screen.getByTestId('situation-gate-hazards').element().querySelector('[data-hazard="total"]')?.textContent).toMatch(/total\s*0\.375/)
    expect(screen.getByTestId('situation-gate-multipliers').element().querySelector('[data-multiplier="damping"]')?.textContent).toMatch(/damping\s*0\.500/)
    await expect.element(screen.getByTestId('situation-gate-history').getByRole('row').nth(1)).toHaveTextContent(/hold\s*-\s*awaiting-reply/)
  })

  it('shows -- instead of Infinity% when the threshold is 0', async () => {
    const screen = await renderGate(urge({ urge: 0.3, urgeThreshold: 0 }))

    await expect.element(screen.getByTestId('situation-gate-urge-percent')).toHaveTextContent('--')
    expect(screen.getByTestId('situation-gate-urge').element().textContent).not.toMatch(/Infinity|NaN/)
  })

  it('reports an "Evaluate now" result with the urge gate reason, its group, and the picked reason', async () => {
    const picked: Reason = { key: 'thread:abc', kind: 'thread-question', category: 'open', text: 'how his interview went', sourceEventId: null, ripeness: 1, weight: 1, urgent: false, dueAtMs: null, dueNow: false }
    const evaluate = (decision: UrgeGateDecision) => render(SituationGate, {
      props: { urge: urge(), nowMs: T0, evaluating: false, evaluation: { atMs: T0, result: { status: 'evaluated', decision, memory: initialUrgeMemory } } },
      global: { plugins: [i18n()] },
    })

    const forced = await evaluate({ fire: true, reason: 'forced', category: 'open', topicKey: picked.key, topicText: picked.text, picked, trace: trace({ forceTiming: true }) })
    const at = formatClock(T0)
    await expect.element(forced.getByTestId('situation-gate-evaluation'))
      .toHaveTextContent(gateText('evaluation.fired', { at, topic: 'thread:abc', reason: 'forced', category: 'open', kind: 'thread-question' }))
    cleanup()

    const held = await evaluate({ fire: false, reason: 'dont-disturb', trace: trace({ forceTiming: true }) })
    await expect.element(held.getByTestId('situation-gate-evaluation'))
      .toHaveTextContent(gateText('evaluation.held', { at, reason: 'dont-disturb', group: gateText('reason-kinds.suppressor') }))
  })
})
