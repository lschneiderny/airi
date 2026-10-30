import type { CueComplianceOutcome, ReplyReplay } from '@proj-airi/core-agent'
import type { StreamingControlEmotion, StreamingControlLook } from '@proj-airi/pipelines-audio'

import type { ReplyScorer } from './scorer'

import { createStreamingCategorizer, cueComplianceOutcome, replayReply, useLlmmarkerParser } from '@proj-airi/core-agent'
import { createStreamingControlParser, normalizeActPayload, tokenAct } from '@proj-airi/pipelines-audio'

export const CUE_CONTRACT_SCORER = { id: 'cue-contract-score', version: 2 } as const
const REJECTED_TOKENS_MAX = 5

export interface ReplyScore {
  schema: 'airi.cue-contract-score.reply/v1'
  chunkInvariant: boolean
  cueStats: { act: number, recovered: number, stripped: number }
  stageRejected: number
  stageRejectedTokens: string[]
  outcome: CueComplianceOutcome
  leadCue: boolean
  acts: {
    form: 'bare' | 'colon' | 'json'
    recoveredFrom: '<' | '[' | null
    stageParsed: boolean
    emotion: StreamingControlEmotion | null
    emotionWritten: string | null
    intensity: { kind: 'band', band: 'slight' | 'clear' | 'strong' } | { kind: 'number' } | { kind: 'none' } | { kind: 'unrecognized-string' }
    expression: string | null
    motion: string | null
    look: StreamingControlLook | null
    lookDropped: boolean
    inert: boolean
    placeholderEcho: string[]
  }[]
  delay: { count: number, valid: number }
  call: { count: number, valid: number }
  stickerMarkers: number
  unknownMarkers: string[]
  residualChars: number
  spokenText: string
  storedSpeech: string | null
  blank: boolean
  toolCallsWithoutSpeech: boolean
}

function projection(replay: ReplyReplay) {
  return JSON.stringify({
    specials: replay.specials,
    cueStats: replay.cueStats,
    speech: replay.speech,
    literals: replay.literals.join('').replace(/\s+/g, ''),
  })
}

export const cueContractScorer: ReplyScorer<ReplyScore> = {
  ...CUE_CONTRACT_SCORER,
  async score(record) {
    const input = {
      text: record.reply.text,
      thinkingText: record.reply.thinkingText,
      origin: record.conversation.origin,
      stickers: record.stickers,
    }
    const whole = await replayReply({ ...input, chunks: 'whole' })
    const perChar = await replayReply({ ...input, chunks: 'per-char' })

    // The diagnostic parser retains residual text in onEnd, but never emits it as a literal.
    // Recovered tokens are absent from onEnd, so only native specials enter its length balance.
    let diagnosticText = ''
    let diagnosticLiterals = 0
    let diagnosticSpecials = 0
    let stickerMarkers = 0
    const controller = createStreamingControlParser()
    const runtimeOnlyMarkers = new Set<string>()
    const recoveries = new Map<string, Array<'<' | '[' | null>>()
    const categorizer = createStreamingCategorizer('replay')
    const consumeLiteral = (value: string) => {
      const position = categorizer.getCurrentPosition()
      categorizer.consume(value)
      categorizer.filterToSpeech(value, position)
    }
    const diagnostic = useLlmmarkerParser({
      minLiteralEmitLength: 1,
      recoverCueNames: ['ACT', 'DELAY'],
      onLiteral: (value) => {
        diagnosticLiterals += value.length
        consumeLiteral(value)
      },
      onSpecial: async (value, recovery) => {
        if (recovery) {
          // Match runtime literal/categorizer ordering while this direct `useLlmmarkerParser` diagnostic parse (mirroring the runtime's options, used for `residualChars`) accepts all recoveries.
          // The isolated replay decides whether this parser-provided raw cue is emitted, stripped, or prose.
          if (!categorizer.filterToSpeech(recovery.raw, categorizer.getCurrentPosition())) {
            consumeLiteral(recovery.raw)
            return true
          }
          const recovered = await replayReply({ text: recovery.raw })
          if (recovered.specials.length === 0) {
            if (recovered.cueStats.rejected === 0)
              consumeLiteral(recovery.raw)
            return true
          }
        }
        else {
          diagnosticSpecials += value.length
          if (!controller.match(value)) {
            // User-origin routing consumes stickers. After visible speech, unprompted routing
            // additionally consumes SILENT without declining the turn or holding other specials.
            const user = await replayReply({ text: value })
            if (user.specials.length === 0) {
              stickerMarkers++
              runtimeOnlyMarkers.add(value)
            }
            else {
              const unprompted = await replayReply({ text: `speech ${value}`, origin: 'unprompted' })
              if (unprompted.specials.length === 0)
                runtimeOnlyMarkers.add(value)
            }
          }
        }
        const sources = recoveries.get(value) ?? []
        sources.push(recovery ? (recovery.raw.startsWith('[') ? '[' : '<') : null)
        recoveries.set(value, sources)
        return true
      },
      onEnd: (value) => { diagnosticText = value },
    })
    await diagnostic.consume(record.reply.text)
    await diagnostic.end()

    const actParser = tokenAct()
    const acts: ReplyScore['acts'] = []
    const delay = { count: 0, valid: 0 }
    const call = { count: 0, valid: 0 }
    const stageRejectedTokens: string[] = []
    const unknownMarkers: string[] = []
    const parsedActs = new Set<string>()
    let stageRejected = 0
    for (const special of whole.specials) {
      let stageParsed = false
      await controller.dispatchWith(special.value, {
        observer: (event) => {
          if (event.type !== 'parsed' && event.type !== 'rejected')
            return
          if (event.type === 'rejected') {
            stageRejected++
            if (stageRejectedTokens.length < REJECTED_TOKENS_MAX)
              stageRejectedTokens.push(special.value)
            if (event.reason === 'no-matching-parser' && !runtimeOnlyMarkers.has(special.value))
              unknownMarkers.push(special.value)
          }
          else {
            stageParsed = true
            if (event.parserName === 'ACT')
              parsedActs.add(special.value)
          }
          const counts = event.parserName === 'DELAY' ? delay : event.parserName === 'CALL' ? call : null
          if (counts) {
            counts.count++
            if (event.type === 'parsed')
              counts.valid++
          }
        },
      })
      if (!actParser.match(special.value))
        continue
      const recoveredFrom = recoveries.get(special.value)?.shift() ?? null
      const parsed = actParser.parse(special.value)
      const payload = parsed?.payload ?? {}
      const normalized = normalizeActPayload(payload)
      const body = special.value.slice(6, -2).trim()
      const form = special.value.startsWith('<|ACT:') ? 'colon' : body.startsWith('{') ? 'json' : 'bare'
      // Written values describe syntax, not validity; only the real parser and normalizer decide validity.
      const [bareEmotion, bareIntensity] = body.split(/\s+/)
      const writtenEmotion = payload.emotion
      const nestedEmotion = typeof writtenEmotion === 'object' && writtenEmotion !== null ? writtenEmotion : null
      const emotionWritten = typeof writtenEmotion === 'string'
        ? writtenEmotion
        : nestedEmotion && 'name' in nestedEmotion && typeof nestedEmotion.name === 'string'
          ? nestedEmotion.name
          : form !== 'json' && !body.startsWith('{') ? bareEmotion : null
      const intensity = nestedEmotion
        ? ('intensity' in nestedEmotion ? nestedEmotion.intensity : undefined)
        : payload.intensity ?? (form !== 'json' ? bareIntensity : undefined)
      let intensityScore: ReplyScore['acts'][number]['intensity'] = { kind: 'none' }
      if (typeof intensity === 'number') {
        intensityScore = { kind: 'number' }
      }
      else if (typeof intensity === 'string') {
        // Probe with a known emotion so an invented emotion cannot hide the intensity's syntax.
        const probe = actParser.parse(`<|ACT neutral ${intensity.trim()}|>`)?.payload.emotion
        const parsedIntensity = typeof probe === 'object' && probe !== null && 'intensity' in probe ? probe.intensity : undefined
        const band = typeof parsedIntensity === 'string' ? parsedIntensity.toLowerCase() : undefined
        if (band === 'slight' || band === 'clear' || band === 'strong') {
          intensityScore = { kind: 'band', band }
        }
        else {
          // JSON intensity strings use numeric coercion, not the bare ACT grammar. Pass the
          // coerced value through the public JSON parser; non-finite values do not parse.
          const numeric = form === 'json' && intensity.trim() !== ''
            ? actParser.parse(`<|ACT {"intensity":${Number(intensity)}}|>`)?.payload.intensity
            : parsedIntensity
          intensityScore = typeof numeric === 'number' ? { kind: 'number' } : { kind: 'unrecognized-string' }
        }
      }
      acts.push({
        form,
        recoveredFrom,
        stageParsed,
        emotion: normalized.emotion?.name ?? null,
        emotionWritten,
        intensity: intensityScore,
        expression: normalized.expression ?? null,
        motion: normalized.motion ?? null,
        look: normalized.look ?? null,
        lookDropped: payload.look !== undefined && normalized.look === undefined,
        inert: stageParsed && Object.keys(normalized).length === 0,
        placeholderEcho: Object.entries(payload).filter(([, value]) => typeof value === 'string' && /^<[^<>]+>$/.test(value)).map(([field]) => field),
      })
    }
    const first = whole.events.find(event => event.kind === 'special' || event.value.trim() !== '')
    const cueStats = { act: whole.cueStats.act, recovered: whole.cueStats.recovered, stripped: whole.cueStats.rejected }
    const spokenText = whole.literals.join('')
    const noSpeech = spokenText.trim() === ''
    return {
      schema: 'airi.cue-contract-score.reply/v1',
      chunkInvariant: projection(whole) === projection(perChar),
      cueStats,
      stageRejected,
      stageRejectedTokens,
      outcome: cueComplianceOutcome({ ...cueStats, rejected: stageRejected }),
      leadCue: first?.kind === 'special' && parsedActs.has(first.value),
      acts,
      delay,
      call,
      stickerMarkers,
      unknownMarkers,
      residualChars: diagnosticText.length - diagnosticLiterals - diagnosticSpecials,
      spokenText,
      storedSpeech: whole.speech ?? null,
      blank: noSpeech && record.reply.toolCalls.length === 0,
      toolCallsWithoutSpeech: noSpeech && record.reply.toolCalls.length > 0,
    }
  },
}
