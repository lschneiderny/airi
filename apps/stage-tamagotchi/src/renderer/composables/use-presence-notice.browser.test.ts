import type { InvokeEventa } from '@moeru/eventa'
import type { HostCapabilities, HostId, HostSignal } from '@proj-airi/stage-shared/host-capabilities'

import type { StageHostMode, StageHostState } from '../../shared/eventa'

import en from '@proj-airi/i18n/locales/en'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { capabilitiesForHost, HostReasons, presenceNoticeKey, resolveHostCapabilities } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useHostNoticeSettings } from '@proj-airi/stage-ui/features/host-capabilities/notice-settings'
import { setupSynced, usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia/setup-synced'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { toast, Toaster } from 'vue-sonner'

import { electronOpenSettings, electronStageGetState } from '../../shared/eventa'
import { presenceNoticeRoute, usePresenceNotice } from './use-presence-notice'

const context = createContext()
vi.mock('@proj-airi/electron-vueuse', async () => {
  const { defineInvoke } = await import('@moeru/eventa')
  return {
    useElectronEventaContext: () => shallowRef(context),
    useElectronEventaInvoke: <Res, Req>(event: InvokeEventa<Res, Req>) => defineInvoke(context, event),
  }
})

const openedRoutes: string[] = []
const running = shallowRef<StageHostMode>('window')
const stageStateReads = vi.fn(() => ({ running: running.value } as StageHostState))
defineInvokeHandler(context, electronStageGetState, stageStateReads)
defineInvokeHandler(context, electronOpenSettings, ({ route }) => void openedRoutes.push(route ?? ''))

const cleanups: Array<() => void> = []

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
const presenceKey = (key: string) => i18n.global.t(`tamagotchi.settings.pages.system.presence-sensing.${key}`)
const signalLabel = (signal: HostSignal) => presenceKey(`signals.${signal}`)

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  toast.dismiss()
  openedRoutes.length = 0
  stageStateReads.mockClear()
  vi.restoreAllMocks()
  localStorage.clear()
})

const macosAccessibilityDenied: HostCapabilities = (() => {
  const caps = capabilitiesForHost('macos')
  return { ...caps, signals: { ...caps.signals, globalKeyUp: { kind: 'unavailable', reason: HostReasons.MacosAccessibilityDenied } } }
})()

async function mountNotice(page: 'index' | 'stage', capabilities: HostCapabilities | HostId) {
  const pinia = createPinia()
  const synced = setupSynced({ leadership: 'leader-only' })
  pinia.use(synced.pinia)
  const snapshot = typeof capabilities === 'string' ? capabilitiesForHost(capabilities) : capabilities
  useHostCapabilitiesStore(pinia).set(snapshot)
  let runtime: ReturnType<typeof usePiniaSynced> | undefined
  const view = render(defineComponent({
    setup() {
      runtime = usePiniaSynced()
      usePresenceNotice(page)
      return () => h(Toaster)
    },
  }), { global: { plugins: [pinia, synced.vue, i18n] } })
  cleanups.push(() => {
    view.unmount()
    disposePinia(pinia)
  })
  await vi.waitFor(() => expect(runtime?.isLeader()).toBe(true))
  return { view, pinia, settings: useHostNoticeSettings(pinia), key: presenceNoticeKey(snapshot)! }
}

const toastLocator = () => document.querySelector('[data-sonner-toast]')

/**
 * Resolves once the condition holds. It re-checks on the store change that can flip it and on the DOM mutation
 * that can flip it, so no timer polls. Rejects with a message naming the awaited state after the timeout.
 */
function until(condition: () => boolean, what: string, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopWatch = () => {}
    let observer: MutationObserver | undefined
    const finish = () => {
      clearTimeout(timer)
      stopWatch()
      observer?.disconnect()
    }
    const check = () => {
      if (condition()) {
        finish()
        resolve()
      }
    }
    observer = new MutationObserver(check)
    timer = setTimeout(() => {
      finish()
      reject(new Error(`timed out after ${ms} ms waiting for ${what}`))
    }, ms)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    stopWatch = watch(condition, check, { flush: 'sync' })
    check()
  })
}

function dismissedKeysAre(mounted: { settings: ReturnType<typeof useHostNoticeSettings> }, keys: Array<string | null>) {
  return JSON.stringify(mounted.settings.document.dismissedKeys) === JSON.stringify(keys)
}

async function expectNoToast() {
  await vi.waitFor(() => {
    expect(stageStateReads.mock.calls.length).toBeGreaterThan(0)
    expect(stageStateReads.mock.settledResults).toHaveLength(stageStateReads.mock.calls.length)
  })
  await nextTick()
  await nextTick()
  expect(toastLocator()).toBeNull()
}

describe('presence notice', () => {
  it('awaits the dismissal command and reports rejection before opening Details', async () => {
    running.value = 'window'
    const mounted = await mountNotice('index', macosAccessibilityDenied)
    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
    const pending = Promise.withResolvers<void>()
    vi.spyOn(mounted.settings, 'dismiss').mockImplementation(() => pending.promise)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = toast.getHistory().at(-1)
    if (!original || !('action' in original) || !original.action || !('onClick' in original.action))
      throw new Error('The notice has no Details action')

    const completed = original.action.onClick(new MouseEvent('click'))
    expect(openedRoutes).toEqual([])
    pending.reject(new Error('Dismiss transport unavailable'))
    await completed

    expect(warning).toHaveBeenCalledOnce()
    expect(warning.mock.calls[0]).toContain('Dismiss transport unavailable')
    expect(openedRoutes).toEqual([presenceNoticeRoute])
    expect(mounted.settings.document.dismissedKeys).toEqual([])
  })

  it('remembers the shown key when macOS title trust changes before its Details callback completes', async () => {
    running.value = 'window'
    const facts = {
      platform: 'darwin',
      waylandSession: false,
      waylandOzone: false,
      macosMajorMinor: [14, 2],
      foregroundBindingFailed: false,
      globalInputHookFailure: 'accessibility-denied',
      foregroundTitlesTrusted: null,
      waylandIdleVerified: false,
      linuxDesktop: null,
    } satisfies Parameters<typeof resolveHostCapabilities>[0]
    const a = resolveHostCapabilities(facts, 0)
    const b = resolveHostCapabilities({ ...facts, foregroundTitlesTrusted: false }, 1)
    const a2 = resolveHostCapabilities({ ...facts, foregroundTitlesTrusted: true }, 2)
    const mounted = await mountNotice('index', a)
    await until(() => toastLocator() !== null, 'the notice toast to open')
    const original = toast.getHistory().at(-1)
    if (!original || !('action' in original) || !original.action || !('onClick' in original.action))
      throw new Error('The notice has no Details action')

    useHostCapabilitiesStore(mounted.pinia).set(b)
    await nextTick()
    expect(mounted.settings.document.dismissedKeys).toEqual([])
    await original.action.onClick(new MouseEvent('click'))

    await until(() => dismissedKeysAre(mounted, [presenceNoticeKey(a)]), 'the shown key to be remembered')
    expect(mounted.settings.document.dismissedKeys).toEqual([presenceNoticeKey(a)])
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
    expect(toastLocator()?.textContent).toContain(signalLabel('foregroundWindow'))
    expect(openedRoutes).toEqual([presenceNoticeRoute])
    useHostCapabilitiesStore(mounted.pinia).set(a2)
    await until(() => toastLocator() === null, 'the notice toast to close after trust returns')
    expect(JSON.parse(localStorage.getItem('settings/host-notice')!).dismissedKeys).toEqual([presenceNoticeKey(a)])

    useHostCapabilitiesStore(mounted.pinia).set(b)
    await until(() => toastLocator() !== null, 'the notice toast to reopen')
    await mounted.view.getByRole('button', { name: 'Close toast' }).click()
    await until(() => dismissedKeysAre(mounted, [presenceNoticeKey(a), presenceNoticeKey(b)]), 'both keys to be remembered')
    expect(mounted.settings.document.dismissedKeys).toEqual([presenceNoticeKey(a), presenceNoticeKey(b)])
    await until(() => toastLocator() === null, 'the notice toast to close after Close toast')
    useHostCapabilitiesStore(mounted.pinia).set(a2)
    await nextTick()
    useHostCapabilitiesStore(mounted.pinia).set(b)
    await nextTick()
    expect(toastLocator()).toBeNull()
  })

  it('withdraws a stale notice without saving it when all presence signals become live', async () => {
    running.value = 'window'
    const mounted = await mountNotice('index', macosAccessibilityDenied)
    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())

    useHostCapabilitiesStore(mounted.pinia).set(capabilitiesForHost('macos'))

    await vi.waitFor(() => expect(toastLocator()).toBeNull())
    expect(mounted.settings.document.dismissedKeys).toEqual([])
    useHostCapabilitiesStore(mounted.pinia).set(macosAccessibilityDenied)
    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
  })

  it('shows once on linux-wayland, names the missing signals, and stays dismissed', async () => {
    running.value = 'window'
    const first = await mountNotice('index', 'linux-wayland')
    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
    expect(toastLocator()!.textContent).toContain(signalLabel('cursorScreenPoint'))
    expect(toastLocator()!.textContent).toContain(signalLabel('globalKeyUp'))

    await first.view.getByRole('button', { name: presenceKey('notice.details') }).click()

    await vi.waitFor(() => expect(first.settings.document.dismissedKeys).toContain(first.key))
    expect(JSON.parse(localStorage.getItem('settings/host-notice')!).dismissedKeys).toContain(first.key)
    expect(openedRoutes).toEqual([presenceNoticeRoute])
    await vi.waitFor(() => expect(toastLocator()).toBeNull())
    cleanups.splice(0).forEach(cleanup => cleanup())

    await mountNotice('index', 'linux-wayland')
    await expectNoToast()
  })

  it('never shows on windows, where every presence signal is live', async () => {
    running.value = 'window'
    await mountNotice('index', 'windows')
    await expectNoToast()
  })

  it('shows again after the dismissal document is reset', async () => {
    running.value = 'window'
    const { view, settings, key } = await mountNotice('index', 'linux-wayland')
    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
    await view.getByRole('button', { name: 'Close toast' }).click()
    await vi.waitFor(() => expect(settings.document.dismissedKeys).toContain(key))
    await vi.waitFor(() => expect(toastLocator()).toBeNull())

    await settings.reset()

    await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
  })

  describe.each<[StageHostMode, 'index' | 'stage', 'index' | 'stage']>([
    ['desktop', 'stage', 'index'],
    ['window', 'index', 'stage'],
  ])('with running %s', (mode, owner, other) => {
    it(`shows in ${owner} and not in ${other} for a macOS host denied Accessibility`, async () => {
      running.value = mode
      await mountNotice(other, macosAccessibilityDenied)
      await expectNoToast()
      cleanups.splice(0).forEach(cleanup => cleanup())

      const owned = await mountNotice(owner, macosAccessibilityDenied)
      await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
      expect(toastLocator()!.textContent).toContain(signalLabel('globalKeyUp'))

      await owned.view.getByRole('button', { name: 'Close toast' }).click()

      await vi.waitFor(() => expect(owned.settings.document.dismissedKeys).toContain(owned.key))
      expect(owned.key).toBe(`macos:${HostReasons.MacosAccessibilityDenied}`)
      cleanups.splice(0).forEach(cleanup => cleanup())

      const again = await mountNotice(owner, macosAccessibilityDenied)
      await expectNoToast()
      await again.settings.reset()
      await vi.waitFor(() => expect(toastLocator()).not.toBeNull())
    })
  })
})
