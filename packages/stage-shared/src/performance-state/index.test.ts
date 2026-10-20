import type { DesktopActivitySnapshot, PerformanceInputs, PerformanceResolution, ResolverMemory } from '.'
import type { AppCategory } from '../situation/types'

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
    cueAttention: null,
    foregroundCategory: null,
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

  it.each([
    ['talking', { speaking: true }, 'aside', 'aside'],
    ['talking', { speaking: true }, 'screen', 'screen'],
    ['talking', { speaking: true }, 'camera', 'camera'],
    ['thinking', { generating: true }, 'aside', 'aside'],
  ] as const)('lets the ACT cue direct attention while %s (%j, cue %s)', (mode, overrides, cueAttention, attention) => {
    const [result] = run([inputsAt(T0, { ...overrides, cueAttention, cursorMovedAtMs: T0 })])

    expect(result.state.mode).toBe(mode)
    expect(result.state.attention).toBe(attention)
  })

  it('keeps listening, watching, and idle attention when an ACT cue is set', () => {
    const listening = run([inputsAt(T0, { userSpeaking: true, generating: true, cueAttention: 'aside' })])[0]
    const watchingCursor = run([inputsAt(T0, { cursorMovedAtMs: T0, cueAttention: 'aside' })])[0]
    const watchingScreen = run([inputsAt(T0, { desktop: quietDesktop({ idleSeconds: 0 }), cueAttention: 'aside' })])[0]
    const idle = run([inputsAt(T0, { cueAttention: 'aside' })])[0]

    expect([listening, watchingCursor, watchingScreen, idle].map(r => [r.state.mode, r.state.attention])).toEqual([
      ['listening', 'camera'],
      ['watching', 'cursor'],
      ['watching', 'screen'],
      ['idle', 'camera'],
    ])
  })

  it('returns attention to camera once talking ends, even while the cue is still set', () => {
    const results = run([
      inputsAt(T0, { speaking: true, cueAttention: 'aside' }),
      inputsAt(T0 + 400, { cueAttention: 'aside' }),
    ])

    expect(results.map(r => [r.state.mode, r.state.attention])).toEqual([['talking', 'aside'], ['idle', 'camera']])
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

  it.each([
    ['game', 'screen'],
    ['media', 'screen'],
    ['editor', 'cursor'],
    ['browser', 'cursor'],
    [null, 'cursor'],
  ] as const)('watches the screen while %s is in front even when the cursor moved (attention %s)', (foregroundCategory, attention) => {
    const [result] = run([inputsAt(T0, { cursorMovedAtMs: T0, foregroundCategory })])

    expect(result.state.mode).toBe('watching')
    expect(result.state.attention).toBe(attention)
  })

  it('leaves attention unchanged without a foreground category', () => {
    const frames = [
      inputsAt(T0, { cursorMovedAtMs: T0 }),
      inputsAt(T0 + 3301, { cursorMovedAtMs: T0, desktop: quietDesktop({ idleSeconds: 0 }) }),
      inputsAt(T0 + 3600, { speaking: true }),
    ]
    const results = run(frames)

    expect(results.map(r => [r.state.mode, r.state.attention])).toEqual([['watching', 'cursor'], ['watching', 'screen'], ['talking', 'camera']])
  })

  it('lets an active ACT look cue win over the foreground category', () => {
    const talkingAside = run([inputsAt(T0, { speaking: true, cursorMovedAtMs: T0, cueAttention: 'aside', foregroundCategory: 'game' })])[0]
    const talkingNoCue = run([inputsAt(T0, { speaking: true, cursorMovedAtMs: T0, foregroundCategory: 'game' })])[0]
    const thinkingCamera = run([inputsAt(T0, { generating: true, cueAttention: 'camera', foregroundCategory: 'media' })])[0]
    const listening = run([inputsAt(T0, { userSpeaking: true, foregroundCategory: 'game' })])[0]

    expect([talkingAside, talkingNoCue, thinkingCamera, listening].map(r => [r.state.mode, r.state.attention])).toEqual([
      ['talking', 'aside'],
      ['talking', 'camera'],
      ['thinking', 'camera'],
      ['listening', 'camera'],
    ])
  })

  it('switches attention only after a new foreground category has held for 2 s', () => {
    const results = run([
      inputsAt(T0, { cursorMovedAtMs: T0, foregroundCategory: 'editor' }),
      inputsAt(T0 + 1000, { cursorMovedAtMs: T0 + 1000, foregroundCategory: 'game' }),
      inputsAt(T0 + 2999, { cursorMovedAtMs: T0 + 2999, foregroundCategory: 'game' }),
      inputsAt(T0 + 3000, { cursorMovedAtMs: T0 + 3000, foregroundCategory: 'game' }),
      inputsAt(T0 + 4000, { cursorMovedAtMs: T0 + 4000, foregroundCategory: 'editor' }),
      inputsAt(T0 + 6000, { cursorMovedAtMs: T0 + 6000, foregroundCategory: 'editor' }),
    ])

    expect(results.map(r => r.state.attention)).toEqual(['cursor', 'cursor', 'cursor', 'screen', 'screen', 'cursor'])
  })

  it('keeps attention steady while the foreground category flaps faster than it settles', () => {
    const frames: PerformanceInputs[] = [inputsAt(T0, { cursorMovedAtMs: T0, foregroundCategory: 'game' })]
    // Alt-tab between the game and an editor every 750 ms for 9 s, with the cursor moving the whole time.
    for (let t = 250; t <= 9000; t += 250) {
      const foregroundCategory: AppCategory = Math.floor(t / 750) % 2 === 0 ? 'game' : 'editor'
      frames.push(inputsAt(T0 + t, { cursorMovedAtMs: T0 + t, foregroundCategory }))
    }

    const attentions = run(frames).map(r => r.state.attention)

    expect(new Set(attentions)).toEqual(new Set(['screen']))
  })

  it('treats an unknown category like a non-screen app without throwing', () => {
    // A category from a newer or misbehaving producer arrives as plain JSON, outside the AppCategory union.
    const foregroundCategory: AppCategory = JSON.parse('"banana"')
    const [result] = run([inputsAt(T0, { cursorMovedAtMs: T0, foregroundCategory })])

    expect(result.state.mode).toBe('watching')
    expect(result.state.attention).toBe('cursor')
  })

  it('applies the first category after the stage was hidden at once, so a stale game does not hold attention', () => {
    const results = run([
      inputsAt(T0, { cursorMovedAtMs: T0, foregroundCategory: 'game' }),
      inputsAt(T0 + 1000, { visible: false, foregroundCategory: 'game' }),
      // Back on screen: the game category is the last sample from before the stage was hidden.
      inputsAt(T0 + 25_000, { cursorMovedAtMs: T0 + 25_000, foregroundCategory: 'game' }),
      inputsAt(T0 + 25_300, { cursorMovedAtMs: T0 + 25_300, foregroundCategory: 'editor' }),
      inputsAt(T0 + 26_000, { cursorMovedAtMs: T0 + 26_000, foregroundCategory: 'game' }),
    ])

    expect(results.map(r => [r.state.mode, r.state.attention])).toEqual([
      ['watching', 'screen'],
      ['idle', 'camera'],
      ['watching', 'screen'],
      ['watching', 'cursor'],
      ['watching', 'cursor'],
    ])
  })

  it('does not watch a game while the stage is hidden', () => {
    const [result] = run([inputsAt(T0, { visible: false, cursorMovedAtMs: T0, desktop: quietDesktop({ idleSeconds: 0 }), foregroundCategory: 'game' })])

    expect(result.state.mode).toBe('idle')
    expect(result.state.attention).toBe('camera')
  })
})
