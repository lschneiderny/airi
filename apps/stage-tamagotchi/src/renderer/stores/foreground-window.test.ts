import type { ForegroundWindowSample } from '@proj-airi/electron-eventa'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createDefaultWindowLifecycleState, useStageWindowLifecycleStore } from './stage-window-lifecycle'

type TestContext = ReturnType<typeof createContext<unknown, { raw?: unknown }>>
type SampleReply = () => Promise<ForegroundWindowSample | null>

const boundary = vi.hoisted(() => ({
  context: undefined as TestContext | undefined,
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => boundary.context,
}))

function windowSample(exeName: string): ForegroundWindowSample {
  return {
    exePath: `C:\\Apps\\${exeName}`,
    exeName,
    title: `${exeName} window`,
    pid: 4242,
    ownProcess: false,
    busy: 'accepts',
    sampledAtMs: Date.now(),
  }
}

/** A reply the test settles by hand, to model a slow main process. */
function deferredReply() {
  let resolve!: (value: ForegroundWindowSample | null) => void
  const promise = new Promise<ForegroundWindowSample | null>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('useForegroundWindowProducerStore', async () => {
  const { useForegroundWindowProducerStore } = await import('./foreground-window')

  let pinia: ReturnType<typeof createPinia>
  let reads: number
  let reply: SampleReply

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    pinia = createPinia()
    setActivePinia(pinia)
    const context = createContext<unknown, { raw?: unknown }>()
    boundary.context = context
    reads = 0
    reply = async () => windowSample('Notepad.exe')
    defineInvokeHandler(context, electron.foregroundWindow.sample, () => {
      reads += 1
      return reply()
    })
  })

  afterEach(() => {
    useForegroundWindowProducerStore().stop()
    disposePinia(pinia)
    vi.useRealTimers()
  })

  it('publishes the first sample at once and then polls once per second', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(producer.polling).toBe(true)
    expect(holder.sample).toMatchObject({ exeName: 'Notepad.exe', sampledAtMs: 1_000_000 })
    expect(reads).toBe(1)

    reply = async () => windowSample('Code.exe')
    await vi.advanceTimersByTimeAsync(1000)
    expect(holder.sample).toMatchObject({ exeName: 'Code.exe', sampledAtMs: 1_001_000 })

    await vi.advanceTimersByTimeAsync(3000)
    expect(reads).toBe(5)
  })

  it('keeps polling while the stage is minimized or hidden', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()
    const lifecycle = useStageWindowLifecycleStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)

    lifecycle.updateWindowLifecycle({ ...createDefaultWindowLifecycleState(), minimized: true, reason: 'minimize' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)

    expect(producer.polling).toBe(true)
    expect(reads).toBe(6)
    expect(holder.sample?.sampledAtMs).toBe(1_005_000)

    lifecycle.updateWindowLifecycle({ ...createDefaultWindowLifecycleState(), visible: false, reason: 'hide' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)

    expect(reads).toBe(8)
    expect(holder.sample?.sampledAtMs).toBe(1_007_000)
  })

  it('keeps the last good sample with its old timestamp when a read fails or finds no window', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    const lastGood = holder.sample

    reply = async () => {
      throw new Error('sampler unavailable')
    }
    await vi.advanceTimersByTimeAsync(3000)

    expect(reads).toBe(4)
    expect(holder.sample).toBe(lastGood)
    expect(holder.sample?.sampledAtMs).toBe(1_000_000)
    // A failing sampler logs once per run of failures, not once per second.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0])).not.toContain('Notepad.exe window')

    reply = async () => null
    await vi.advanceTimersByTimeAsync(2000)

    expect(holder.sample).toBe(lastGood)

    reply = async () => windowSample('Code.exe')
    await vi.advanceTimersByTimeAsync(1000)
    expect(holder.sample).toMatchObject({ exeName: 'Code.exe', sampledAtMs: 1_006_000 })
    warn.mockRestore()
  })

  it('does not stack reads while a reply is slow', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()
    const slow = deferredReply()
    reply = () => slow.promise

    producer.start()
    await vi.advanceTimersByTimeAsync(5000)

    expect(reads).toBe(1)
    expect(holder.sample).toBeNull()

    slow.resolve(windowSample('Notepad.exe'))
    reply = async () => windowSample('Code.exe')
    await vi.advanceTimersByTimeAsync(0)
    expect(holder.sample?.exeName).toBe('Notepad.exe')

    await vi.advanceTimersByTimeAsync(1000)
    expect(reads).toBe(2)
    expect(holder.sample).toMatchObject({ exeName: 'Code.exe', sampledAtMs: 1_006_000 })
  })

  it('drops a reply that arrives after stop and clears the holder', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()

    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(holder.sample).not.toBeNull()

    const late = deferredReply()
    reply = () => late.promise
    await vi.advanceTimersByTimeAsync(1000)
    producer.stop()

    expect(producer.polling).toBe(false)
    expect(holder.sample).toBeNull()

    late.resolve(windowSample('Code.exe'))
    await vi.advanceTimersByTimeAsync(5000)

    expect(holder.sample).toBeNull()
    expect(reads).toBe(2)
  })

  it('does not let a reply from before a restart block or overwrite the new run', async () => {
    const producer = useForegroundWindowProducerStore()
    const holder = useForegroundWindowStore()
    const stale = deferredReply()
    reply = () => stale.promise

    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    producer.stop()

    reply = async () => windowSample('Code.exe')
    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(holder.sample?.exeName).toBe('Code.exe')

    stale.resolve(windowSample('Notepad.exe'))
    await vi.advanceTimersByTimeAsync(0)
    expect(holder.sample?.exeName).toBe('Code.exe')

    await vi.advanceTimersByTimeAsync(2000)
    expect(reads).toBe(4)
  })

  it('keeps a single interval across repeated start and stop calls', async () => {
    const producer = useForegroundWindowProducerStore()

    producer.start()
    producer.start()
    producer.stop()
    producer.start()
    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    reads = 0

    await vi.advanceTimersByTimeAsync(3000)
    expect(reads).toBe(3)

    producer.stop()
    producer.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(reads).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    expect(useForegroundWindowStore().sample).toBeNull()
  })
})
