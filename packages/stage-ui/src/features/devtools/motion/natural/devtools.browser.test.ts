import type { NaturalCaptureResult } from '@proj-airi/stage-ui-live2d/stores'

import { setNaturalTraceSink, useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import NaturalMotionDevtools from './devtools.vue'

import { useNaturalPerformanceOverride } from '../../../../stores/natural-performance-override'

import '@proj-airi/ui/main.css'

type CapturedTrace = Parameters<ReturnType<typeof useNaturalMotionDiagnostics>['completeCapture']>[1]

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: {} },
  })
}

async function renderLab() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const screen = await render(NaturalMotionDevtools, {
    global: { plugins: [pinia, createTestI18n()] },
  })
  return {
    screen,
    override: useNaturalPerformanceOverride(),
    diagnostics: useNaturalMotionDiagnostics(),
  }
}

const report: NaturalCaptureResult['report'] = {
  metrics: {
    'sd:ParamAngleX': { value: 4.5, band: [3, 6], pass: true, provisional: false },
    'still05': { value: 0.62, band: [0.1, 0.4], pass: false, provisional: false },
  },
  hardFailures: ['frozen'],
  warnings: [],
  score: 41.237,
  pass: false,
}

const trace: CapturedTrace = {
  t: [0, 1 / 30],
  channels: { ParamAngleX: [0, 1] },
  ranges: { ParamAngleX: { min: -30, max: 30, default: 0 } },
  meta: {
    model: 'fixture',
    driver: 'natural',
    energy: 0.5,
    home: 'product',
    adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 },
    capturedAt: '2026-10-17T12:00:00.000Z',
    durationSeconds: 60,
  },
}

describe('natural motion lab', () => {
  afterEach(() => {
    setNaturalTraceSink(null)
    cleanup()
  })

  it('writes the performance override from its controls', async () => {
    const { screen, override } = await renderLab()

    await screen.getByRole('switch').nth(0).click()
    await expect.poll(() => override.overrideEnabled).toBe(true)

    await screen.getByRole('radio', { name: /options\.talking/ }).click()
    await expect.poll(() => override.overrideMode).toBe('talking')
    expect(override.performanceOverride).toEqual({ mode: 'talking', energy: null })

    await screen.getByRole('switch').nth(1).click()
    await expect.poll(() => override.overrideEnergy).toBe(0.5)
  })

  it('advances the emotion pulse sequence for each click', async () => {
    const { screen, override } = await renderLab()
    const happy = screen.getByRole('button', { name: /names\.happy/ })

    await happy.click()
    await happy.click()

    await expect.poll(() => override.emotionPulse).toEqual({ name: 'happy', intensity: 1, seq: 2 })
  })

  it('requests a capture and renders its result, then saves through the sink', async () => {
    const { screen, diagnostics } = await renderLab()
    const sink = vi.fn(() => 'C:/evidence/natural-trace.json')
    setNaturalTraceSink(sink)

    await screen.getByRole('button', { name: /capture\.start/ }).nth(0).click()
    await expect.poll(() => diagnostics.pendingRequest?.durationSeconds).toBe(60)
    await expect.element(screen.getByTestId('natural-capture-pending')).toBeVisible()

    diagnostics.completeCapture(diagnostics.pendingRequest!.id, trace, report)

    await expect.element(screen.getByTestId('natural-capture-results')).toBeVisible()
    expect(diagnostics.pendingRequest).toBeNull()
    expect(screen.getByTestId('natural-capture-pending').query()).toBeNull()
    await expect.element(screen.getByTestId('natural-capture-score')).toHaveTextContent('41.24')
    await expect.element(screen.getByText('sd:ParamAngleX')).toBeVisible()
    await expect.element(screen.getByText('0.620')).toBeVisible()
    await expect.element(screen.getByTestId('natural-capture-hard-failures')).toHaveTextContent('frozen')

    await screen.getByTestId('natural-capture-download').click()

    await expect.element(screen.getByTestId('natural-capture-saved-path')).toHaveTextContent('C:/evidence/natural-trace.json')
    expect(sink).toHaveBeenCalledWith(trace, 'natural-trace-2026-10-17T12-00-00.000Z-fixture.json')
  })
})
