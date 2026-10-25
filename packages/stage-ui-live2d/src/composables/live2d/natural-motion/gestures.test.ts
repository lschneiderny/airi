import type { GestureKind } from './emotions'

import { describe, expect, it } from 'vitest'

import { gestureLifetimes, NaturalGestures } from './gestures'
import { minJerk } from './processes'
import { createRandomStream } from './random'

const step = 1 / 120
const kinds: GestureKind[] = ['laugh', 'recoil', 'shake', 'drop', 'shake-or-drop', 'sway', 'tilt-in', 'look-away', 'nod-off']

/** Head and body samples on the facade's grid from 0 to `seconds`. */
function sampleTrack(gestures: NaturalGestures, seconds: number) {
  const head: number[][] = []
  const body: number[][] = []
  for (let i = 0; i <= seconds / step; i++) {
    head.push(gestures.headOffset(i * step))
    body.push(gestures.bodyOffset(i * step))
  }
  return { head, body }
}

function peak(track: number[][]) {
  return Math.max(...track.map(offset => Math.hypot(...offset)))
}

describe('natural gestures', () => {
  it('replays bit-identical clips for equal seeds and triggers', () => {
    for (const kind of kinds) {
      const a = new NaturalGestures(createRandomStream(41))
      const b = new NaturalGestures(createRandomStream(41))
      expect(a.trigger(kind, 0.9, 'strong', 0)).toBe(true)
      expect(b.trigger(kind, 0.9, 'strong', 0)).toBe(true)
      const trackA = sampleTrack(a, 10)
      const trackB = sampleTrack(b, 10)
      const headB = trackB.head.flat()
      const bodyB = trackB.body.flat()
      expect(trackA.head.flat().every((value, i) => Object.is(value, headB[i]))).toBe(true)
      expect(trackA.body.flat().every((value, i) => Object.is(value, bodyB[i]))).toBe(true)
    }
  })

  it('blocks a retrigger during the cooldown, allows one after it, and draws nothing when refused', () => {
    const gestures = new NaturalGestures(createRandomStream(41))
    expect(gestures.trigger('laugh', 0.9, 'strong', 0)).toBe(true)
    expect(gestures.trigger('laugh', 0.9, 'strong', 2)).toBe(false)
    expect(gestures.trigger('laugh', 0.9, 'strong', 4)).toBe(true)

    const withRefusal = new NaturalGestures(createRandomStream(5))
    const withoutRefusal = new NaturalGestures(createRandomStream(5))
    withRefusal.trigger('sway', 0.8, 'clear', 0)
    withoutRefusal.trigger('sway', 0.8, 'clear', 0)
    expect(withRefusal.trigger('sway', 0.8, 'clear', 1)).toBe(false)
    withRefusal.trigger('tilt-in', 0.8, 'clear', 5)
    withoutRefusal.trigger('tilt-in', 0.8, 'clear', 5)
    expect(sampleTrack(withRefusal, 12).head).toEqual(sampleTrack(withoutRefusal, 12).head)
  })

  it('shares one cooldown across shake, drop, and shake-or-drop', () => {
    const gestures = new NaturalGestures(createRandomStream(3))
    expect(gestures.trigger('shake-or-drop', 0.9, 'strong', 0)).toBe(true)
    expect(gestures.trigger('shake', 0.9, 'strong', 3)).toBe(false)
    expect(gestures.trigger('drop', 0.9, 'strong', 5)).toBe(true)
  })

  it('plays both shake and drop for shake-or-drop across seeds', () => {
    const axes = new Set<number>()
    for (let seed = 1; seed <= 20; seed++) {
      const gestures = new NaturalGestures(createRandomStream(seed))
      gestures.trigger('shake-or-drop', 0.9, 'strong', 0)
      const { head } = sampleTrack(gestures, 3)
      axes.add(Math.max(...head.map(offset => Math.abs(offset[0]))) > 0.01 ? 0 : 1)
    }
    expect([...axes].sort()).toEqual([0, 1])
  })

  it('returns to exactly zero after the clip ends, stays within 0.12, and moves continuously', () => {
    for (const kind of kinds) {
      for (const band of ['clear', 'strong'] as const) {
        for (let seed = 1; seed <= 10; seed++) {
          const gestures = new NaturalGestures(createRandomStream(seed))
          expect(gestures.trigger(kind, 1, band, 0)).toBe(true)
          const end = gestures.activeUntil()
          const { head, body } = sampleTrack(gestures, end + 1)
          expect(peak(head)).toBeLessThanOrEqual(0.12)
          expect(peak(head)).toBeGreaterThan(0.01)
          for (let i = 1; i < head.length; i++)
            expect(Math.max(...head[i].map((value, axis) => Math.abs(value - head[i - 1][axis])))).toBeLessThan(0.02)
          const endIndex = Math.ceil(end / step)
          for (const offset of [...head.slice(endIndex), ...body.slice(endIndex)])
            expect(offset).toEqual([0, 0, 0])
        }
      }
    }
  })

  it('never triggers in the slight band or without positive finite strength', () => {
    const gestures = new NaturalGestures(createRandomStream(41))
    expect(gestures.trigger('laugh', 0.9, 'slight', 0)).toBe(false)
    expect(gestures.trigger('laugh', 0, 'strong', 0)).toBe(false)
    expect(gestures.trigger('laugh', -1, 'strong', 0)).toBe(false)
    expect(gestures.trigger('laugh', Number.NaN, 'strong', 0)).toBe(false)
    expect(gestures.trigger('laugh', Number.POSITIVE_INFINITY, 'strong', 0)).toBe(false)
    expect(gestures.trigger('laugh', 0.9, 'strong', Number.NaN)).toBe(false)
    expect(peak(sampleTrack(gestures, 2).head)).toBe(0)
    expect(gestures.activeUntil()).toBe(0)
    // A refused trigger does not start a cooldown.
    expect(gestures.trigger('laugh', 0.9, 'strong', 0)).toBe(true)
  })

  it('moves the body only in the strong band, on yaw and roll at half the head amplitude', () => {
    for (const kind of kinds) {
      const clear = new NaturalGestures(createRandomStream(7))
      clear.trigger(kind, 1, 'clear', 0)
      expect(peak(sampleTrack(clear, 8).body)).toBe(0)
    }
    for (const kind of ['shake', 'sway', 'look-away', 'tilt-in'] as const) {
      const strong = new NaturalGestures(createRandomStream(7))
      strong.trigger(kind, 1, 'strong', 0)
      const { head, body } = sampleTrack(strong, 8)
      expect(peak(body)).toBeGreaterThan(0)
      body.forEach((offset, i) => {
        expect(offset[1]).toBe(0)
        expect(offset[0]).toBeCloseTo(0.5 * head[i][0], 12)
        expect(offset[2]).toBeCloseTo(0.5 * head[i][2], 12)
      })
    }
  })

  it('scales clear below strong', () => {
    const clear = new NaturalGestures(createRandomStream(9))
    const strong = new NaturalGestures(createRandomStream(9))
    clear.trigger('recoil', 1, 'clear', 0)
    strong.trigger('recoil', 1, 'strong', 0)
    expect(peak(sampleTrack(clear, 2).head)).toBeCloseTo(0.6 * peak(sampleTrack(strong, 2).head), 12)
  })

  it.each([
    ['laugh', 4],
    ['recoil', 3],
    ['shake', 5],
    ['drop', 5],
    ['shake-or-drop', 5],
    ['sway', 4],
    ['tilt-in', 5],
    ['look-away', 4],
    ['nod-off', 8],
  ] satisfies [GestureKind, number][])('enforces the %s cooldown of %s seconds', (kind, seconds) => {
    const gestures = new NaturalGestures(createRandomStream(41))
    gestures.trigger(kind, 1, 'strong', 0)
    expect(gestures.trigger(kind, 1, 'strong', seconds - 0.001)).toBe(false)
    expect(gestures.trigger(kind, 1, 'strong', seconds)).toBe(true)
  })

  it('draws laugh cycles, frequency, and amplitude after the side and plays the closed-form chuckle', () => {
    const draws = [0.1, 0.9, 0.5, 0.5]
    let next = 0
    const gestures = new NaturalGestures(() => draws[next++])
    gestures.trigger('laugh', 1, 'strong', 0)
    expect(next).toBe(4)
    // Side -1, 3 cycles, 2.9 Hz, amplitude 0.06.
    const frequency = 2.9
    const bounceEnd = 0.15 + 3 / frequency
    for (const age of [0.05, 0.1, 0.15, 0.3, 0.42, 0.77, 1.0, bounceEnd - 0.05, bounceEnd + 0.1, bounceEnd + 0.3]) {
      const lift = age < bounceEnd ? minJerk(age / 0.15) : 1 - minJerk((age - bounceEnd) / 0.35)
      const bounce = age <= 0.15 || age >= bounceEnd ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * frequency * (age - 0.15))
      const head = gestures.headOffset(age)
      expect(head[0]).toBe(0)
      expect(Math.abs(head[1] - 0.06 * (lift - 0.8 * bounce))).toBeLessThan(1e-12)
      expect(Math.abs(head[2] - -1 * 0.5 * 0.06 * lift)).toBeLessThan(1e-12)
    }
  })

  it('bounces the laugh pitch upward only: one strict minimum per drawn cycle, never below rest', () => {
    for (const band of ['clear', 'strong'] as const) {
      const scale = band === 'clear' ? 0.6 : 1
      for (let seed = 1; seed <= 40; seed++) {
        const draw = createRandomStream(seed)
        draw()
        const cycles = 2 + Math.floor(draw() * 2)
        const frequency = 2.6 + 0.6 * draw()
        const bounceEnd = 0.15 + cycles / frequency
        const gestures = new NaturalGestures(createRandomStream(seed))
        expect(gestures.trigger('laugh', 1, band, 0)).toBe(true)
        const lifetime = gestures.activeUntil()
        expect(lifetime).toBeCloseTo(bounceEnd + 0.35, 12)
        const { head } = sampleTrack(gestures, lifetime + 0.5)
        const pitch = head.map(offset => offset[1])
        expect(Math.min(...pitch)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...pitch)).toBeGreaterThanOrEqual(0.05 * scale)
        expect(peak(head)).toBeLessThanOrEqual(0.12)
        for (let i = 1; i < head.length; i++)
          expect(Math.max(...head[i].map((value, axis) => Math.abs(value - head[i - 1][axis])))).toBeLessThanOrEqual(0.02)
        // No zero crossing: pitch stays above rest from the first frame until the settle.
        for (let i = 1; i * step < lifetime - 0.01; i++)
          expect(pitch[i]).toBeGreaterThan(0)
        let minima = 0
        for (let i = 1; i < pitch.length - 1; i++) {
          if (i * step > 0.15 && i * step < bounceEnd && pitch[i] < pitch[i - 1] && pitch[i] < pitch[i + 1])
            minima++
        }
        expect(minima).toBe(cycles)
      }
    }
  })

  it('keeps the laugh lifetime inside its documented bound', () => {
    expect(gestureLifetimes.laugh).toBe(0.15 + 3 / 2.6 + 0.35)
    for (let seed = 1; seed <= 40; seed++) {
      const gestures = new NaturalGestures(createRandomStream(seed))
      gestures.trigger('laugh', 1, 'strong', 0)
      expect(gestures.activeUntil()).toBeGreaterThanOrEqual(0.15 + 2 / 3.2 + 0.35)
      expect(gestures.activeUntil()).toBeLessThanOrEqual(gestureLifetimes.laugh)
    }
  })

  it('rolls the strong laugh body at half the head roll and never pitches it', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const strong = new NaturalGestures(createRandomStream(seed))
      strong.trigger('laugh', 1, 'strong', 0)
      const { head, body } = sampleTrack(strong, 2)
      expect(Math.max(...body.map(offset => Math.abs(offset[2])))).toBeGreaterThan(0)
      body.forEach((offset, i) => {
        expect(offset[0]).toBe(0)
        expect(offset[1]).toBe(0)
        expect(offset[2]).toBeCloseTo(0.5 * head[i][2], 12)
      })
    }
  })

  it('pulses the laugh face with the head in both bands: a smile that follows the lift and one mouth opening per cycle', () => {
    const draws = [0.1, 0.9, 0.5, 0.5]
    let next = 0
    const closed = new NaturalGestures(() => draws[next++])
    closed.trigger('laugh', 1, 'strong', 0)
    const bounceEnd = 0.15 + 3 / 2.9
    for (const age of [0.05, 0.3, 0.6, bounceEnd - 0.05, bounceEnd + 0.1]) {
      const lift = age < bounceEnd ? minJerk(age / 0.15) : 1 - minJerk((age - bounceEnd) / 0.35)
      const bounce = age <= 0.15 || age >= bounceEnd ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * 2.9 * (age - 0.15))
      const face = closed.faceOffset(age)
      expect(Math.abs(face.eyeSmile - 0.35 * lift)).toBeLessThan(1e-12)
      expect(Math.abs(face.mouthOpen - 0.12 * bounce)).toBeLessThan(1e-12)
    }
    for (const band of ['clear', 'strong'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const draw = createRandomStream(seed)
        draw()
        const cycles = 2 + Math.floor(draw() * 2)
        const gestures = new NaturalGestures(createRandomStream(seed))
        gestures.trigger('laugh', 1, band, 0)
        const lifetime = gestures.activeUntil()
        const mouth = Array.from({ length: Math.ceil((lifetime + 0.5) / step) }, (_, i) => gestures.faceOffset(i * step).mouthOpen)
        let peaks = 0
        for (let i = 1; i < mouth.length - 1; i++) {
          if (mouth[i] > mouth[i - 1] && mouth[i] > mouth[i + 1])
            peaks++
        }
        expect(peaks).toBe(cycles)
        for (const time of [lifetime, lifetime + step, lifetime + 3])
          expect(gestures.faceOffset(time)).toEqual({ eyeSmile: 0, mouthOpen: 0 })
      }
    }
  })

  it('gives no face term before a laugh, after a refused one, or for any other clip', () => {
    const idle = new NaturalGestures(createRandomStream(7))
    expect(idle.faceOffset(0)).toEqual({ eyeSmile: 0, mouthOpen: 0 })
    expect(idle.trigger('laugh', 1, 'slight', 0)).toBe(false)
    expect(idle.faceOffset(0.5)).toEqual({ eyeSmile: 0, mouthOpen: 0 })
    for (const kind of kinds.filter(kind => kind !== 'laugh')) {
      const gestures = new NaturalGestures(createRandomStream(7))
      gestures.trigger(kind, 1, 'strong', 0)
      for (let i = 0; i < 120; i++)
        expect(gestures.faceOffset(i * step)).toEqual({ eyeSmile: 0, mouthOpen: 0 })
    }
  })

  it('uses side before angry choice, and keeps explicit shake and drop meaningful', () => {
    for (const choice of [0.1, 0.9]) {
      const draws = [0.1, choice, 0.9]
      let next = 0
      const angry = new NaturalGestures(() => draws[next++])
      const explicitDraws = [0.1, 0.9]
      let explicitNext = 0
      const explicit = new NaturalGestures(() => explicitDraws[explicitNext++])
      angry.trigger('shake-or-drop', 1, 'strong', 0)
      explicit.trigger(choice < 0.5 ? 'shake' : 'drop', 1, 'strong', 0)
      expect(sampleTrack(angry, 3)).toEqual(sampleTrack(explicit, 3))
    }
  })

  it('recoils to positive pitch, overshoots to negative pitch, and settles in 0.6 seconds', () => {
    const gestures = new NaturalGestures(createRandomStream(41))
    gestures.trigger('recoil', 1, 'strong', 0)
    expect(gestures.headOffset(0.12)[1]).toBeCloseTo(0.1, 12)
    expect(gestures.headOffset(0.6)[1]).toBeLessThan(0)
    expect(gestures.headOffset(0.72)).toEqual([0, 0, 0])
  })

  it('nods down over 1.2 seconds, then catches back by 0.04', () => {
    const gestures = new NaturalGestures(createRandomStream(41))
    gestures.trigger('nod-off', 1, 'strong', 0)
    expect(gestures.headOffset(1.2)[1]).toBeCloseTo(-0.08, 12)
    expect(gestures.headOffset(1.5)[1]).toBeCloseTo(0.04, 12)
  })

  it('adds overlapping kinds and keeps head and body retirement independent', () => {
    const combined = new NaturalGestures(() => 0.25)
    const tilt = new NaturalGestures(() => 0.25)
    const sway = new NaturalGestures(() => 0.25)
    combined.trigger('tilt-in', 1, 'strong', 0)
    combined.trigger('sway', 1, 'strong', 0)
    tilt.trigger('tilt-in', 1, 'strong', 0)
    sway.trigger('sway', 1, 'strong', 0)
    const a = tilt.headOffset(0.5)
    const b = sway.headOffset(0.5)
    combined.headOffset(0.5).forEach((value, axis) => expect(value).toBeCloseTo(a[axis] + b[axis], 12))
    const bodyFirst = combined.bodyOffset(0.5)
    expect(bodyFirst).toEqual(combined.bodyOffset(0.5))
    combined.headOffset(8)
    expect(combined.bodyOffset(8)).toEqual([0, 0, 0])
    expect(combined.activeUntil()).toBe(0)
  })

  it('does not draw or move on the idle path', () => {
    const random = createRandomStream(41)
    const untouched = createRandomStream(41)
    const gestures = new NaturalGestures(random)
    expect(peak(sampleTrack(gestures, 60).head)).toBe(0)
    expect(peak(sampleTrack(gestures, 60).body)).toBe(0)
    expect(random()).toBe(untouched())
  })
})

describe('gesture duck', () => {
  const duckStep = 1 / 120
  const scaleTrack = (gestures: NaturalGestures, seconds: number) => Array.from({ length: Math.round(seconds / duckStep) + 1 }, (_, i) => gestures.continuousScale(i * duckStep))

  it('is exactly 1 before any trigger, after refused triggers, and from activeUntil() + 0.3 on', () => {
    const idle = new NaturalGestures(createRandomStream(7))
    expect(scaleTrack(idle, 3).every(value => value === 1)).toBe(true)

    const slight = new NaturalGestures(createRandomStream(7))
    expect(slight.trigger('sway', 1, 'slight', 0)).toBe(false)
    expect(scaleTrack(slight, 3).every(value => value === 1)).toBe(true)

    const refused = new NaturalGestures(createRandomStream(7))
    const twin = new NaturalGestures(createRandomStream(7))
    refused.trigger('sway', 1, 'strong', 0)
    twin.trigger('sway', 1, 'strong', 0)
    expect(refused.trigger('sway', 1, 'strong', 1)).toBe(false)
    expect(scaleTrack(refused, 6)).toEqual(scaleTrack(twin, 6))

    for (const kind of kinds) {
      const gestures = new NaturalGestures(createRandomStream(9))
      expect(gestures.trigger(kind, 1, 'strong', 2)).toBe(true)
      const from = gestures.activeUntil() + 0.3
      for (let t = from; t < from + 2; t += duckStep)
        expect(gestures.continuousScale(t)).toBe(1)
    }
  })

  it('holds 1 - 0.45 for a strong strength-1 clip and 1 - 0.27 for a clear one between attack end and clip end', () => {
    for (const [band, depth] of [['strong', 0.45], ['clear', 0.27]] as const) {
      const gestures = new NaturalGestures(createRandomStream(11))
      expect(gestures.trigger('sway', 1, band, 0)).toBe(true)
      for (let t = 0.15; t <= 1.4; t += duckStep)
        expect(gestures.continuousScale(t)).toBeCloseTo(1 - depth, 12)
      expect(gestures.continuousScale(0)).toBe(1)
    }
  })

  it('changes by at most the min-jerk slope bound per 1/120 s step', () => {
    const bound = 0.45 * 1.875 / (0.15 * 120) + 1e-12
    for (const kind of kinds) {
      const gestures = new NaturalGestures(createRandomStream(13))
      gestures.trigger(kind, 1, 'strong', 0)
      const track = scaleTrack(gestures, 12)
      for (let i = 1; i < track.length; i++)
        expect(Math.abs(track[i] - track[i - 1])).toBeLessThanOrEqual(bound)
    }
  })

  it('takes the deepest of overlapping windows, not their sum', () => {
    const gestures = new NaturalGestures(createRandomStream(17))
    expect(gestures.trigger('sway', 1, 'strong', 0)).toBe(true)
    expect(gestures.trigger('tilt-in', 1, 'strong', 0.1)).toBe(true)
    expect(gestures.continuousScale(0.5)).toBeCloseTo(1 - 0.45, 12)
  })

  it('draws a fixed number of random values per trigger, whatever the duck state', () => {
    for (const [kind, draws] of [['sway', 1], ['recoil', 1], ['laugh', 4], ['tilt-in', 1]] as const) {
      let count = 0
      const stream = createRandomStream(21)
      const gestures = new NaturalGestures(() => {
        count++
        return stream()
      })
      gestures.trigger(kind, 1, 'strong', 0)
      gestures.continuousScale(0.5)
      expect(count).toBe(draws)
    }
  })

  it('ends every clip window after its peak, once its head offset stays under 10% of the peak', () => {
    const played = ['laugh', 'recoil', 'shake', 'drop', 'sway', 'tilt-in', 'look-away', 'nod-off'] as const
    for (const kind of played) {
      for (let seed = 1; seed <= 40; seed++) {
        const gestures = new NaturalGestures(createRandomStream(seed))
        expect(gestures.trigger(kind, 0.8, 'strong', 0)).toBe(true)
        // Sample once, in time order: both getters retire expired clips as time advances.
        const samples = Math.floor(gestureLifetimes[kind] * 120)
        const norms = Array.from({ length: samples + 1 }, (_, i) => Math.hypot(...gestures.headOffset(i * duckStep)))
        const scales = Array.from({ length: samples + 120 }, (_, i) => gestures.continuousScale(i * duckStep))
        const peakNorm = Math.max(...norms)
        const peakAge = norms.indexOf(peakNorm) * duckStep
        // The duck holds its depth until the active span ends: the last grid time within float noise of the deepest scale.
        const deepest = Math.min(...scales)
        let last = Math.round(0.15 / duckStep)
        while (scales[last + 1] <= deepest + 1e-9)
          last++
        const activeSpan = last * duckStep
        expect(activeSpan).toBeGreaterThan(peakAge)
        expect(activeSpan).toBeLessThanOrEqual(2 + duckStep)
        // Only the 2 s cap may leave more than 10% of the peak: nod-off's catch-up tail outlasts it.
        if (activeSpan < 2 - duckStep)
          expect(norms[last]).toBeLessThanOrEqual(0.1 * peakNorm)
        else
          expect(kind).toBe('nod-off')
      }
    }
  })
})
