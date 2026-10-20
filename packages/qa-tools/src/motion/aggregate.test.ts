import type { EmotionTrialRecord, PlaceboRecord, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { GateSelection } from './gate/options'
import type { EmotionCellPartial, NullPartial } from './gate/partials'

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildIdleWithPlacebos } from '@proj-airi/stage-shared/motion-scenario'
import { buildEmotionChecks, emotionGate, naturalIdleLivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { aggregateEmotion, aggregateLiveliness, formatSummary } from './gate/aggregate'
import { cellPartialName, expectedEmotionPartials, nullPartialName, seedRange, variantsFor } from './gate/options'
import { writePartial } from './gate/partials'
import { parseGateReport } from './gate/report'
import { runT1 } from './t1/runner'

const selection: GateSelection = { emotions: ['angry'], bands: ['strong'], seedsLimit: null }
const channels: ScoredChannel[] = ['browMean', 'browAngle', 'mouthForm', 'eyelid', 'angleY']

/** Deterministic fixture trial: a clear positive delta over a small, seed-dependent wobble. */
function trial(variant: EmotionTrialRecord['variant'], seed: number): EmotionTrialRecord {
  const wobble = ((seed * 37) % 11 - 5) / 500
  return {
    trialId: `angry-strong-${variant}-${seed}`,
    emotion: 'angry',
    band: 'strong',
    variant,
    side: null,
    rejected: null,
    releaseStart: 4,
    faceResidue: 1,
    channels: Object.fromEntries(channels.map(channel => [channel, { value: 0.2 + wobble, paired: wobble / 2 }])),
    missing: {},
  }
}

function placebo(index: number): PlaceboRecord {
  return { id: `placebo-${index}`, channels: Object.fromEntries(channels.map(channel => [channel, ((index * 17) % 13 - 6) / 300])) }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-aggregate-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeFixture(target: string, seeds = 12): void {
  const ranges = runT1(buildIdleWithPlacebos({ seed: 1, warmup: 1, placebos: 1, spacing: 1 })).ranges
  for (const variant of variantsFor('strong')) {
    const cell: EmotionCellPartial = { kind: 'emotion-cell', emotion: 'angry', band: 'strong', variant, seeds: { start: 1, count: seeds }, records: Array.from({ length: seeds }, (_, index) => trial(variant, index + 1)) }
    writePartial(target, cellPartialName('angry', 'strong', variant), cell)
  }
  const nullPartial: NullPartial = { kind: 'null', seeds: { start: 1, count: seeds }, ranges, records: Array.from({ length: 60 }, (_, index) => placebo(index)) }
  writePartial(target, nullPartialName, nullPartial)
}

const context = (runDir: string) => ({ runDir, fileSha: 'a'.repeat(40), level: 't1' as const })

describe('aggregateEmotion', () => {
  it('writes a schema-valid report with one result per generated check of the selection', () => {
    writeFixture(dir)
    const report = aggregateEmotion(context(dir), emotionGate, selection)

    expect(parseGateReport(JSON.parse(JSON.stringify(report)))).toEqual(report)
    const expectedKeys = buildEmotionChecks().filter(check => check.emotion === 'angry' && check.band === 'strong').map(check => check.key).sort()
    expect(report.results.map(result => result.key).sort()).toEqual(expectedKeys)
    expect(report.gateId).toBe(emotionGate.id)
    expect(report.version).toBe(emotionGate.version)
    expect(report.limitation).toBe(emotionGate.limitation)
    expect(Object.keys(report.nullStats)).toContain('browMean')
  })

  it('reports a pass only when every check passed, and names the failed checks in the summary', () => {
    writeFixture(dir)
    const report = aggregateEmotion(context(dir), emotionGate, selection)
    const failing = report.results.filter(result => result.verdict !== 'pass')

    expect(report.pass).toBe(failing.length === 0)
    // The fixture carries no long-hold release windows, so at least the modulation checks cannot pass.
    expect(failing.length).toBeGreaterThan(0)
    expect(report.pass).toBe(false)
    const summary = formatSummary(report)
    for (const result of failing)
      expect(summary).toContain(result.key)
  })

  it('gives the same hash for the same partials in another directory and a different one when a trial changes', () => {
    writeFixture(dir)
    const copy = mkdtempSync(join(tmpdir(), 'qa-aggregate-copy-'))
    try {
      cpSync(join(dir, 'partials'), join(copy, 'partials'), { recursive: true })
      const first = aggregateEmotion(context(dir), emotionGate, selection)
      expect(aggregateEmotion(context(copy), emotionGate, selection).determinismHash).toBe(first.determinismHash)

      const changed = { ...trial('full', 1), channels: { browMean: { value: 0.9, paired: 0 } } }
      writePartial(copy, cellPartialName('angry', 'strong', 'full'), { kind: 'emotion-cell', emotion: 'angry', band: 'strong', variant: 'full', seeds: { start: 1, count: 1 }, records: [changed] })
      expect(aggregateEmotion(context(copy), emotionGate, selection).determinismHash).not.toBe(first.determinismHash)
    }
    finally {
      rmSync(copy, { recursive: true, force: true })
    }
  })

  it('refuses to score when an expected partial is missing', () => {
    writeFixture(dir)
    rmSync(join(dir, 'partials', cellPartialName('angry', 'strong', 'held-only')))

    expect(() => aggregateEmotion(context(dir), emotionGate, selection)).toThrow(cellPartialName('angry', 'strong', 'held-only'))
  })
})

describe('gate selection', () => {
  it('expects a long-hold partial only for clear and strong bands', () => {
    const names = expectedEmotionPartials({ emotions: ['sad'], bands: ['slight', 'strong'], seedsLimit: null })

    expect(names).toContain(cellPartialName('sad', 'strong', 'long-hold'))
    expect(names).not.toContain(cellPartialName('sad', 'slight', 'long-hold'))
    expect(names).toContain(nullPartialName)
  })

  it('cuts the committed seed ranges to the limit and never extends them', () => {
    expect(seedRange({ start: 1, count: 100 }, null)).toEqual({ start: 1, count: 100 })
    expect(seedRange({ start: 1, count: 30 }, 10)).toEqual({ start: 1, count: 10 })
    expect(seedRange({ start: 1, count: 30 }, 500)).toEqual({ start: 1, count: 30 })
  })
})

describe('aggregateLiveliness', () => {
  it('refuses to score when a trace partial is missing', () => {
    mkdirSync(join(dir, 'partials'))
    writeFileSync(join(dir, 'partials', 'unrelated.json'), '{}')

    expect(() => aggregateLiveliness(context(dir), naturalIdleLivelinessGate)).toThrow('liveliness-trace-1.json')
  })
})
