import type { PerformanceRuntimeSnapshot } from '../features/performance/runtime-state'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../constants/emotions'
import { usePerformanceRuntimeState } from '../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../features/performance/settings'

const RUNTIME_PROMPT_KEYS = [
  'base.prompt.emotion',
  'base.prompt.emoji',
  'base.prompt.suffix',
]

const EXPRESSION_KINDS = ['face', 'effect', 'prop'] as const

/** One line per kind that has exposed labels, in face, effect, prop order. */
function formatExposedList(exposed: PerformanceRuntimeSnapshot['exposed']) {
  return EXPRESSION_KINDS.flatMap((kind) => {
    const labels = exposed.filter(entry => entry.kind === kind).map(entry => entry.label)
    return labels.length ? [`- ${kind}: ${labels.join(', ')}`] : []
  }).join('\n')
}

function formatActive(active: PerformanceRuntimeSnapshot['active']) {
  return active.length ? active.map(entry => `${entry.slot} ${entry.label}`).join(', ') : 'none'
}

function formatMood(mood: PerformanceRuntimeSnapshot['mood']) {
  return mood ? `valence ${mood.valence}, arousal ${mood.arousal}, tension ${mood.tension}` : 'unknown'
}

/**
 * Returns the localized emotion and emoji prompt for each model request.
 *
 * The expression list and the state feedback line are appended from code under their own
 * `te(...)` guards rather than through `RUNTIME_PROMPT_KEYS`, so a locale that lacks them
 * keeps the rest of the runtime prompt.
 */
export function useAiriRuntimePrompt() {
  const { locale, t, te } = useI18n()
  const runtimeState = usePerformanceRuntimeState()
  const performanceSettings = useExpressionPerformanceSettings()

  return computed(() => {
    if (!RUNTIME_PROMPT_KEYS.every(key => te(key, locale.value)))
      return ''

    const parts = [
      t('base.prompt.emotion'),
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      t('base.prompt.suffix'),
      t('base.prompt.emoji'),
    ]
    if (runtimeState.exposed.length && te('base.prompt.expressions', locale.value))
      parts.push(t('base.prompt.expressions', { list: formatExposedList(runtimeState.exposed) }))
    if (performanceSettings.document.stateFeedback && te('base.prompt.expression-state', locale.value))
      parts.push(t('base.prompt.expression-state', { active: formatActive(runtimeState.active), mood: formatMood(runtimeState.mood) }))

    return parts.join('\n\n')
  })
}
