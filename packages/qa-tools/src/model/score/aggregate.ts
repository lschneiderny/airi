import type { ClosureEntry } from '../../motion/cache/closure'
import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { ReplyScore } from './cue-contract'
import type { StyleScore } from './style'

import { normalizeActPayload } from '@proj-airi/pipelines-audio'

import { legacyScoreReplies } from './legacy-score'

export interface RunScore {
  schema: 'airi.cue-contract-score.run/v1'
  scorer: { id: string, version: number, fileSha: string }
  sources: { closureDigest: string, files: ClosureEntry[], coreAgentDistSha256: string }
  fixtures: { id: string, version: number, passed: number, total: number }
  set: string
  runKey: string
  model: string
  config: string
  prompt: { sha256: string | null, contractVersion: string | null }
  replies: number
  declined: number
  errors: number
  blank: number
  toolNoSpeech: number
  /** Counts over non-declined replies with spoken text; their sum is the rate denominator. */
  outcomes: { parsed: number, recovered: number, rejected: number, none: number }
  leadCue: number
  acts: number
  actsInert: number
  invalidEmotion: number
  inventedEmotions: [name: string, count: number][]
  forms: { bare: number, colon: number, json: number }
  intensity: { slight: number, clear: number, strong: number, number: number, none: number, unrecognized: number }
  fields: { expression: number, motion: number, look: number, lookDropped: number, placeholderEcho: number }
  /** ACT action labels that are exposed gestures or not exposed at all; both stay 0 unless the run supplied an exposed set. */
  actionsAccepted: number
  actionsUnknown: number
  /** `perform_action` calls, and those outside the exposed actions and dances. */
  actionToolCalls: number
  actionToolUnknown: number
  /**
   * Nonverbal-channel use, summed over every reply of the run.
   * `gestures` counts ACTs with a normalized gesture, `gesturesDropped` written gestures the normalizer refused, and
   * `silentMarkers` SILENT markers in visible speech. `wordless` and `silentNoCue` count replies.
   */
  nonverbal: {
    gestures: number
    gesturesDropped: number
    bareGestureAttempts: number
    breaks: number
    breaksIgnored: number
    silentMarkers: number
    wordless: number
    silentNoCue: number
    asciiFaces: number
  }
  delay: { count: number, valid: number }
  call: { count: number, valid: number }
  stripped: number
  stageRejected: number
  unknownMarkers: [name: string, count: number][]
  residualReplies: number
  chunkVariant: number
  style: {
    emoji: number
    stageDirection: number
    firstLetterLower: number
    personaFace: number
    aiBreak: number
    exampleEcho: number
    meanWords: number
  }
  timing: {
    replies: number
    meanTtftMs: number | null
    meanTotalMs: number | null
    /** Generation speed from the endpoint's own evaluation duration. Only imported Ollama-native records carry it. */
    genTps: number | null
    /** Mean time to first token of a conversation's first turn: it includes loading the model and the whole prompt. */
    coldTtftMs: number | null
    /** Mean time to first token of later turns: low only when the server reuses the prompt cache of the previous turn. */
    warmTtftMs: number | null
    /** Client-measured decode speed: completion tokens over the time from the first token to the end of the stream. */
    decodeTps: number | null
    /** Mean `usage.prompt_tokens`, to compare with the server's context size and to spot truncation. */
    meanPromptTokens: number | null
  } | null
  legacy?: ReturnType<typeof legacyScoreReplies>
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function ranked(counts: Map<string, number>): [string, number][] {
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Scores are aligned to records by input index. Each runKey identifies one set/model/config/prompt.
 * The caller supplies measured provenance, never an environment-derived or invented identity.
 */
export function aggregateRun(
  records: readonly ReplyTranscriptRecord[],
  replyScores: readonly ReplyScore[],
  styleScores: readonly StyleScore[],
  provenance: Pick<RunScore, 'scorer' | 'sources' | 'fixtures'>,
): RunScore[] {
  const groups = new Map<string, number[]>()
  for (const [index, record] of records.entries()) {
    const group = groups.get(record.runKey) ?? []
    group.push(index)
    groups.set(record.runKey, group)
  }
  return [...groups.keys()].sort().map((runKey) => {
    const indices = groups.get(runKey)!
    const first = records[indices[0]]
    const run: RunScore = {
      schema: 'airi.cue-contract-score.run/v1',
      ...provenance,
      set: first.set,
      runKey,
      model: first.model.id,
      config: first.generation.config,
      prompt: { sha256: first.prompt.sha256, contractVersion: first.prompt.contractVersion },
      replies: indices.length,
      declined: 0,
      errors: 0,
      blank: 0,
      toolNoSpeech: 0,
      outcomes: { parsed: 0, recovered: 0, rejected: 0, none: 0 },
      leadCue: 0,
      acts: 0,
      actsInert: 0,
      invalidEmotion: 0,
      inventedEmotions: [],
      forms: { bare: 0, colon: 0, json: 0 },
      intensity: { slight: 0, clear: 0, strong: 0, number: 0, none: 0, unrecognized: 0 },
      fields: { expression: 0, motion: 0, look: 0, lookDropped: 0, placeholderEcho: 0 },
      actionsAccepted: 0,
      actionsUnknown: 0,
      actionToolCalls: 0,
      actionToolUnknown: 0,
      nonverbal: { gestures: 0, gesturesDropped: 0, bareGestureAttempts: 0, breaks: 0, breaksIgnored: 0, silentMarkers: 0, wordless: 0, silentNoCue: 0, asciiFaces: 0 },
      delay: { count: 0, valid: 0 },
      call: { count: 0, valid: 0 },
      stripped: 0,
      stageRejected: 0,
      unknownMarkers: [],
      residualReplies: 0,
      chunkVariant: 0,
      style: { emoji: 0, stageDirection: 0, firstLetterLower: 0, personaFace: 0, aiBreak: 0, exampleEcho: 0, meanWords: 0 },
      timing: null,
    }
    const invented = new Map<string, number>()
    const unknown = new Map<string, number>()
    const ttfts: number[] = []
    const coldTtfts: number[] = []
    const warmTtfts: number[] = []
    const totals: number[] = []
    const promptTokens: number[] = []
    let decodeTokens = 0
    let decodeMs = 0
    let timedReplies = 0
    let evalTokens = 0
    let evalMs = 0
    let words = 0
    let spoken = 0
    for (const index of indices) {
      const record = records[index]
      const cue = replyScores[index]
      const style = styleScores[index]
      // The runtime declines an unprompted turn when it stores no speech.
      const declined = record.conversation.origin === 'unprompted' && cue.storedSpeech === null
      run.declined += Number(declined)
      run.errors += Number(record.reply.error !== null)
      run.blank += Number(cue.blank)
      run.toolNoSpeech += Number(cue.toolCallsWithoutSpeech)
      if (!declined && cue.spokenText.trim()) {
        spoken++
        run.outcomes[cue.outcome]++
        run.leadCue += Number(cue.leadCue)
        run.style.emoji += Number(style.emoji)
        run.style.stageDirection += Number(style.stageDirection)
        run.style.firstLetterLower += Number(style.firstLetterLower)
        run.style.personaFace += Number(style.personaFace)
        run.style.aiBreak += Number(style.aiBreak)
        run.style.exampleEcho += Number(style.exampleEcho)
        words += style.words
      }
      run.acts += cue.cueStats.act
      run.stripped += cue.cueStats.stripped
      run.stageRejected += cue.stageRejected
      run.residualReplies += Number(cue.residualChars > 0)
      run.chunkVariant += Number(!cue.chunkInvariant)
      for (const act of cue.acts) {
        run.actsInert += Number(act.inert)
        // A rejected ACT can name a valid emotion but fail on its intensity or extra words.
        if (act.emotionWritten !== null && !normalizeActPayload({ emotion: act.emotionWritten }).emotion) {
          run.invalidEmotion++
          invented.set(act.emotionWritten, (invented.get(act.emotionWritten) ?? 0) + 1)
        }
        run.forms[act.form]++
        const intensity = act.intensity
        run.intensity[intensity.kind === 'band' ? intensity.band : intensity.kind === 'unrecognized-string' ? 'unrecognized' : intensity.kind]++
        run.fields.expression += Number(act.expression !== null)
        run.fields.motion += Number(act.motion !== null)
        run.fields.look += Number(act.look !== null)
        run.fields.lookDropped += Number(act.lookDropped)
        run.fields.placeholderEcho += act.placeholderEcho.length
        run.actionsAccepted += Number(act.actionDisposition === 'accepted')
        run.actionsUnknown += Number(act.actionDisposition === 'unknown')
        run.nonverbal.gestures += Number(act.gesture.kind !== null)
        run.nonverbal.gesturesDropped += Number(act.gesture.dropped)
      }
      run.nonverbal.bareGestureAttempts += cue.bareGestureAttempts
      run.nonverbal.breaks += cue.breaks
      run.nonverbal.breaksIgnored += cue.breaksIgnored
      run.nonverbal.silentMarkers += cue.silent.count
      run.nonverbal.wordless += Number(cue.wordless)
      run.nonverbal.silentNoCue += Number(cue.silentNoCue)
      run.nonverbal.asciiFaces += cue.asciiFaces
      run.actionToolCalls += cue.actionToolCalls
      run.actionToolUnknown += cue.actionToolUnknown
      run.delay.count += cue.delay.count
      run.delay.valid += cue.delay.valid
      run.call.count += cue.call.count
      run.call.valid += cue.call.valid
      for (const marker of cue.unknownMarkers)
        unknown.set(marker, (unknown.get(marker) ?? 0) + 1)
      const { ttftMs, totalMs } = record.timing
      if (ttftMs !== null) {
        ttfts.push(ttftMs)
        if (record.conversation.turn !== null)
          (record.conversation.turn === 1 ? coldTtfts : warmTtfts).push(ttftMs)
      }
      if (totalMs !== null)
        totals.push(totalMs)
      const completionTokens = record.usage?.completion_tokens
      // The first token's own time is in the TTFT, so the decode window holds the tokens after it.
      if (typeof completionTokens === 'number' && completionTokens > 1 && ttftMs !== null && totalMs !== null && totalMs > ttftMs) {
        decodeTokens += completionTokens - 1
        decodeMs += totalMs - ttftMs
      }
      if (typeof record.usage?.prompt_tokens === 'number')
        promptTokens.push(record.usage.prompt_tokens)
      const tokens = record.usage?.evalTokens
      const ms = record.usage?.evalMs
      const hasGeneration = typeof tokens === 'number' && typeof ms === 'number' && ms > 0
      if (hasGeneration) {
        evalTokens += tokens
        evalMs += ms
      }
      if (record.timing.ttftMs !== null || record.timing.totalMs !== null || hasGeneration)
        timedReplies++
    }
    run.inventedEmotions = ranked(invented)
    run.unknownMarkers = ranked(unknown)
    run.style.meanWords = spoken ? words / spoken : 0
    if (timedReplies) {
      run.timing = {
        replies: timedReplies,
        meanTtftMs: mean(ttfts),
        meanTotalMs: mean(totals),
        genTps: evalMs ? evalTokens / (evalMs / 1000) : null,
        coldTtftMs: mean(coldTtfts),
        warmTtftMs: mean(warmTtfts),
        decodeTps: decodeMs ? decodeTokens / (decodeMs / 1000) : null,
        meanPromptTokens: mean(promptTokens),
      }
    }
    run.legacy = legacyScoreReplies(indices.map(index => records[index]))
    return run
  })
}
