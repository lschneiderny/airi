import type { RenderedSituation, SituationState } from '@proj-airi/stage-shared/situation'

import { initialSituationState, reduceSituation, WAKE_TOPIC_KEY } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { SITUATION_RENDER_HISTORY_MAX, situationBlockUsage, useSituationObservabilityStore } from './situation-observability'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

function stateWithWake(): SituationState {
  return reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: T0 }, T0)
}

function rendered(text: string, shownEventIds: string[] = []): RenderedSituation {
  return { text, shownEventIds }
}

describe('situation observability store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps only the newest renders once the history cap is reached', async () => {
    const store = useSituationObservabilityStore()

    const total = SITUATION_RENDER_HISTORY_MAX + 50
    for (let index = 0; index < total; index++)
      store.recordRender(T0 + index * 1_000, rendered(`[Situation ${index}]`))

    expect(store.renders).toHaveLength(SITUATION_RENDER_HISTORY_MAX)
    expect(store.renders[0].nowMs).toBe(T0 + (total - 1) * 1_000)
    expect(store.renders.at(-1)?.nowMs).toBe(T0 + (total - SITUATION_RENDER_HISTORY_MAX) * 1_000)
    expect((await store.inspect()).renders).toHaveLength(SITUATION_RENDER_HISTORY_MAX)
  })

  it('copies the shown ids of a render, so later changes to the source array do not rewrite history', () => {
    const store = useSituationObservabilityStore()
    const shownEventIds = ['wake@1']

    store.recordRender(T0, rendered('[Situation 09:00]', shownEventIds))
    shownEventIds.push('later')

    expect(store.renders[0]).toMatchObject({ nowMs: T0, text: '[Situation 09:00]', shownEventIds: ['wake@1'] })
  })

  it('returns the published live state and the renders from inspect', async () => {
    const store = useSituationObservabilityStore()
    expect(store.liveState).toEqual({ leading: false, state: initialSituationState })

    const state = stateWithWake()
    store.publishLiveState(true, state)
    store.recordRender(T0, rendered('[Situation 09:00]'))

    expect(store.liveState).toEqual({ leading: true, state })
    const inspection = await store.inspect()
    expect(inspection.leading).toBe(true)
    expect(inspection.state.events.map(event => event.topicKey)).toEqual([WAKE_TOPIC_KEY])
    expect(inspection.renders.map(render => render.text)).toEqual(['[Situation 09:00]'])
  })

  it('reports a window that does not lead as not leading', async () => {
    const store = useSituationObservabilityStore()
    store.publishLiveState(false, initialSituationState)

    const inspection = await store.inspect()

    expect(inspection.leading).toBe(false)
    expect(inspection.state).toBe(initialSituationState)
    expect(inspection.renders).toEqual([])
    expect((await store.preview(T0)).leading).toBe(false)
  })

  it('previews the next block without marking its events as shown', async () => {
    const store = useSituationObservabilityStore()
    const state = stateWithWake()
    const wakeId = state.events[0].id
    store.publishLiveState(true, state)

    const first = await store.preview(T0 + 1_000)
    const second = await store.preview(T0 + 2_000)

    expect(first.text).toContain('- New: unlocked the computer')
    expect(first.shownEventIds).toEqual([wakeId])
    expect(second.text).toContain('- New: unlocked the computer')
    expect(second.shownEventIds).toEqual([wakeId])
    expect(store.liveState.state).toBe(state)
    expect(store.liveState.state.events[0].shownAtMs).toBeNull()
    expect(store.renders).toEqual([])
  })

  it('counts block lines and characters the way the renderer budgets them', () => {
    expect(situationBlockUsage('')).toEqual({ lines: 0, chars: 0 })
    expect(situationBlockUsage('[Situation 09:00]')).toEqual({ lines: 1, chars: 17 })
    expect(situationBlockUsage('[Situation 09:00]\n- New: x')).toEqual({ lines: 2, chars: 26 })
  })
})
