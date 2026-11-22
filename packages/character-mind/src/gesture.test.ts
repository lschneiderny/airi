import type { PerformanceEmotion, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import type { EmotionGestureCooldownKey } from './gesture'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { describe, expect, it } from 'vitest'

import { EMOTION_GESTURE_COOLDOWN_SECONDS, emotionGesture, initialMindGestureState } from './gesture'

const on = { heldEmotions: true, bands: true }

function episode(emotion: PerformanceEmotion, band: ReactionEpisode['band'] = 'clear', id = `${emotion}-1`, intensity = 0.6): ReactionEpisode {
  return { id, emotion, nominal: intensity, intensity, band, escalation: false }
}

describe('emotionGesture', () => {
  it('yields each recipe gesture at clear and strong and none at slight', () => {
    const recipe = Object.entries(naturalEmotions).filter(([, spec]) => spec.gesture && spec.gesture !== 'shake-or-drop')
    expect(recipe.map(([emotion]) => emotion)).toEqual(['happy', 'surprised', 'awkward', 'love', 'flustered', 'sleepy'])
    for (const [emotion, spec] of recipe) {
      const name = emotion as PerformanceEmotion
      expect(emotionGesture(initialMindGestureState, episode(name, 'clear'), on, 0).gesture).toBe(spec.gesture)
      expect(emotionGesture(initialMindGestureState, episode(name, 'strong'), on, 0).gesture).toBe(spec.gesture)
      expect(emotionGesture(initialMindGestureState, episode(name, 'slight'), on, 0).gesture).toBeNull()
    }
    for (const emotion of ['neutral', 'sad', 'think', 'question', 'curious'] as const)
      expect(emotionGesture(initialMindGestureState, episode(emotion, 'strong'), on, 0).gesture).toBeNull()
  })

  it('treats every band as clear when bands are off, so a slight episode plays', () => {
    expect(emotionGesture(initialMindGestureState, episode('happy', 'slight'), { heldEmotions: true, bands: false }, 0).gesture).toBe('laugh')
  })

  it('yields none with held emotions off or without a positive intensity, and keeps the memory', () => {
    const off = emotionGesture(initialMindGestureState, episode('happy'), { heldEmotions: false, bands: true }, 0)
    expect(off.gesture).toBeNull()
    expect(off.memory).toBe(initialMindGestureState)
    expect(emotionGesture(initialMindGestureState, episode('happy', 'clear', 'happy-1', 0), on, 0).gesture).toBeNull()
  })

  it('refuses a repeat inside each cooldown key and allows it at the boundary', () => {
    const cases: [PerformanceEmotion, EmotionGestureCooldownKey][] = [['happy', 'laugh'], ['surprised', 'recoil'], ['angry', 'angry'], ['awkward', 'sway'], ['love', 'tilt-in'], ['flustered', 'look-away'], ['sleepy', 'nod-off']]
    for (const [emotion, key] of cases) {
      const seconds = EMOTION_GESTURE_COOLDOWN_SECONDS[key]
      const first = emotionGesture(initialMindGestureState, episode(emotion, 'clear', `${emotion}-1`), on, 100)
      expect(first.gesture).not.toBeNull()
      expect(first.memory.lastAtSeconds[key]).toBe(100)
      const inside = emotionGesture(first.memory, episode(emotion, 'clear', `${emotion}-2`), on, 100 + seconds - 0.001)
      expect(inside.gesture).toBeNull()
      expect(inside.memory).toBe(first.memory)
      expect(emotionGesture(first.memory, episode(emotion, 'clear', `${emotion}-3`), on, 100 + seconds).gesture).not.toBeNull()
    }
  })

  it('keeps one cooldown per key, so another key plays at once', () => {
    const laugh = emotionGesture(initialMindGestureState, episode('happy'), on, 0)
    expect(emotionGesture(laugh.memory, episode('surprised'), on, 0.1).gesture).toBe('recoil')
  })

  it('resolves shake-or-drop from the episode id: the same for the same id, both values over ids, one shared angry key', () => {
    const picks = Array.from({ length: 40 }, (_, index) => emotionGesture(initialMindGestureState, episode('angry', 'clear', `angry-${index}`), on, 0))
    expect(new Set(picks.map(pick => pick.gesture))).toEqual(new Set(['shake', 'drop']))
    for (const [index, pick] of picks.entries()) {
      expect(emotionGesture(initialMindGestureState, episode('angry', 'strong', `angry-${index}`), on, 50).gesture).toBe(pick.gesture)
      expect(pick.memory.lastAtSeconds).toEqual({ angry: 0 })
    }
    const shake = picks.findIndex(pick => pick.gesture === 'shake')
    const drop = picks.findIndex(pick => pick.gesture === 'drop')
    expect(emotionGesture(picks[shake].memory, episode('angry', 'clear', `angry-${drop}`), on, 3).gesture).toBeNull()
  })
})
