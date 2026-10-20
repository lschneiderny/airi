import type { StagePerformanceScene } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { StagePerformanceConductor } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

// The conductor arms deadline timers; the smoke test never fires them.
const noHandle = setTimeout(() => {}, 0)
clearTimeout(noHandle)

describe('stagePerformanceConductor in the qa-tools node project', () => {
  it('loads and routes an angry emotion to the scene as one episode and one hold', () => {
    setActivePinia(createPinia())
    const scene = {
      setEmotion: vi.fn<StagePerformanceScene['setEmotion']>(),
      applySlots: vi.fn<StagePerformanceScene['applySlots']>(),
      applyHolds: vi.fn<StagePerformanceScene['applyHolds']>(),
      onSpeech: vi.fn<StagePerformanceScene['onSpeech']>(),
      setMuted: vi.fn<StagePerformanceScene['setMuted']>(),
    }
    const conductor = new StagePerformanceConductor({
      scene: () => scene,
      driver: () => 'natural',
      playMotion: () => {},
      settings: () => defaultExpressionPerformanceSettings,
      catalog: () => [],
      seed: 7,
      clock: () => 10,
      timers: { setTimeout: () => noHandle, clearTimeout: () => {} },
    })

    conductor.emotion('angry', 0.9, 'devtools')

    expect(scene.setEmotion).toHaveBeenCalledTimes(1)
    expect(scene.applyHolds).toHaveBeenCalledTimes(1)
  })
})
