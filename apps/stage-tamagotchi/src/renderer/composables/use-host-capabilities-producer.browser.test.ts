import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { electron, electronEvents } from '@proj-airi/electron-eventa'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, shallowRef } from 'vue'

import { useHostCapabilitiesProducer } from './use-host-capabilities-producer'

const context = createContext()
const readSnapshot = vi.fn<() => Promise<HostCapabilities>>()
vi.mock('@proj-airi/electron-vueuse', async () => {
  const { defineInvoke } = await import('@moeru/eventa')
  return {
    useElectronEventaContext: () => shallowRef(context),
    useElectronEventaInvoke: (event: typeof electron.hostCapabilities.get) => {
      readSnapshot.mockImplementation(defineInvoke(context, event))
      return readSnapshot
    },
  }
})

async function mountProducer(get: () => Promise<HostCapabilities>) {
  readSnapshot.mockClear()
  const handler = vi.fn(get)
  onTestFinished(defineInvokeHandler(context, electron.hostCapabilities.get, handler))
  const pinia = createPinia()
  const view = await render(defineComponent({
    setup() {
      useHostCapabilitiesProducer()
      return () => null
    },
  }), { global: { plugins: [pinia] } })
  onTestFinished(() => view.unmount())
  return { view, handler, store: useHostCapabilitiesStore(pinia) }
}

describe('host capability producer', () => {
  it('reads once and applies a runtime change after the initial snapshot', async () => {
    const { store, handler } = await mountProducer(async () => capabilitiesForHost('windows'))
    await vi.waitFor(() => expect(store.snapshot?.host).toBe('windows'))

    context.emit(electronEvents.hostCapabilities.changed, capabilitiesForHost('macos'))

    expect(store.snapshot?.host).toBe('macos')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('keeps a changed event when the older initial snapshot answers later', async () => {
    const reply = Promise.withResolvers<HostCapabilities>()
    const { store, handler } = await mountProducer(() => reply.promise)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    context.emit(electronEvents.hostCapabilities.changed, capabilitiesForHost('linux-wayland'))
    reply.resolve(capabilitiesForHost('windows'))
    await reply.promise
    await vi.waitFor(() => expect(readSnapshot.mock.settledResults[0]?.type).toBe('fulfilled'))

    expect(store.snapshot?.host).toBe('linux-wayland')
  })

  it('stops listening and ignores a pending snapshot after unmount', async () => {
    const reply = Promise.withResolvers<HostCapabilities>()
    const { view, store } = await mountProducer(() => reply.promise)
    await view.unmount()

    context.emit(electronEvents.hostCapabilities.changed, capabilitiesForHost('macos'))
    reply.resolve(capabilitiesForHost('windows'))
    await vi.waitFor(() => expect(readSnapshot.mock.settledResults[0]?.type).toBe('fulfilled'))

    expect(store.snapshot).toBeNull()
  })
})
