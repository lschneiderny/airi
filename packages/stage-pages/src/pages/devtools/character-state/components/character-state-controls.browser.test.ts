import type { CharacterEvent } from '@proj-airi/stage-shared/character-state'

import en from '@proj-airi/i18n/locales/en'

import { applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '@proj-airi/stage-shared/character-state'
import { characterStateContext } from '@proj-airi/stage-ui/stores/character-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import CharacterStateControls from './character-state-controls.vue'
import CharacterStateSource from './character-state-source.vue'

import { TEST_EVENT_KINDS, testEvent } from '../character-state-test-events'

import 'virtual:uno.css'

const PAGE = 'tamagotchi.settings.devtools.pages.character-state'
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const DAY_MS = 24 * 3_600_000

const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

/** Shipped English copy for a page key; a missing locale entry renders the key, which would match nothing real. */
function pageText(key: string, params: Record<string, string | number> = {}): string {
  const text = t(`${PAGE}.${key}`, params)
  expect(text).not.toContain(PAGE)
  return text
}

describe('character state controls', () => {
  afterEach(() => {
    cleanup()
  })

  it('builds an event of every offered kind that the reducer accepts', () => {
    const profile = DEFAULT_CHARACTER_PROFILE
    const context = characterStateContext(T0)
    const fresh = initialCharacterState('default', profile, context)
    for (const kind of TEST_EVENT_KINDS) {
      const event = { ...testEvent(kind), atMs: T0 }
      expect(event.kind).toBe(kind)
      // Every kind changes the fresh state, so none is dropped as malformed or inapplicable.
      expect(applyEvent(fresh, event, profile, context), kind).not.toBe(fresh)
    }
    expect(testEvent('touch-pleasant').id).not.toBe(testEvent('touch-pleasant').id)
  })

  it('emits the jump sizes, the selected test event, and the reset, and shows the current offset', async () => {
    const onJump = vi.fn<(ms: number) => void>()
    const onApply = vi.fn<(event: CharacterEvent) => void>()
    const onReset = vi.fn()
    const screen = await render(CharacterStateControls, {
      props: { clockOffsetMs: DAY_MS + 3_600_000, busy: false, onJump, onApply, onReset },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByTestId('character-state-offset')).toHaveTextContent(pageText('controls.offset', { offset: '1d 1h' }))
    const jump = screen.getByTestId('character-state-jump')
    await jump.getByRole('button', { name: pageText('controls.jump-hour') }).click()
    await jump.getByRole('button', { name: pageText('controls.jump-day') }).click()
    await jump.getByRole('button', { name: pageText('controls.jump-week') }).click()
    expect(onJump.mock.calls.map(([ms]) => ms)).toEqual([3_600_000, DAY_MS, 7 * DAY_MS])

    await screen.getByTestId('character-state-apply-action').click()
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({ kind: 'touch-pleasant' })

    await screen.getByTestId('character-state-reset-action').click()
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('shows the outcome of the last action, a rejected event as an error, and a leader failure', async () => {
    const screen = await render(CharacterStateControls, {
      props: { clockOffsetMs: 0, busy: false, outcome: { action: 'apply', atMs: T0, kind: 'hurtful', status: 'applied' } },
      global: { plugins: [i18n()] },
    })
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(/Applied hurtful at/)

    await screen.rerender({ clockOffsetMs: 0, busy: false, outcome: { action: 'apply', atMs: T0, kind: 'hurtful', status: 'invalid', error: 'atMs: Invalid type' } })
    await expect.element(screen.getByTestId('character-state-controls-outcome')).toHaveTextContent(pageText('controls.invalid', { error: 'atMs: Invalid type' }))

    await screen.rerender({ clockOffsetMs: 0, busy: true, error: 'The leader window did not answer.' })
    await expect.element(screen.getByTestId('character-state-controls-error')).toHaveTextContent(pageText('controls.failed', { error: 'The leader window did not answer.' }))
    await expect.element(screen.getByTestId('character-state-apply-action')).toBeDisabled()
  })
})

describe('character state source', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the leader clock with its jump, and the follower explanation', async () => {
    const screen = await render(CharacterStateSource, {
      props: { localLeading: false, sourceLeading: true, leaderNowMs: T0 + DAY_MS, clockOffsetMs: DAY_MS, cardId: 'default', inspectedAtMs: T0 },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByTestId('character-state-window-role')).toHaveTextContent(pageText('source.this-window', { role: pageText('source.follower') }))
    await expect.element(screen.getByTestId('character-state-leader-clock')).toHaveTextContent(pageText('source.jumped', { offset: '1d' }))
    await expect.element(screen.getByTestId('character-state-source-message')).toHaveTextContent(pageText('source.following'))
  })

  it('shows the timeout error while no leader answers', async () => {
    const screen = await render(CharacterStateSource, {
      props: { localLeading: false, sourceLeading: null, error: 'The operation was aborted due to timeout' },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByTestId('character-state-source-message')).toHaveTextContent(pageText('source.waiting'))
    await expect.element(screen.getByTestId('character-state-source-error')).toHaveTextContent(pageText('source.error', { error: 'The operation was aborted due to timeout' }))
  })
})
