import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { initialSituationState, reduceSituation } from '@proj-airi/stage-shared/situation'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'

import { useSituationObservabilityStore } from './situation-observability'

const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { store: useSituationObservabilityStore(pinia), runtime }
}

function coordinated(runtime: SyncedPiniaRuntime, predicate: () => boolean) {
  if (predicate())
    return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timeout = setTimeout(() => {
      stop?.()
      reject(new Error('Coordination timed out'))
    }, 5000)
    stop = runtime.onCoordinationChange(() => {
      if (predicate()) {
        clearTimeout(timeout)
        stop?.()
        resolve()
      }
    })
  })
}

describe('situation observability across windows', () => {
  afterEach(() => {
    for (const { pinia, runtime } of contexts.splice(0)) {
      runtime.dispose()
      disposePinia(pinia)
    }
  })

  it('answers a follower window from the leader, and previews without marking shown or recording a render', async () => {
    const namespace = `situation-observability:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const settings = createContext(namespace, 'follower-only')
    await coordinated(settings.runtime, () => settings.runtime.getLeaderId() === stage.runtime.participantId)

    const now = Date.now()
    const state = reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: now }, now)
    stage.store.publishLiveState(true, state)
    stage.store.recordRender(now, { text: '[Situation 09:00]', shownEventIds: [] })

    const inspection = await settings.store.inspect()
    const first = await settings.store.preview(now + 1_000)
    const second = await settings.store.preview(now + 2_000)

    expect(inspection.leading).toBe(true)
    expect(inspection.state.events.map(event => event.id)).toEqual([state.events[0].id])
    expect(inspection.renders.map(render => render.text)).toEqual(['[Situation 09:00]'])
    expect(first.shownEventIds).toEqual([state.events[0].id])
    expect(second.shownEventIds).toEqual([state.events[0].id])
    expect(stage.store.liveState.state.events[0].shownAtMs).toBeNull()
    expect(stage.store.renders).toHaveLength(1)
    // The follower keeps its own empty copy: nothing is replicated into it.
    expect(settings.store.liveState).toEqual({ leading: false, state: initialSituationState })
    expect(settings.store.renders).toEqual([])
  })
})
