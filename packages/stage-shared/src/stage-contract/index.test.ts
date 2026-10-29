import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { PERFORMANCE_EMOTIONS } from '../expression-performance/types'
import { composeSystemPrompt, renderStageContract, STAGE_CONTRACT_EN_SHA256, stageContractEmotions } from './index'

describe('stage contract', () => {
  it('renders every emotion between the contract keys in performance order', () => {
    expect(renderStageContract(key => key)).toBe([
      'base.prompt.emotion',
      [
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
      ].join('\n'),
      'base.prompt.emoji',
    ].join('\n\n'))
  })

  it('pins the English contract bytes and renders literal ACT markers', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages,
      ...createFallbackOptions(() => {}),
    })
    const text = renderStageContract(i18n.global.t)

    expect(text).toContain('<|ACT happy|>')
    expect(createHash('sha256').update(text).digest('hex')).toBe(STAGE_CONTRACT_EN_SHA256)
  })

  it('appends only non-empty contracts with two newlines', () => {
    expect(composeSystemPrompt('card', '')).toMatch(/card$/)
    expect(composeSystemPrompt('card', '')).not.toMatch(/\n\n$/)
    expect(composeSystemPrompt('card', 'c')).toBe(`${composeSystemPrompt('card', '')}\n\nc`)
  })

  it('uses exactly the performance emotions in their defined order', () => {
    expect(stageContractEmotions.map(emotion => emotion.value)).toEqual(PERFORMANCE_EMOTIONS)
  })
})
