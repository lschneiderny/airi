import type { AffectTraceSink, NaturalCaptureResult } from '@proj-airi/stage-ui-live2d/stores'

import en from '@proj-airi/i18n/locales/en'

import { defaultExpressionPerformanceSettings, parseAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { setAffectTraceSink, setNaturalTraceSink, useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { watch } from 'vue'
import { createI18n } from 'vue-i18n'

import NaturalMotionDevtools from './devtools.vue'

import { answerAffectTraceRequest, StagePerformanceConductor } from '../../../../composables/performance/use-stage-performance-conductor'
import { useExpressionPerformanceSettings } from '../../../../features/performance/settings'
import { useNaturalPerformanceOverride } from '../../../../stores/natural-performance-override'

import '@proj-airi/ui/main.css'

type CapturedTrace = Parameters<ReturnType<typeof useNaturalMotionDiagnostics>['completeCapture']>[1]

type LabMessages = Parameters<typeof createI18n>[0]['messages']

function createTestI18n(messages: LabMessages = { en: {} }) {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  })
}

async function renderLab(messages?: LabMessages) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const screen = await render(NaturalMotionDevtools, {
    global: { plugins: [pinia, createTestI18n(messages)] },
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
  version: 2,
  t: [0, 1 / 30],
  channels: { ParamAngleX: [0, 1] },
  ranges: { ParamAngleX: { min: -30, max: 30, default: 0 } },
  events: [],
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

/**
 * A stage conductor answering the lab's affect-trace requests, as the stage window does. The
 * test shares one store between lab and stage; across windows the store's channel carries them.
 */
function createStage(diagnostics: ReturnType<typeof useNaturalMotionDiagnostics>) {
  let now = 10
  const conductor = new StagePerformanceConductor({
    scene: () => undefined,
    driver: () => 'natural',
    playMotion: () => {},
    settings: () => defaultExpressionPerformanceSettings,
    catalog: () => [],
    seed: 7,
    clock: () => now,
  })
  const stop = watch(() => diagnostics.affectTraceRequest, (request) => {
    if (request)
      answerAffectTraceRequest(conductor, diagnostics, request)
  })
  return {
    conductor,
    stop,
    advance(seconds: number) {
      now += seconds
    },
  }
}

describe('natural motion lab', () => {
  afterEach(() => {
    setNaturalTraceSink(null)
    setAffectTraceSink(null)
    cleanup()
    localStorage.removeItem('settings/expression-performance')
  })

  it('writes the performance override from its controls', async () => {
    const { screen, override } = await renderLab()

    const enabled = until(() => override.overrideEnabled).toBe(true, { timeout: 5000, throwOnTimeout: true })
    await screen.getByRole('switch').nth(0).click()
    await enabled

    const talking = until(() => override.overrideMode).toBe('talking', { timeout: 5000, throwOnTimeout: true })
    await screen.getByRole('radio', { name: /options\.talking/ }).click()
    await talking
    expect(override.performanceOverride).toEqual({ mode: 'talking', energy: null })

    const energy = until(() => override.overrideEnergy).toBe(0.5, { timeout: 5000, throwOnTimeout: true })
    await screen.getByRole('switch').nth(1).click()
    await energy
  })

  it('disables the energy override while the state override is off', async () => {
    const { screen, override } = await renderLab()
    const stateSwitch = screen.getByRole('switch').nth(0)
    const energySwitch = screen.getByRole('switch').nth(1)

    await expect.element(energySwitch).toBeDisabled()

    await stateSwitch.click()
    await expect.element(energySwitch).toBeEnabled()
    const energy = until(() => override.overrideEnergy).toBe(0.5, { timeout: 5000, throwOnTimeout: true })
    await energySwitch.click()
    await energy
    const energySlider = screen.getByTestId('natural-override-energy').getByRole('slider')
    await expect.element(energySlider).toBeEnabled()

    await stateSwitch.click()
    await expect.element(energySwitch).toBeDisabled()
    await expect.element(energySlider).toBeDisabled()
  })

  it('advances the emotion pulse sequence for each click', async () => {
    const { screen, override } = await renderLab()
    const happy = screen.getByRole('button', { name: /names\.happy/ })

    const pulsed = until(() => override.emotionPulse?.seq).toBe(2, { timeout: 5000, throwOnTimeout: true })

    await happy.click()
    await happy.click()

    await pulsed
    expect(override.emotionPulse).toEqual({ name: 'happy', nominal: defaultExpressionPerformanceSettings.intensity.clear, seq: 2 })
  })

  it('emits the configured clear nominal from the real pulse button', async () => {
    const { screen, override } = await renderLab()
    const settings = useExpressionPerformanceSettings()
    expect(await settings.update({ intensity: { clear: 0.7 } })).toEqual({ success: true })

    const pulsed = until(() => override.emotionPulse?.seq).toBe(1, { timeout: 5000, throwOnTimeout: true })

    await screen.getByRole('button', { name: /names\.happy/ }).click()

    await pulsed
    expect(override.emotionPulse).toEqual({ name: 'happy', nominal: 0.7, seq: 1 })
  })

  it('starts an affect recording in the stage and saves the exported trace through the sink', async () => {
    const { screen, diagnostics } = await renderLab()
    const sink = vi.fn<AffectTraceSink>(() => 'C:/evidence/affect-trace.json')
    setAffectTraceSink(sink)
    const stage = createStage(diagnostics)

    await screen.getByTestId('affect-trace-start').click()
    await expect.element(screen.getByTestId('affect-trace-status')).toHaveTextContent('affect-trace.recording')

    stage.conductor.emotion('angry', 0.6, 'devtools')
    stage.advance(1)
    stage.conductor.emotion('happy', 0.9, 'devtools')
    await screen.getByTestId('affect-trace-export').click()

    await expect.element(screen.getByTestId('affect-trace-saved-path')).toHaveTextContent('C:/evidence/affect-trace.json')
    expect(sink).toHaveBeenCalledTimes(1)
    const [saved, fileName] = sink.mock.calls[0]
    const trace = parseAffectTrace(JSON.parse(JSON.stringify(saved)))
    expect(trace.entries.map(entry => entry.type === 'signal' ? [entry.signal.kind, entry.signal.at] : [entry.type])).toEqual([['emotion', 10], ['emotion', 11]])
    expect(trace).toMatchObject({ decider: 'picker', truncated: false, endAt: 11 })
    expect(fileName).toMatch(/^affect-trace-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/)
    await expect.element(screen.getByTestId('affect-trace-entries')).toHaveTextContent('affect-trace.exported')
    expect(diagnostics.affectTraceResult).toMatchObject({ action: 'export', entries: 2, truncated: false })
    stage.stop()
  })

  it('shows the stage failure when an export finds no open recording', async () => {
    const { screen, diagnostics } = await renderLab()
    const sink = vi.fn<AffectTraceSink>(() => null)
    setAffectTraceSink(sink)
    const stage = createStage(diagnostics)

    await screen.getByTestId('affect-trace-export').click()

    await expect.element(screen.getByTestId('affect-trace-failure')).toBeVisible()
    expect(diagnostics.affectTraceFailure).toBe('no-recording')
    expect(diagnostics.affectTraceRequest).toBeNull()
    expect(sink).not.toHaveBeenCalled()
    stage.stop()
  })

  it('renders each failure code through the English catalog', async () => {
    const { screen, diagnostics } = await renderLab({ en })
    const { t } = createTestI18n({ en }).global
    const failureKey = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.failures'
    const failures = { 'no-recording': t(`${failureKey}.no-recording`), 'save-failed': t(`${failureKey}.save-failed`) }
    expect(failures['no-recording']).not.toContain(failureKey)
    expect(failures['save-failed']).not.toContain(failureKey)
    setAffectTraceSink(() => {
      throw new Error('disk full')
    })
    const stage = createStage(diagnostics)

    await screen.getByTestId('affect-trace-export').click()
    await expect.element(screen.getByTestId('affect-trace-failure')).toHaveTextContent(failures['no-recording'])

    await screen.getByTestId('affect-trace-start').click()
    await expect.element(screen.getByTestId('affect-trace-status')).toBeVisible()
    await screen.getByTestId('affect-trace-export').click()
    await expect.element(screen.getByTestId('affect-trace-failure')).toHaveTextContent(failures['save-failed'])
    expect(diagnostics.affectTraceFailure).toBe('save-failed')
    stage.stop()
  })

  it('carries an export across windows and saves it only in the requesting window', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stageDiagnostics = useNaturalMotionDiagnostics()
    const stage = createStage(stageDiagnostics)
    const { screen, diagnostics } = await renderLab()
    expect(diagnostics).not.toBe(stageDiagnostics)
    const sink = vi.fn<AffectTraceSink>(() => 'C:/evidence/affect-trace.json')
    setAffectTraceSink(sink)

    await screen.getByTestId('affect-trace-start').click()
    await expect.element(screen.getByTestId('affect-trace-status')).toHaveTextContent('affect-trace.recording')
    stage.conductor.emotion('happy', 0.6, 'devtools')
    await screen.getByTestId('affect-trace-export').click()

    await expect.element(screen.getByTestId('affect-trace-saved-path')).toHaveTextContent('C:/evidence/affect-trace.json')
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0]).toEqual(stageDiagnostics.affectTrace)
    expect(diagnostics.affectTraceResult).toMatchObject({ action: 'export', entries: 1, savedPath: 'C:/evidence/affect-trace.json' })
    expect(stageDiagnostics.affectTraceResult).toMatchObject({ action: 'export', entries: 1, savedPath: null })
    stage.stop()
    disposePinia(stagePinia)
  })

  it('requests a capture and renders its result, then saves through the sink', async () => {
    const { screen, diagnostics } = await renderLab()
    const sink = vi.fn(() => 'C:/evidence/natural-trace.json')
    setNaturalTraceSink(sink)

    const requested = until(() => diagnostics.pendingRequest?.durationSeconds).toBe(60, { timeout: 5000, throwOnTimeout: true })
    await screen.getByRole('button', { name: /capture\.start/ }).nth(0).click()
    await requested
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
