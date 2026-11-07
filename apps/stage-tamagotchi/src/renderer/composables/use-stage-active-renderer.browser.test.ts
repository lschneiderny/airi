import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { createPinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, nextTick } from 'vue'

import { electronStageSetActiveRenderer } from '../../shared/eventa'
import { useStageActiveRenderer } from './use-stage-active-renderer'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  useInvoke: vi.fn(),
}))

// Electron IPC is outside the browser test; keep the real settings store and watcher.
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: mocks.useInvoke,
}))

async function mountReporter() {
  mocks.invoke.mockClear()
  mocks.useInvoke.mockReturnValue(mocks.invoke)
  const pinia = createPinia()
  const screen = await render(defineComponent({
    setup() {
      useStageActiveRenderer()
      return () => null
    },
  }), { global: { plugins: [pinia] } })
  onTestFinished(() => screen.unmount())
  expect(mocks.useInvoke).toHaveBeenCalledWith(electronStageSetActiveRenderer)
  return useSettings(pinia)
}

describe('useStageActiveRenderer', () => {
  it('does not report an unresolved selection as leaving MMD on mount or reload', async () => {
    const settings = await mountReporter()
    expect(mocks.invoke).not.toHaveBeenCalled()

    settings.setStageModelRenderer('mmd')
    await nextTick()
    expect(mocks.invoke.mock.calls).toEqual([['mmd']])
  })

  it('still reports a resolved selection with no model', async () => {
    const settings = await mountReporter()
    expect(mocks.invoke).not.toHaveBeenCalled()

    settings.setStageModelRenderer('disabled')
    await nextTick()
    expect(mocks.invoke.mock.calls).toEqual([['other']])
  })

  it('reports a genuine MMD to Live2D switch once', async () => {
    const settings = await mountReporter()
    settings.setStageModelRenderer('mmd')
    await nextTick()
    mocks.invoke.mockClear()

    settings.setStageModelRenderer('live2d')
    await nextTick()
    settings.setStageModelRenderer('live2d')
    await nextTick()
    expect(mocks.invoke.mock.calls).toEqual([['other']])
  })
})
