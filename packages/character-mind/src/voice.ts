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
function gateInput(view: VoiceView, nowMs: number, forceTiming: boolean): UrgeGateInput {
  return {
    nowMs,
    situation: view.situation,
    reasons: view.threads,
    local: view.local,
    sessionId: view.sessionId,
    heldTopics: new Set(view.heldTopics),
    signals: view.signals,
    settings: view.settings,
    moodFactor: view.moodFactor,
    forceTiming,
  }
}

/**
 * One gate tick. A new run restores the gate memory, and the next shown tick eases her in. The gate skips while a
 * line of the mind or another unprompted turn is open; otherwise a fire yields one `speak` with a reach-out line,
 * which occupies the line slot until its outcome.
 */
export function answerVoiceTick(state: MindState, stimulus: Stimulus<'voice-tick'>, cause: number, nowMs: number, random: MindRandom): Answer {
  const { view } = stimulus
  let voice: MindVoiceState = state.voice
  if (voice.runId !== view.run.id || voice.gate === null)
    voice = { ...voice, runId: view.run.id, gate: restoreGate(view, nowMs, random), stageShown: false }

  if (voice.line !== null || view.unpromptedPending)
    return { state: { ...state, voice }, intents: [] }

  let gate = voice.gate!
  // A stage that comes back on screen eases in again, like a new leader, instead of speaking at once.
  const stageShown = view.signals.stageVisible && view.signals.desktopFresh
  if (stageShown && !voice.stageShown)
    gate = visibilityRegainUrgeMemory(gate, nowMs)

  const { decision, memory } = evaluateUrgeGate(gateInput(view, nowMs, stimulus.forceTiming), gate, random)
  voice = { ...voice, gate: memory, stageShown, lastGate: decision }
  if (!decision.fire)
    return { state: { ...state, voice }, intents: [] }

  // Unique among this mind's lines; the time keeps it apart from the lines of an earlier mind in the same run.
  const turnId = `reach-out:${nowMs}-${cause}`
  const line: VoiceLineState = {
    turnId,
    kind: 'reach-out',
    before: { lastFireAtMs: gate.lastFireAtMs, fires: gate.fires, pending: gate.pending, urge: gate.urge, urgeThreshold: gate.urgeThreshold, doubleText: gate.doubleText },
  }
  return {
    state: { ...state, voice: { ...voice, line } },
    intents: [{
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

/** A forced widget or plugin turn spoke: it starts the floor but never counts as an unanswered opening. */
export function answerExternalSpeech(state: MindState, stimulus: Stimulus<'external-speech'>): Answer {
  const { gate } = state.voice
  return { state: gate ? { ...state, voice: { ...state.voice, gate: recordExternalSpeech(gate, stimulus.atMs) } } : state, intents: [] }
}
