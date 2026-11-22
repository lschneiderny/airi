import type { StagePerformanceScene } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'

import { CharacterMind } from '@proj-airi/character-mind'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { MMD_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
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
    const mind = new CharacterMind({ seed: 7, clock: () => 10_000 })
    mind.receive({ kind: 'performer', capabilities: MMD_NATURAL_CAPABILITIES })
    const conductor = new StagePerformanceConductor({
      scene: () => scene,
      driver: () => 'natural',
      playMotion: () => {},
      settings: () => defaultExpressionPerformanceSettings,
      catalog: () => [],
      mind,
      seed: 7,
      clock: () => 10,
      timers: { setTimeout: () => noHandle, clearTimeout: () => {} },
    })

    conductor.emotion('angry', 0.9, 'devtools')

    expect(scene.setEmotion).toHaveBeenCalledTimes(1)
    expect(scene.applyHolds).toHaveBeenCalledTimes(1)
  })
})
