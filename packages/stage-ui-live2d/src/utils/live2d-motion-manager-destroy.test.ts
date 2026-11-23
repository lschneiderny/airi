import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('live2d motion manager lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { Live2DCubismCore: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([false, true])('starts a cached idle motion only while alive (destroy: %s)', async (destroy) => {
    const { Cubism4ModelSettings, Cubism4MotionManager, MotionPreloadStrategy, MotionPriority } = await import('pixi-live2d-display/cubism4')
    const definition = { File: 'idle.motion3.json' }
    const settings = new Cubism4ModelSettings({
      Version: 3,
      url: 'https://example.com/avatar.model3.json',
      FileReferences: {
        Moc: 'avatar.moc3',
        Textures: ['avatar.png'],
        Motions: { Idle: [definition] },
      },
    })
    const manager = new Cubism4MotionManager(settings, { motionPreload: MotionPreloadStrategy.NONE })
    manager.motionGroups.Idle = [manager.createMotion({
      Meta: { Duration: 1, Fps: 30, Loop: true, CurveCount: 0, TotalSegmentCount: 0, TotalPointCount: 0, UserDataCount: 0 },
      Curves: [],
    }, 'Idle', definition)]

    // Preview cleanup destroys the manager in the microtask gap after a render starts idle.
    const pending = manager.startMotion('Idle', 0, MotionPriority.IDLE)
    if (destroy)
      manager.destroy()

    try {
      await expect(pending).resolves.toBe(!destroy)
    }
    finally {
      if (!destroy)
        manager.destroy()
    }
  })
})
