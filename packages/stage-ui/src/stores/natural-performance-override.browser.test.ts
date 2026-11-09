import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { EmotionPulse, GestureRequest } from './natural-performance-override'

import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, shallowRef } from 'vue'

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

  it('delivers every lab emotion pulse to the stage window, repeats included', async () => {
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const stageWindow = createWindow(namespace, 'leader-only')
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()
    const pulses = shallowRef<EmotionPulse[]>([])
    onTestFinished(stage.onEmotionPulse((pulse) => {
      pulses.value = [...pulses.value, pulse]
    }))

    const labWindow = createWindow(namespace, 'follower-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()

    const pulsed = until(() => pulses.value.length).toBe(2, { timeout: 5000, throwOnTimeout: true })
    lab.pulseEmotion('happy', 1)
    lab.pulseEmotion('happy', 1)
    await pulsed

    expect(pulses.value).toEqual([{ name: 'happy', nominal: 1 }, { name: 'happy', nominal: 1 }])
  })

  it('delivers every lab gesture request to the stage window, repeats included', async () => {
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const stageWindow = createWindow(namespace, 'leader-only')
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()
    const requests = shallowRef<GestureRequest[]>([])
    onTestFinished(stage.onGestureRequest((request) => {
      requests.value = [...requests.value, request]
    }))

    const labWindow = createWindow(namespace, 'follower-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()

    const requested = until(() => requests.value.length).toBe(2, { timeout: 5000, throwOnTimeout: true })
    lab.requestGesture('nod', 2)
    lab.requestGesture('nod', 2)
    await requested

    expect(requests.value).toEqual([{ kind: 'nod', count: 2 }, { kind: 'nod', count: 2 }])
  })

  it('never replays an earlier pulse or gesture to a stage window that opens later', async () => {
    // A replicated command would reach a reloaded stage in its first snapshot and fire again.
    const namespace = `natural-override-${Math.random().toString(36).slice(2)}`

    const labWindow = createWindow(namespace, 'leader-only')
    setActivePinia(labWindow.pinia)
    const lab = useNaturalPerformanceOverride()
    lab.overrideEnabled = true
    lab.pulseEmotion('sad', 0.5)
    lab.requestGesture('shrug', 1)

    const stageWindow = createWindow(namespace, 'follower-only')
    setActivePinia(stageWindow.pinia)
    const stage = useNaturalPerformanceOverride()
    const pulses = shallowRef<EmotionPulse[]>([])
    const requests = shallowRef<GestureRequest[]>([])
    onTestFinished(stage.onEmotionPulse((pulse) => {
      pulses.value = [...pulses.value, pulse]
    }))
    onTestFinished(stage.onGestureRequest((request) => {
      requests.value = [...requests.value, request]
    }))
    // The late window has taken the lab's snapshot, so any replicated command would have arrived by now.
    await vi.waitFor(() => expect(stage.overrideEnabled).toBe(true))

    // Commands from one window arrive in order, so seeing these sentinels proves nothing earlier is still on its way.
    const sentinels = Promise.all([
      until(() => pulses.value.length).toBeTruthy({ timeout: 5000, throwOnTimeout: true }),
      until(() => requests.value.length).toBeTruthy({ timeout: 5000, throwOnTimeout: true }),
    ])
    lab.pulseEmotion('happy', 1)
    lab.requestGesture('nod', 2)
    await sentinels

    expect(pulses.value).toEqual([{ name: 'happy', nominal: 1 }])
    expect(requests.value).toEqual([{ kind: 'nod', count: 2 }])
  })

  it('restores the defaults on resetState', () => {
    const window = createWindow(`natural-override-${Math.random().toString(36).slice(2)}`, 'leader-only')
    setActivePinia(window.pinia)
    const store = useNaturalPerformanceOverride()

    store.overrideEnabled = true
    store.overrideMode = 'thinking'
    store.overrideEnergy = 0.2
    store.resetState()

    expect(store.overrideEnabled).toBe(false)
    expect(store.overrideMode).toBe('idle')
    expect(store.overrideEnergy).toBeNull()
    expect(store.performanceOverride).toBeNull()
  })

  it('keeps an empty mode inactive even when a replicated enabled flag is still true', () => {
    const window = createWindow(`natural-override-${Math.random().toString(36).slice(2)}`, 'leader-only')
    setActivePinia(window.pinia)
    const store = useNaturalPerformanceOverride()
    store.overrideEnabled = true
    store.overrideMode = null
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

    stage.overrideMode = null
    await vi.waitFor(() => expect(lab.overrideMode).toBeNull())

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
