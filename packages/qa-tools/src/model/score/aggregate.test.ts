import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { ReplyScore } from './cue-contract'
import type { StyleScore } from './style'

import { describe, expect, it } from 'vitest'

import { aggregateRun } from './aggregate'
import { legacyScoreReplies } from './legacy-score'

const provenance = {
  scorer: { id: 'cue-contract-score', version: 1, fileSha: 'scorer-hash' },
  sources: { closureDigest: 'closure-hash', files: [{ repoPath: 'score.ts', sha256: 'source-hash' }], coreAgentDistSha256: 'dist-hash' },
  fixtures: { id: 'cue-contract-fixtures', version: 1, passed: 25, total: 25 },
}

function record(runKey = 'model/defaults'): ReplyTranscriptRecord {
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: 'reply',
    set: 'test-set',
    runKey,
    source: { kind: 'live', file: 'test', fileSha256: 'source', rowIndex: 0, path: 'reply' },
    model: { id: 'model', provider: 'test', digest: null, capabilities: [] },
    generation: { config: 'defaults', options: {}, think: false, withTools: false },
    prompt: { sha256: 'prompt-hash', shaSource: 'recorded', toolsSha256: null, contractVersion: 'contract' },
    machine: { label: 'test' },
    conversation: { kind: 'turn', turn: 0, user: 'hi', origin: 'user' },
    reply: { text: 'hello', thinkingText: '', toolCalls: [], finish: null, error: null, steps: null },
    timing: { ttftMs: null, totalMs: null },
    usage: null,
  }
}

function score(overrides: Partial<ReplyScore> = {}): ReplyScore {
  return {
    schema: 'airi.cue-contract-score.reply/v1',
    chunkInvariant: true,
    cueStats: { act: 0, recovered: 0, stripped: 0 },
    stageRejected: 0,
    stageRejectedTokens: [],
    outcome: 'none',
    leadCue: false,
    acts: [],
    bareGestureAttempts: 0,
    breaks: 0,
    breaksIgnored: 0,
    silent: { count: 0, beforeSpeech: false },
    wordless: false,
    silentNoCue: false,
    asciiFaces: 0,
    delay: { valid: 0, count: 0 },
    call: { valid: 0, count: 0 },
    mood: 0,
    stickerMarkers: 0,
    unknownMarkers: [],
    residualChars: 0,
    spokenText: 'hello',
    storedSpeech: 'hello',
    blank: false,
    toolCallsWithoutSpeech: false,
    actionToolCalls: 0,
    actionToolUnknown: 0,
    ...overrides,
  }
}

const style: StyleScore = {
  schema: 'airi.style-score.reply/v1',
  words: 4,
  emoji: true,
  stageDirection: true,
  firstLetterLower: true,
  personaFace: true,
  aiBreak: true,
  exampleEcho: true,
}

describe('aggregateRun', () => {
  it('aggregates every run field from aligned reply and style scores', () => {
    const first = record()
    first.timing = { ttftMs: 100, totalMs: 1000 }
    first.usage = { evalTokens: 20, evalMs: 500 }
    const second = record()
    second.reply.error = 'failed'
    second.timing = { ttftMs: null, totalMs: 3000 }
    second.usage = { evalTokens: 40, evalMs: 1500 }
    const act: ReplyScore['acts'][number] = {
      form: 'bare',
      recoveredFrom: null,
      stageParsed: true,
      emotion: null,
      emotionWritten: 'zany',
      intensity: { kind: 'band', band: 'strong' },
      expression: '<label>',
      motion: '<cue>',
      look: null,
      lookDropped: true,
      gesture: { kind: null, count: null, dropped: false },
      action: null,
      actionDisposition: null,
      inert: true,
      placeholderEcho: ['expression', 'motion'],
    }
    const scores = [
      score({
        cueStats: { act: 2, recovered: 1, stripped: 1 },
        outcome: 'recovered',
        leadCue: true,
        acts: [act, { ...act, form: 'json', emotionWritten: 'alien', intensity: { kind: 'number' }, inert: false }],
        delay: { valid: 1, count: 2 },
        call: { valid: 2, count: 3 },
        unknownMarkers: ['LOOK', 'LOOK'],
        residualChars: 2,
      }),
      score({
        cueStats: { act: 1, recovered: 0, stripped: 2 },
        stageRejected: 1,
        outcome: 'rejected',
        chunkInvariant: false,
        acts: [{ ...act, form: 'colon', emotion: 'happy', emotionWritten: 'happy', intensity: { kind: 'none' }, expression: null, motion: null, look: 'you', lookDropped: false, inert: false, placeholderEcho: [] }],
        unknownMarkers: ['OTHER'],
      }),
    ]
    expect(aggregateRun([first, second], scores, [style, { ...style, words: 8, emoji: false }], provenance)).toEqual([{
      schema: 'airi.cue-contract-score.run/v1',
      ...provenance,
      set: 'test-set',
      runKey: 'model/defaults',
      model: 'model',
      config: 'defaults',
      prompt: { sha256: 'prompt-hash', contractVersion: 'contract' },
      replies: 2,
      declined: 0,
      errors: 1,
      blank: 0,
      toolNoSpeech: 0,
      outcomes: { parsed: 0, recovered: 1, rejected: 1, none: 0 },
      leadCue: 1,
      acts: 3,
      actsInert: 1,
      invalidEmotion: 2,
      inventedEmotions: [['alien', 1], ['zany', 1]],
      forms: { bare: 1, colon: 1, json: 1 },
      intensity: { slight: 0, clear: 0, strong: 1, number: 1, none: 1, unrecognized: 0 },
      fields: { expression: 2, motion: 2, look: 1, lookDropped: 2, placeholderEcho: 4 },
      actionsAccepted: 0,
      actionsUnknown: 0,
      actionToolCalls: 0,
      actionToolUnknown: 0,
      nonverbal: { gestures: 0, gesturesDropped: 0, bareGestureAttempts: 0, breaks: 0, breaksIgnored: 0, silentMarkers: 0, wordless: 0, silentNoCue: 0, asciiFaces: 0 },
      delay: { valid: 1, count: 2 },
      call: { valid: 2, count: 3 },
      stripped: 3,
      stageRejected: 1,
      unknownMarkers: [['LOOK', 2], ['OTHER', 1]],
      residualReplies: 1,
      chunkVariant: 1,
      style: { emoji: 1, stageDirection: 2, firstLetterLower: 2, personaFace: 2, aiBreak: 2, exampleEcho: 2, meanWords: 6 },
      timing: { replies: 2, meanTtftMs: 100, meanTotalMs: 2000, genTps: 30 },
      legacy: legacyScoreReplies([first, second]),
    }])
  })

  it('excludes declined, blank, and tool-only speech from rates and style denominators', () => {
    const declined = record()
    declined.conversation.origin = 'unprompted'
    const silent = score({ storedSpeech: null, spokenText: '', blank: true })
    const tool = score({ storedSpeech: null, spokenText: '', toolCallsWithoutSpeech: true })
    const [run] = aggregateRun([record(), declined, record(), record()], [score(), silent, silent, tool], [style, style, style, style], provenance)
    expect(run).toMatchObject({
      replies: 4,
      declined: 1,
      blank: 2,
      toolNoSpeech: 1,
      outcomes: { parsed: 0, recovered: 0, rejected: 0, none: 1 },
      style: { emoji: 1, meanWords: 4 },
      timing: null,
    })
    expect(aggregateRun([declined], [silent], [style], provenance)[0]).toMatchObject({
      declined: 1,
      outcomes: { parsed: 0, recovered: 0, rejected: 0, none: 0 },
      style: { meanWords: 0 },
      acts: 0,
    })
  })

  it('groups and sorts by runKey without changing inputs', () => {
    const records = [record('z'), record('a'), record('z')]
    const before = JSON.stringify(records)
    const runs = aggregateRun(records, records.map(() => score()), records.map(() => style), provenance)
    expect(runs.map(run => [run.runKey, run.replies])).toEqual([['a', 1], ['z', 2]])
    expect(JSON.stringify(records)).toBe(before)
    expect(aggregateRun([], [], [], provenance)).toEqual([])
  })

  it('counts every intensity band and sorts invented emotions by frequency then name', () => {
    const act: ReplyScore['acts'][number] = {
      form: 'bare',
      recoveredFrom: null,
      stageParsed: false,
      emotion: null,
      emotionWritten: 'z',
      intensity: { kind: 'band', band: 'slight' },
      expression: null,
      motion: null,
      look: null,
      lookDropped: false,
      gesture: { kind: null, count: null, dropped: false },
      action: null,
      actionDisposition: null,
      inert: false,
      placeholderEcho: [],
    }
    const [run] = aggregateRun([record()], [score({ acts: [
      act,
      { ...act, emotionWritten: 'a', intensity: { kind: 'band', band: 'clear' } },
      { ...act, intensity: { kind: 'unrecognized-string' } },
    ] })], [style], provenance)
    expect(run.inventedEmotions).toEqual([['z', 2], ['a', 1]])
    expect(run.intensity).toEqual({ slight: 1, clear: 1, strong: 0, number: 0, none: 0, unrecognized: 1 })
  })

  it('does not label a valid emotion invented when another ACT field caused rejection', () => {
    const [run] = aggregateRun([record()], [score({
      acts: [{
        form: 'bare',
        recoveredFrom: null,
        stageParsed: false,
        emotion: null,
        emotionWritten: 'happy',
        intensity: { kind: 'unrecognized-string' },
        expression: null,
        motion: null,
        look: null,
        lookDropped: false,
        gesture: { kind: null, count: null, dropped: false },
        action: null,
        actionDisposition: null,
        inert: false,
        placeholderEcho: [],
      }],
    })], [style], provenance)
    expect(run.invalidEmotion).toBe(0)
    expect(run.inventedEmotions).toEqual([])
  })

  it('counts accepted and unknown ACT actions and perform_action calls, and ignores the rest', () => {
    const act: ReplyScore['acts'][number] = {
      form: 'json',
      recoveredFrom: null,
      stageParsed: true,
      emotion: 'happy',
      emotionWritten: 'happy',
      intensity: { kind: 'none' },
      expression: null,
      motion: null,
      look: null,
      lookDropped: false,
      gesture: { kind: null, count: null, dropped: false },
      action: 'wave',
      actionDisposition: 'accepted',
      inert: false,
      placeholderEcho: [],
    }
    const [run] = aggregateRun([record(), record()], [
      score({ acts: [act, { ...act, action: 'cartwheel', actionDisposition: 'unknown' }, { ...act, action: 'moonwalk', actionDisposition: 'not-gesture' }, { ...act, action: null, actionDisposition: null }], actionToolCalls: 3, actionToolUnknown: 1 }),
      score({ acts: [{ ...act, action: 'cartwheel', actionDisposition: 'unknown' }], actionToolCalls: 1, actionToolUnknown: 1 }),
    ], [style, style], provenance)

    expect(run).toMatchObject({ actionsAccepted: 1, actionsUnknown: 2, actionToolCalls: 4, actionToolUnknown: 2 })
  })

  it('totals nonverbal-channel use over every reply of the run', () => {
    const act: ReplyScore['acts'][number] = {
      form: 'json',
      recoveredFrom: null,
      stageParsed: true,
      emotion: null,
      emotionWritten: null,
      intensity: { kind: 'none' },
      expression: null,
      motion: null,
      look: null,
      lookDropped: false,
      gesture: { kind: 'nod', count: 2, dropped: false },
      action: null,
      actionDisposition: null,
      inert: false,
      placeholderEcho: [],
    }
    const [run] = aggregateRun([record(), record(), record()], [
      score({ acts: [act, { ...act, gesture: { kind: null, count: null, dropped: true } }, { ...act, gesture: { kind: null, count: null, dropped: false } }], bareGestureAttempts: 2, breaks: 2, breaksIgnored: 1, asciiFaces: 3 }),
      score({ acts: [act], storedSpeech: null, spokenText: '', silent: { count: 1, beforeSpeech: true }, wordless: true, breaks: 1 }),
      score({ storedSpeech: null, spokenText: '', silent: { count: 2, beforeSpeech: true }, silentNoCue: true, asciiFaces: 1 }),
    ], [style, style, style], provenance)

    expect(run.nonverbal).toEqual({ gestures: 2, gesturesDropped: 1, bareGestureAttempts: 2, breaks: 3, breaksIgnored: 1, silentMarkers: 3, wordless: 1, silentNoCue: 1, asciiFaces: 4 })
  })
})
