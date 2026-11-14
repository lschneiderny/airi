import type { PerfRecordingState } from '../../../../shared/eventa'

import en from '@proj-airi/i18n/locales/en'

import { MotionPlugin } from '@vueuse/motion'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import Developer from './developer.vue'

import { perfTraceState } from '../../../../shared/eventa'

const invokeMocks = vi.hoisted(() => ({
  perfRecordingGet: vi.fn(),
  perfRecordingSetEnabled: vi.fn(),
  perfTraceGet: vi.fn(),
  other: vi.fn(async () => undefined),
  listeners: [] as Array<{ event: unknown, handler: (event: { body: unknown }) => void }>,
}))

vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaContext: () => ref({
    on: (event: unknown, handler: (event: { body: unknown }) => void) => {
      invokeMocks.listeners.push({ event, handler })
      return () => {}
    },
  }),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    if (event?.receiveEvent?.id === 'eventa:invoke:electron:perf-recording:get-receive')
      return invokeMocks.perfRecordingGet
    if (event?.receiveEvent?.id === 'eventa:invoke:electron:perf-recording:set-enabled-receive')
      return invokeMocks.perfRecordingSetEnabled
    if (event?.receiveEvent?.id === 'eventa:invoke:electron:perf-recording:trace-get-receive')
      return invokeMocks.perfTraceGet
    return invokeMocks.other
  },
}))

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
// The copy is read from the en catalogue by key, so a wording edit cannot break the checks.
const copy = (key: string, params: Record<string, string> = {}) => i18n.global.t(`tamagotchi.settings.devtools.pages.performance-recording.${key}`, params)

const recording: PerfRecordingState = {
  enabled: true,
  active: true,
  sessionId: '2026-11-14T12-00-00-000Z-abc123',
  directory: '/tmp/airi-perf',
  buildMode: 'dev',
  source: 'default',
}

async function renderPage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }],
  })
  const screen = await render(Developer, {
    global: { plugins: [pinia, i18n, router, MotionPlugin] },
  })
  onTestFinished(() => screen.unmount())
  return screen
}

beforeEach(() => {
  invokeMocks.perfRecordingGet.mockReset()
  invokeMocks.perfRecordingSetEnabled.mockReset()
  invokeMocks.perfTraceGet.mockReset()
  invokeMocks.perfTraceGet.mockResolvedValue({ capturing: false, lastFile: null })
  invokeMocks.listeners.length = 0
})

describe('developer settings page: record performance', () => {
  it('turns recording off through main and shows the state main answered with', async () => {
    invokeMocks.perfRecordingGet.mockResolvedValue(recording)
    invokeMocks.perfRecordingSetEnabled.mockResolvedValue({ ...recording, enabled: false, active: false, sessionId: null, source: 'toggle' })
    const screen = await renderPage()

    const toggle = screen.getByRole('switch', { name: copy('title') })
    await expect.element(toggle).toBeChecked()
    await expect.element(toggle).toBeEnabled()
    await expect.element(screen.getByTestId('perf-recording-directory')).toHaveTextContent(copy('directory', { directory: recording.directory, buildMode: recording.buildMode }))

    await toggle.click()

    expect(invokeMocks.perfRecordingSetEnabled.mock.calls).toEqual([[{ enabled: false }]])
    await expect.element(toggle).not.toBeChecked()
  })

  it.each([
    ['a capture is running', { capturing: true, lastFile: null }, 'capturing'],
    ['a capture finished earlier', { capturing: false, lastFile: '/tmp/airi-perf/traces/a.json' }, 'last-file'],
  ])('shows the trace state on open when %s', async (_, traceState, key) => {
    invokeMocks.perfRecordingGet.mockResolvedValue(recording)
    invokeMocks.perfTraceGet.mockResolvedValue(traceState)
    const screen = await renderPage()

    await expect.element(screen.getByTestId('perf-trace-status')).toHaveTextContent(i18n.global.t(`tamagotchi.settings.devtools.pages.perf-trace.${key}`, { path: traceState.lastFile }))
  })

  it('keeps a trace state event that arrives before the on-open answer', async () => {
    invokeMocks.perfRecordingGet.mockResolvedValue(recording)
    let answer: (state: { capturing: boolean, lastFile: string | null }) => void = () => {}
    invokeMocks.perfTraceGet.mockReturnValue(new Promise((resolve) => {
      answer = resolve
    }))
    const screen = await renderPage()

    for (const listener of invokeMocks.listeners.filter(({ event }) => event === perfTraceState))
      listener.handler({ body: { capturing: true, lastFile: null } })
    answer({ capturing: false, lastFile: '/tmp/airi-perf/traces/old.json.gz' })
    await nextTick()

    await expect.element(screen.getByTestId('perf-trace-status')).toHaveTextContent(i18n.global.t('tamagotchi.settings.devtools.pages.perf-trace.capturing'))
  })

  it('locks the toggle and explains the override while AIRI_PERF_RECORD controls recording', async () => {
    invokeMocks.perfRecordingGet.mockResolvedValue({ ...recording, source: 'env' })
    const screen = await renderPage()

    const toggle = screen.getByRole('switch', { name: copy('title') })
    await expect.element(toggle).toBeChecked()
    await expect.element(toggle).toBeDisabled()
    await expect.element(screen.getByText(copy('env-controlled'))).toBeVisible()
    expect(screen.container.textContent).not.toContain(copy('description'))
  })
})
