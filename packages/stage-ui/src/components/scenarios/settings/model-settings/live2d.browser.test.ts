import type { Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { nextTick, watch } from 'vue'
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

type ExpressionEntry = Live2DExpressionSettingsSnapshot['groups'][number]

function expressionEntry(overrides: Partial<ExpressionEntry>): ExpressionEntry {
  return {
    id: 'entry.exp3.json',
    name: 'entry',
    label: 'entry',
    kind: 'face',
    group: null,
    confirmed: false,
    exposedToLlm: false,
    mappings: [],
    fileName: 'entry.exp3.json',
    parameterIds: [],
    active: false,
    ...overrides,
  }
}

function remoteSnapshot(groups: ExpressionEntry[]): ModelSettingsRuntimeSnapshot {
  return {
    ownerInstanceId: 'stage-owner',
    modelId: 'test-model',
    renderer: 'live2d',
    phase: 'mounted',
    controlsLocked: false,
    previewAvailable: true,
    canCapturePreview: false,
    updatedAt: 1,
    live2dExpressions: { groups },
  }
}

async function renderRemoteExpressions(groups: ExpressionEntry[]) {
  Object.assign(window, { Live2DCubismCore: {} })
  const [{ useSettingsLive2d }, { default: Live2DSettings }] = await Promise.all([
    import('@proj-airi/stage-ui-live2d'),
    import('./live2d.vue'),
  ])
  await import('virtual:uno.css')
  const pinia = createPinia()
  useSettingsLive2d(pinia).live2dExpressionEnabled = true
  const onLive2dExpressionCommand = vi.fn()
  const screen = await render(Live2DSettings, {
    props: { palette: [], runtimeSnapshot: remoteSnapshot(groups), onLive2dExpressionCommand },
    global: { plugins: [pinia, createTestI18n()] },
  })
  await screen.getByText(t('settings.live2d.expressions.title'), { exact: true }).click()
  return { screen, pinia, onLive2dExpressionCommand }
}

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
          { id: 'happy.exp3.json', name: 'happy', label: 'happy', kind: 'face', group: null, confirmed: false, exposedToLlm: false, mappings: [], fileName: 'happy.exp3.json', parameterIds: [], active: false },
          { id: 'surprised.exp3.json', name: 'surprised', label: 'surprised', kind: 'face', group: null, confirmed: false, exposedToLlm: false, mappings: [], fileName: 'surprised.exp3.json', parameterIds: [], active: true },
        ],
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

    await screen.getByRole('switch', { name: `${t('settings.live2d.expressions.preview')}: happy` }).click()

    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({ type: 'toggle', id: 'happy.exp3.json' })
    expect(useExpressionStore(pinia).definitions).toEqual([])
  })

  it('renders catalog labels and kinds, and offers the AI toggle only for face, effect, and prop', async () => {
    const { screen } = await renderRemoteExpressions([
      expressionEntry({ id: 'a', label: 'Blush', kind: 'face', group: 'Cheeks', confirmed: true }),
      expressionEntry({ id: 'b', label: 'Hat', kind: 'outfit' }),
    ])
    await expect.element(screen.getByText('Blush', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Hat', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.live2d.expressions.kinds.face'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.live2d.expressions.kinds.outfit'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Cheeks', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.live2d.expressions.confirmed'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Blush` })).toBeVisible()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Hat` })).not.toBeInTheDocument()
  })

  it('emits update-entry when a label is edited and applied', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Blush')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true }).click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
    expect(onLive2dExpressionCommand).toHaveBeenCalledWith({
      type: 'update-entry',
      id: 'red.exp3.json',
      patch: { label: 'Blush', kind: 'face', group: null, confirmed: false, mappings: [] },
    })
  })

  it('rejects an empty label and a mapping weight of 0 without emitting a command', async () => {
    const { screen, onLive2dExpressionCommand } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const apply = screen.getByRole('button', { name: t('settings.live2d.expressions.apply'), exact: true })

    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('')
    await expect.element(screen.getByText(t('settings.live2d.expressions.validation.label-required'), { exact: true })).toBeVisible()
    await apply.click()
    expect(onLive2dExpressionCommand).not.toHaveBeenCalled()
    await screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true }).fill('Blush')

    await screen.getByRole('button', { name: t('settings.live2d.expressions.add-mapping'), exact: true }).click()
    const weight = screen.getByRole('spinbutton', { name: `${t('settings.live2d.expressions.fields.weight')} 1` })
    for (const invalid of ['0', '5.5', '-1']) {
      await weight.fill(invalid)
      await expect.element(screen.getByText(t('settings.live2d.expressions.validation.weight-range', { min: 0.1, max: 5 }), { exact: true })).toBeVisible()
      await apply.click()
    }
    expect(onLive2dExpressionCommand).not.toHaveBeenCalled()

    await weight.fill('1.5')
    await apply.click()
    expect(onLive2dExpressionCommand).toHaveBeenCalledTimes(1)
  })

  it('keeps an open draft when the snapshot changes and offers to reload it', async () => {
    const { screen } = await renderRemoteExpressions([expressionEntry({ id: 'red.exp3.json', label: 'red' })])
    await screen.getByRole('button', { name: t('settings.live2d.expressions.edit'), exact: true }).click()
    const label = screen.getByRole('textbox', { name: t('settings.live2d.expressions.fields.label'), exact: true })
    await label.fill('Draft')
    await screen.rerender({ runtimeSnapshot: remoteSnapshot([expressionEntry({ id: 'red.exp3.json', label: 'Remote' })]) })
    await expect.element(screen.getByText(t('settings.live2d.expressions.stale'), { exact: true })).toBeVisible()
    await expect.element(label).toHaveValue('Draft')
    await screen.getByRole('button', { name: t('settings.live2d.expressions.reload'), exact: true }).click()
    await expect.element(label).toHaveValue('Remote')
    await expect.element(screen.getByText(t('settings.live2d.expressions.stale'), { exact: true })).not.toBeInTheDocument()
  })

  it('updates the performance settings store from the Emotion performance switches', async () => {
    Object.assign(window, { Live2DCubismCore: {} })
    const [{ useExpressionPerformanceSettings }, { default: Live2DSettings }] = await Promise.all([
      import('../../../../features/performance/settings'),
      import('./live2d.vue'),
    ])
    await import('virtual:uno.css')
    const pinia = createPinia()
    const performance = useExpressionPerformanceSettings(pinia)
    const screen = await render(Live2DSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot([]) },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.live2d.performance.title'), { exact: true }).click()
    const bands = screen.getByRole('switch', { name: t('settings.live2d.performance.bands.title') })
    await expect.element(bands).toBeChecked()
    expect(performance.document.bands).toBe(true)
    const bandsChanged = new Promise<boolean>((resolve, reject) => {
      const stop = watch(() => performance.document.bands, (value) => {
        stop()
        resolve(value)
      }, { flush: 'sync' })
      AbortSignal.timeout(5000).addEventListener('abort', () => {
        stop()
        reject(new Error('performance.document.bands did not change after the switch click'))
      })
    })
    await bands.click()
    expect(await bandsChanged).toBe(false)
    expect(performance.document.bands).toBe(false)
    await expect.element(bands).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings/expression-performance') ?? '{}').bands).toBe(false)
    expect(performance.document.mood).toBe(true)
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

  it('shows the Energy slider only for Natural, persists it, and resets it to 0.5', async () => {
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
    // A missing locale entry renders the key, which the role query would still match.
    expect(t('settings.live2d.animation.natural-energy.title')).not.toBe('settings.live2d.animation.natural-energy.title')
    const energy = screen.getByRole('slider', { name: t('settings.live2d.animation.natural-energy.title') })
    await expect.element(energy).not.toBeInTheDocument()
    await screen.getByRole('radio', { name: 'MAGIC', exact: true }).click()
    await expect.element(energy).not.toBeInTheDocument()
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await expect.element(energy).toBeVisible()
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await energy.click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(screen.getByText('55%', { exact: true })).toBeVisible()
    expect(settings.live2dNaturalEnergy).toBe(0.55)
    const key = 'settings/live2d/natural-energy'
    expect(localStorage.getItem(key)).toBe('0.55')

    localStorage.setItem(key, '7')
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: '0.55', newValue: '7', storageArea: localStorage }))
    await expect.element(screen.getByText('100%', { exact: true })).toBeVisible()
    expect(settings.live2dNaturalEnergy).toBe(1)

    // Reset also restores the Universal driver, which hides the slider.
    settings.resetState()
    await nextTick()
    await expect.element(energy).not.toBeInTheDocument()
    expect(settings.live2dNaturalEnergy).toBe(0.5)
    expect(localStorage.getItem(key)).toBe('0.5')
    await screen.getByRole('radio', { name: 'Natural', exact: true }).click()
    await expect.element(screen.getByText('50%', { exact: true })).toBeVisible()

    await screen.getByRole('radio', { name: 'Universal', exact: true }).click()
    await expect.element(energy).not.toBeInTheDocument()
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
    { stored: 'abc', expected: 0.5 },
    { stored: '7', expected: 1 },
    { stored: '-2', expected: 0 },
    { stored: '0.35', expected: 0.35 },
  ])('reads a stored Natural energy of $stored as $expected', async ({ stored, expected }) => {
    Object.assign(window, { Live2DCubismCore: {} })
    const { useSettingsLive2d } = await import('@proj-airi/stage-ui-live2d')
    const settings = useSettingsLive2d(createPinia())
    settings.resetState()
    settings.live2dNaturalEnergy = 0.8
    await nextTick()
    const key = 'settings/live2d/natural-energy'
    const oldValue = localStorage.getItem(key)
    localStorage.setItem(key, stored)
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: stored, storageArea: localStorage }))
    await nextTick()
    expect(settings.live2dNaturalEnergy).toBe(expected)
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
    const energy = screen.getByRole('slider', { name: t('settings.live2d.animation.natural-energy.title') })
    await expect.element(energy).toBeVisible()
    for (const control of [cursor, energy, screen.getByRole('radio', { name: 'Natural', exact: true })]) {
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
      path: `../../../../../../../.omo/evidence/live2d-presence-v2/task-11-${size}${theme === 'dark' ? '-dark' : ''}.png`,
    })
  })
})
