import type { ModelSettingsRuntimeSnapshot } from './runtime'

import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  })
}

const { t } = createTestI18n().global

describe('live2D model settings', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.body.className = ''
  })

  // https://github.com/moeru-ai/airi/issues/2450
  it('renders a remote expression snapshot and emits a command without changing the local store', async () => {
    // ROOT CAUSE:
    //
    // The Electron stage renderer loaded the model and registered its expressions.
    // The separate settings renderer read a different Pinia store, so the list stayed empty.
    //
    // We fixed this by sending a serializable expression snapshot from the stage owner.
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionStore, useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')

    const pinia = createPinia()
    const live2dSettings = useSettingsLive2d(pinia)
    live2dSettings.live2dExpressionEnabled = true

    const runtimeSnapshot = {
      ownerInstanceId: 'stage-owner',
      modelId: 'test-model',
      renderer: 'live2d',
      phase: 'mounted',
      controlsLocked: false,
      previewAvailable: true,
      canCapturePreview: false,
      updatedAt: 1,
      live2dExpressions: {
        groups: [
          { name: 'happy', active: false, exposedToLlm: false },
          { name: 'surprised', active: true, exposedToLlm: false },
        ],
        llmMode: 'none',
      },
    } satisfies ModelSettingsRuntimeSnapshot

    const onLive2dExpressionCommand = vi.fn()

    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot,
        onLive2dExpressionCommand,
      },
      global: {
        plugins: [pinia, createTestI18n()],
      },
    })

    await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
    await expect.element(screen.getByText('happy', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('surprised', { exact: true })).toBeVisible()

    const expressionSwitches = screen.getByRole('switch').all()
    await expressionSwitches[1].click()

    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({ type: 'toggle', name: 'happy' })
    expect(useExpressionStore(pinia).expressionGroups.size).toBe(0)
  })

  it('selects Natural and preserves mode settings', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    settings.live2dEyeTracking = false
    localStorage.setItem('selected-runtime-motion', 'idle.motion3.json')
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    await expect.element(screen.getByRole('radio', { name: 'Universal', exact: true })).toBeChecked()
    for (const enabled of [false, true, false]) {
      await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
      const cursor = screen.getByRole('switch', { name: t('settings.live2d.animation.natural-cursor-attention.title') })
      await expect.element(cursor).toBeEnabled()
      if (settings.live2dNaturalCursorAttention !== enabled)
        await cursor.click()
      await nextTick()
      expect(settings.live2dNaturalCursorAttention).toBe(enabled)
      expect(localStorage.getItem('settings/live2d/motion-driver')).toBe('natural')
      expect(localStorage.getItem('settings/live2d/natural-cursor-attention')).toBe(String(enabled))
      expect(settings.live2dEyeTracking).toBe(false)
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.force-idle-eye-animation.title') })).toBeDisabled()
      await expect.element(screen.getByRole('combobox')).toBeDisabled()
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.blink-enable.title') })).toBeEnabled()
      if (enabled)
        await expect.element(screen.getByText(t('settings.live2d.animation.focus.offset'), { exact: true })).toBeVisible()
      else
        await expect.element(screen.getByText(t('settings.live2d.animation.focus.offset'), { exact: true })).not.toBeInTheDocument()
      await screen.getByRole('radio', { name: 'MAGIC', exact: true }).click()
      await expect.element(cursor).not.toBeInTheDocument()
      await screen.getByRole('radio', { name: 'Universal', exact: true }).click()
      await expect.element(screen.getByRole('switch', { name: t('settings.live2d.animation.focus.title') })).not.toBeChecked()
      await expect.element(screen.getByRole('combobox')).toBeEnabled()
      expect(settings.live2dForceIdleEyeAnimation).toBe(true)
      expect(settings.live2dIdleAnimationEnabled).toBe(true)
      expect(localStorage.getItem('selected-runtime-motion')).toBe('idle.motion3.json')
    }
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
    const switches = screen.getByRole('switch').all()
    await expect.element(switches[switches.length - 1]).toBeEnabled()
    settings.resetState()
    await nextTick()
    await expect.element(screen.getByRole('radio', { name: 'Universal', exact: true })).toBeChecked()
    expect(settings.live2dNaturalCursorAttention).toBe(true)
    expect(settings.live2dEyeTracking).toBe(true)
  })

  it.each([
    'universal',
    'magic',
    'natural',
  ] as const)('restores stored %s through storage updates without migrating cursor preferences', async (driver) => {
    Object.assign(window, { Live2DCubismCore: {} })
    const { useSettingsLive2d } = await import('@proj-airi/stage-ui-live2d')
    const settings = useSettingsLive2d(createPinia())
    settings.resetState()
    await nextTick()
    for (const [key, newValue] of [
      ['settings/live2d/motion-driver', driver],
      ['settings/live2d/natural-cursor-attention', 'false'],
      ['settings/live2d/eye-tracking', 'true'],
    ]) {
      const oldValue = localStorage.getItem(key)
      localStorage.setItem(key, newValue)
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
    }
    await nextTick()
    expect(settings.live2dMotionDriver).toBe(driver)
    expect(settings.live2dNaturalCursorAttention).toBe(false)
    expect(settings.live2dEyeTracking).toBe(true)
  })

  it.each([
    { width: 1280, theme: 'light', size: 'desktop' },
    { width: 1280, theme: 'dark', size: 'desktop' },
    { width: 390, theme: 'light', size: 'mobile' },
    { width: 390, theme: 'dark', size: 'mobile' },
  ])('keeps natural controls usable at narrow width ($size $theme)', async ({ width, theme, size }) => {
    await page.viewport(width, 1000)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.className = 'bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4'
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-live2d'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const settings = useSettingsLive2d(pinia)
    settings.resetState()
    const screen = await render(Live2DSettings, {
      props: {
        palette: [],
        runtimeSnapshot: {
          ownerInstanceId: 'stage-owner',
          modelId: 'test-model',
          renderer: 'live2d',
          phase: 'mounted',
          controlsLocked: false,
          previewAvailable: true,
          canCapturePreview: false,
          updatedAt: 1,
        },
      },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.animation.title'), { exact: true }).click()
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    const cursor = screen.getByRole('switch', { name: t('settings.live2d.animation.natural-cursor-attention.title') })
    await expect.element(cursor).toBeChecked()
    for (const control of [cursor, screen.getByRole('radio', { name: 'Natural', exact: true })]) {
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeGreaterThanOrEqual(24)
      expect(bounds.width).toBeGreaterThanOrEqual(24)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished))
    await page.screenshot({
      path: `../../../../../../../.omo/evidence/live2d-presence-v1/task-3-settings-${size}-${theme}.png`,
    })
  })
})
