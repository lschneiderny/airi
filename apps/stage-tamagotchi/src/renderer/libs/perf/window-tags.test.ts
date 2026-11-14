import type { WindowTagInputs } from './window-tags'

import { describe, expect, it } from 'vitest'

import { resolveWindowTags } from './window-tags'

function inputs(overrides: Partial<WindowTagInputs> = {}): WindowTagInputs {
  return {
    stageHost: 'window',
    renderer: 'mmd',
    model: { id: 'display-model-abc', fileName: 'Chisa.pmx' },
    speechMuted: false,
    mmd: { physicsEnabled: true, naturalDriver: true, roamMode: 'stay' },
    live2dNaturalDriver: false,
    wakeWordRunning: false,
    hearing: 'push-to-talk',
    performanceMode: 'idle',
    chatGenerating: false,
    screen: { width: 2560, height: 1440, scale: 1.5 },
    diagnosticsTracing: false,
    ...overrides,
  }
}

describe('resolveWindowTags', () => {
  it('tags an MMD stage with its model, MMD features and activity', () => {
    const tags = resolveWindowTags(inputs())

    expect(tags).toMatchObject({
      renderer: 'mmd',
      modelId: 'display-model-abc',
      modelName: 'Chisa',
      features: { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'stay', wakeWord: false, hearing: 'push-to-talk' },
      activity: 'idle',
      stageHost: 'window',
      devtoolsOpen: false,
      display: { width: 2560, height: 1440, scale: 1.5 },
    })
  })

  it('leaves MMD-only features null on a Live2D stage and reads Natural from the Live2D driver', () => {
    const tags = resolveWindowTags(inputs({ renderer: 'live2d', live2dNaturalDriver: true }))

    expect(tags.features).toMatchObject({ mmdPhysics: null, mmdRoam: null, naturalMotion: true })
  })

  it('records no model and an unknown activity when no stage model renders and no stage resolved a mode', () => {
    const tags = resolveWindowTags(inputs({ renderer: 'disabled', performanceMode: null }))

    expect(tags).toMatchObject({ renderer: 'none', modelId: null, modelName: null, activity: 'unknown' })
    expect(resolveWindowTags(inputs({ renderer: undefined })).renderer).toBe('none')
  })

  it('keeps the feature hash for equal features and changes it with any feature value', () => {
    const base = resolveWindowTags(inputs()).featureHash

    expect(resolveWindowTags(inputs({ performanceMode: 'talking', chatGenerating: true })).featureHash).toBe(base)
    expect(resolveWindowTags(inputs({ speechMuted: true })).featureHash).not.toBe(base)
    expect(resolveWindowTags(inputs({ mmd: { physicsEnabled: true, naturalDriver: true, roamMode: 'roam' } })).featureHash).not.toBe(base)
    expect(resolveWindowTags(inputs({ hearing: false })).featureHash).not.toBe(base)
  })
})
