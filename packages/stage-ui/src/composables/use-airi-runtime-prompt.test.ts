import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { STAGE_CONTRACT_EN_SHA256 } from '@proj-airi/stage-shared/stage-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePerformanceRuntimeState } from '../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../features/performance/settings'
import { toExposedExpressions } from './performance/use-stage-performance-conductor'
import { useStageContractPrompt, useStageLiveStatePrompt } from './use-airi-runtime-prompt'

type Translate = (key: string, params?: Record<string, string>) => string

/** Echoes the key and its parameters, so a test can assert which keys a prompt used. */
const echoTranslate: Translate = (key, params) => params ? `${key}\n${Object.entries(params).map(([name, value]) => `[${name}]\n${value}`).join('\n')}` : key

const i18nMock = vi.hoisted(() => {
  const t: Translate = key => key
  return { t }
})

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({ t: (key: string, params?: Record<string, string>) => i18nMock.t(key, params) }),
  }
})

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

beforeEach(() => {
  setActivePinia(createPinia())
  i18nMock.t = echoTranslate
})

describe('useStageContractPrompt', () => {
  it('renders the English contract byte-for-byte', async () => {
    const { createI18n } = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages,
      ...createFallbackOptions(() => {}),
    })
    i18nMock.t = (key, params) => i18n.global.t(key, params ?? {})

    const prompt = useStageContractPrompt().value

    expect(prompt).toContain('<|ACT happy|>')
    expect(createHash('sha256').update(prompt).digest('hex')).toBe(STAGE_CONTRACT_EN_SHA256)
  })

  it('assembles the emotion and emoji rules without the shared closing', () => {
    const prompt = useStageContractPrompt().value

    expect(prompt).toContain('base.prompt.emotion')
    expect(prompt).toContain('base.prompt.emoji')
    expect(prompt).not.toContain('base.prompt.suffix')
  })

  it('keeps the nine original emotion lines byte-for-byte and appends the newer emotions', () => {
    expect(useStageContractPrompt().value).toContain([
      '- happy (Emotion for feeling Happy)',
      '- sad (Emotion for feeling Sad)',
      '- angry (Emotion for feeling Angry)',
      '- think (Emotion for feeling Think)',
      '- surprised (Emotion for feeling Surprise)',
      '- awkward (Emotion for feeling Awkward)',
      '- question (Emotion for feeling Question)',
      '- curious (Emotion for feeling Curious)',
      '- neutral (Emotion for feeling Idle)',
      '- love (Emotion for feeling Love)',
      '- flustered (Emotion for feeling Flustered)',
      '- sleepy (Emotion for feeling Sleepy)',
    ].join('\n'))
  })

  it('carries no live state, so it stays identical while the performance state changes', async () => {
    const prompt = useStageContractPrompt()
    const before = prompt.value

    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(catalog), active: [{ slot: 'face', label: 'anger' }], mood: null })
    await useExpressionPerformanceSettings().update({ stateFeedback: true })

    expect(prompt.value).toBe(before)
  })

  it('renders a key that the active locale lacks from English', async () => {
    const { createI18n } = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
    // The contract keys are the subject here. Every other key is irrelevant to this composable.
    const i18n = createI18n({
      legacy: false,
      locale: 'th',
      fallbackLocale: 'en',
      fallbackWarn: false,
      missingWarn: false,
      messages: {
        en: { base: { prompt: { emotion: 'en-emotion', emoji: 'en-emoji', response: 'en-response' } } },
        th: { base: { prompt: { emotion: 'th-emotion' } } },
      },
    })
    i18nMock.t = (key, params) => i18n.global.t(key, params ?? {})

    const prompt = useStageContractPrompt().value

    expect(prompt.startsWith('th-emotion\n\n')).toBe(true)
    expect(prompt.endsWith('\n\nen-emoji\n\nen-response')).toBe(true)
  })
})

describe('useStageLiveStatePrompt', () => {
  it('is empty while nothing is exposed and state feedback is off', () => {
    expect(useStageLiveStatePrompt().value).toBe('')
  })

  it('carries no stage contract', () => {
    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(catalog), active: [], mood: null })

    const prompt = useStageLiveStatePrompt().value

    expect(prompt).not.toContain('base.prompt.emotion')
    expect(prompt).not.toContain('base.prompt.emoji')
  })

  it('lists exactly the exposed expressions by kind and no outfit, system, or unexposed entry', () => {
    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(catalog), active: [], mood: null })

    const prompt = useStageLiveStatePrompt().value

    expect(listedLabels(prompt)).toEqual(new Set(['anger', 'pout', 'tear', 'game']))
    expect(prompt).toContain('- face: anger, pout\n- effect: tear\n- prop: game')
    expect(prompt).not.toMatch(/hat|watermark|smile|P-/)
  })

  it('lists a combo under its own group after prop and hides unsorted and duplicate entries', () => {
    const withCombos = [
      ...catalog,
      entry('smile-and-tear', 'combo', { fileName: '', parameterIds: [], slots: ['face', 'effect'] }),
      entry('expression19', 'unsorted'),
      entry('anger-copy', 'face', { duplicateOf: 'anger.exp3.json' }),
    ]
    usePerformanceRuntimeState().publish({ exposed: toExposedExpressions(withCombos), active: [], mood: null })

    const prompt = useStageLiveStatePrompt().value

    expect(prompt).toContain('- face: anger, pout\n- effect: tear\n- prop: game\n- combo: smile-and-tear')
    expect(prompt).not.toMatch(/expression19|anger-copy/)
  })

  it('reports active expressions and mood only while state feedback is on', async () => {
    const runtimeState = usePerformanceRuntimeState()
    runtimeState.publish({ exposed: toExposedExpressions(catalog), active: [{ slot: 'face', label: 'anger' }], mood: { valence: -0.2, arousal: 0.3, tension: 0.4 } })
    const prompt = useStageLiveStatePrompt()
    expect(prompt.value).not.toContain('base.prompt.expression-state')

    await useExpressionPerformanceSettings().update({ stateFeedback: true })

    expect(prompt.value).toContain('base.prompt.expression-state\n[active]\nface anger\n[mood]\nvalence -0.2, arousal 0.3, tension 0.4')
  })
})
