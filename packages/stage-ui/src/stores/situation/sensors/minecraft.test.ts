import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useSituationStore } from '..'
import { useMinecraftStore } from '../../modules/gaming-minecraft'
import { MINECRAFT_CONTEXT_SOURCE_KEY, minecraftContextText, startMinecraftSensor } from './minecraft'

type Listener = (event: unknown) => void

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const listeners = new Map<string, Set<Listener>>()

function listen(eventName: string, listener: Listener) {
  const set = listeners.get(eventName) ?? new Set<Listener>()
  listeners.set(eventName, set)
  set.add(listener)
  return () => set.delete(listener)
}

function emit(eventName: string, event: unknown) {
  for (const listener of listeners.get(eventName) ?? [])
    listener(event)
}

// The server channel is the network boundary of the Minecraft store.
vi.mock('../../mods/api/channel-server', () => ({
  useModsServerChannelStore: () => ({
    onContextUpdate: (listener: Listener) => listen('context:update', listener),
    onEvent: (eventName: string, listener: Listener) => listen(eventName, listener),
  }),
}))

function createLeadership(initiallyLeader: boolean) {
  let isLeader = initiallyLeader
  const subscribers = new Set<(isLeader: boolean) => void>()
  const runtime: SyncedPiniaRuntime = {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      subscribers.add(listener)
      listener(isLeader)
      return () => subscribers.delete(listener)
    }),
    participantId: 'minecraft-sensor-test',
    plugin: vi.fn(),
  }
  return {
    runtime,
    set(next: boolean) {
      isLeader = next
      for (const listener of subscribers)
        listener(next)
    },
  }
}

const minecraftSource = { source: { id: 'minecraft-bot' } }

function botContext(text: string) {
  return {
    type: 'context:update',
    source: 'minecraft-bot',
    metadata: minecraftSource,
    data: { id: 'mc-1', contextId: 'mc-1', strategy: ContextUpdateStrategy.ReplaceSelf, text },
  }
}

describe('minecraft sensor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    listeners.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useMinecraftStore().dispose()
    useSituationStore().dispose()
    vi.useRealTimers()
  })

  it('describes the integration in one short line', () => {
    expect(minecraftContextText({ configured: false, serviceConnected: false, latestRuntimeContextText: 'x' })).toBe('')
    expect(minecraftContextText({ configured: true, serviceConnected: true, latestRuntimeContextText: ' Mining iron. ' }))
      .toBe('Minecraft bot (online): Mining iron.')
    expect(minecraftContextText({ configured: true, serviceConnected: false, latestRuntimeContextText: '' }))
      .toBe('Minecraft bot (offline): no live context yet.')
    expect(minecraftContextText({ configured: true, serviceConnected: true, latestRuntimeContextText: '<|ACT happy|> hi' }))
      .toBe('Minecraft bot (online): (ACT happy) hi')
  })

  it('feeds bot context into the leader situation and clears it when the service leaves', async () => {
    const situation = useSituationStore()
    situation.initialize(createLeadership(true).runtime)
    const stop = startMinecraftSensor()
    expect(situation.state.contexts).toEqual({})

    emit('registry:modules:health:healthy', { type: 'registry:modules:health:healthy', data: { name: 'minecraft-bot' } })
    emit('context:update', botContext('Mining iron at y=12.'))
    await nextTick()

    expect(situation.state.contexts[MINECRAFT_CONTEXT_SOURCE_KEY]?.text).toBe('Minecraft bot (online): Mining iron at y=12.')
    expect(situation.renderForRequest(T0)).toContain('- Minecraft bot (online): Mining iron at y=12.')

    useMinecraftStore().resetState()
    await nextTick()
    expect(situation.state.contexts[MINECRAFT_CONTEXT_SOURCE_KEY]).toBeUndefined()

    stop()
  })

  it('ingests the current status when this window becomes the leader', async () => {
    const leadership = createLeadership(false)
    const situation = useSituationStore()
    situation.initialize(leadership.runtime)
    const stop = startMinecraftSensor()

    emit('context:update', botContext('Building a house.'))
    await nextTick()
    expect(situation.state.contexts).toEqual({})

    leadership.set(true)
    await nextTick()
    expect(situation.state.contexts[MINECRAFT_CONTEXT_SOURCE_KEY]?.text).toBe('Minecraft bot (offline): Building a house.')

    stop()
  })

  it('stops feeding after stop while the Minecraft store keeps running', async () => {
    const situation = useSituationStore()
    situation.initialize(createLeadership(true).runtime)
    const stop = startMinecraftSensor()
    stop()

    emit('context:update', botContext('Fighting a creeper.'))
    await nextTick()

    expect(useMinecraftStore().latestRuntimeContextText).toBe('Fighting a creeper.')
    expect(situation.state.contexts).toEqual({})
  })
})
