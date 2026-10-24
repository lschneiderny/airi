import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useSettingsLive2d browser persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults expressions to enabled when no preference is stored', async () => {
    const { useSettingsLive2d } = await import('./live2d')

    expect(useSettingsLive2d(createPinia()).live2dExpressionEnabled).toBe(true)
  })

  it('restores a disabled expression preference from localStorage', async () => {
    const { useSettingsLive2d } = await import('./live2d')
    useSettingsLive2d(createPinia()).live2dExpressionEnabled = false

    vi.resetModules()
    const reloaded = await import('./live2d')

    expect(reloaded.useSettingsLive2d(createPinia()).live2dExpressionEnabled).toBe(false)
  })
})
