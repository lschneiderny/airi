import type { MindIntent, MindRandom, MindState, MindStimulus } from './types'

import { touchAffect } from '@proj-airi/stage-shared/expression-performance'
import { reactionPolicy, settleReaction } from '@proj-airi/stage-shared/situation'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * One touch gets one response, decided together on the same state and clock:
 * - Posture: every touch gets a touch reaction, a poke at its point or a pet that starts or ends.
 * - Mood: `touchAffect` paces and habituates the dose, in seconds.
 * - Face: a poke and a finished pet are moments.
 * - Voice: for a poke or a finished pet with a voice view, `reactionPolicy` decides whether she says a line. The
 *   decision is kept either way. Without a view nobody could speak the line, so the voice state is untouched.
 */
export function answerTouch(state: MindState, stimulus: Stimulus<'touch'>, cause: number, nowMs: number, rng: MindRandom): Answer {
  const intents: MindIntent[] = []
  if (stimulus.gesture === 'poke')
    intents.push({ id: `${cause}-touch-reaction`, cause, channel: 'posture', kind: 'touch-reaction', gesture: 'poke', region: stimulus.region, point: stimulus.point })
  else
    intents.push({ id: `${cause}-touch-reaction`, cause, channel: 'posture', kind: 'touch-reaction', gesture: 'pet', phase: stimulus.gesture === 'pet-start' ? 'start' : 'end' })

  const affect = touchAffect(state.touch.affect, {
    touch: stimulus.gesture,
    region: stimulus.region,
    durationSeconds: stimulus.gesture === 'pet-end' ? stimulus.durationMs / 1000 : undefined,
    at: nowMs / 1000,
  }, stimulus.settings)
  if (affect.dose)
    intents.push({ id: `${cause}-mood`, cause, channel: 'posture', kind: 'mood', dose: affect.dose })

  let { voice } = state
  if (stimulus.gesture !== 'pet-start') {
    intents.push({ id: `${cause}-moment`, cause, channel: 'face', kind: 'moment', moment: stimulus.gesture === 'poke' ? 'poked' : 'petted' })
    if (stimulus.voice) {
      const { decision, memory } = reactionPolicy({ nowMs, gesture: stimulus.gesture === 'poke' ? 'poke' : 'pet', view: stimulus.voice }, voice.reaction, rng)
      voice = { reaction: memory, lastDecision: decision }
      if (decision.speak)
        intents.push({ id: `${cause}-speak`, cause, channel: 'voice', kind: 'speak', line: decision.kind, eventId: decision.eventId })
    }
  }

  return { state: { ...state, touch: { affect: affect.memory }, voice }, intents }
}

/**
 * Settles the pending line when the outcome is its own. A spoken line always starts the refractory, also when its
 * attempt is no longer pending (it expired, or a newer attempt replaced it); a newer attempt stays pending for its
 * own outcome. Any other outcome of a line that is not pending changes nothing.
 */
export function answerVoiceOutcome(state: MindState, stimulus: Stimulus<'voice-outcome'>, nowMs: number): Answer {
  const memory = state.voice.reaction
  let reaction = memory
  if (memory.pending?.eventId === stimulus.eventId)
    reaction = settleReaction(memory, stimulus.outcome, nowMs)
  else if (stimulus.outcome === 'spoken')
    reaction = { ...memory, lastLineAtMs: nowMs }

  return { state: reaction === memory ? state : { ...state, voice: { ...state.voice, reaction } }, intents: [] }
}
