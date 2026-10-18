import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useNaturalPerformanceOverride } from './natural-performance-override'

const contexts: { pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }[] = []

/** Stands in for one Electron renderer: its own Pinia, joined to a shared namespace. */
function createWindow(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ callTimeout: 1000, leadership, namespace })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia)
  contexts.push({ pinia, runtime })
  return { pinia, runtime }
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
})

describe('natural performance override', () => {
  it('reports no override while the control is off, so the stage resolves real signals', () => {
    const window = createWindow(`natural-override-${Math.random().toString(36).slice(2)}`, 'leader-only')
    setActivePinia(window.pinia)
    const store = useNaturalPerformanceOverride()

    store.overrideMode = 'talking'

    expect(store.performanceOverride).toBeNull()
  })

  it('carries the override from the lab window to the stage window', async () => {
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const stageWindow = createWindow(namespace, 'leader-only')
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()

    const labWindow = createWindow(namespace, 'follower-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()

    lab.overrideEnabled = true
    lab.overrideMode = 'listening'
    lab.overrideEnergy = 0.8

    await vi.waitFor(() => expect(stage.performanceOverride).toEqual({ mode: 'listening', energy: 0.8 }))
  })

  it('advances the emotion pulse sequence for each pulse, including repeats', async () => {
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const stageWindow = createWindow(namespace, 'leader-only')
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()

    const labWindow = createWindow(namespace, 'follower-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()

    const pulsed = until(() => stage.emotionPulse?.seq).toBe(2, { timeout: 5000, throwOnTimeout: true })

    lab.pulseEmotion('happy', 1)
    lab.pulseEmotion('happy', 1)

    await pulsed
    expect(stage.emotionPulse).toEqual({ name: 'happy', nominal: 1, seq: 2 })
  })

  it('restores the defaults on resetState', () => {
    const window = createWindow(`natural-override-${Math.random().toString(36).slice(2)}`, 'leader-only')
    setActivePinia(window.pinia)
    const store = useNaturalPerformanceOverride()

    store.overrideEnabled = true
    store.overrideMode = 'thinking'
    store.overrideEnergy = 0.2
    store.pulseEmotion('sad', 0.5)
    store.resetState()

    expect(store.overrideEnabled).toBe(false)
    expect(store.overrideMode).toBe('idle')
    expect(store.overrideEnergy).toBeNull()
    expect(store.emotionPulse).toBeNull()
    expect(store.performanceOverride).toBeNull()
  })

  it('takes a leader snapshot without proposing one back', async () => {
    // A remote snapshot runs the local watchers, and a store that answered one
    // by writing its own state would send a proposal back for every change the
    // other window made.
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const stageWindow = createWindow(namespace, 'leader-only')
    await vi.waitFor(() => expect(stageWindow.runtime.isLeader()).toBe(true))
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()

    const labWindow = createWindow(namespace, 'follower-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()
    // Counting before the windows agree who leads would include the snapshots
    // they exchange while settling that.
    await vi.waitFor(() => expect(labWindow.runtime.getLeaderId()).toBe(stageWindow.runtime.participantId))

    let stageMutations = 0
    let labMutations = 0
    let labActions = 0
    stage.$subscribe(() => stageMutations++, { flush: 'sync' })
    lab.$subscribe(() => labMutations++, { flush: 'sync' })
    lab.$onAction(() => labActions++)

    stage.overrideMode = 'watching'
    await vi.waitFor(() => expect(lab.overrideMode).toBe('watching'))

    // Each window's messages arrive in order, so an echo the lab proposed in
    // answer to that snapshot reaches the stage before this sentinel does.
    // Seeing the sentinel therefore proves any echo has already been counted.
    const sentinelSeen = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('stage never received the sentinel')), 5000)
      const stop = stage.$subscribe(() => {
        if (stage.overrideEnergy !== 0.5)
          return
        clearTimeout(timeout)
        stop()
        resolve()
      }, { flush: 'sync' })
    })
    lab.overrideEnergy = 0.5
    await sentinelSeen

    expect(stageMutations).toBe(2)
    expect(labMutations).toBe(2)
    expect(labActions).toBe(0)
  })
})
