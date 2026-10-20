import type { PerformanceRuntimeSnapshot } from '../features/performance/runtime-state'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { EMOTION_PromptName_value, EMOTION_VALUES } from '../constants/emotions'
import { usePerformanceRuntimeState } from '../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../features/performance/settings'

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
 * Returns the stable stage contract: the cue rules, the emotion list, and the emoji rule.
 *
 * It changes only with the locale, so callers place it in the system prompt, where it stays a cache-stable prefix.
 * A locale that lacks a key renders the English text through the i18n `fallbackLocale`.
 */
export function useStageContractPrompt() {
  const { t } = useI18n()

  return computed(() => [
    t('base.prompt.emotion'),
    EMOTION_VALUES
      .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_PromptName_value[emotion]})`)
      .join('\n'),
    t('base.prompt.emoji'),
  ].join('\n\n'))
}

/**
 * Returns the live performance state: the exposed expressions and, while state feedback is on, the active
 * expressions and mood. It is empty when neither applies.
 *
 * It changes during a conversation, so callers send it with the request rather than in the system prompt.
 */
export function useStageLiveStatePrompt() {
  const { t } = useI18n()
  const runtimeState = usePerformanceRuntimeState()
  const performanceSettings = useExpressionPerformanceSettings()

  return computed(() => {
    const parts: string[] = []
    if (runtimeState.exposed.length)
      parts.push(t('base.prompt.expressions', { list: formatExposedList(runtimeState.exposed) }))
    if (performanceSettings.document.stateFeedback)
      parts.push(t('base.prompt.expression-state', { active: formatActive(runtimeState.active), mood: formatMood(runtimeState.mood) }))

    return parts.join('\n\n')
  })
}
