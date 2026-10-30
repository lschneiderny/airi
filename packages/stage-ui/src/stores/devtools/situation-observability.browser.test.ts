import type { GateDecision, Reason, Thread, UrgeGateDecision } from '@proj-airi/stage-shared/situation'
import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { initialGateMemory, initialSituationState, initialUrgeMemory, reduceSituation } from '@proj-airi/stage-shared/situation'
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

/** Whether an operation retains an inspection or a gate evaluation answer. */
function holdsRenders(operation: DomainOperation) {
  const result = operation.result
  return typeof result === 'object' && result !== null && ('renders' in result || 'gateHistory' in result || 'decision' in result)
}

function dontDisturb(nowMs: number): GateDecision {
  return {
    fire: false,
    reason: 'dont-disturb',
    trace: { nowMs, chattiness: 1, threshold: 0.15, candidate: null, gapMs: 180_000, hourlyCap: 7, firesLastHour: 0, backoffLevel: 0, ignoreStreak: 0, pendingTopicKey: null, nextEligibleAtMs: nowMs, forceTiming: true },
  }
}

function threadFire(nowMs: number): { decision: UrgeGateDecision, thread: Thread } {
  const thread: Thread = {
    id: 'thread:question:1',
    topicKey: 'thread:question:1',
    sessionId: 'session-a',
    kind: 'question',
    summary: 'He had a job interview this morning.',
    cue: 'how his interview went',
    bornAtMs: nowMs - 3_600_000,
    dueAtMs: null,
    raisedCount: 0,
    lastRaisedAtMs: null,
    expiresAtMs: nowMs + 3_600_000,
  }
  const picked: Reason = { key: thread.topicKey, kind: 'thread-question', category: 'open', text: thread.cue, sourceEventId: null, ripeness: 1, weight: 1.2, urgent: false, dueAtMs: null, dueNow: false }
  const decision: UrgeGateDecision = {
    fire: true,
    reason: 'urge',
    category: 'open',
    topicKey: picked.key,
    topicText: picked.text,
    picked,
    trace: {
      nowMs,
      chattiness: 0.5,
      hazardPerHour: { open: 0.8, continuation: 0, ritual: 0, due: 0, total: 0.8 },
      multipliers: { base: 0.6, pressure: 1.4, exchange: 1, clear: 1, damping: 1, floor: 1, game: 1 },
      urge: 1.2,
      urgeThreshold: 1.1,
      expectedWaitMs: null,
      phase: 'open',
      unanswered: 0,
      reopenAtMs: null,
      doubleTextDueAtMs: null,
      rituals: null,
      reasons: [picked],
      pick: { categoryRoll: 0.3, reasonRoll: 0.5, category: 'open', reasonKey: picked.key },
      firesLastHour: 0,
      pendingTopicKey: null,
      forceTiming: false,
    },
  }
  return { decision, thread }
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

    stage.store.serveGateEvaluation(() => ({ status: 'evaluated', decision: dontDisturb(now), memory: initialGateMemory }))
    const inspections = []
    for (let index = 0; index < 50; index++) {
      stage.store.recordGateDecision(dontDisturb(now + index), initialGateMemory)
      inspections.push(await settings.store.inspectLeader())
      await settings.store.evaluateGateLeader()
    }

    expect(inspections.every(inspection => inspection.renders.length === 20)).toBe(true)
    expect(committed.flatMap(state => state.operations ?? []).filter(holdsRenders)).toEqual([])
  })

  it('carries "Evaluate now" from a follower window to the leader gate, and the gate history back', async () => {
    const namespace = `situation-observability:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const settings = createContext(namespace, 'follower-only')
    await coordinated(settings.runtime, () => settings.runtime.getLeaderId() === stage.runtime.participantId)

    const now = Date.now()
    stage.store.publishLiveState(true, initialSituationState)
    for (let index = 0; index < 3; index++)
      stage.store.recordGateDecision(dontDisturb(now + index * 2_000), initialGateMemory)
    const calls: unknown[][] = []
    const stop = stage.store.serveGateEvaluation((...args: unknown[]) => {
      calls.push(args)
      return { status: 'evaluated', decision: dontDisturb(now + 6_000), memory: initialGateMemory }
    })

    expect(await settings.store.evaluateGateLeader()).toMatchObject({ status: 'evaluated', decision: { fire: false, reason: 'dont-disturb', trace: { forceTiming: true } } })
    // The bus request has no payload, so the follower cannot pass anything to the gate.
    expect(calls).toEqual([[]])
    const inspection = await settings.store.inspectLeader()
    expect(inspection.gateHistory).toEqual([expect.objectContaining({ reason: 'dont-disturb', count: 3, firstAtMs: now, lastAtMs: now + 4_000 })])
    expect(settings.store.gateHistory).toEqual([])

    stop()
    expect(await settings.store.evaluateGateLeader()).toEqual({ status: 'skipped', reason: 'gate-not-running' })
  })

  it('hands a follower window the urge trace, reasons, threads, extraction, and outcomes the leader recorded', async () => {
    const namespace = `situation-observability:${crypto.randomUUID()}`
    const stage = createContext(namespace, 'leader-only')
    await coordinated(stage.runtime, () => stage.runtime.isLeader())
    const settings = createContext(namespace, 'follower-only')
    await coordinated(settings.runtime, () => settings.runtime.getLeaderId() === stage.runtime.participantId)

    const now = Date.now()
    const { decision, thread } = threadFire(now)
    stage.store.publishLiveState(true, initialSituationState)
    stage.store.recordUrgeDecision(decision, initialUrgeMemory)
    stage.store.publishUrgeState(initialUrgeMemory, [thread])
    stage.store.recordReasonOutcome('thread-question', 'spoken', now)
    stage.store.recordExtraction({ atMs: now, sessionId: 'session-a', requestChars: 120, messageCount: 4, status: 'ok', threads: [{ kind: 'question', summary: thread.summary }], error: null })

    const inspection = await settings.store.inspectLeader()

    expect(inspection.urge.trace).toEqual(decision.trace)
    expect(inspection.urge.decision).toEqual({ fire: true, reason: 'urge', category: 'open', topicKey: thread.topicKey, atMs: now })
    expect(inspection.urge.history).toEqual([{ fromMs: now, toMs: now, count: 1, fire: true, reason: 'urge', category: 'open', topicKey: thread.topicKey }])
    expect(inspection.urge.memory).toEqual(initialUrgeMemory)
    expect(inspection.urgeHistory).toEqual([{ fromMs: now, toMs: now, phase: 'open', hazardTotal: 0.8 }])
    expect(inspection.reasons.map(reason => reason.key)).toEqual([thread.topicKey])
    expect(inspection.threads).toEqual([thread])
    expect(inspection.extraction).toEqual({ ledger: [expect.objectContaining({ status: 'ok', threads: [{ kind: 'question', summary: thread.summary }] })], inFlight: false })
    expect(inspection.outcomes['thread-question']).toMatchObject({ spoken: 1 })
    // The follower keeps its own empty copy: nothing is replicated into it.
    expect((await settings.store.inspect()).urge.trace).toBeNull()
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
