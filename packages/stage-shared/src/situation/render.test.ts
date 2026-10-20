import type { Observation, SituationEvent, SituationState } from '.'

import { describe, expect, it } from 'vitest'

import { initialSituationState, markAddressed, markShown, reduceSituation, renderSituation } from '.'

const T0 = 1_700_000_000_000
const SEC = 1000
const MIN = 60 * SEC

function fold(observations: readonly Observation[]): SituationState {
  return observations.reduce((state, observation) => reduceSituation(state, observation, observation.atMs), initialSituationState)
}

function event(overrides: Partial<SituationEvent> = {}): SituationEvent {
  return {
    id: 'e1',
    kind: 'app-switch',
    topicKey: 'activity:game',
    text: 'switched to game',
    atMs: T0,
    salience: 0.8,
    halfLifeMs: 20 * MIN,
    tier: 0,
    origin: 'world',
    shownAtMs: null,
    addressedAtMs: null,
    ...overrides,
  }
}

function stateWith(overrides: Partial<SituationState>): SituationState {
  return { ...initialSituationState, ...overrides }
}

function clock(nowMs: number): string {
  const date = new Date(nowMs)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const fullState = stateWith({
  presence: { state: 'here', reason: null, sinceMs: T0 },
  activity: { appId: 'code', label: 'VS Code', category: 'editor', title: 'render.ts', sinceMs: T0 + 10 * MIN },
  recentActivities: [{ appId: 'game', label: 'Elden Ring', category: 'game', sinceMs: T0, endedAtMs: T0 + 10 * MIN }],
  conversation: { lastUserAtMs: T0 + 5 * MIN, lastCharacterAtMs: T0 + 6 * MIN, lastUnpromptedAtMs: T0 + 2 * MIN, lastUnpromptedTopic: 'the boss fight' },
  contexts: { vision: { text: 'A text editor with TypeScript open', atMs: T0 + 12 * MIN } },
  stage: { exposed: 'smile, wave', active: 'idle', mood: 'calm', atMs: T0 },
  events: [event({ atMs: T0 + 14 * MIN })],
})

describe('renderSituation', () => {
  it('renders the header only for an empty state', () => {
    const result = renderSituation(initialSituationState, T0)
    expect(result.text).toBe(`[Situation ${clock(T0)}]`)
    expect(result.shownEventIds).toEqual([])
  })

  it('renders every section in priority order', () => {
    const nowMs = T0 + 15 * MIN
    const { text, shownEventIds } = renderSituation(fullState, nowMs, { maxLines: 20, maxChars: 2000 })
    expect(text.split('\n')).toEqual([
      `[Situation ${clock(nowMs)}]`,
      '- The user is at the desk, active for about 15 min',
      '- Now: VS Code (editor): render.ts, for about 5 min',
      '- Before that: Elden Ring, about 10 min',
      '- New: switched to game (1 min ago)',
      '- You two last talked 9 min ago. You last spoke up on your own 15 min ago, about the boss fight.',
      '- A text editor with TypeScript open',
      '- Stage - on stage: smile, wave; active: idle; mood: calm',
    ])
    expect(shownEventIds).toEqual(['e1'])
  })

  it('uses the given user name and can leave out the stage line', () => {
    const { text } = renderSituation(fullState, T0 + 15 * MIN, { userName: 'Luke', includeStage: false, maxLines: 20, maxChars: 2000 })
    expect(text).toContain('- Luke is at the desk')
    expect(text).not.toContain('Stage -')
  })

  it('drops the lowest-priority bullets first when lines run out', () => {
    const nowMs = T0 + 15 * MIN
    const lines = renderSituation(fullState, nowMs, { maxLines: 4, maxChars: 2000 }).text.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toMatch(/^- Before that/)
    const fewer = renderSituation(fullState, nowMs, { maxLines: 2, maxChars: 2000 }).text.split('\n')
    expect(fewer[1]).toMatch(/^- The user is at the desk/)
    expect(fewer).toHaveLength(2)
  })

  it('drops whole bullets for the character budget and never cuts mid-word', () => {
    const nowMs = T0 + 15 * MIN
    const full = renderSituation(fullState, nowMs, { maxLines: 20, maxChars: 2000 }).text
    for (let maxChars = 0; maxChars <= full.length; maxChars++) {
      const { text } = renderSituation(fullState, nowMs, { maxLines: 20, maxChars })
      expect(text.length).toBeLessThanOrEqual(Math.max(maxChars, `[Situation ${clock(nowMs)}]`.length))
      expect(full.startsWith(text)).toBe(true)
      expect(full.slice(text.length)).toMatch(/^(\n- |$)/)
    }
  })

  it('does not report events whose bullet was dropped as shown', () => {
    const { text, shownEventIds } = renderSituation(fullState, T0 + 15 * MIN, { maxLines: 3 })
    expect(text).not.toContain('New:')
    expect(shownEventIds).toEqual([])
  })

  it('renders identical text within one time bucket', () => {
    const base = T0 + 12 * MIN + 10 * SEC
    const first = renderSituation(fullState, base)
    const later = renderSituation(fullState, base + 30 * SEC)
    expect(later.text.replace(/^\[Situation [^\]]*\]/, '')).toBe(first.text.replace(/^\[Situation [^\]]*\]/, ''))
  })

  it('uses the documented buckets', () => {
    const at = (elapsedMs: number): string => renderSituation(stateWith({ presence: { state: 'away', reason: 'locked', sinceMs: T0 } }), T0 + elapsedMs).text.split('\n')[1]
    expect(at(30 * SEC)).toBe('- The user stepped away just now')
    expect(at(MIN)).toBe('- The user stepped away 1 min ago')
    expect(at(9 * MIN + 59 * SEC)).toBe('- The user stepped away 9 min ago')
    expect(at(10 * MIN)).toBe('- The user stepped away 10 min ago')
    expect(at(13 * MIN)).toBe('- The user stepped away 15 min ago')
    expect(at(58 * MIN)).toBe('- The user stepped away about 1 h ago')
    expect(at(80 * MIN)).toBe('- The user stepped away about 1.5 h ago')
    expect(at(150 * MIN)).toBe('- The user stepped away about 2.5 h ago')
  })

  it('shows New: only for unshown events with enough effective salience, at most two', () => {
    const state = stateWith({
      events: [
        event({ id: 'a', text: 'alpha', atMs: T0, salience: 0.9 }),
        event({ id: 'b', text: 'bravo', atMs: T0, salience: 0.8 }),
        event({ id: 'c', text: 'charlie', atMs: T0, salience: 0.7 }),
        event({ id: 'd', text: 'delta', atMs: T0, salience: 0.1 }),
      ],
    })
    const first = renderSituation(state, T0 + MIN)
    expect(first.shownEventIds).toEqual(['a', 'b'])
    const after = markShown(state, first.shownEventIds, T0 + MIN)
    const second = renderSituation(after, T0 + 2 * MIN)
    expect(second.shownEventIds).toEqual(['c'])
    expect(second.text).not.toContain('alpha')
    expect(renderSituation(markShown(after, ['c'], T0 + 2 * MIN), T0 + 3 * MIN).shownEventIds).toEqual([])
  })

  it('ignores events whose salience has decayed below the threshold', () => {
    const state = stateWith({ events: [event({ salience: 0.5, halfLifeMs: 10 * MIN })] })
    expect(renderSituation(state, T0 + 5 * MIN).shownEventIds).toEqual(['e1'])
    expect(renderSituation(state, T0 + 20 * MIN).shownEventIds).toEqual([])
  })

  it('omits the presence bullet when presence is unknown', () => {
    expect(renderSituation(stateWith({ activity: fullState.activity }), T0 + 15 * MIN).text).not.toMatch(/at the desk|stepped away|idle/)
  })

  it('renders the last unprompted topic', () => {
    const base = fold([
      { kind: 'context', sourceKey: 'vision', text: 'a cat on screen', atMs: T0 },
    ])
    const addressed = markAddressed(base, 'context:vision', T0 + MIN)
    const { text } = renderSituation(
      { ...addressed, conversation: { ...addressed.conversation, lastUnpromptedAtMs: T0 + MIN } },
      T0 + 11 * MIN,
    )
    expect(text).toContain('- You last spoke up on your own 10 min ago, about a cat on screen.')
    expect(text).not.toContain('You two last talked')
  })

  it('renders an activity without a title and never adds one', () => {
    const state = stateWith({ activity: { appId: 'browser', label: 'Chrome', category: 'browser', title: null, sinceMs: T0 } })
    expect(renderSituation(state, T0 + 3 * MIN).text.split('\n')[1]).toBe('- Now: Chrome (browser), for about 3 min')
  })

  it('keeps 20 events and 6 long contexts within 6 lines and 500 chars', () => {
    const long = 'The screen shows a very long description of many things happening at once '.repeat(8)
    const state = stateWith({
      presence: fullState.presence,
      activity: fullState.activity,
      recentActivities: fullState.recentActivities,
      conversation: fullState.conversation,
      stage: fullState.stage,
      contexts: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`src${i}`, { text: `${long}${i}`, atMs: T0 + i * MIN }])),
      events: Array.from({ length: 20 }, (_, i) => event({ id: `e${i}`, text: `event number ${i}`, atMs: T0 + i * SEC })),
    })
    const { text } = renderSituation(state, T0 + 20 * MIN)
    expect(text.split('\n').length).toBeLessThanOrEqual(6)
    expect(text.length).toBeLessThanOrEqual(500)
    const wide = renderSituation(state, T0 + 20 * MIN, { maxLines: 40, maxChars: 5000 }).text.split('\n')
    for (const line of wide.filter(l => l.includes('The screen shows')))
      expect(line.length - 2).toBeLessThanOrEqual(120)
    expect(wide.filter(l => l.startsWith('- The screen shows'))[0]).toMatch(/\.\.\.$/)
    const cut = wide.filter(l => l.startsWith('- The screen shows'))[0].slice(2, -3)
    expect(cut.endsWith(' ')).toBe(false)
    expect(long.startsWith(`${cut} `)).toBe(true)
  })

  it('orders contexts newest first', () => {
    const state = stateWith({ contexts: { a: { text: 'older', atMs: T0 }, b: { text: 'newer', atMs: T0 + MIN } } })
    expect(renderSituation(state, T0 + 2 * MIN).text.split('\n').slice(1)).toEqual(['- newer', '- older'])
  })

  it('is deterministic and does not mutate the state', () => {
    const snapshot = structuredClone(fullState)
    const a = renderSituation(fullState, T0 + 15 * MIN)
    const b = renderSituation(fullState, T0 + 15 * MIN)
    expect(a).toEqual(b)
    expect(fullState).toEqual(snapshot)
  })

  it('collapses newlines so each bullet stays on one line', () => {
    const state = stateWith({ contexts: { a: { text: 'line one\n\n  line two\r\nline three', atMs: T0 } } })
    expect(renderSituation(state, T0 + MIN).text.split('\n')).toEqual([`[Situation ${clock(T0 + MIN)}]`, '- line one line two line three'])
  })

  it('counts emoji by UTF-16 length and never splits a surrogate pair', () => {
    const state = stateWith({ contexts: { a: { text: '😀'.repeat(100), atMs: T0 } } })
    const { text } = renderSituation(state, T0 + MIN)
    const bullet = text.split('\n')[1]
    expect(bullet.length - 2).toBeLessThanOrEqual(120)
    expect(bullet).toMatch(/^- 😀+\.\.\.$/u)
    const tight = renderSituation(state, T0 + MIN, { maxChars: 40 })
    expect(tight.text).toBe(`[Situation ${clock(T0 + MIN)}]`)
  })

  it('handles malformed input without throwing', () => {
    expect(renderSituation(fullState, Number.NaN)).toEqual({ text: '[Situation --:--]', shownEventIds: [] })
    expect(renderSituation(fullState, Number.POSITIVE_INFINITY).text).toBe('[Situation --:--]')
    const blank = stateWith({
      activity: { appId: '', label: '  ', category: 'other', title: '', sinceMs: T0 },
      contexts: { a: { text: '   ', atMs: T0 } },
      events: [event({ text: ' ' })],
    })
    expect(renderSituation(blank, T0, { userName: '  ', maxLines: Number.NaN, maxChars: -5 }).text).toBe(`[Situation ${clock(T0)}]`)
    expect(renderSituation(blank, T0, { maxLines: 0 }).text).toBe(`[Situation ${clock(T0)}]`)
    expect(renderSituation(blank, T0).text.split('\n')[1]).toBe('- Now: an app (other), for less than a minute')
  })

  it('clamps spans when the clock is behind the state', () => {
    const state = stateWith({ presence: { state: 'here', reason: null, sinceMs: T0 + 10 * MIN } })
    expect(renderSituation(state, T0).text).toContain('active for less than a minute')
  })
})
