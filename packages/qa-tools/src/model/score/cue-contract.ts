import type { CueComplianceOutcome, ReplyReplay } from '@proj-airi/core-agent'
import type { StreamingControlEmotion, StreamingControlGestureKind, StreamingControlLook } from '@proj-airi/pipelines-audio'

import type { ReplyScorer, ScoreContext } from './scorer'

import { createStreamingCategorizer, cueComplianceOutcome, replayReply, useLlmmarkerParser } from '@proj-airi/core-agent'
import { createStreamingControlParser, normalizeActPayload, tokenAct } from '@proj-airi/pipelines-audio'
import { ASCII_FACES } from '@proj-airi/stage-shared/conversation-register'

export const CUE_CONTRACT_SCORER = { id: 'cue-contract-score', version: 4 } as const
const REJECTED_TOKENS_MAX = 5
/**
 * A native MOOD marker: `<|MOOD` followed by whitespace or the closing `|>`. The character-state layer consumes it,
 * so it is never a stage rejection. Its body is not validated here; `parseMoodCue` decides validity.
 */
const MOOD_MARKER = /^<\|MOOD(?:\s|\|>)/
// Longest first, so `^_^` is not counted as the shorter `^^`.
const facesLongestFirst = [...ASCII_FACES].sort((a, b) => b.length - a.length)

/**
 * Counts the faces the TTS face stripper would remove from `text`: a listed face that starts a
 * whitespace-separated word and is followed by the word end or one of `.,!?`.
 */
function countAsciiFaces(text: string): number {
  return text.split(/\s+/).filter(word => facesLongestFirst.some(face => word.startsWith(face) && (word.length === face.length || '.,!?'.includes(word[face.length])))).length
}

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
    /** The normalized gesture; `dropped` marks a written `gesture` the normalizer refused, with `kind` null. */
    gesture: { kind: StreamingControlGestureKind | null, count: number | null, dropped: boolean }
    /** The normalized `action` label of the ACT, or null when it wrote none. */
    action: string | null
    /**
     * Whether the label is an exposed gesture (`accepted`), an exposed action or dance that belongs on `perform_action`
     * (`not-gesture`), or not exposed (`unknown`). Null without an action, or when the score options carry no exposed set.
     */
    actionDisposition: 'accepted' | 'unknown' | 'not-gesture' | null
    inert: boolean
    placeholderEcho: string[]
  }[]
  /** Non-JSON ACT markers whose first word is a gesture kind (`<|ACT nod|>`). The stage rejects them, so they are not in `acts`. */
  bareGestureAttempts: number
  /** BREAK slices the runtime kept, and well-formed BREAK markers that split nothing. */
  breaks: number
  breaksIgnored: number
  /** SILENT markers in visible speech, and whether one came before any spoken text. */
  silent: { count: number, beforeSpeech: boolean }
  /** The runtime answered a user turn without words but with at least one ACT. */
  wordless: boolean
  /** The runtime answered a user turn with SILENT alone: no ACT and no words. */
  silentNoCue: boolean
  /** ASCII faces in the spoken text that speech output strips. */
  asciiFaces: number
  delay: { count: number, valid: number }
  call: { count: number, valid: number }
  /** Native MOOD markers, well-formed or not. Near-miss spellings such as `[MOOD ...]` stay prose and are not counted. */
  mood: number
  stickerMarkers: number
  unknownMarkers: string[]
  residualChars: number
  spokenText: string
  storedSpeech: string | null
  /** No speech, no SILENT before speech, and no tool call: the reply said nothing and did not decline. */
  blank: boolean
  toolCallsWithoutSpeech: boolean
  /** `perform_action` tool calls, and those whose label is not an exposed action or dance (and not `stop`). */
  actionToolCalls: number
  actionToolUnknown: number
}

/** The `perform_action` stop label ends the running performance, so it is never unknown. */
const ACTION_TOOL_STOP = 'stop'

/** Resolves an ACT action label against the exposed set. The label is data from the model and is only compared. */
function resolveActionDisposition(action: string | null, exposed: ScoreContext['exposedActions']): ReplyScore['acts'][number]['actionDisposition'] {
  if (action === null || exposed === undefined)
    return null
  const entry = exposed.find(candidate => candidate.label === action)
  return entry === undefined ? 'unknown' : entry.kind === 'gesture' ? 'accepted' : 'not-gesture'
}

/** Reads the `action` label of a `perform_action` call; arguments may be an object or a JSON string. */
function toolActionLabel(args: unknown): string | null {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null || !('action' in value))
    return null
  return typeof value.action === 'string' ? value.action : null
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
  async score(record, { stage, exposedActions }) {
    const input = {
      text: record.reply.text,
      stage,
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
    const silent = { count: 0, beforeSpeech: false }
    let speechSeen = false
    const controller = createStreamingControlParser()
    const runtimeOnlyMarkers = new Set<string>()
    const recoveries = new Map<string, Array<'<' | '[' | null>>()
    const categorizer = createStreamingCategorizer('replay')
    const consumeLiteral = (value: string) => {
      const position = categorizer.getCurrentPosition()
      categorizer.consume(value)
      if (categorizer.filterToSpeech(value, position).trim() !== '')
        speechSeen = true
    }
    const diagnostic = useLlmmarkerParser({
      minLiteralEmitLength: 1,
      recoverCueNames: stage.recoverCueNames,
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
          const recovered = await replayReply({ text: recovery.raw, stage })
          if (recovered.specials.length === 0) {
            if (recovered.cueStats.rejected === 0)
              consumeLiteral(recovery.raw)
            return true
          }
        }
        else {
          diagnosticSpecials += value.length
          if (!controller.match(value)) {
            // Runtime routing consumes stickers and, on every origin, the decline marker. A lone decline marker
            // answers a user turn as silent, which tells it apart from a sticker.
            const user = await replayReply({ text: value, stage })
            if (user.specials.length === 0) {
              runtimeOnlyMarkers.add(value)
              if (!user.cueStats.silent) {
                stickerMarkers++
              }
              else if (categorizer.filterToSpeech(value, categorizer.getCurrentPosition())) {
                silent.count++
                silent.beforeSpeech ||= !speechSeen
              }
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
    let bareGestureAttempts = 0
    let mood = 0
    for (const special of whole.specials) {
      if (MOOD_MARKER.test(special.value)) {
        mood++
        continue
      }
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
      // Gestures are JSON-only. Probe the first word through the public JSON parser, so the scorer keeps no kind list.
      if (form !== 'json' && !stageParsed && bareEmotion
        && normalizeActPayload(actParser.parse(`<|ACT {"gesture":${JSON.stringify(bareEmotion)}}|>`)?.payload ?? {}).gesture) {
        bareGestureAttempts++
        continue
      }
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
        gesture: {
          kind: normalized.gesture?.kind ?? null,
          count: normalized.gesture?.count ?? null,
          dropped: payload.gesture !== undefined && normalized.gesture === undefined,
        },
        action: normalized.action ?? null,
        actionDisposition: resolveActionDisposition(normalized.action ?? null, exposedActions),
        inert: stageParsed && Object.keys(normalized).length === 0,
        placeholderEcho: Object.entries(payload).filter(([, value]) => typeof value === 'string' && /^<[^<>]+>$/.test(value)).map(([field]) => field),
      })
    }
    const first = whole.events.find(event => event.kind === 'special' || event.value.trim() !== '')
    const cueStats = { act: whole.cueStats.act, recovered: whole.cueStats.recovered, stripped: whole.cueStats.rejected }
    const spokenText = whole.literals.join('')
    const noSpeech = spokenText.trim() === ''
    const actionCalls = record.reply.toolCalls.filter(toolCall => toolCall.name === 'perform_action')
    const actionToolUnknown = exposedActions === undefined
      ? 0
      : actionCalls.filter((toolCall) => {
        const label = toolActionLabel(toolCall.arguments)
        return label !== ACTION_TOOL_STOP && !exposedActions.some(entry => entry.label === label && entry.kind !== 'gesture')
      }).length
    return {
      schema: 'airi.cue-contract-score.reply/v1',
      chunkInvariant: projection(whole) === projection(perChar),
      cueStats,
      stageRejected,
      stageRejectedTokens,
      outcome: cueComplianceOutcome({ ...cueStats, rejected: stageRejected }),
      leadCue: first?.kind === 'special' && parsedActs.has(first.value),
      acts,
      bareGestureAttempts,
      breaks: whole.cueStats.breaks,
      breaksIgnored: whole.cueStats.breaksIgnored,
      silent,
      wordless: whole.cueStats.wordless,
      silentNoCue: whole.cueStats.silent,
      asciiFaces: countAsciiFaces(spokenText),
      delay,
      call,
      mood,
      stickerMarkers,
      unknownMarkers,
      residualChars: diagnosticText.length - diagnosticLiterals - diagnosticSpecials,
      spokenText,
      storedSpeech: whole.speech ?? null,
      blank: noSpeech && !silent.beforeSpeech && record.reply.toolCalls.length === 0,
      toolCallsWithoutSpeech: noSpeech && record.reply.toolCalls.length > 0,
      actionToolCalls: actionCalls.length,
      actionToolUnknown,
    }
  },
}
