import type { CharacterStateApplyResult, CharacterStateInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import en from '@proj-airi/i18n/locales/en'

import { advance, applyEvent, currentWound, DEFAULT_CHARACTER_PROFILE, initialCharacterState, rawAt, readCharacter, remaining, renderCharacterContext } from '@proj-airi/stage-shared/character-state'
import { characterStateContext } from '@proj-airi/stage-ui/stores/character-state'
import { useCharacterStateObservabilityStore } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import CharacterStatePage from './index.vue'

import 'virtual:uno.css'

// The character state store reads only the active card id and the cards' profiles from the card store, whose real
// setup calls `useI18n` and so needs a mounted component.
vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

const PAGE = 'tamagotchi.settings.devtools.pages.character-state'
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const profile = DEFAULT_CHARACTER_PROFILE

const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

function pageText(key: string, params: Record<string, string | number> = {}): string {
  const text = t(`${PAGE}.${key}`, params)
  expect(text).not.toContain(PAGE)
  return text
}

/** A fake leader: a real record driven by the pure reducer, answering the store's leader calls. */
function fakeLeader() {
  let record = applyEvent(initialCharacterState('default', profile, characterStateContext(T0)), { kind: 'significant-positive', id: 'moment-1', atMs: T0, reason: 'shared a good moment' }, profile, characterStateContext(T0))
  let clockOffsetMs = 0
  const now = () => T0 + clockOffsetMs

  function inspect(): CharacterStateInspection {
    const nowMs = now()
    record = advance(record, profile, characterStateContext(nowMs))
    const reading = readCharacter(record, profile, null, characterStateContext(nowMs))
    return {
      leading: true,
      nowMs,
      clockOffsetMs,
      cardId: 'default',
      reading,
      renderedText: renderCharacterContext(reading, characterStateContext(nowMs)),
      raw: rawAt(record.mood.contributions, nowMs),
      contributions: record.mood.contributions.filter(contribution => remaining(contribution, nowMs) > 0).map(contribution => ({ ...contribution, delta: { ...contribution.delta }, remaining: remaining(contribution, nowMs) })),
      temperament: { axes: record.temperament.axes, throughHourMs: record.temperament.throughHourMs },
      relationship: { ...record.relationship, wound: currentWound(record.relationship, nowMs), milestoneIds: [...record.relationship.milestoneIds] },
      history: [...record.history].reverse(),
      lastInteractionAtMs: record.lastInteractionAtMs,
      updatedAtMs: record.updatedAtMs,
    }
  }

  return {
    inspect,
    jump(ms: number) {
      clockOffsetMs += ms
      return { clockOffsetMs, inspection: inspect() }
    },
    apply(event: unknown): CharacterStateApplyResult {
      const candidate = event as { kind?: unknown, atMs?: unknown }
      if (typeof candidate.atMs !== 'number')
        return { status: 'invalid', error: 'atMs: Invalid type: Expected number but received undefined' }
      const next = applyEvent(record, { ...(event as Parameters<typeof applyEvent>[1]), atMs: now() }, profile, characterStateContext(now()))
      const applied = next !== record
      record = next
      return { status: applied ? 'applied' : 'ignored', inspection: inspect() }
    },
    reset() {
      record = initialCharacterState('default', profile, characterStateContext(now()))
      return inspect()
    },
  }
}

describe('character state devtools page', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    cleanup()
    disposePinia(pinia)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function renderPage() {
    return render(CharacterStatePage, { global: { plugins: [pinia, i18n()] } })
  }

  it('shows the timeout message while no leader answers, then the leader state once one appears', async () => {
    const observability = useCharacterStateObservabilityStore(pinia)
    const leader = fakeLeader()
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const inspectLeader = vi.spyOn(observability, 'inspectLeader').mockRejectedValue(timeout)

    const screen = await renderPage()

    await expect.element(screen.getByTestId('character-state-source-error')).toHaveTextContent(pageText('source.error', { error: timeout.message }))
    await expect.element(screen.getByTestId('character-state-source-message')).toHaveTextContent(pageText('source.waiting'))
    expect(screen.container.querySelector('[data-testid="character-state-mood-axes"]')).toBeNull()

    // The leader comes up: the next poll answers.
    inspectLeader.mockImplementation(async () => leader.inspect())
    vi.advanceTimersByTime(1_000)

    await expect.element(screen.getByTestId('character-state-mood-axes')).toBeVisible()
    expect(screen.container.querySelector('[data-testid="character-state-source-error"]')).toBeNull()
    await expect.element(screen.getByTestId('character-state-source-message')).toHaveTextContent(pageText('source.following'))
    await expect.element(screen.getByTestId('character-state-rendered-text')).toHaveTextContent(/^Feeling: good/)
  })

  it('jumps the leader clock, applies and rejects events, and resets, showing the state each answer carried', async () => {
    const observability = useCharacterStateObservabilityStore(pinia)
    const leader = fakeLeader()
    vi.spyOn(observability, 'inspectLeader').mockImplementation(async () => leader.inspect())
    vi.spyOn(observability, 'jumpLeader').mockImplementation(async ms => leader.jump(ms))
    const applyLeader = vi.spyOn(observability, 'applyLeader').mockImplementation(async event => leader.apply(event))
    vi.spyOn(observability, 'resetLeader').mockImplementation(async () => leader.reset())

    const screen = await renderPage()
    await expect.element(screen.getByTestId('character-state-offset')).toHaveTextContent(pageText('controls.offset', { offset: '0h' }))
    await expect.element(screen.getByTestId('character-state-history-empty')).toBeVisible()

    // Stale state: the view after a jump is the advanced one, not the one before.
    await screen.getByTestId('character-state-jump').getByRole('button', { name: pageText('controls.jump-day') }).click()
    await expect.element(screen.getByTestId('character-state-offset')).toHaveTextContent(pageText('controls.offset', { offset: '1d' }))
    await expect.element(screen.getByTestId('character-state-leader-clock')).toHaveTextContent(pageText('source.jumped', { offset: '1d' }))
    await expect.element(screen.getByTestId('character-state-history').getByText('2026-10-20')).toBeVisible()
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(/^Jumped to /)

    // A valid test event is applied at the leader's clock.
    await screen.getByTestId('character-state-apply-action').click()
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(/Applied touch-pleasant at/)
    expect(applyLeader).toHaveBeenCalledWith(expect.objectContaining({ kind: 'touch-pleasant' }))

    // Malformed input: the leader's rejection is shown and nothing changes.
    applyLeader.mockImplementationOnce(async () => leader.apply({ kind: 'hurtful' }))
    await screen.getByTestId('character-state-apply-action').click()
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(/The leader rejected the event: atMs: Invalid type/)

    await page.viewport(1280, 1800)
    await page.screenshot({ path: '../../../../../../.omo/evidence/layered-character-state/task-20-page.png' })

    // Reset clears the card's state but keeps the clock offset.
    await screen.getByTestId('character-state-reset-action').click()
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(/^The card's state was reset at /)
    await expect.element(screen.getByTestId('character-state-history-empty')).toBeVisible()
    await expect.element(screen.getByTestId('character-state-contributions-empty')).toBeVisible()
    await expect.element(screen.getByTestId('character-state-offset')).toHaveTextContent(pageText('controls.offset', { offset: '1d' }))
  })
})
