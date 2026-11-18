import type { PersonaJudgment, Verdict } from './pairs'

import { describe, expect, it } from 'vitest'

import { buildJudgmentReport, renderJudgmentMarkdown } from './report'

let id = 0
function judgment(left: string, right: string, verdict: Verdict, tags: { left?: PersonaJudgment['left']['tags'], right?: PersonaJudgment['right']['tags'] } = {}): PersonaJudgment {
  id++
  return {
    schema: 'airi.persona-judgment/v1',
    judgmentId: `j${id}`,
    sessionId: 's',
    judge: 'owner',
    at: '2026-11-18T12:00:00.000Z',
    elapsedMs: 1000,
    slot: { key: `slot${id}`, turn: 1, user: 'hi', seed: '1', stage: null },
    left: { replyId: `l${id}`, runKey: 'k', contender: left, tags: tags.left ?? [] },
    right: { replyId: `r${id}`, runKey: 'k', contender: right, tags: tags.right ?? [] },
    verdict,
    note: '',
  }
}

describe('buildJudgmentReport', () => {
  it('counts wins from either side, clear wins, and ties as half a win', () => {
    const report = buildJudgmentReport([
      judgment('a', 'b', 'left-much'),
      judgment('b', 'a', 'right'),
      judgment('a', 'b', 'tie'),
      judgment('b', 'a', 'left'),
    ])
    const a = report.standings.find(s => s.contender === 'a')!

    expect(a.judged).toBe(4)
    expect(a.wins).toBe(2)
    expect(a.clearWins).toBe(1)
    expect(a.ties).toBe(1)
    expect(a.losses).toBe(1)
    expect(a.score).toBeCloseTo(2.5 / 4)
    expect(report.matchups).toEqual([{ a: 'a', b: 'b', aWins: 2, ties: 1, bWins: 1 }])
  })

  it('ranks by Bradley-Terry strength, so beating a strong contender counts more', () => {
    // c beats b, b beats a; a and c never meet.
    const report = buildJudgmentReport([
      ...Array.from({ length: 4 }, () => judgment('b', 'a', 'left')),
      ...Array.from({ length: 4 }, () => judgment('c', 'b', 'left')),
    ])

    expect(report.standings.map(s => s.contender)).toEqual(['c', 'b', 'a'])
    expect(report.standings[0]!.strength).toBeGreaterThan(1)
    expect(report.standings[2]!.strength).toBeLessThan(1)
  })

  it('keeps an undefeated contender finite and its interval below certainty', () => {
    const report = buildJudgmentReport(Array.from({ length: 3 }, () => judgment('a', 'b', 'left')))
    const a = report.standings[0]!

    expect(Number.isFinite(a.strength)).toBe(true)
    expect(a.score).toBe(1)
    expect(a.scoreHigh).toBe(1)
    expect(a.scoreLow).toBeLessThan(1)
  })

  it('reports each tag as a share of the contender\'s judged replies', () => {
    const report = buildJudgmentReport([
      judgment('a', 'b', 'left', { left: ['warm'], right: ['generic-assistant'] }),
      judgment('a', 'b', 'right', { right: ['generic-assistant'] }),
    ])

    expect(report.standings.find(s => s.contender === 'a')!.tags).toEqual({ warm: 0.5 })
    expect(report.standings.find(s => s.contender === 'b')!.tags).toEqual({ 'generic-assistant': 1 })
  })
})

describe('renderJudgmentMarkdown', () => {
  it('renders standings, used tags, and head-to-head rows', () => {
    const markdown = renderJudgmentMarkdown(buildJudgmentReport([judgment('a', 'b', 'left', { left: ['warm'] })]))

    expect(markdown).toContain('| a | 1 | 1 (0) | 0 | 0 | 100% |')
    expect(markdown).toContain('| Contender | Warm |')
    expect(markdown).toContain('| a | b | 1 | 0 | 0 |')
  })
})
