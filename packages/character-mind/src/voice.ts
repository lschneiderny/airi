import type { UrgeGateInput, UrgeGateMemory } from '@proj-airi/stage-shared/situation'

import type { MindIntent, MindRandom, MindState, MindStimulus, MindVoiceState, VoiceLineState, VoiceView } from './types'

import {
  evaluateUrgeGate,
  promotionUrgeMemory,
  recordExternalSpeech,
  recordUrgeFireOutcome,
  recordUrgeUserTurn,
  restoreSocialMemory,
  settleReaction,
  visibilityRegainUrgeMemory,
} from '@proj-airi/stage-shared/situation'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/** The turn id of a touch line: the situation names the line by its touch event. */
const REACTION_TURN_PREFIX = 'reaction:'

/** How long a widget request may wait for a quiet moment before the mind drops it. */
export const WIDGET_START_WAIT_MS = 20_000
/** Taken off the caller's wait for a widget line, for the bridge round trip of its cancel. */
export const WIDGET_DEADLINE_MARGIN_MS = 1_000

/** The turn id of the spoken touch reaction about the situation event `eventId`. */
export function reactionTurnId(eventId: string): string {
  return `${REACTION_TURN_PREFIX}${eventId}`
}

/** The gate memory of a run the mind has not seen: the store's mirror, else the saved social slice, else promotion alone. */
function restoreGate(view: VoiceView, nowMs: number, random: MindRandom): UrgeGateMemory {
  if (view.run.memory)
    // A mind that connects mid-run keeps the urge and the hourly cap. Its predecessor's fire has no outcome to wait for.
    return { ...view.run.memory, pending: null }
  const promoted = promotionUrgeMemory(nowMs, random)
  return view.run.saved ? restoreSocialMemory(promoted, view.run.saved, nowMs) : promoted
}

/** The gate's input from the store's view, field by field as the store's own gate tick built it. */
function gateInput(view: VoiceView, requests: MindVoiceState['requests'], nowMs: number, forceTiming: boolean): UrgeGateInput {
  return {
    nowMs,
    situation: view.situation,
    reasons: view.threads,
    local: view.local,
    sessionId: view.sessionId,
    // A waiting request's topic is the widget's to raise, so the gate never picks it.
    heldTopics: new Set(requests.map(({ request }) => request.topicKey)),
    signals: view.signals,
    settings: view.settings,
    moodFactor: view.moodFactor,
    forceTiming,
  }
}

/** She or the user is busy: no widget line starts. `userSpeaking: null` (cannot tell) counts as speaking. */
function busy(view: VoiceView, voice: MindVoiceState): boolean {
  const { signals } = view
  return signals.userSpeaking !== false || signals.userTyping || signals.characterSpeaking || signals.generating
    || signals.queued > 0 || view.unpromptedPending || voice.line !== null
}

/**
 * Widget deadlines, then the oldest waiting request when nobody is busy. A request past `startBy` yields `drop`, and
 * an open widget line past `speakBy` yields `cancel` and closes. The gate's hard holds never apply here.
 */
function serveRequests(voice: MindVoiceState, view: VoiceView, cause: number, nowMs: number): { voice: MindVoiceState, intents: MindIntent[] } {
  const intents: MindIntent[] = []
  let { line, requests } = voice
  if (line && line.speakBy !== null && nowMs >= line.speakBy) {
    intents.push({ id: `${cause}-cancel`, cause, channel: 'voice', kind: 'cancel', turnId: line.turnId })
    line = null
  }
  for (const { request } of requests.filter(({ startBy }) => nowMs >= startBy))
    intents.push({ id: `${cause}-drop-${request.turnId}`, cause, channel: 'voice', kind: 'drop', turnId: request.turnId })
  requests = requests.filter(({ startBy }) => nowMs < startBy)
  voice = { ...voice, line, requests }

  const [next, ...rest] = requests
  if (next === undefined || busy(view, voice))
    return { voice, intents }
  const { request } = next
  intents.push({
    id: `${cause}-speak`,
    cause,
    channel: 'voice',
    kind: 'speak',
    turnId: request.turnId,
    line: { kind: 'widget', topicKey: request.topicKey, topicText: request.topicText, supplement: request.supplement },
  })
  return { voice: { ...voice, requests: rest, line: { turnId: request.turnId, kind: 'widget', before: null, speakBy: next.speakBy } }, intents }
}

/** A widget or plugin request joins the queue and speaks at once when nobody is busy. */
export function answerVoiceRequest(state: MindState, stimulus: Stimulus<'voice-request'>, cause: number, nowMs: number): Answer {
  const { request, view } = stimulus
  const entry = { request, startBy: nowMs + WIDGET_START_WAIT_MS, speakBy: nowMs + request.timeoutMs - WIDGET_DEADLINE_MARGIN_MS }
  const { voice, intents } = serveRequests({ ...state.voice, requests: [...state.voice.requests, entry] }, view, cause, nowMs)
  return { state: { ...state, voice }, intents }
}

/** The earliest widget deadline (`startBy` of a waiting request, `speakBy` of an open line), or null without one. */
export function nextVoiceWakeAt(voice: MindVoiceState): number | null {
  const deadlines = [...voice.requests.map(({ startBy }) => startBy), ...(voice.line && voice.line.speakBy !== null ? [voice.line.speakBy] : [])]
  return deadlines.length > 0 ? Math.min(...deadlines) : null
}

/**
 * One gate tick. A new run restores the gate memory, and the next shown tick eases her in. Widget deadlines and
 * requests come first. The gate skips while a line of the mind, a waiting request, or another unprompted turn is
 * open; otherwise a fire yields one `speak` with a reach-out line, which occupies the line slot until its outcome.
 */
export function answerVoiceTick(state: MindState, stimulus: Stimulus<'voice-tick'>, cause: number, nowMs: number, random: MindRandom): Answer {
  const { view } = stimulus
  let voice: MindVoiceState = state.voice
  if (voice.runId !== view.run.id || voice.gate === null)
    voice = { ...voice, runId: view.run.id, gate: restoreGate(view, nowMs, random), stageShown: false }

  const served = serveRequests(voice, view, cause, nowMs)
  voice = served.voice
  if (voice.line !== null || voice.requests.length > 0 || view.unpromptedPending)
    return { state: { ...state, voice }, intents: served.intents }

  let gate = voice.gate!
  // A stage that comes back on screen eases in again, like a new leader, instead of speaking at once.
  const stageShown = view.signals.stageVisible && view.signals.desktopFresh
  if (stageShown && !voice.stageShown)
    gate = visibilityRegainUrgeMemory(gate, nowMs)

  const { decision, memory } = evaluateUrgeGate(gateInput(view, voice.requests, nowMs, stimulus.forceTiming), gate, random)
  voice = { ...voice, gate: memory, stageShown, lastGate: decision }
  if (!decision.fire)
    return { state: { ...state, voice }, intents: served.intents }

  // Unique among this mind's lines; the time keeps it apart from the lines of an earlier mind in the same run.
  const turnId = `reach-out:${nowMs}-${cause}`
  const line: VoiceLineState = {
    turnId,
    kind: 'reach-out',
    speakBy: null,
    before: { lastFireAtMs: gate.lastFireAtMs, fires: gate.fires, pending: gate.pending, urge: gate.urge, urgeThreshold: gate.urgeThreshold, doubleText: gate.doubleText },
  }
  return {
    state: { ...state, voice: { ...voice, line } },
    intents: [...served.intents, {
      id: `${cause}-speak`,
      cause,
      channel: 'voice',
      kind: 'speak',
      turnId,
      line: { kind: 'reach-out', topicKey: decision.picked.key, topicText: decision.picked.text, reason: { kind: decision.picked.kind, category: decision.category } },
    }],
  }
}

/**
 * Settles a line. A touch line (`reaction:<eventId>`) runs the touch rule: its pending attempt settles when the
 * outcome is its own, and a spoken one always starts the refractory, also when its attempt is no longer pending. A
 * spoken touch line also starts the gate's floor. A reach-out applies its outcome to the gate; `refused` restores
 * the gate fields of before the fire, whose draws stay spent. The line closes when the outcome is its own.
 */
export function answerVoiceOutcome(state: MindState, stimulus: Stimulus<'voice-outcome'>, nowMs: number): Answer {
  const { voice } = state
  const own = voice.line?.turnId === stimulus.turnId
  const line = own ? null : voice.line

  if (stimulus.turnId.startsWith(REACTION_TURN_PREFIX)) {
    const eventId = stimulus.turnId.slice(REACTION_TURN_PREFIX.length)
    let reaction = voice.reaction
    if (reaction.pending?.eventId === eventId)
      reaction = settleReaction(reaction, stimulus.outcome, nowMs)
    else if (stimulus.outcome === 'spoken')
      reaction = { ...reaction, lastLineAtMs: nowMs }
    const gate = stimulus.outcome === 'spoken' && voice.gate ? recordExternalSpeech(voice.gate, nowMs) : voice.gate
    if (reaction === voice.reaction && gate === voice.gate && line === voice.line)
      return { state, intents: [] }
    return { state: { ...state, voice: { ...voice, reaction, gate, line } }, intents: [] }
  }

  if (own && voice.line?.kind === 'widget') {
    // A spoken widget line starts the floor and never counts as an unanswered opening.
    const gate = stimulus.outcome === 'spoken' && voice.gate ? recordExternalSpeech(voice.gate, nowMs) : voice.gate
    return { state: { ...state, voice: { ...voice, gate, line } }, intents: [] }
  }

  if (!own || voice.line?.kind !== 'reach-out' || voice.gate === null)
    return { state, intents: [] }
  const { before } = voice.line
  const gate = stimulus.outcome === 'refused'
    ? (before ? { ...voice.gate, ...before } : voice.gate)
    : recordUrgeFireOutcome(voice.gate, stimulus.outcome, nowMs)
  return { state: { ...state, voice: { ...voice, gate, line } }, intents: [] }
}

/** The user's own turn turns unanswered openings into damping and clears the reply clock and an armed double text. */
export function answerUserTurn(state: MindState, stimulus: Stimulus<'user-turn'>): Answer {
  const { gate } = state.voice
  return { state: gate ? { ...state, voice: { ...state.voice, gate: recordUrgeUserTurn(gate, stimulus.atMs) } } : state, intents: [] }
}
