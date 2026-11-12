import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { describe, expect, it } from 'vitest'

import { activeEvents, clipCodec, clipTimes, composeClipFrame, findOnPath } from './clip'

describe('clip', () => {
  it('draws the before run on the left and the after run on the right, at an even size', () => {
    const panel = (value: number) => ({ rgb: new Uint8Array(10 * 10 * 3).fill(value) })
    const frame = composeClipFrame([{ panels: [panel(10)], header: [] }, { panels: [panel(200)], header: [] }], 10, 10, [])
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
