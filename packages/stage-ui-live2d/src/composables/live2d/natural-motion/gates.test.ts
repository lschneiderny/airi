import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { ScoredChannel } from './emotion-score'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { describe, expect, it } from 'vitest'

import { buildEmotionChecks, unscoredRecipeEntries } from './gates'

const faceChannels = { browAngle: 'browAngle', eyeSmile: 'eyeSmile', mouthForm: 'mouthForm', mouthOpen: 'mouthOpen', cheek: 'cheek' } as const
const postureChannels: readonly (readonly ScoredChannel[])[] = [['angleX', 'bodyAngleX'], ['angleY', 'bodyAngleY'], ['angleZ', 'bodyAngleZ']]
const modulationChannels = { blinkInterval: 'blinkRate', breathPeriod: 'breathPeriod', amplitude: 'headRms', cameraFixation: 'cameraFixation' } as const
const modulationRest = { blinkInterval: 1, breathPeriod: 1, amplitude: 1, cameraFixation: 0, deskWeight: 0, nodSize: 1, nodAcceptance: 0 } as const

/** Every channel the held recipe of `emotion` must be checked on, per band. */
function expectedKeys(emotion: PerformanceEmotion) {
  const held = naturalEmotions[emotion].held!
  const keys: string[] = []
  for (const band of ['slight', 'clear', 'strong'] as const) {
    const key = (channel: ScoredChannel) => keys.push(`${emotion}:${band}:${channel}`)
    if (held.face.browY !== 0 || (held.face.oneSidedBrow ?? 0) !== 0)
      key('browMean')
    if ((held.face.oneSidedBrow ?? 0) !== 0)
      key('browAsym')
    for (const [field, channel] of Object.entries(faceChannels) as [keyof typeof faceChannels, ScoredChannel][]) {
      if (held.face[field] !== 0)
        key(channel)
    }
    if (held.face.eyeOpenMultiplier !== 1 || held.face.eyeOpenHint !== 0)
      key('eyelid')
    held.posture.forEach((value, axis) => {
      if (value !== 0)
        postureChannels[axis].forEach(key)
    })
    if (band !== 'slight') {
      for (const [field, channel] of Object.entries(modulationChannels) as [keyof typeof modulationChannels, ScoredChannel][]) {
        if (held.modulation[field] !== modulationRest[field])
          key(channel)
      }
    }
  }
  return keys
}

describe('emotion gate checks', () => {
  const checks = buildEmotionChecks()
  const emotions = (Object.keys(naturalEmotions) as PerformanceEmotion[]).filter(emotion => emotion !== 'neutral')

  it('covers every nonzero held recipe entry of all 11 non-neutral emotions', () => {
    expect(emotions).toHaveLength(11)
    for (const emotion of emotions)
      expect(checks.filter(check => check.emotion === emotion).map(check => check.key).sort()).toEqual(expectedKeys(emotion).sort())
    expect(checks.some(check => check.emotion === 'neutral')).toBe(false)
  })

  it('lists every nonzero modulation entry it cannot score', () => {
    for (const emotion of emotions) {
      const { modulation } = naturalEmotions[emotion].held!
      for (const field of ['deskWeight', 'nodSize', 'nodAcceptance'] as const) {
        if (modulation[field] !== modulationRest[field])
          expect(Object.keys(unscoredRecipeEntries)).toContain(`modulation.${field}`)
      }
    }
  })

  it('gives every check a unique key and the recipe direction', () => {
    expect(new Set(checks.map(check => check.key)).size).toBe(checks.length)
    const sleepyEyelid = checks.find(check => check.key === 'sleepy:strong:eyelid')!
    expect(sleepyEyelid.sign).toBe(-1)
    expect(checks.find(check => check.key === 'surprised:strong:blinkRate')!.sign).toBe(-1)
    expect(checks.find(check => check.key === 'question:clear:browAsym')!.sided).toBe(true)
  })

  it('follows recipe edits without code changes', () => {
    const edited = structuredClone(naturalEmotions)
    edited.happy.held!.face.mouthForm = 0
    edited.sad.held!.face.cheek = 0.5
    const keys = buildEmotionChecks(edited).map(check => check.key)
    expect(keys).not.toContain('happy:clear:mouthForm')
    expect(keys).toContain('sad:clear:cheek')
    expect(buildEmotionChecks(edited).find(check => check.key === 'sad:strong:cheek')!.recipe).toBe(0.5)
  })
})
