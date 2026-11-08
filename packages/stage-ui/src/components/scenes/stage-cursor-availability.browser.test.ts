import type { Component } from 'vue'

import { resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useSettingsStageModel } from '../../stores/settings/stage-model'

vi.mock('@proj-airi/stage-shared/performance-state', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/stage-shared/performance-state')>(),
  resolvePerformanceState: vi.fn(
    (await importOriginal<typeof import('@proj-airi/stage-shared/performance-state')>()).resolvePerformanceState,
  ),
}))

let Stage: Component
beforeAll(async () => {
  Object.assign(window, { Live2DCubismCore: {} })
  Stage = (await import('./Stage.vue')).default
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function mountStage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSettingsStageModel().setStageModelRenderer('disabled')
  const props: { cursorPosition: { x: number, y: number } | undefined } = { cursorPosition: undefined }
  return render(Stage, {
    props,
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] },
  })
}

describe('stage cursor availability', () => {
  it('leaves the resolver cursor movement null while no cursor is reported', async () => {
    const screen = mountStage()
    await screen.rerender({ cursorPosition: undefined })
    await nextTick()

    const calls = vi.mocked(resolvePerformanceState).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.map(([input]) => input.cursorMovedAtMs)).toEqual(calls.map(() => null))
  })

  it('does not count cursor withdrawal or DOM hover as a new movement', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: 1000 })
    const screen = mountStage()
    await screen.rerender({ cursorPosition: { x: 130, y: 140 } })
    await nextTick()
    expect(vi.mocked(resolvePerformanceState).mock.lastCall?.[0].cursorMovedAtMs).toBe(1000)

    vi.setSystemTime(2000)
    await screen.rerender({ cursorPosition: undefined })
    screen.container.dispatchEvent(new PointerEvent('pointerenter', { clientX: 30, clientY: 40 }))
    screen.container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 40 }))
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(vi.mocked(resolvePerformanceState).mock.lastCall?.[0].cursorMovedAtMs).toBe(1000)
  })
})
