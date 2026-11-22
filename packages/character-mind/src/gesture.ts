import type { PlayedGesture } from '@proj-airi/motion-driver-natural/emotions'
import type { EmotionBehaviorSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { expressionSeed } from '@proj-airi/stage-shared/expression-performance'

/**
 * Seconds before a gesture of the same key may play again, on the mind's clock. Shake and drop share the `angry` key,
 * so an angry episode cannot alternate them inside one cooldown. Values moved unchanged from Natural's gesture layer.
 */
export const EMOTION_GESTURE_COOLDOWN_SECONDS = { 'laugh': 4, 'recoil': 3, 'angry': 5, 'sway': 4, 'tilt-in': 5, 'look-away': 4, 'nod-off': 8 } as const

export type EmotionGestureCooldownKey = keyof typeof EMOTION_GESTURE_COOLDOWN_SECONDS

/** When each cooldown key last played, in seconds of the mind's clock. Fast state; plain JSON. */
export interface MindGestureState {
  lastAtSeconds: Partial<Record<EmotionGestureCooldownKey, number>>
}

export const initialMindGestureState: MindGestureState = { lastAtSeconds: {} }

function cooldownKey(gesture: PlayedGesture): EmotionGestureCooldownKey {
  return gesture === 'shake' || gesture === 'drop' ? 'angry' : gesture
}

/**
 * The body gesture of a new or escalated emotion episode, or null, and the gesture memory after it. Pure: it reads the
 * Natural recipe table and draws nothing from the mind's source. It requires held emotions, a recipe gesture and impulse,
 * a positive intensity, and a band that is not slight (`clear` when bands are off), and refuses inside the key's cooldown.
 * `shake-or-drop` resolves from a hash of the episode id, so every mind given the same episode chooses the same clip,
 * and an escalation of that episode keeps it.
 *
 * The cooldown is spent when the mind orders the gesture, also when the performer then refuses it (a cue gesture holds
 * the head, or the model's strength for the emotion is 0).
 */
export function emotionGesture(memory: MindGestureState, episode: ReactionEpisode, settings: Pick<EmotionBehaviorSettings, 'heldEmotions' | 'bands'>, atSeconds: number): { gesture: PlayedGesture | null, memory: MindGestureState } {
  const recipe = naturalEmotions[episode.emotion]
  const band = settings.bands ? episode.band : 'clear'
  if (!settings.heldEmotions || !recipe.gesture || !recipe.impulse || !(episode.intensity > 0) || band === 'slight')
    return { gesture: null, memory }

  const gesture = recipe.gesture === 'shake-or-drop'
    ? (expressionSeed(episode.id, 'gesture') / 2 ** 32 < 0.5 ? 'shake' : 'drop')
    : recipe.gesture
  const key = cooldownKey(gesture)
  const last = memory.lastAtSeconds[key]
  if (last !== undefined && atSeconds - last < EMOTION_GESTURE_COOLDOWN_SECONDS[key])
    return { gesture: null, memory }

  return { gesture, memory: { lastAtSeconds: { ...memory.lastAtSeconds, [key]: atSeconds } } }
}
