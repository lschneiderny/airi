import type { MindIntent } from '@proj-airi/character-mind'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'

import { NO_CAPABILITIES, permits } from '@proj-airi/character-mind'
import { LIVE2D_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import { MMD_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { describe, expect, it } from 'vitest'

const channels = {
  'touch-reaction': 'posture',
  'mood': 'posture',
  'emotion-gesture': 'posture',
  'emotion': 'face',
  'entry': 'face',
  'release': 'face',
  'moment': 'face',
  'wake': 'posture',
  'desktop-reaction': 'posture',
  'speak': 'voice',
  'cancel': 'voice',
  'drop': 'voice',
  'cue': 'posture',
  'observe-wake': 'voice',
  'observe-return': 'voice',
  'idle-act': 'posture',
  'idle-errand': 'posture',
  'settle': 'posture',
  'cursor-episode': 'gaze',
  'attend': 'body',
  'refractory': 'body',
  'away': 'body',
  'chat-read': 'gaze',
  'gesture': 'posture',
} satisfies Record<MindIntent['kind'], MindIntent['channel']>

describe('performer capabilities', () => {
  it.each(Object.entries(channels))('permits the declared channel of %s', (kind, channel) => {
    // Permission reads only the discriminants and gesture kind, independent of each episode's payload.
    const intent = { id: '1', cause: 1, kind, channel, gesture: 'nod' } as MindIntent
    expect(permits(NO_CAPABILITIES, intent)).toBe(channel === 'voice')
    expect(permits(LIVE2D_NATURAL_CAPABILITIES, intent)).toBe(channel !== 'body')
    expect(permits(MMD_NATURAL_CAPABILITIES, intent)).toBe(true)
  })

  it.each<CueGestureKind>(['nod', 'shake', 'glance', 'shrug', 'lean'])('checks the gesture declaration for %s', (gesture) => {
    const intent: MindIntent = { id: '1', cause: 1, channel: 'posture', kind: 'gesture', gesture, count: 1 }
    expect(permits(NO_CAPABILITIES, intent)).toBe(false)
    expect(permits(LIVE2D_NATURAL_CAPABILITIES, intent)).toBe(gesture !== 'shrug' && gesture !== 'lean')
    expect(permits(MMD_NATURAL_CAPABILITIES, intent)).toBe(true)
  })
})
