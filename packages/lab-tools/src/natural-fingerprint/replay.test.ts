import type { Track } from './track'

import { describe, expect, it } from 'vitest'

import { DEFAULT_REPLAY, replayTrack } from './replay'
import { parseTrack } from './track'

/** Three seconds at 30 fps: one second of silence, then a second of speech, then silence. */
function voiceTrack(): Track {
  const frames = 90
  const voiced = Array.from({ length: frames }, (_, i) => i >= 30 && i < 60)
  const empty = voiced.map(() => null)
  return {
    format: 'natural-track',
    version: 1,
    source: 'video',
    tracker: 'test',
    fps: 30,
    channels: { tilt: [...empty], x: [...empty], y: [...empty], scale: [...empty], eyeOpen: [...empty] },
    voice: { level: voiced.map(v => v ? 0.6 : 0), voiced },
  }
}

describe('replayTrack', () => {
  const track = voiceTrack()
  const first = replayTrack(track, { ...DEFAULT_REPLAY, seed: 1 })

  it('writes a valid natural track with the same voice', () => {
    const parsed = parseTrack(first)
    expect(parsed.source).toBe('natural')
    expect(parsed.channels.bodyTilt).toHaveLength(90)
    expect(parsed.voice).toEqual(track.voice)
  })

  it('is deterministic for a seed and differs between seeds', () => {
    expect(replayTrack(track, { ...DEFAULT_REPLAY, seed: 1 })).toEqual(first)
    expect(replayTrack(track, { ...DEFAULT_REPLAY, seed: 2 }).channels.tilt).not.toEqual(first.channels.tilt)
  })
})
