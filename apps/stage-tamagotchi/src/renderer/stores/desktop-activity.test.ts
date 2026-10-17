import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { electron, electronEvents } from '@proj-airi/electron-eventa'
import { ambientLightNeutralEnvironment } from '@proj-airi/stage-shared/screen-ambient-light'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useScreenAmbientLightEnvironment } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { useSystemAudioLipSyncStore } from '@proj-airi/stage-ui/stores/system-audio-lipsync'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createDefaultWindowLifecycleState, useStageWindowLifecycleStore } from './stage-window-lifecycle'

type TestContext = ReturnType<typeof createContext<unknown, { raw?: unknown }>>

const boundary = vi.hoisted(() => ({
  context: undefined as TestContext | undefined,
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => boundary.context,
}))

describe('useDesktopActivityProducerStore', async () => {
  const { useDesktopActivityProducerStore } = await import('./desktop-activity')

  let pinia: ReturnType<typeof createPinia>
  let context: TestContext
  let idleSeconds: number
  let idleReads: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    pinia = createPinia()
    setActivePinia(pinia)
    context = createContext<unknown, { raw?: unknown }>()
    boundary.context = context
    idleSeconds = 7
    idleReads = 0
    defineInvokeHandler(context, electron.powerMonitor.getSystemIdleTime, () => {
      idleReads += 1
      return idleSeconds
    })
  })

  afterEach(() => {
    useDesktopActivityProducerStore().stop()
    disposePinia(pinia)
    vi.useRealTimers()
  })

  function setMinimized(minimized: boolean) {
    useStageWindowLifecycleStore().updateWindowLifecycle({
      ...createDefaultWindowLifecycleState(),
      minimized,
      reason: minimized ? 'minimize' : 'restore',
    })
  }

  it('publishes the first idle sample at once and then polls once per second', async () => {
    const producer = useDesktopActivityProducerStore()
    const desktop = useDesktopActivityStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(desktop.snapshot?.idleSeconds).toBe(7)
    expect(desktop.snapshot?.sampledAtMs).toBe(1_000_000)
    expect(idleReads).toBe(1)

    idleSeconds = 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(desktop.snapshot?.idleSeconds).toBe(0)
    expect(idleReads).toBe(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(idleReads).toBe(5)
  })

  it('stops polling while the stage is minimized and resumes on restore', async () => {
    const producer = useDesktopActivityProducerStore()
    const desktop = useDesktopActivityStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(producer.polling).toBe(true)

    setMinimized(true)
    await nextTick()
    const sampledWhileHidden = desktop.snapshot?.sampledAtMs
    const readsWhileHidden = idleReads
    await vi.advanceTimersByTimeAsync(5000)

    expect(producer.polling).toBe(false)
    expect(idleReads).toBe(readsWhileHidden)
    expect(desktop.snapshot?.sampledAtMs).toBe(sampledWhileHidden)

    setMinimized(false)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)

    expect(producer.polling).toBe(true)
    expect(idleReads).toBe(readsWhileHidden + 1)
    expect(desktop.snapshot?.sampledAtMs).toBe(1_005_000)
  })

  it('keeps a single interval across repeated start and stop calls', async () => {
    const producer = useDesktopActivityProducerStore()

    producer.start()
    producer.start()
    producer.stop()
    producer.start()
    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    idleReads = 0

    await vi.advanceTimersByTimeAsync(3000)
    expect(idleReads).toBe(3)

    producer.stop()
    producer.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(idleReads).toBe(3)
    expect(useDesktopActivityStore().snapshot).toBeNull()
  })

  it('records lock, unlock, suspend, and resume times from power monitor events', async () => {
    const producer = useDesktopActivityProducerStore()
    const desktop = useDesktopActivityStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)

    vi.setSystemTime(2_000_000)
    context.emit(electronEvents.powerMonitor.lockScreen, undefined)
    expect(desktop.snapshot?.locked).toBe(true)
    expect(desktop.snapshot?.unlockedAtMs).toBeNull()

    vi.setSystemTime(2_100_000)
    context.emit(electronEvents.powerMonitor.suspended, undefined)
    vi.setSystemTime(2_200_000)
    context.emit(electronEvents.powerMonitor.resumed, undefined)
    vi.setSystemTime(2_300_000)
    context.emit(electronEvents.powerMonitor.unlockScreen, undefined)

    expect(desktop.snapshot).toMatchObject({
      locked: false,
      suspendedAtMs: 2_100_000,
      resumedAtMs: 2_200_000,
      unlockedAtMs: 2_300_000,
    })
  })

  it('reports null audio and screen levels while neither capture runs', async () => {
    const producer = useDesktopActivityProducerStore()
    const desktop = useDesktopActivityStore()
    const systemAudio = useSystemAudioLipSyncStore()
    systemAudio.inputLevel = 0.6

    producer.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(desktop.snapshot?.systemAudioLevel).toBeNull()
    expect(desktop.snapshot?.screenChange).toBeNull()
  })

  it('reads the audio level and screen change once those captures run', async () => {
    const producer = useDesktopActivityProducerStore()
    const desktop = useDesktopActivityStore()
    const systemAudio = useSystemAudioLipSyncStore()
    const ambientLight = useScreenAmbientLightEnvironment()

    producer.start()
    systemAudio.isActive = true
    systemAudio.inputLevel = 0.4
    ambientLight.setEnvironment({ ...ambientLightNeutralEnvironment, exposure: 0.1 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)

    expect(desktop.snapshot?.systemAudioLevel).toBe(0.4)
    expect(desktop.snapshot?.screenChange).toBe(0)

    ambientLight.setEnvironment({ ...ambientLightNeutralEnvironment, exposure: 0.9 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(desktop.snapshot?.screenChange).toBeGreaterThan(0.35)

    ambientLight.reset()
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(desktop.snapshot?.screenChange).toBeNull()
  })
})

describe('screenChangeFollower', async () => {
  const { ScreenChangeFollower } = await import('./desktop-activity')

  it('spikes on a step and relaxes over a few seconds', () => {
    const follower = new ScreenChangeFollower()

    expect(follower.update(0.2, 0)).toBe(0)
    expect(follower.update(0.2, 1000)).toBe(0)

    const spike = follower.update(0.8, 1500)
    expect(spike).toBeGreaterThan(0.45)

    const relaxed = follower.update(0.8, 13_500)
    expect(relaxed).toBeLessThan(0.05)
  })

  it('treats the first exposure after a reset as a new baseline', () => {
    const follower = new ScreenChangeFollower()
    follower.update(0.1, 0)
    follower.reset()

    expect(follower.update(0.9, 100)).toBe(0)
  })
})
