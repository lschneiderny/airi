import type { GaitStyle } from '@proj-airi/motion-driver-humanoid/locomotion'
import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { GAIT_STYLE_KEYS, NEUTRAL_GAIT_STYLE } from '@proj-airi/motion-driver-humanoid/locomotion'
import { describe, expect, it } from 'vitest'

import { activeEvents, clipCodec, clipTimes, composeClipFrame, findOnPath, heldLines, wrapHeader } from './clip'

describe('clip', () => {
  it('draws the before run on the left and the after run on the right, at an even size', () => {
    const panel = (value: number) => ({ rgb: new Uint8Array(10 * 10 * 3).fill(value) })
    const frame = composeClipFrame([{ panels: [panel(10)], header: [] }, { panels: [panel(200)], header: [] }], 10, 10, [], 0)
    const pixelAt = (x: number) => frame.rgb[((frame.height - 20 + 5) * frame.width + x) * 3]
    expect(frame.width % 2 + frame.height % 2).toBe(0)
    expect(pixelAt(5)).toBe(10)
    expect(pixelAt(frame.width - 5)).toBe(200)
  })

  it('samples motion time at the playback rate, so the clip plays in real time', () => {
    const times = clipTimes(2, 3, 30)
    expect(times).toHaveLength(31)
    expect(times[30]).toBeCloseTo(3, 9)
  })

  it('names the mood a run holds at each time, from its overrides and then its mood cues', () => {
    const events = [{ t: 5, kind: 'marker' as const, label: 'mood:0.8,0.8,0.15' }, { t: 9, kind: 'marker' as const, label: 'energy:0.05' }]
    const held = { mood: { valence: 0, arousal: 0, tension: 0.15 }, energy: null, walkStyle: { ...NEUTRAL_GAIT_STYLE, stride: 1.2 } }
    expect(heldLines(events, held, 4)).toEqual(['mood 0,0,0.15', 'style stride'])
    expect(heldLines(events, held, 10)).toEqual(['mood 0.8,0.8,0.15', 'energy 0.05', 'style stride'])
    expect(heldLines(events, {}, 4)).toEqual([])
  })

  it('sizes the header to every held input and caption, wrapped to a one-view panel', () => {
    const style = GAIT_STYLE_KEYS.reduce<GaitStyle>((held, key) => ({ ...held, [key]: held[key] + 0.1 }), NEUTRAL_GAIT_STYLE)
    const held = { mood: { valence: 0.8, arousal: 0.8, tension: 0.15 }, energy: 0.05, walkStyle: style }
    const header = ['RUN 0123abcde', 'walk seed 1', 't 1.00 s  f 60', ...heldLines([], held, 0), '1.00 heel-strike left', '0.90 mood:0.8,0.8,0.15']
    // The clip's 270-pixel panel holds 22 header columns.
    const lines = wrapHeader(header, 270, 1)
    expect(lines.every(line => line.length <= 22)).toBe(true)
    expect(lines.join(' ')).toContain(GAIT_STYLE_KEYS.join(', '))
    const frame = composeClipFrame([{ panels: [{ rgb: new Uint8Array(270 * 10 * 3).fill(255) }], header }], 270, 10, [], lines.length)
    const inked = (line: number) => {
      for (let y = 3 + line * 16; y < 3 + (line + 1) * 16; y++) {
        for (let x = 0; x < frame.width; x++) {
          if (frame.rgb[(y * frame.width + x) * 3] < 128)
            return true
        }
      }
      return false
    }
    expect(lines.map((_, line) => inked(line))).toEqual(lines.map(() => true))
  })

  it('keeps an event on screen for the hold time after it happens, newest first', () => {
    const events = [{ t: 1, kind: 'marker' as const, label: 'stroke' }, { t: 1.5, kind: 'marker' as const, label: 'release' }]
    const label = (event: MotionTraceEvent) => event.kind === 'marker' ? event.label : event.kind
    expect(activeEvents(events, 0.9, label)).toEqual([])
    expect(activeEvents(events, 1.6, label)).toEqual(['1.50 release', '1.00 stroke'])
    expect(activeEvents(events, 2.2, label)).toEqual(['1.50 release'])
    expect(activeEvents(events, 2.6, label)).toEqual([])
  })

  it('finds ffmpeg only where it is, and picks the encoder from the extension', () => {
    const present = new Set(['/opt/b/ffmpeg'])
    expect(findOnPath('ffmpeg', '/opt/a:/opt/b', path => present.has(path))).toBe('/opt/b/ffmpeg')
    expect(findOnPath('ffmpeg', '/opt/a', path => present.has(path))).toBeNull()
    expect(findOnPath('ffmpeg', undefined, () => true)).toBeNull()
    expect(clipCodec('/x/clip.MP4')?.encoder).toBe('libopenh264')
    expect(clipCodec('/x/clip.webp')?.encoder).toBe('libwebp_anim')
    expect(clipCodec('/x/clip.avi')).toBeNull()
  })
})
