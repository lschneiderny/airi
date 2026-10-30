import type { Reason, ReasonKind, Thread } from '@proj-airi/stage-shared/situation'
import type { SituationExtraction, SituationReasonOutcome, SituationReasonOutcomes } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import en from '@proj-airi/i18n/locales/en'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import SituationReasons from './situation-reasons.vue'

import 'virtual:uno.css'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const HOUR_MS = 60 * 60_000
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

const NONE: SituationReasonOutcome = { spoken: 0, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 0 }
const KINDS: readonly ReasonKind[] = [
  'thread-question',
  'thread-event',
  'thread-later',
  'thread-topic',
  'ritual-greeting',
  'ritual-sign-off',
  'ritual-welcome-back',
  'own-day',
  'continuation',
  'double-text',
  'long-session',
  'returned',
  'notify',
]

function outcomes(overrides: Partial<SituationReasonOutcomes> = {}): SituationReasonOutcomes {
  return { ...Object.fromEntries(KINDS.map(kind => [kind, NONE])) as Record<ReasonKind, SituationReasonOutcome>, ...overrides }
}

const thread: Thread = {
  id: 'thread-1',
  topicKey: 'thread:dentist',
  sessionId: 'session-1',
  kind: 'event',
  summary: 'He has a dentist appointment this afternoon',
  cue: 'ask how the dentist went',
  bornAtMs: T0 - HOUR_MS,
  dueAtMs: null,
  raisedCount: 0,
  lastRaisedAtMs: null,
  expiresAtMs: T0 + 24 * HOUR_MS,
}

const reason: Reason = {
  key: 'thread:dentist',
  kind: 'thread-event',
  category: 'due',
  text: 'ask how the dentist went',
  sourceEventId: null,
  ripeness: 0.4567,
  weight: 0.12345,
  urgent: false,
  dueAtMs: null,
  dueNow: false,
}

const extraction: SituationExtraction = {
  inFlight: false,
  ledger: [{ atMs: T0 - HOUR_MS, sessionId: 'session-1', requestChars: 1234, messageCount: 6, status: 'ok', threads: [{ kind: 'event', summary: thread.summary }], error: null }],
}

describe('situation reasons panel', () => {
  afterEach(() => {
    cleanup()
  })

  it('lists reasons, threads, extraction attempts, and outcomes per reason kind', async () => {
    const screen = await render(SituationReasons, {
      props: { reasons: [reason], threads: [thread], extraction, outcomes: outcomes({ 'thread-event': { ...NONE, spoken: 2, declined: 1, engaged: 1, ignored: 1 } }), nowMs: T0 },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByTestId('situation-reasons').getByRole('row').nth(1)).toHaveTextContent(/thread-event\s*due\s*ask how the dentist went\s*0\.46\s*0\.123\s*no/)
    // An event thread without a due time starts ripening 90 minutes after its birth, 30 minutes from now.
    await expect.element(screen.getByTestId('situation-threads').getByRole('row').nth(1)).toHaveTextContent(/event\s*He has a dentist appointment this afternoon\s*1h 00m ago.*in 30m 00s.*in 24h 00m\)\s*0$/)
    await expect.element(screen.getByTestId('situation-extraction').getByRole('row').nth(1)).toHaveTextContent(/ok\s*1234\s*event: He has a dentist appointment this afternoon\s*-/)
    expect(screen.getByTestId('situation-outcomes').element().querySelector('[data-outcome-kind="thread-event"]')?.textContent).toMatch(/thread-event\s*2\s*1\s*1\s*1/)
    expect(screen.getByTestId('situation-outcomes').element().querySelectorAll('tbody tr')).toHaveLength(KINDS.length)
  })

  it('shows empty states when there is no reason and no thread', async () => {
    const emptyText = t('tamagotchi.settings.devtools.pages.situation.reasons.current-empty')
    // A missing locale entry renders the key, which the text query would still match.
    expect(emptyText).not.toBe('tamagotchi.settings.devtools.pages.situation.reasons.current-empty')

    const screen = await render(SituationReasons, {
      props: { reasons: [], threads: [], extraction: { inFlight: false, ledger: [] }, outcomes: outcomes(), nowMs: T0 },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByTestId('situation-reasons-empty')).toHaveTextContent(emptyText)
    await expect.element(screen.getByTestId('situation-threads-empty')).toBeVisible()
    expect(screen.container.querySelector('[data-testid="situation-reasons"]')).toBeNull()
  })
})
