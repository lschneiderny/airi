import type { MindIntent, MindRandom, MindState, MindStimulus, Refusal } from './types'

import { touchAffect } from '@proj-airi/stage-shared/expression-performance'
import { reactionPolicy } from '@proj-airi/stage-shared/situation'

import { attendIntent } from './attention'
import { refusedAnswer } from './capabilities'
import { reactionTurnId } from './voice'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[], refusals?: Refusal[] }

/**
 * One touch gets one response, decided together on the same state and clock:
 * - Posture: every touch gets a touch reaction, a poke at its point or a pet that starts or ends.
 * - Mood: `touchAffect` paces and habituates the dose, in seconds.
 * - Face: a poke and a finished pet are moments.
 * - Voice: for a poke or a finished pet with a voice view, `reactionPolicy` decides whether she says a line. The
 *   decision is kept either way. A line takes the line slot unless a reach-out holds it. Without a view nobody could speak the line, so the voice state is untouched.
 * - Body: a poke and a pet start end with `attend`, which opens the director's attend window. A pet end opens none.
 */
export function answerTouch(state: MindState, stimulus: Stimulus<'touch'>, cause: number, nowMs: number, rng: MindRandom): Answer {
  if (!state.behavior.touchReactions)
    return { state, intents: [] }
  if (!state.performer.posture)
    return refusedAnswer(state, cause, 'touch-reaction')

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
      voice = { ...voice, reaction: memory, lastDecision: decision }
      if (decision.speak) {
        const turnId = reactionTurnId(decision.eventId)
        intents.push({ id: `${cause}-speak`, cause, channel: 'voice', kind: 'speak', turnId, line: { kind: 'reaction', reaction: decision.kind, eventId: decision.eventId } })
        // The touch line takes the line slot, so the gate skips until it settles. A reach-out on its way keeps the
        // slot; chat refuses the touch line then.
        if (voice.line === null || voice.line.kind === 'reaction')
          voice = { ...voice, line: { turnId, kind: 'reaction', runId: voice.runId, before: null, speakBy: null } }
      }
    }
  }

  if (stimulus.gesture !== 'pet-end')
    intents.push(attendIntent(cause, 'touch'))

  return { state: { ...state, touch: { affect: affect.memory }, voice }, intents }
}
