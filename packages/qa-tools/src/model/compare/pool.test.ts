import type { RunScore } from '../score/aggregate'
import type { ServerMemory } from './pool'

import { describe, expect, it } from 'vitest'

import { poolRuns, renderCompareMarkdown } from './pool'

function score(model: string, config: string, overrides: Partial<RunScore> = {}): RunScore {
  const runKey = `set@1/${model}/${config}`
  return {
    schema: 'airi.cue-contract-score.run/v1',
    scorer: { id: 'cue-contract-score', version: 1, fileSha: 'hash' },
    sources: { closureDigest: 'closure-hash', files: [], coreAgentDistSha256: 'dist-hash' },
    fixtures: { id: 'cue-contract-fixtures', version: 1, passed: 25, total: 25 },
    set: 'set',
    runKey,
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
    actionsAccepted: 7,
    actionsUnknown: 8,
    actionToolCalls: 9,
    actionToolUnknown: 10,
    nonverbal: { gestures: 11, gesturesDropped: 12, bareGestureAttempts: 13, breaks: 14, breaksIgnored: 15, silentMarkers: 16, wordless: 17, silentNoCue: 18, asciiFaces: 19 },
    delay: { valid: 2, count: 3 },
    call: { valid: 1, count: 4 },
    stripped: 2,
    stageRejected: 3,
    unknownMarkers: [['LOOK', 3], ['OTHER', 2], ['X', 1], ['hidden', 1]],
    residualReplies: 1,
    chunkVariant: 2,
    style: { emoji: 1, stageDirection: 2, firstLetterLower: 1, personaFace: 2, aiBreak: 1, exampleEcho: 2, meanWords: 12.5 },
    timing: { replies: 2, meanTtftMs: 100, meanTotalMs: 2000, genTps: 30, coldTtftMs: 4000, warmTtftMs: 250, warmFirstSpeechMs: 900, decodeTps: 12.5, meanPromptTokens: 1200 },
    model,
    config,
    ...overrides,
  }
}

const none = { servers: new Map(), checks: new Map() }

describe('poolRuns', () => {
  it('pools the seeds and stages of one setup into one row, and keeps other setups apart', () => {
    const rows = poolRuns([
      score('small', 'seed-1@stranger'),
      score('small', 'seed-2@close'),
      score('small', 'seed-1+app-hiyori'),
    ], none)

    expect(rows.map(row => [row.contender, row.runs, row.replies])).toEqual([['small · default', 2, 10], ['small · default+app-hiyori', 1, 5]])
  })

  it('sums cue outcomes into shares of the spoken replies and weighs timing by timed replies', () => {
    const [row] = poolRuns([
      score('small', 'seed-1', { outcomes: { parsed: 3, recovered: 1, rejected: 0, none: 0 }, leadCue: 2, timing: { replies: 4, meanTtftMs: 0, meanTotalMs: 0, genTps: null, coldTtftMs: 1000, warmTtftMs: 200, warmFirstSpeechMs: 300, decodeTps: 20, meanPromptTokens: 1000 } }),
      score('small', 'seed-2', { outcomes: { parsed: 0, recovered: 0, rejected: 4, none: 0 }, leadCue: 2, timing: { replies: 2, meanTtftMs: 0, meanTotalMs: 0, genTps: null, coldTtftMs: 3000, warmTtftMs: 500, warmFirstSpeechMs: null, decodeTps: 10, meanPromptTokens: 2000 } }),
    ], none)

    expect(row!.cue).toEqual({ parsed: 3 / 8, recovered: 1 / 8, rejected: 4 / 8, none: 0, leadCue: 4 / 8 })
    expect(row!.timing.coldTtftMs).toBe(2000)
    expect(row!.timing.warmTtftMs).toBeCloseTo((200 * 3 + 500 * 1) / 4)
    expect(row!.timing.warmFirstSpeechMs).toBe(300)
    expect(row!.timing.decodeTps).toBeCloseTo((20 * 4 + 10 * 2) / 6)
  })

  it('counts recall checks and prefers the server log\'s buffers to /api/ps', () => {
    const logged = { loaded: { size: 0.5 * 2 ** 30, sizeVram: 0.5 * 2 ** 30, contextLength: 16384 }, load: { gpuWeightsMiB: 2048, cpuWeightsMiB: 1024, gpuCacheMiB: 512, gpuComputeMiB: 512, contextLength: 16384 } }
    const reported = { loaded: { size: 2 ** 30, sizeVram: 2 ** 30, contextLength: 8192 }, load: null }
    const a = score('small', 'seed-1')
    const b = score('small', 'seed-2')
    const [row] = poolRuns([a, b], {
      servers: new Map<string, ServerMemory>([[a.runKey, logged], [b.runKey, reported]]),
      checks: new Map([[a.runKey, [{ turn: 3, any: ['x'], passed: true }, { turn: 4, any: ['y'], passed: false }]], [b.runKey, [{ turn: 3, any: ['x'], passed: null }]]]),
    })

    expect(row!.recall).toEqual({ passed: 1, total: 3 })
    expect(row!.memory).toEqual({ gpuGiB: 3, cpuWeightsGiB: 1, contextLength: 16384, source: 'server-log' })
  })
})

describe('renderCompareMarkdown', () => {
  it('keeps each row on one line, marks log-measured memory, and states the contract', () => {
    const rows = poolRuns([score('small', 'seed-1', { unknownMarkers: [['<|look:\nyou|>', 2]] })], none)
    const text = renderCompareMarkdown(rows, { contractVersions: ['0922aabf01ac'], scorer: 'cue-contract-score@5' })
    const line = text.split('\n').find(row => row.startsWith('| small'))!

    expect(text).toContain('contract 0922aabf01ac')
    expect(line).toContain('<&#124;look: you&#124;>: 2')
    expect(line.split(' | ')).toHaveLength(25)
  })
})
