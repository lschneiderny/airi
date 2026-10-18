import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePerformanceRuntimeState } from '../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { toExposedExpressions } from './performance/use-stage-performance-conductor'
import { useAiriRuntimePrompt } from './use-airi-runtime-prompt'

const i18nMock = vi.hoisted(() => ({
  hasTranslation: vi.fn<(key: string, locale: string) => boolean>(),
  locale: { value: 'en' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: i18nMock.locale,
    t: (key: string, params?: Record<string, string>) => params ? `${key}\n${Object.entries(params).map(([name, value]) => `[${name}]\n${value}`).join('\n')}` : key,
    te: (key: string, currentLocale: string) => i18nMock.hasTranslation(key, currentLocale),
  }),
}))

function entry(id: string, kind: CatalogEntry['kind'], overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id: `${id}.exp3.json`, label: id, kind, group: null, confirmed: true, exposedToLlm: true, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [`P-${id}`], ...overrides }
}

const catalog = [
  entry('anger', 'face'),
  entry('tear', 'effect'),
  entry('game', 'prop'),
  entry('hat', 'outfit'),
  entry('watermark', 'system'),
  entry('smile', 'face', { exposedToLlm: false }),
  entry('pout', 'face', { confirmed: false }),
]

/** Labels on the `- kind: a, b` lines of the expression list. */
function listedLabels(prompt: string) {
  const list = prompt.split('[list]\n')[1]?.split('\n\n')[0] ?? ''
  return new Set(list.split('\n').flatMap(line => line.replace(/^- \w+: /, '').split(', ')).filter(Boolean))
}

describe('useAiriRuntimePrompt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    i18nMock.hasTranslation.mockReset()
  })

  it('returns no prompt for a locale that still uses the combined prompt', () => {
    i18nMock.hasTranslation.mockReturnValue(false)

    expect(useAiriRuntimePrompt().value).toBe('')
  })

  it('assembles the emotion and emoji prompt for a split locale', () => {
    i18nMock.hasTranslation.mockReturnValue(true)

    const prompt = useAiriRuntimePrompt().value

    expect(prompt).toContain('base.prompt.emotion')
    expect(prompt).toContain('base.prompt.suffix')
    expect(prompt).toContain('base.prompt.emoji')
    // Nothing is exposed and state feedback is off by default.
    expect(prompt).not.toContain('base.prompt.expressions')
    expect(prompt).not.toContain('base.prompt.expression-state')
  })

  it('lists exactly the exposed expressions by kind and no outfit, system, or unexposed entry', () => {
    i18nMock.hasTranslation.mockReturnValue(true)
    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(catalog), active: [], mood: null })

    const prompt = useAiriRuntimePrompt().value

    expect(listedLabels(prompt)).toEqual(new Set(['anger', 'tear', 'game']))
    expect(prompt).toContain('- face: anger\n- effect: tear\n- prop: game')
    expect(prompt).not.toMatch(/hat|watermark|smile|pout|P-/)
  })

  it('keeps the rest of the prompt and adds no list when the locale lacks the expressions key', () => {
    i18nMock.hasTranslation.mockImplementation(key => key !== 'base.prompt.expressions')
    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(catalog), active: [], mood: null })

    const prompt = useAiriRuntimePrompt().value

    expect(prompt).toContain('base.prompt.emotion')
    expect(prompt).not.toContain('base.prompt.expressions')
    expect(prompt).not.toContain('anger')
  })

  it('reports active expressions and mood only while state feedback is on', async () => {
    i18nMock.hasTranslation.mockReturnValue(true)
    const runtimeState = usePerformanceRuntimeState()
    runtimeState.publish({ exposed: toExposedExpressions(catalog), active: [{ slot: 'face', label: 'anger' }], mood: { valence: -0.2, arousal: 0.3, tension: 0.4 } })
    const prompt = useAiriRuntimePrompt()
    expect(prompt.value).not.toContain('base.prompt.expression-state')

    await useExpressionPerformanceSettings().update({ stateFeedback: true })

    expect(prompt.value).toContain('base.prompt.expression-state\n[active]\nface anger\n[mood]\nvalence -0.2, arousal 0.3, tension 0.4')
  })
})
