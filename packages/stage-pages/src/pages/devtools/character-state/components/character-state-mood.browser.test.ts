import type { CharacterStateInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import en from '@proj-airi/i18n/locales/en'

import { advance, applyEvent, currentWound, DEFAULT_CHARACTER_PROFILE, initialCharacterState, rawAt, readCharacter, remaining, renderCharacterContext } from '@proj-airi/stage-shared/character-state'
import { characterStateContext } from '@proj-airi/stage-ui/stores/character-state'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import CharacterStateContributions from './character-state-contributions.vue'
import CharacterStateHistory from './character-state-history.vue'
import CharacterStateMood from './character-state-mood.vue'
import CharacterStateRelationship from './character-state-relationship.vue'

import 'virtual:uno.css'

const PAGE = 'tamagotchi.settings.devtools.pages.character-state'
// 8 pm local time, two days after the record started, so one day has rolled over into history.
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const DAY_MS = 24 * 3_600_000
const NOW = T0 + DAY_MS + 2 * 3_600_000

const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
const { t } = i18n().global

/** Shipped English copy for a page key; a missing locale entry renders the key, which would match nothing real. */
function pageText(key: string, params: Record<string, string | number> = {}): string {
  const text = t(`${PAGE}.${key}`, params)
  expect(text).not.toContain(PAGE)
  return text
}

/**
 * A record built through the real reducer: a significant positive moment at T0, a day's rollover, and a hurtful
 * event two hours before `NOW`, read at `NOW`.
 */
function seededInspection(): CharacterStateInspection {
  const profile = DEFAULT_CHARACTER_PROFILE
  const started = initialCharacterState('default', profile, characterStateContext(T0))
  const moment = applyEvent(started, { kind: 'significant-positive', id: 'moment-1', atMs: T0, reason: 'shared a good moment' }, profile, characterStateContext(T0))
  const hurt = applyEvent(advance(moment, profile, characterStateContext(NOW - 2 * 3_600_000)), { kind: 'hurtful', id: 'hurt-1', atMs: NOW - 2 * 3_600_000, reason: 'he said something cruel' }, profile, characterStateContext(NOW - 2 * 3_600_000))
  const record = advance(hurt, profile, characterStateContext(NOW))
  const reading = readCharacter(record, profile, null, characterStateContext(NOW))
  return {
    leading: true,
    nowMs: NOW,
    clockOffsetMs: DAY_MS,
    cardId: 'default',
    reading,
    renderedText: renderCharacterContext(reading, characterStateContext(NOW)),
    raw: rawAt(record.mood.contributions, NOW),
    contributions: record.mood.contributions.map(contribution => ({ ...contribution, delta: { ...contribution.delta }, remaining: remaining(contribution, NOW) })),
    temperament: { axes: record.temperament.axes, throughHourMs: record.temperament.throughHourMs },
    relationship: { ...record.relationship, wound: currentWound(record.relationship, NOW), milestoneIds: [...record.relationship.milestoneIds] },
    history: [...record.history].reverse(),
    lastInteractionAtMs: record.lastInteractionAtMs,
    updatedAtMs: record.updatedAtMs,
  }
}

describe('character state panels', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the mood axes, the rendered text, and the shown reasons of a seeded record', async () => {
    const inspection = seededInspection()
    const screen = await render(CharacterStateMood, { props: { inspection }, global: { plugins: [i18n()] } })

    const axes = screen.getByTestId('character-state-mood-axes')
    await expect.element(axes.getByText(pageText('mood.axis-names.valence'), { exact: true })).toBeVisible()
    const valenceRow = axes.element().querySelector('[data-axis="valence"]')?.textContent ?? ''
    expect(valenceRow).toContain(inspection.reading!.mood.valence.toFixed(3))
    expect(valenceRow).toContain(inspection.reading!.buckets.valence)
    expect(axes.element().querySelector('[data-axis="tension"]')?.textContent).toContain(inspection.reading!.buckets.tension)

    const text = screen.getByTestId('character-state-rendered-text')
    await expect.element(text).toHaveTextContent(/^Feeling: /)
    expect(text.element().textContent).toBe(inspection.renderedText)
    expect(text.element().textContent).not.toMatch(/\d/)

    const reasons = screen.getByTestId('character-state-reasons')
    await expect.element(reasons.getByText('he said something cruel')).toBeVisible()
    expect(reasons.element().textContent).not.toContain(pageText('mood.no-reasons'))
  })

  it('lists every live contribution with its remaining weight, oldest first', async () => {
    const inspection = seededInspection()
    const screen = await render(CharacterStateContributions, { props: { contributions: inspection.contributions, nowMs: NOW }, global: { plugins: [i18n()] } })

    const table = screen.getByTestId('character-state-contributions')
    await expect.element(table.getByText(pageText('contributions.columns.remaining'), { exact: true })).toBeVisible()
    const rows = [...table.element().querySelectorAll('tbody tr')].map(row => row.getAttribute('data-contribution'))
    expect(rows).toEqual(['moment-1', 'hurt-1'])
    // 26 h into a 9 h half-life leaves 2^(-26/9) of the moment.
    expect(table.element().querySelector('[data-contribution="moment-1"]')?.textContent).toMatch(/significant.*shared a good moment.*\+0\.250 \/ \+0\.100 \/ 0\.000.*9h 00m.*14%/s)
    expect(table.element().querySelector('[data-contribution="hurt-1"]')?.textContent).toMatch(/2h 00m ago.*he said something cruel.*-0\.250 \/ -0\.100 \/ 0\.150.*86%/s)
  })

  it('renders the relationship levels, stages, wound, and unlocks', async () => {
    const inspection = seededInspection()
    const screen = await render(CharacterStateRelationship, { props: { inspection }, global: { plugins: [i18n()] } })

    const table = screen.getByTestId('character-state-relationship')
    await expect.element(table.getByText(pageText('relationship.dimensions.trust'), { exact: true })).toBeVisible()
    expect(table.element().querySelector('[data-dimension="trust"]')?.textContent).toContain(inspection.relationship!.levels.trust.toFixed(3))
    expect(table.element().querySelector('[data-dimension="closeness"]')?.textContent).toContain('stranger')

    const facts = screen.getByTestId('character-state-relationship-facts')
    expect(facts.element().querySelector('[data-fact="unlocks"]')?.textContent).toContain(pageText('relationship.no-unlocks'))
    // A hurtful event two hours ago leaves nearly the full 0.15 wound.
    expect(facts.element().querySelector('[data-fact="wound"]')?.textContent).toMatch(/0\.14\d/)
  })

  it('renders the completed day as a history row, and the empty copy without one', async () => {
    const inspection = seededInspection()
    expect(inspection.history).toHaveLength(1)
    const screen = await render(CharacterStateHistory, { props: { history: inspection.history }, global: { plugins: [i18n()] } })

    const table = screen.getByTestId('character-state-history')
    await expect.element(table.getByText(pageText('history.columns.day'), { exact: true })).toBeVisible()
    expect(table.element().querySelector('[data-day="2026-10-20"]')?.textContent).toContain('stranger, guarded, new')
    cleanup()

    const empty = await render(CharacterStateHistory, { props: { history: [] }, global: { plugins: [i18n()] } })
    await expect.element(empty.getByTestId('character-state-history-empty')).toHaveTextContent(pageText('history.empty'))
  })
})
