import type { CursorAttentionEvent, CursorAttentionInput, CursorAttentionResult } from './cursor-attention'
import type { RandomStream } from './random'

import { describe, expect, it } from 'vitest'

import { cursorGaze, mapCursor, NaturalCursorAttention } from './cursor-attention'
import { drawCursorEpisode } from './cursor-notice'
import { createRandomStream } from './random'

const dt = 1 / 120

function counting(seed: number) {
  const random = createRandomStream(seed)
  let draws = 0
  return {
    random: () => {
      draws++
      return random()
    },
    get draws() { return draws },
  }
}

/**
 * Cursor attention whose reports a fake mind answers with `drawCursorEpisode` on `random`. Each order arrives after
 * the step that reported, so the episode starts one step later, as it does in the app.
 */
function answered(random: RandomStream) {
  const attention = new NaturalCursorAttention()
  return {
    attention,
    step(stepDt: number, at: number, input: CursorAttentionInput): CursorAttentionResult {
      const result = attention.step(stepDt, at, input)
      for (const report of result.reports)
        attention.order({ requestId: report.requestId, episode: drawCursorEpisode(report.band, random) })
      return result
    },
  }
}

type Answered = ReturnType<typeof answered>

/** Moving on a circle keeps the episode in one distance band. */
function moving(at: number, distance = 1): CursorAttentionInput {
  return { cursor: { x: distance * Math.cos(at * 2), y: distance * Math.sin(at * 2) }, permission: 'full' }
}

function sample(attention: Answered, from: number, to: number, input: (at: number) => CursorAttentionInput) {
  const results: CursorAttentionResult[] = []
  for (let i = Math.round(from / dt); i < Math.round(to / dt); i++)
    results.push(attention.step(dt, i * dt, input(i * dt)))
  return results
}

function events(results: CursorAttentionResult[]) {
  return results.flatMap(result => result.events)
}

describe('cursor mapping', () => {
  it('(a) preserves radial direction and increases eye magnitude smoothly', () => {
    for (const angle of [-2.5, -1, 0, 0.7, 2.6]) {
      let previous = 0
      for (const radius of [0.01, 0.1, 0.5, 1, 3, 10, 50]) {
        const mapped = mapCursor({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
        expect(Math.abs(Math.atan2(mapped.eye.y, mapped.eye.x) - angle)).toBeLessThan(1e-12)
        const magnitude = Math.hypot(mapped.eye.x, mapped.eye.y)
        expect(magnitude).toBeGreaterThan(previous)
        expect(magnitude).toBeLessThan(cursorGaze)
        previous = magnitude
      }
    }
    expect(mapCursor({ x: 0.5, y: 0 }).eye.x / cursorGaze).toBeCloseTo(0.38, 2)
    expect(mapCursor({ x: 3, y: 0 }).eye.x / cursorGaze).toBeCloseTo(0.93, 2)
    expect(mapCursor({ x: 0, y: 0 })).toEqual({ distance: 0, gain: 1, eye: { x: 0, y: 0 }, head: { x: 0, y: 0 } })
    expect(mapCursor({ x: 500, y: -500 })).toEqual(mapCursor({ x: 100, y: -100 }))
  })

  it('(a2) reduces head pull at distance without reducing the eye target', () => {
    const head = (radius: number) => {
      const { head } = mapCursor({ x: radius * 0.6, y: radius * 0.8 })
      return Math.hypot(head.x, head.y)
    }
    expect(head(3)).toBeGreaterThan(head(9))
    expect(mapCursor({ x: 1.5, y: 0 }).gain).toBeCloseTo(1, 9)
    expect(mapCursor({ x: 20, y: 0 }).gain).toBeCloseTo(0.35, 9)
    let previous = 1
    for (let radius = 2; radius <= 20; radius += 0.1) {
      const { gain } = mapCursor({ x: radius, y: 0 })
      expect(gain).toBeLessThanOrEqual(previous)
      previous = gain
    }
  })
})

describe('natural cursor attention', () => {
  it('(b) always notices a near moving cursor before engaging', () => {
    const attention = answered(createRandomStream(4))
    const path = sample(attention, 0, 1, moving)
    const emitted = events(path)
    expect(emitted.map(event => event.kind)).toEqual(['notice', 'engage'])
    expect(emitted[1].at - emitted[0].at).toBeGreaterThanOrEqual(0.25)
    expect(emitted[1].at - emitted[0].at).toBeLessThanOrEqual(0.5)
    // The first step reports; the mind's order starts the episode at the next.
    expect(path[0].reports).toEqual([{ requestId: 1, band: 'near', opportunity: 'appeared' }])
    expect(path[0].phase).toBe('idle')
    expect(path[1].phase).toBe('notice')
    expect(path[1].oriented).toBe(true)
    expect(path.at(-1)?.phase).toBe('full')
  })

  it('(c) independently engages medium and far episodes within seeded probability bands', () => {
    for (const [distance, min, max] of [[4, 0.45, 0.65], [9, 0.12, 0.28]]) {
      let engaged = 0
      for (let seed = 0; seed < 400; seed++) {
        const attention = answered(createRandomStream(seed))
        const emitted = events(sample(attention, 0, 0.7, at => moving(at, distance)))
        if (emitted.some(event => event.kind === 'engage'))
          engaged++
      }
      expect(engaged / 400).toBeGreaterThanOrEqual(min)
      expect(engaged / 400).toBeLessThanOrEqual(max)
    }
  })

  it('(r1) gives a continuously moving ignored cursor another opportunity after its cooldown', () => {
    let draws = 0
    const attention = answered(() => ++draws === 1 ? 0.9 : 0.1)
    const emitted = events(sample(attention, 0, 60, at => moving(at, 4)))
    const firstNotice = emitted.find(event => event.kind === 'notice')
    // The first draw ignores; the subsequent interest, dwell, and cooldown draws
    // make the ignored episode's cooldown 4 + 0.1 * 6 = 4.6 seconds. It starts when the order applies, one step in,
    // and the next episode's order applies one step after its report.
    expect(firstNotice).toBeDefined()
    expect(firstNotice?.at).toBeGreaterThanOrEqual(4.6 + 2 * dt - 1e-9)
    expect(firstNotice?.at).toBeLessThanOrEqual(4.6 + 3 * dt)
    expect(emitted[0].kind).toBe('notice')
    expect(emitted[1].kind).toBe('engage')
    expect(draws).toBeGreaterThan(5)
  })

  it('(r2) makes no additional draws in an ignored cooldown, or while the cursor is null afterwards', () => {
    let draws = 0
    const attention = answered(() => ++draws === 1 ? 0.9 : 0.1)
    attention.step(dt, 0, moving(0, 4))
    expect(attention.step(dt, dt, moving(dt, 4)).phase).toBe('ignored')
    // One engagement uniform, two Box-Muller uniforms for interest, one dwell
    // uniform, and one cooldown uniform are drawn once for the report.
    expect(draws).toBe(5)
    const path = sample(attention, 2 * dt, 4.6 + dt, at => moving(at, 4))
    expect(events(path)).toEqual([])
    expect(path.every(result => result.phase === 'ignored' && !result.oriented && result.weight === 0 && result.reports.length === 0)).toBe(true)
    expect(draws).toBe(5)
    const absent = sample(attention, 4.6 + dt, 10, () => ({ cursor: null, permission: 'full' }))
    expect(events(absent)).toEqual([])
    expect(draws).toBe(5)
    expect(attention.step(dt, 10, moving(10, 4)).reports.map(report => report.opportunity)).toEqual(['appeared'])
    expect(draws).toBe(10)
    expect(attention.step(dt, 10 + dt, moving(10 + dt, 4)).events.map(event => event.kind)).toEqual(['notice'])
  })

  it('(d) holds a settled cursor briefly, then releases smoothly before the screen timeout', () => {
    const attention = answered(createRandomStream(7))
    sample(attention, 0, 3, moving)
    const cursor = moving(3).cursor
    const path = sample(attention, 3, 6 + dt, () => ({ cursor, permission: 'full' }))
    expect(Math.min(...path.slice(0, Math.round(0.6 / dt)).map(result => result.weight))).toBeGreaterThan(0.9)
    expect(path[Math.round(2.4 / dt)].weight).toBeLessThan(0.3)
    expect(path[Math.round(3 / dt)].weight).toBeLessThan(0.15)
    const emitted = events(path)
    expect(emitted.map(event => event.kind)).toEqual(['release'])
    expect(emitted[0].at - 3).toBeLessThanOrEqual(2.4)
    expect(path.at(-1)?.oriented).toBe(false)
  })

  it('(e) dismisses once and rapidly loses attention', () => {
    const attention = answered(createRandomStream(7))
    sample(attention, 0, 2, moving)
    const path = sample(attention, 2, 2.4 + dt, at => ({ ...moving(at), permission: 'dismiss' }))
    expect(events(path).map(event => event.kind)).toEqual(['dismiss'])
    expect(path.at(-1)?.weight).toBeLessThan(0.05)
    expect(path.every(result => result.phase === 'idle' && !result.oriented)).toBe(true)
  })

  it('(f) draws nothing during each 60 s null-cursor path, including release', () => {
    for (const mode of ['full', 'dismiss', 'after-engagement'] as const) {
      const stream = counting(12)
      const attention = answered(stream.random)
      const from = mode === 'after-engagement' ? 2 : 0
      if (mode === 'after-engagement')
        sample(attention, 0, from, moving)
      const before = stream.draws
      const path = sample(attention, from, from + 60, () => ({ cursor: null, permission: mode === 'dismiss' ? 'dismiss' : 'full' }))
      expect(stream.draws - before, mode).toBe(0)
      expect(path.at(-1)?.weight).toBe(0)
      expect(path.at(-1)?.oriented).toBe(false)
      expect(events(path).map(event => event.kind)).toEqual(mode === 'after-engagement' ? ['release'] : [])
    }
  })

  it('(f2) silently dismisses idle, ignored, and already-released episodes without drawing', () => {
    const stream = counting(12)
    const idle = answered(stream.random)
    expect(idle.step(dt, 0, { cursor: null, permission: 'dismiss' }).events).toEqual([])
    expect(stream.draws).toBe(0)

    let draws = 0
    const ignoring: RandomStream = () => {
      draws++
      return 0.9
    }
    const ignored = answered(ignoring)
    ignored.step(dt, 0, moving(0, 9))
    expect(ignored.step(dt, dt, moving(dt, 9)).phase).toBe('ignored')
    const beforeIgnored = draws
    expect(ignored.step(dt, 2 * dt, { ...moving(2 * dt, 9), permission: 'dismiss' }).events).toEqual([])
    expect(draws).toBe(beforeIgnored)

    const released = answered(stream.random)
    sample(released, 0, 2, moving)
    const cursor = moving(2).cursor
    const rested = sample(released, 2, 5, () => ({ cursor, permission: 'full' }))
    expect(events(rested).map(event => event.kind)).toEqual(['release'])
    const beforeReleased = stream.draws
    expect(released.step(dt, 5, { cursor, permission: 'dismiss' }).events).toEqual([])
    expect(stream.draws).toBe(beforeReleased)
  })

  it('(f4) dismisses an oriented notice even below the release weight', () => {
    const attention = answered(createRandomStream(7))
    const path = sample(attention, 0, 0.2, moving)
    expect(events(path).map(event => event.kind)).toEqual(['notice'])
    expect(path.at(-1)?.weight).toBeLessThan(0.3)
    const result = attention.step(dt, 0.2, { ...moving(0.2), permission: 'dismiss' })
    expect(result.events.map(event => event.kind)).toEqual(['dismiss'])
    expect(result.phase).toBe('idle')
    expect(result.oriented).toBe(false)
    expect(attention.step(dt, 0.2 + dt, { ...moving(0.2 + dt), permission: 'dismiss' }).events).toEqual([])
  })

  it('(f3) reopens after two dismissed seconds while moving, without rerolling', () => {
    const stream = counting(5)
    const attention = answered(stream.random)
    sample(attention, 0, 1, moving)
    const draws = stream.draws
    sample(attention, 1, 3, at => ({ ...moving(at), permission: 'dismiss' }))
    const emitted = events(sample(attention, 3, 3.6, moving))
    expect(emitted.map(event => event.kind)).toEqual(['notice', 'engage'])
    expect(emitted[1].at).toBeLessThanOrEqual(3.6)
    expect(stream.draws).toBe(draws)
  })

  it.each(['dismiss', 'fade'] as const)('starts a deferred episode only when %s reopens with a moving cursor', (permission) => {
    const stream = counting(9)
    const attention = answered(stream.random)
    expect(events(sample(attention, 0, 2, at => ({ ...moving(at), permission })))).toEqual([])
    expect(stream.draws).toBe(0)
    expect(events(sample(attention, 2, 2.6, moving)).map(event => event.kind)).toEqual(['notice', 'engage'])
    expect(stream.draws).toBeGreaterThan(0)
  })

  it('reuses an ignored engagement decision when permission reopens', () => {
    let draws = 0
    const attention = answered(() => {
      draws++
      return 0.9
    })
    const ignored = sample(attention, 0, 1, at => moving(at, 9))
    expect(ignored.at(-1)?.phase).toBe('ignored')
    const before = draws
    sample(attention, 1, 2, at => ({ ...moving(at, 9), permission: 'dismiss' }))
    const reopened = sample(attention, 2, 3, at => moving(at, 9))
    expect(events(reopened)).toEqual([])
    expect(reopened.at(-1)?.phase).toBe('ignored')
    expect(draws).toBe(before)
  })

  it('lets a nearer band bypass cooldown and notices a previously ignored cursor', () => {
    const attention = answered(() => 0.9)
    attention.step(dt, 0, moving(0, 9))
    expect(attention.step(dt, dt, moving(dt, 9)).phase).toBe('ignored')
    expect(attention.step(dt, 2 * dt, moving(2 * dt)).reports.map(report => report.opportunity)).toEqual(['nearer'])
    const near = attention.step(dt, 3 * dt, moving(3 * dt))
    expect(near.events.map(event => event.kind)).toEqual(['notice'])
    expect(near.oriented).toBe(true)
    sample(attention, 4 * dt, 1, moving)
    expect(events(sample(attention, 1, 2, () => ({ cursor: null, permission: 'full' }))).map(event => event.kind)).toEqual(['release'])
    expect(events(sample(attention, 2, 3, moving))).toEqual([])
    expect(events(sample(attention, 3, 13, moving)).some(event => event.kind === 'notice')).toBe(true)
  })

  it('starts a new episode when an ignored cursor moves again after resting and cooldown', () => {
    const stream = counting(1)
    const attention = answered(stream.random)
    attention.step(dt, 0, moving(0, 9))
    const before = stream.draws
    sample(attention, dt, 1, () => moving(0, 9))
    attention.step(dt, 1, moving(1, 9))
    expect(stream.draws).toBe(before)
    sample(attention, 1 + dt, 11, () => moving(1, 9))
    attention.step(dt, 11, moving(11, 9))
    expect(stream.draws).toBeGreaterThan(before)
  })

  it('expires medium interest while moving and observes its pre-drawn cooldown', () => {
    const attention = answered(() => 0.1)
    const emitted = events(sample(attention, 0, 12, at => moving(at, 4)))
    const releases = emitted.filter(event => event.kind === 'release')
    const notices = emitted.filter(event => event.kind === 'notice')
    expect(releases.length).toBeGreaterThan(0)
    expect(notices.length).toBeGreaterThan(1)
    expect(notices[1].at - releases[0].at).toBeGreaterThanOrEqual(4)
    expect(notices[1].at - releases[0].at).toBeLessThanOrEqual(10 + dt)
  })

  it('(g) replays identical complete results for the same seed and inputs', () => {
    function replay(seed: number) {
      const attention = answered(createRandomStream(seed))
      return sample(attention, 0, 30, (at) => {
        if (at < 4)
          return moving(at, 9)
        if (at < 7)
          return moving(at, 4)
        if (at < 12)
          return moving(at)
        if (at < 16)
          return { ...moving(at), permission: 'dismiss' }
        if (at < 20)
          return moving(at)
        if (at < 24)
          return moving(20)
        return { cursor: null, permission: 'full' }
      })
    }
    const first = replay(25)
    expect(replay(25)).toEqual(first)
    expect(replay(26)).not.toEqual(first)
    const emitted: CursorAttentionEvent[] = events(first)
    expect(emitted.some(event => event.kind === 'notice')).toBe(true)
    expect(emitted.some(event => event.kind === 'engage')).toBe(true)
    expect(emitted.some(event => event.kind === 'release')).toBe(true)
    expect(emitted.some(event => event.kind === 'dismiss')).toBe(true)
  })
})

describe('cursor reports and orders', () => {
  const engaged = { band: 'near', engaging: true, span: Number.POSITIVE_INFINITY, dwell: 0.3, cooldown: 5 } as const
  const ignored = { band: 'medium', engaging: false, span: 2, dwell: 0.3, cooldown: 5 } as const

  it('reports an opportunity, starts nothing, and reports no other while it awaits the order', () => {
    const attention = new NaturalCursorAttention()
    const first = attention.step(dt, 0, moving(0))
    expect(first.reports).toEqual([{ requestId: 1, band: 'near', opportunity: 'appeared' }])
    expect(first.events).toEqual([])
    expect(first.weight).toBe(0)
    const waiting = []
    for (let i = 1; i < 120; i++)
      waiting.push(attention.step(dt, i * dt, moving(i * dt, i < 60 ? 1 : 0.5)))
    expect(waiting.every(result => result.reports.length === 0 && result.events.length === 0 && result.phase === 'idle' && result.weight === 0)).toBe(true)
  })

  it('notices on a matching order and engages after its dwell', () => {
    const attention = new NaturalCursorAttention()
    const { requestId } = attention.step(dt, 0, moving(0)).reports[0]
    attention.order({ requestId, episode: engaged })
    const path = [attention.step(dt, dt, moving(dt))]
    for (let i = 2; i < 120; i++)
      path.push(attention.step(dt, i * dt, moving(i * dt)))
    const emitted = events(path)
    expect(emitted.map(event => event.kind)).toEqual(['notice', 'engage'])
    expect(emitted[0].at).toBe(dt)
    expect(emitted[1].at - emitted[0].at).toBeGreaterThanOrEqual(0.3 - 1e-9)
    expect(emitted[1].at - emitted[0].at).toBeLessThanOrEqual(0.3 + dt)
  })

  it('starts the cooldown of an ignored episode when the order applies', () => {
    const attention = new NaturalCursorAttention()
    const { requestId } = attention.step(dt, 0, moving(0, 4)).reports[0]
    for (let i = 1; i < Math.round(0.5 / dt); i++)
      attention.step(dt, i * dt, moving(i * dt, 4))
    attention.order({ requestId, episode: ignored })
    expect(attention.step(dt, 0.5, moving(0.5, 4)).phase).toBe('ignored')
    let next = null
    for (let i = Math.round(0.5 / dt) + 1; next === null; i++) {
      const result = attention.step(dt, i * dt, moving(i * dt, 4))
      if (result.reports.length > 0)
        next = i * dt
    }
    expect(next).toBeGreaterThanOrEqual(5.5 - 1e-9)
    expect(next).toBeLessThanOrEqual(5.5 + dt)
  })

  it.each([
    ['a wrong id', (attention: NaturalCursorAttention, requestId: number) => {
      attention.order({ requestId: requestId + 1, episode: engaged })
      return moving(dt)
    }],
    ['the cursor left', (attention: NaturalCursorAttention, requestId: number) => {
      attention.order({ requestId, episode: engaged })
      return { cursor: null, permission: 'full' } as const
    }],
    ['a dismissal', (attention: NaturalCursorAttention, requestId: number) => {
      attention.order({ requestId, episode: engaged })
      return { ...moving(dt), permission: 'dismiss' } as const
    }],
  ])('drops an order after %s', (_, send) => {
    const attention = new NaturalCursorAttention()
    const { requestId } = attention.step(dt, 0, moving(0)).reports[0]
    const result = attention.step(dt, dt, send(attention, requestId))
    expect(result.events).toEqual([])
    expect(result.phase).toBe('idle')
  })

  it('reports anew once a dropped order cleared the awaited report', () => {
    const attention = new NaturalCursorAttention()
    const { requestId } = attention.step(dt, 0, moving(0)).reports[0]
    attention.order({ requestId, episode: engaged })
    attention.step(dt, dt, { cursor: null, permission: 'full' })
    const back = attention.step(dt, 2 * dt, moving(2 * dt))
    expect(back.reports).toEqual([{ requestId: requestId + 1, band: 'near', opportunity: 'appeared' }])
    // A late order for the dropped report does nothing.
    attention.order({ requestId, episode: engaged })
    expect(attention.step(dt, 3 * dt, moving(3 * dt)).events).toEqual([])
  })

  it('reports a nearer cursor during a running episode', () => {
    const attention = new NaturalCursorAttention()
    const { requestId } = attention.step(dt, 0, moving(0, 4)).reports[0]
    attention.order({ requestId, episode: { ...ignored, engaging: true } })
    expect(attention.step(dt, dt, moving(dt, 4)).phase).toBe('notice')
    expect(attention.step(dt, 2 * dt, moving(2 * dt)).reports).toEqual([{ requestId: requestId + 1, band: 'near', opportunity: 'nearer' }])
  })
})
