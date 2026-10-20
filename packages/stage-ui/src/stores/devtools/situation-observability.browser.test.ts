import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { initialSituationState, reduceSituation } from '@proj-airi/stage-shared/situation'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'

import { DEVTOOLS_BUS_CHANNEL_NAME } from '../../services/devtools/bus'
import { situationInspectInvoke, useSituationObservabilityStore } from './situation-observability'

const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime, store: ReturnType<typeof useSituationObservabilityStore> }> = []
const channels: BroadcastChannel[] = []

function createContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  const store = useSituationObservabilityStore(pinia)
  contexts.push({ pinia, runtime, store })
  return { store, runtime }
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

interface DomainOperation {
  result?: unknown
}

/** Records every domain state the leader commits for `namespace`, read from the plugin's own channel. */
function watchCommittedStates(namespace: string) {
  const channel = new BroadcastChannel(`tab-${namespace}`)
  channels.push(channel)
  const states: Array<{ operations?: DomainOperation[] }> = []
  channel.addEventListener('message', (event: MessageEvent<{ name?: string, rest?: unknown[] }>) => {
    if (event.data?.name === 'onState' || event.data?.name === 'onLeader')
      states.push((event.data.rest?.[0] ?? {}) as { operations?: DomainOperation[] })
  })
  return states
}

function holdsRenders(operation: DomainOperation) {
  const result = operation.result
  return typeof result === 'object' && result !== null && 'renders' in result
}

describe('situation observability across windows', () => {
  afterEach(() => {
    for (const { pinia, runtime, store } of contexts.splice(0)) {
      store.publishLiveState(false, initialSituationState)
      runtime.dispose()
      disposePinia(pinia)
    }
    for (const channel of channels.splice(0))
      channel.close()
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

    const inspection = await settings.store.inspectLeader()
    const first = await settings.store.previewLeader(now + 1_000)
    const second = await settings.store.previewLeader(now + 2_000)

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

  it('leaves no inspection in the synced domain state, however often a follower inspects', async () => {
    const namespace = `situation-observability:${crypto.randomUUID()}`
    const committed = watchCommittedStates(namespace)
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const settings = createContext(namespace, 'follower-only')
    await coordinated(settings.runtime, () => settings.runtime.getLeaderId() === stage.runtime.participantId)

    const now = Date.now()
    stage.store.publishLiveState(true, reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: now }, now))
    for (let index = 0; index < 20; index++)
      stage.store.recordRender(now + index, { text: `[Situation ${index}]`, shownEventIds: [] })

    const inspections = []
    for (let index = 0; index < 50; index++)
      inspections.push(await settings.store.inspectLeader())

    expect(inspections.every(inspection => inspection.renders.length === 20)).toBe(true)
    expect(committed.flatMap(state => state.operations ?? []).filter(holdsRenders)).toEqual([])
  })

  it('answers another window over the BroadcastChannel only while this window leads', async () => {
    const namespace = `situation-observability:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const channel = new BroadcastChannel(DEVTOOLS_BUS_CHANNEL_NAME)
    channels.push(channel)
    const inspectFromOtherWindow = defineInvoke(createBroadcastChannelContext(channel).context, situationInspectInvoke)

    const now = Date.now()
    stage.store.publishLiveState(true, initialSituationState)
    stage.store.recordRender(now, { text: '[Situation 09:00]', shownEventIds: [] })

    const answered = await inspectFromOtherWindow(undefined, { signal: AbortSignal.timeout(2_000) })
    expect(answered.renders.map(render => render.text)).toEqual(['[Situation 09:00]'])

    stage.store.publishLiveState(false, initialSituationState)
    await expect(inspectFromOtherWindow(undefined, { signal: AbortSignal.timeout(500) })).rejects.toThrow()
  })
})
