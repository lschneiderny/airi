import type { SituationEvent } from '@proj-airi/stage-shared/situation'
import type { SituationReactionInspection, SituationReactionOutcome } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import en from '@proj-airi/i18n/locales/en'

import { initialReactionMemory, initialSituationState } from '@proj-airi/stage-shared/situation'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import SituationReactions from './situation-reactions.vue'

import 'virtual:uno.css'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const SEC = 1_000
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

const REACTIONS = 'tamagotchi.settings.devtools.pages.situation.reactions'

/** Shipped English copy for a reactions key; a missing locale entry renders the key, which would match nothing real. */
function reactionsText(key: string, params: Record<string, string> = {}): string {
  const text = t(`${REACTIONS}.${key}`, params)
  expect(text).not.toContain(REACTIONS)
  return text
}

const NO_OUTCOME: SituationReactionOutcome = { spoken: 0, declined: 0, cancelled: 0, failed: 0, refused: 0 }

function touchEvent(overrides: Partial<SituationEvent> = {}): SituationEvent {
  return {
    id: 'touch-1',
    kind: 'touch',
    topicKey: 'touch:pet',
    text: 'The user petted your head for 4s.',
    atMs: T0 - 5 * SEC,
    salience: 0.45,
    halfLifeMs: 60 * SEC,
    tier: 0,
    origin: 'world',
    shownAtMs: T0 - 2 * SEC,
    addressedAtMs: null,
    ...overrides,
  }
}

function reactions(overrides: Partial<SituationReactionInspection> = {}): SituationReactionInspection {
  return {
    decision: { speak: false, kind: 'pet-soft', reason: 'refractory', roll: null, probability: null, atMs: T0 - 5 * SEC },
    memory: { ...initialReactionMemory(7), sessionId: 'chat-a', petsSeen: 3, lastLineAtMs: T0 - 30 * SEC, lastAttemptAtMs: T0 - 30 * SEC },
    refractoryRemainingMs: 15 * SEC,
    retryRemainingMs: 0,
    pending: { kind: 'poke-protest', eventId: 'touch-0', atMs: T0 - 10 * SEC },
    outcomes: { 'pet-soft': { ...NO_OUTCOME, spoken: 2, declined: 1 }, 'poke-protest': { ...NO_OUTCOME, refused: 4 } },
    ...overrides,
  }
}

function renderPanel(inspection: SituationReactionInspection, events: readonly SituationEvent[], pokeTimes: readonly number[] = []) {
  return render(SituationReactions, {
    props: { reactions: inspection, events, tracking: { ...initialSituationState.tracking, pokeTimes }, nowMs: T0 },
    global: { plugins: [i18n()] },
  })
}

function row(container: Element, id: string): string | undefined {
  return container.querySelector(`[data-row="${id}"]`)?.textContent ?? undefined
}

describe('situation reactions panel', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the last touch, the reaction memory, the last hold with its reason, and the outcome counts', async () => {
    const older = touchEvent({ id: 'touch-0', text: 'The user poked you.', atMs: T0 - 20 * SEC })
    const unrelated: SituationEvent = { ...touchEvent({ id: 'wake-1', text: 'The user woke the computer.' }), kind: 'wake', atMs: T0 - SEC }
    const screen = await renderPanel(reactions(), [older, touchEvent(), unrelated], [T0 - 8 * SEC, T0 - 3 * SEC])

    const touch = screen.getByTestId('situation-reactions-touch').element()
    expect(row(touch, 'text')).toContain('The user petted your head for 4s.')
    expect(row(touch, 'salience')).toContain('0.45')
    expect(row(touch, 'shown')).toContain('2s ago')

    const policy = screen.getByTestId('situation-reactions-policy').element()
    expect(row(policy, 'decision')).toContain(reactionsText('decision-hold', { reason: 'refractory', kind: 'pet-soft', roll: '-', ago: '5s ago' }))
    expect(row(policy, 'pets-seen')).toContain('3')
    expect(row(policy, 'poke-times')).toContain('2: 3s ago, 8s ago')
    expect(row(policy, 'last-line')).toContain('30s ago')
    expect(row(policy, 'pending')).toContain(reactionsText('pending-value', { kind: 'poke-protest', eventId: 'touch-0', ago: '10s ago' }))
    expect(row(policy, 'refractory')).toContain('15s')
    expect(row(policy, 'retry')).toContain(reactionsText('none'))

    const outcomes = screen.getByTestId('situation-reactions-outcomes').element()
    expect(outcomes.querySelector('[data-kind="pet-soft"] [data-status="spoken"]')?.textContent?.trim()).toBe('2')
    expect(outcomes.querySelector('[data-kind="pet-soft"] [data-status="declined"]')?.textContent?.trim()).toBe('1')
    expect(outcomes.querySelector('[data-kind="poke-protest"] [data-status="refused"]')?.textContent?.trim()).toBe('4')
  })

  it('shows a speak decision with its roll against the probability', async () => {
    const screen = await renderPanel(reactions({ decision: { speak: true, kind: 'poke-protest', reason: null, roll: 0.1234, probability: 0.8, atMs: T0 } }), [touchEvent()])

    expect(row(screen.getByTestId('situation-reactions-policy').element(), 'decision'))
      .toContain(reactionsText('decision-speak', { kind: 'poke-protest', roll: '0.123', probability: '0.800', ago: '0s ago' }))
  })

  it('renders "none" when no reaction is pending', async () => {
    const screen = await renderPanel(reactions({ pending: null }), [touchEvent({ shownAtMs: null })])

    expect(row(screen.getByTestId('situation-reactions-policy').element(), 'pending')?.trim()).toMatch(new RegExp(`${reactionsText('none')}$`))
    expect(row(screen.getByTestId('situation-reactions-touch').element(), 'shown')).toContain(reactionsText('not-shown'))
  })

  it('shows the empty state before any touch or policy run', async () => {
    const screen = await renderPanel(reactions({ decision: null, memory: null, refractoryRemainingMs: 0, pending: null, outcomes: { 'pet-soft': NO_OUTCOME, 'poke-protest': NO_OUTCOME } }), [])

    await expect.element(screen.getByText(reactionsText('last-touch-empty'))).toBeVisible()
    await expect.element(screen.getByText(reactionsText('not-started'))).toBeVisible()
    const policy = screen.getByTestId('situation-reactions-policy').element()
    expect(row(policy, 'decision')).toMatch(/-$/)
    expect(row(policy, 'pets-seen')).toMatch(/-$/)
    expect(row(policy, 'pending')).toContain(reactionsText('none'))
    expect(screen.getByTestId('situation-reactions-outcomes').element().querySelector('[data-kind="poke-protest"] [data-status="spoken"]')?.textContent?.trim()).toBe('0')
  })
})
