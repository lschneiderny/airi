import type { DesktopActivitySnapshot, PerformanceInputs, PerformanceResolution, ResolverMemory } from '.'

import { describe, expect, it } from 'vitest'

import { initialResolverMemory, resolvePerformanceState } from '.'

const T0 = 1_700_000_000_000

/** A desktop with no activity: input long ago (but not away), nothing on screen or speakers. */
function quietDesktop(overrides: Partial<DesktopActivitySnapshot> = {}): DesktopActivitySnapshot {
  return {
    idleSeconds: 60,
    locked: false,
    suspendedAtMs: null,
    resumedAtMs: null,
    unlockedAtMs: null,
    systemAudioLevel: 0,
    screenChange: 0,
    sampledAtMs: T0,
    ...overrides,
  }
}

function inputsAt(nowMs: number, overrides: Partial<PerformanceInputs> = {}): PerformanceInputs {
  return {
    nowMs,
    speaking: false,
    userSpeaking: false,
    generating: false,
    cursorMovedAtMs: null,
    desktop: quietDesktop(),
    visible: true,
    override: null,
    ...overrides,
  }
}

/** Feeds frames in order, carrying memory between them like the stage does. */
function run(frames: PerformanceInputs[], memory: ResolverMemory = initialResolverMemory): PerformanceResolution[] {
  const results: PerformanceResolution[] = []
  for (const frame of frames) {
    const result = resolvePerformanceState(frame, memory)
    results.push(result)
    memory = result.memory
  }
  return results
}

describe('resolvePerformanceState', () => {
  it('speaking overrides listening and thinking', () => {
    const [result] = run([inputsAt(T0, { speaking: true, userSpeaking: true, generating: true, cursorMovedAtMs: T0 })])

    expect(result.state.mode).toBe('talking')
    expect(result.state.attention).toBe('camera')
  })

  it('orders listening over thinking over watching over idle', () => {
    expect(run([inputsAt(T0, { userSpeaking: true, generating: true, cursorMovedAtMs: T0 })])[0].state.mode).toBe('listening')
    expect(run([inputsAt(T0, { generating: true, cursorMovedAtMs: T0 })])[0].state.mode).toBe('thinking')
    expect(run([inputsAt(T0, { cursorMovedAtMs: T0 })])[0].state.mode).toBe('watching')
    expect(run([inputsAt(T0)])[0].state.mode).toBe('idle')
  })

  it('holds a mode for 0.3 s before switching', () => {
    const results = run([
      inputsAt(T0, { generating: true }),
      inputsAt(T0 + 100, { speaking: true }),
      inputsAt(T0 + 299, { speaking: true }),
      inputsAt(T0 + 300, { speaking: true }),
    ])

    expect(results.map(r => r.state.mode)).toEqual(['thinking', 'thinking', 'thinking', 'talking'])
  })

  it('keeps listening for 0.5 s after the user stops speaking', () => {
    const results = run([
      inputsAt(T0, { userSpeaking: true }),
      inputsAt(T0 + 1000, { userSpeaking: true }),
      inputsAt(T0 + 1400),
      inputsAt(T0 + 1899),
      inputsAt(T0 + 1900),
    ])

    expect(results.map(r => r.state.mode)).toEqual(['listening', 'listening', 'listening', 'listening', 'idle'])
  })

  it.each([50, 250])('measures the listening release from the first false sample when ticking every %i ms', (tickMs) => {
    // Speech is reported true up to the tick before 500 ms and false from 500 ms
    // on, so the release must end no earlier than 1000 ms.
    const speechEndsAtMs = 500
    const frames: PerformanceInputs[] = []
    for (let t = 0; t <= 2000; t += tickMs)
      frames.push(inputsAt(T0 + t, { userSpeaking: t < speechEndsAtMs }))

    const results = run(frames)
    // Frame i is resolved at i * tickMs.
    const releasedAt = results.findIndex(r => r.state.mode !== 'listening') * tickMs

    expect(releasedAt).toBeGreaterThanOrEqual(1000)
    expect(releasedAt).toBeLessThanOrEqual(1000 + tickMs)
  })

  it('watches when desktop input is recent', () => {
    const [result] = run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: 9 }) })])

    expect(result.state.mode).toBe('watching')
    expect(result.state.attention).toBe('screen')
  })

  it('watches the cursor for 3 s after it moves', () => {
    const results = run([
      inputsAt(T0 + 3000, { cursorMovedAtMs: T0 }),
      inputsAt(T0 + 3301, { cursorMovedAtMs: T0 }),
    ])

    expect(results[0].state.mode).toBe('watching')
    expect(results[0].state.attention).toBe('cursor')
    expect(results[1].state.mode).toBe('idle')
  })

  it('watches when the screen changes', () => {
    expect(run([inputsAt(T0, { desktop: quietDesktop({ screenChange: 0.16 }) })])[0].state.mode).toBe('watching')
    expect(run([inputsAt(T0, { desktop: quietDesktop({ screenChange: 0.15 }) })])[0].state.mode).toBe('idle')
  })

  it('watches when other applications play audio', () => {
    expect(run([inputsAt(T0, { desktop: quietDesktop({ systemAudioLevel: 0.11 }) })])[0].state.mode).toBe('watching')
    expect(run([inputsAt(T0, { desktop: quietDesktop({ systemAudioLevel: 0.1 }) })])[0].state.mode).toBe('idle')
  })

  it('does not watch while the stage is hidden', () => {
    const [result] = run([inputsAt(T0, { visible: false, cursorMovedAtMs: T0, desktop: quietDesktop({ idleSeconds: 0 }) })])

    expect(result.state.mode).toBe('idle')
  })

  it('falls through to idle when the host reports no desktop signals (web, Wayland)', () => {
    const allNull = quietDesktop({ idleSeconds: null, systemAudioLevel: null, screenChange: null })

    const [web] = run([inputsAt(T0, { desktop: null })])
    const [wayland] = run([inputsAt(T0, { desktop: allNull })])

    expect(web.state).toEqual({ mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' })
    expect(wayland.state).toEqual({ mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' })
  })

  it('marks the user away after 300 s idle, when locked, or when suspended', () => {
    expect(run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: 300 }) })])[0].state.away).toBe(false)
    expect(run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: 301 }) })])[0].state.away).toBe(true)
    expect(run([inputsAt(T0, { desktop: quietDesktop({ locked: true }) })])[0].state.away).toBe(true)
    expect(run([inputsAt(T0, { desktop: quietDesktop({ suspendedAtMs: T0 - 10 }) })])[0].state.away).toBe(true)
  })

  it('does not watch screen activity while the user is away', () => {
    const [result] = run([inputsAt(T0, { desktop: quietDesktop({ locked: true, screenChange: 0.5, systemAudioLevel: 0.5 }) })])

    expect(result.state.mode).toBe('idle')
    expect(result.state.away).toBe(true)
  })

  it('reacts once with wake on unlock', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop({ locked: true }) }),
      inputsAt(T0 + 1000, { desktop: quietDesktop({ unlockedAtMs: T0 + 900 }) }),
      inputsAt(T0 + 1250, { desktop: quietDesktop({ unlockedAtMs: T0 + 900 }) }),
    ])

    expect(results.map(r => r.state.reactSeq)).toEqual([0, 1, 1])
    expect(results[1].state.reactKind).toBe('wake')
  })

  it('reacts with wake on resume from sleep', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop({ suspendedAtMs: T0 - 60_000 }) }),
      inputsAt(T0 + 1000, { desktop: quietDesktop({ suspendedAtMs: T0 - 60_000, resumedAtMs: T0 + 800 }) }),
    ])

    expect(results[0].state.away).toBe(true)
    expect(results[1].state.away).toBe(false)
    expect(results[1].state.reactSeq).toBe(1)
    expect(results[1].state.reactKind).toBe('wake')
  })

  it('treats the first desktop snapshot as a baseline without reacting', () => {
    const results = run([
      inputsAt(T0, { desktop: null }),
      inputsAt(T0 + 250, { desktop: quietDesktop({ unlockedAtMs: T0 - 1000, resumedAtMs: T0 - 2000 }) }),
      inputsAt(T0 + 500, { desktop: quietDesktop({ unlockedAtMs: T0 - 1000, resumedAtMs: T0 - 2000 }) }),
    ])

    expect(results.map(r => r.state.reactSeq)).toEqual([0, 0, 0])
  })

  it('reacts to a later unlock even when its timestamp is old', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop({ locked: true }) }),
      inputsAt(T0 + 60_000, { desktop: quietDesktop({ unlockedAtMs: T0 + 1000 }) }),
    ])

    expect(results[1].state.reactSeq).toBe(1)
    expect(results[1].state.reactKind).toBe('wake')
  })

  it('reacts once to the same wake timestamp seen twice', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop() }),
      inputsAt(T0 + 30_000, { desktop: quietDesktop({ resumedAtMs: T0 + 10_000 }) }),
      inputsAt(T0 + 30_250, { desktop: quietDesktop({ resumedAtMs: T0 + 10_000 }) }),
      inputsAt(T0 + 30_500, { desktop: quietDesktop({ resumedAtMs: null }) }),
      inputsAt(T0 + 30_750, { desktop: quietDesktop({ resumedAtMs: T0 + 10_000 }) }),
    ])

    expect(results.map(r => r.state.reactSeq)).toEqual([0, 1, 1, 1, 1])
  })

  it('reacts with screen-change when the screen change rises above 0.35', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop({ screenChange: 0.3 }) }),
      inputsAt(T0 + 250, { desktop: quietDesktop({ screenChange: 0.5 }) }),
      inputsAt(T0 + 500, { desktop: quietDesktop({ screenChange: 0.6 }) }),
    ])

    expect(results.map(r => r.state.reactSeq)).toEqual([0, 1, 1])
    expect(results[1].state.reactKind).toBe('screen-change')
  })

  it('screen-change within 10 s refractory does not increment reactSeq', () => {
    const results = run([
      inputsAt(T0, { desktop: quietDesktop({ screenChange: 0.5 }) }),
      inputsAt(T0 + 1000, { desktop: quietDesktop({ screenChange: 0 }) }),
      inputsAt(T0 + 2000, { desktop: quietDesktop({ screenChange: 0.5 }) }),
      inputsAt(T0 + 10_500, { desktop: quietDesktop({ screenChange: 0 }) }),
      inputsAt(T0 + 11_000, { desktop: quietDesktop({ screenChange: 0.5 }) }),
    ])

    expect(results.map(r => r.state.reactSeq)).toEqual([1, 1, 1, 1, 2])
  })

  it('lets the developer override win without dwell', () => {
    const results = run([
      inputsAt(T0, { speaking: true }),
      inputsAt(T0 + 10, { speaking: true, override: { mode: 'thinking', energy: null } }),
      inputsAt(T0 + 20, { speaking: true, override: { mode: 'idle', energy: 1 } }),
    ])

    expect(results.map(r => r.state.mode)).toEqual(['talking', 'thinking', 'idle'])
  })

  it('treats NaN and negative idle time as unknown without throwing', () => {
    const nan = run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: Number.NaN, screenChange: Number.NaN, systemAudioLevel: Number.NaN }) })])[0]
    const negative = run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: -5 }) })])[0]

    expect(nan.state.mode).toBe('idle')
    expect(nan.state.away).toBe(false)
    expect(negative.state.mode).toBe('idle')
    expect(negative.state.away).toBe(false)
  })

  it('does not flap modes or reopen refractory when the clock steps backwards', () => {
    const results = run([
      inputsAt(T0, { generating: true, desktop: quietDesktop({ screenChange: 0.5 }) }),
      inputsAt(T0 + 400, { speaking: true, desktop: quietDesktop({ screenChange: 0 }) }),
      inputsAt(T0 - 5000, { generating: true, desktop: quietDesktop({ screenChange: 0.5 }) }),
      inputsAt(Number.NaN, { generating: true, desktop: quietDesktop({ screenChange: 0.5 }) }),
    ])

    expect(results.map(r => r.state.mode)).toEqual(['thinking', 'talking', 'talking', 'talking'])
    expect(results.map(r => r.state.reactSeq)).toEqual([1, 1, 1, 1])
    expect(results[3].memory.nowMs).toBe(T0 + 400)
  })
})
