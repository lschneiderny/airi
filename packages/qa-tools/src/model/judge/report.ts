import type { PersonaJudgment } from './pairs'

import { PERSONA_TAGS } from './pairs'

export interface ContenderStanding {
  contender: string
  /** Comparisons the contender took part in. */
  judged: number
  wins: number
  /** Wins with a `-much` verdict. Counted in `wins` too. */
  clearWins: number
  ties: number
  losses: number
  /** (wins + ties / 2) / judged. */
  score: number
  /** 95% Wilson interval of `score`. Ties count as half a win, so the interval is approximate. */
  scoreLow: number
  scoreHigh: number
  /** Bradley-Terry strength, scaled so the mean contender is 1. The chance to beat the mean contender is strength / (strength + 1). */
  strength: number
  /** How often the judge tagged this contender's replies with each tag, as a share of its judged replies. */
  tags: Record<string, number>
}

export interface JudgmentReport {
  schema: 'airi.persona-judgment-report/v1'
  judgments: number
  judges: string[]
  standings: ContenderStanding[]
  /** Head-to-head results, one row per contender pair with at least one comparison. */
  matchups: { a: string, b: string, aWins: number, ties: number, bWins: number }[]
}

/** Wilson z for a 95% interval. */
const WILSON_Z = 1.96
/**
 * Bradley-Terry iterations. The minorization-maximization update converges in a few dozen steps for the handful of
 * contenders a session compares; 200 leaves the strengths stable to many decimals.
 */
const BT_ITERATIONS = 200
/**
 * Half a win and half a loss against a virtual average opponent for every contender. Without it, a contender that never
 * lost or never won has an infinite or zero strength.
 */
const BT_PRIOR = 0.5

/** Aggregates judgments into standings, head-to-head counts, and tag rates. */
export function buildJudgmentReport(judgments: readonly PersonaJudgment[]): JudgmentReport {
  const names = [...new Set(judgments.flatMap(j => [j.left.contender, j.right.contender]))].sort()
  const index = new Map(names.map((name, i) => [name, i]))
  const wins = names.map(() => 0)
  const clearWins = names.map(() => 0)
  const ties = names.map(() => 0)
  const judged = names.map(() => 0)
  const tagCounts = names.map(() => new Map<string, number>())
  // games[i][j] counts comparisons between i and j, beat[i][j] i's wins over j, and tied[i][j] their ties.
  const games = names.map(() => names.map(() => 0))
  const beat = names.map(() => names.map(() => 0))
  const tied = names.map(() => names.map(() => 0))

  for (const judgment of judgments) {
    const l = index.get(judgment.left.contender)!
    const r = index.get(judgment.right.contender)!
    judged[l]!++
    judged[r]!++
    games[l]![r]!++
    games[r]![l]!++
    for (const [side, i] of [[judgment.left, l], [judgment.right, r]] as const) {
      for (const tag of side.tags)
        tagCounts[i]!.set(tag, (tagCounts[i]!.get(tag) ?? 0) + 1)
    }
    if (judgment.verdict === 'tie') {
      ties[l]!++
      ties[r]!++
      tied[l]![r]!++
      tied[r]![l]!++
      continue
    }
    const [winner, loser] = judgment.verdict.startsWith('left') ? [l, r] : [r, l]
    wins[winner]!++
    if (judgment.verdict.endsWith('-much'))
      clearWins[winner]!++
    beat[winner]![loser]!++
  }

  // Bradley-Terry counts a tie as half a win for each side.
  const strength = bradleyTerry(games, beat.map((row, i) => row.map((count, j) => count + tied[i]![j]! / 2)))
  const standings = names.map((contender, i): ContenderStanding => {
    const n = judged[i]!
    const score = n ? (wins[i]! + ties[i]! / 2) / n : 0
    const [scoreLow, scoreHigh] = wilson(score, n)
    return {
      contender,
      judged: n,
      wins: wins[i]!,
      clearWins: clearWins[i]!,
      ties: ties[i]!,
      losses: n - wins[i]! - ties[i]!,
      score,
      scoreLow,
      scoreHigh,
      strength: strength[i]!,
      tags: Object.fromEntries([...tagCounts[i]!].map(([tag, count]) => [tag, n ? count / n : 0])),
    }
  }).sort((a, b) => b.strength - a.strength)

  const matchups: JudgmentReport['matchups'] = []
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (!games[i]![j])
        continue
      matchups.push({ a: names[i]!, b: names[j]!, aWins: beat[i]![j]!, ties: tied[i]![j]!, bWins: beat[j]![i]! })
    }
  }

  return {
    schema: 'airi.persona-judgment-report/v1',
    judgments: judgments.length,
    judges: [...new Set(judgments.map(j => j.judge))].sort(),
    standings,
    matchups,
  }
}

function wilson(p: number, n: number): [number, number] {
  if (!n)
    return [0, 1]
  const z2 = WILSON_Z * WILSON_Z
  const center = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (WILSON_Z / (1 + z2 / n)) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/** Bradley-Terry strengths by the minorization-maximization update (Hunter 2004), normalized to a geometric mean of 1. */
function bradleyTerry(games: number[][], won: number[][]): number[] {
  const n = games.length
  let p: number[] = Array.from<number>({ length: n }).fill(1)
  for (let iteration = 0; iteration < BT_ITERATIONS; iteration++) {
    const next = p.map((pi, i) => {
      // The prior adds one game against a virtual opponent of strength 1, won half the time.
      let numerator = BT_PRIOR
      let denominator = 1 / (pi + 1)
      for (let j = 0; j < n; j++) {
        if (j === i || !games[i]![j])
          continue
        numerator += won[i]![j]!
        denominator += games[i]![j]! / (pi + p[j]!)
      }
      return numerator / denominator
    })
    const mean = Math.exp(next.reduce((sum, value) => sum + Math.log(value), 0) / n)
    p = next.map(value => value / mean)
  }
  return p
}

const percent = (value: number) => `${Math.round(value * 100)}%`

/** Renders a report as Markdown: standings, then tag rates, then head-to-head counts. */
export function renderJudgmentMarkdown(report: JudgmentReport): string {
  const lines = [
    '# Persona judgments',
    '',
    `${report.judgments} judgments by ${report.judges.join(', ') || 'nobody'}. Score counts a tie as half a win; the interval is a 95% Wilson interval. Strength is a Bradley-Terry strength scaled so the mean contender is 1.`,
    '',
    '| Contender | Judged | Wins (clear) | Ties | Losses | Score | 95% interval | Strength |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.standings.map(s => `| ${s.contender} | ${s.judged} | ${s.wins} (${s.clearWins}) | ${s.ties} | ${s.losses} | ${percent(s.score)} | ${percent(s.scoreLow)}–${percent(s.scoreHigh)} | ${s.strength.toFixed(2)} |`),
  ]
  const used = PERSONA_TAGS.filter(tag => report.standings.some(s => s.tags[tag.id]))
  if (used.length) {
    lines.push('', '## Tags', '', 'Share of each contender\'s judged replies that carried the tag.', '', `| Contender | ${used.map(tag => tag.label).join(' | ')} |`, `| --- |${used.map(() => ' --- |').join('')}`)
    for (const s of report.standings)
      lines.push(`| ${s.contender} | ${used.map(tag => s.tags[tag.id] ? percent(s.tags[tag.id]!) : '').join(' | ')} |`)
  }
  if (report.matchups.length) {
    lines.push('', '## Head to head', '', '| A | B | A wins | Ties | B wins |', '| --- | --- | --- | --- | --- |')
    for (const m of report.matchups)
      lines.push(`| ${m.a} | ${m.b} | ${m.aWins} | ${m.ties} | ${m.bWins} |`)
  }
  return `${lines.join('\n')}\n`
}
