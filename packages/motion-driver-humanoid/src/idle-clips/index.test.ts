import type { IdleClipCandidate, IdleClipHistory } from './index'

import { describe, expect, it } from 'vitest'

import { createRandomStream } from '../random'
import { IDLE_CLIP_REPEAT_MS, initialIdleClipHistory, pickIdleClip } from './index'

const clips: IdleClipCandidate[] = [
  { clipId: 'wave', kind: 'gesture' },
  { clipId: 'hair', kind: 'gesture' },
  { clipId: 'spin', kind: 'action' },
  { clipId: 'dance', kind: 'dance' },
]

/** Picks a clip every `gapMs` for `hours`, with seeded picks, and returns each pick with its time. */
function simulate(hours: number, gapMs: number) {
  const random = createRandomStream(3)
  let history: IdleClipHistory = initialIdleClipHistory
  const picked: { clipId: string, atMs: number }[] = []
  for (let nowMs = 0; nowMs < hours * 3_600_000; nowMs += gapMs) {
    const clip = pickIdleClip(clips, history, { nowMs, pick: random() })
    if (clip === null)
      continue
    history = { lastClipId: clip.clipId, playedAtMs: { ...history.playedAtMs, [clip.clipId]: nowMs } }
    picked.push({ clipId: clip.clipId, atMs: nowMs })
  }
  return picked
}

describe('pickIdleClip', () => {
  it('lets each clip rest for its kind and never picks the same one twice in a row, so a dance stays rare', () => {
    const picked = simulate(24, 60_000)
    for (const { clipId, kind } of clips) {
      const times = picked.filter(clip => clip.clipId === clipId).map(clip => clip.atMs)
      for (let index = 1; index < times.length; index++)
        expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(IDLE_CLIP_REPEAT_MS[kind])
    }
    expect(picked.some((clip, index) => index > 0 && clip.clipId === picked[index - 1].clipId)).toBe(false)
    const count = (id: string) => picked.filter(clip => clip.clipId === id).length
    expect(count('dance')).toBeLessThan(count('wave'))
  })

  it('picks nothing while every clip rests, and the last one again only when it is the only one rested', () => {
    const history: IdleClipHistory = { lastClipId: 'wave', playedAtMs: { wave: 0 } }
    expect(pickIdleClip([clips[0]], history, { nowMs: 1_000, pick: 0 })).toBeNull()
    expect(pickIdleClip([clips[0]], history, { nowMs: IDLE_CLIP_REPEAT_MS.gesture, pick: 0 })).toEqual(clips[0])
    expect(pickIdleClip([], initialIdleClipHistory, { nowMs: 0, pick: 0 })).toBeNull()
  })
})
