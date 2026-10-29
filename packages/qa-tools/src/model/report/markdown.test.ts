import type { RunScore } from '../score/aggregate'

import { describe, expect, it } from 'vitest'

import { renderSummaryMarkdown } from './markdown'

function run(runKey = 'b'): RunScore {
  return {
    schema: 'airi.cue-contract-score.run/v1',
    scorer: { id: 'cue-contract-score', version: 1, fileSha: 'hash' },
    sources: { closureDigest: 'closure-hash', files: [], coreAgentDistSha256: 'dist-hash' },
    fixtures: { id: 'cue-contract-fixtures', version: 1, passed: 25, total: 25 },
    set: 'set',
    runKey,
    model: 'model',
    config: 'defaults',
    prompt: { sha256: 'prompt', contractVersion: 'contract' },
    replies: 5,
    declined: 1,
    errors: 1,
    blank: 1,
    toolNoSpeech: 1,
    outcomes: { parsed: 1, recovered: 1, rejected: 0, none: 0 },
    leadCue: 1,
    acts: 6,
    actsInert: 2,
    invalidEmotion: 4,
    inventedEmotions: [['pouting', 3], ['zany', 2], ['alien', 1], ['fourth', 1]],
    forms: { bare: 1, colon: 2, json: 3 },
    intensity: { slight: 1, clear: 2, strong: 3, number: 4, none: 5, unrecognized: 6 },
    fields: { expression: 2, motion: 3, look: 4, lookDropped: 5, placeholderEcho: 6 },
    delay: { valid: 2, count: 3 },
    call: { valid: 1, count: 4 },
    stripped: 2,
    stageRejected: 3,
    unknownMarkers: [['LOOK', 3], ['OTHER', 2], ['X', 1], ['hidden', 1]],
    residualReplies: 1,
    chunkVariant: 2,
    style: { emoji: 1, stageDirection: 2, firstLetterLower: 1, personaFace: 2, aiBreak: 1, exampleEcho: 2, meanWords: 12.5 },
    timing: { replies: 2, meanTtftMs: 100, meanTotalMs: 2000, genTps: 30 },
  }
}

describe('renderSummaryMarkdown', () => {
  it('renders concrete cells in contract, heuristic, and timing column order deterministically', () => {
    const runs = [run('b'), { ...run('a'), model: 'first' }]
    const text = renderSummaryMarkdown(runs)
    const lines = text.split('\n')
    const columns = '| Model | Config | replies | errors | blank | toolNoSpeech | parsed% | recovered% | rejected% | none% | leadCue% | acts | actsInert | invalidEmotion | inventedEmotions | forms b/c/j | intensity s/c/st/n/-/? | fields e/m/l/ld/pe | delay valid/count | call valid/count | stripped | stageRejected | unknownMarkers | chunkVariant | emoji | stageDir | firstLower% | personaFace% | aiBreak | exampleEcho | meanWords | timing replies | meanTtftMs | meanTotalMs | genTps |'
    expect(lines).toContain(columns)
    expect(text).toContain('**Contract**')
    expect(text).toContain('**Heuristic**')
    expect(text).toContain('**Timing**')
    expect(text.indexOf('**Contract**')).toBeLessThan(text.indexOf('**Heuristic**'))
    expect(text.indexOf('**Heuristic**')).toBeLessThan(text.indexOf('**Timing**'))
    expect(lines).toContain('| model | defaults | 5 | 1 | 1 | 1 | 50% | 50% | 0% | 0% | 50% | 6 | 2 | 4 | pouting: 3, zany: 2, alien: 1 | 1/2/3 | 1/2/3/4/5/6 | 2/3/4/5/6 | 2/3 | 1/4 | 2 | 3 | LOOK: 3, OTHER: 2, X: 1 | 2 | 1 | 2 | 50% | 100% | 1 | 2 | 12.5 | 2 | 100 | 2000 | 30 |')
    expect(text.indexOf('| first |')).toBeLessThan(text.indexOf('| model |'))
    expect(text).toContain('closure-hash')
    expect(text).toContain('25/25')
    expect(text).not.toContain('fourth')
    expect(text).not.toContain('hidden')
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i)
    expect(renderSummaryMarkdown(runs)).toBe(text)
    expect(runs[0].runKey).toBe('b')
  })

  it('renders only the header for empty input and omits absent timing', () => {
    const empty = renderSummaryMarkdown([])
    expect(empty).toContain('# Model evaluation summary')
    expect(empty).not.toContain('|')
    expect(empty).toContain('Heuristic columns are not persona judgment.')
    const text = renderSummaryMarkdown([{ ...run(), timing: null }])
    expect(text).not.toContain('**Timing**')
    expect(text).not.toContain('meanTtftMs')
  })

  it('escapes hostile table text and keeps one physical line per row', () => {
    const hostile = 'm|`name`\nnext'
    const text = renderSummaryMarkdown([{
      ...run(),
      model: hostile,
      config: hostile,
      set: hostile,
      inventedEmotions: [[hostile, 1]],
      unknownMarkers: [['<|LOOK screen|>', 2]],
    }])
    const line = text.split('\n').find(row => row.startsWith('| m&#124;'))!
    expect(line).toBeDefined()
    expect(line).toContain('m&#124;&#96;name&#96;<br>next')
    expect(line).toContain('&lt;&#124;LOOK screen&#124;&gt;: 2')
    expect(line.split('|')).toHaveLength(37)
  })

  it('renders all-declined rates as zero without division by zero and separates sets', () => {
    const empty = {
      ...run('a'),
      timing: null,
      replies: 1,
      declined: 1,
      outcomes: { parsed: 0, recovered: 0, rejected: 0, none: 0 },
      leadCue: 0,
    }
    const text = renderSummaryMarkdown([empty, { ...run('z'), set: 'other', timing: null }])
    expect(text).toContain('0% | 0% | 0% | 0% | 0%')
    expect(text).not.toMatch(/NaN|Infinity/)
    expect(text.match(/^## /gm)).toHaveLength(2)
  })
})
