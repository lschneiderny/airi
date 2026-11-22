import type { MindIntent, MindRandom, MindState, MindStimulus, Refusal } from './types'

import { touchAffect } from '@proj-airi/stage-shared/expression-performance'
import { reactionPolicy } from '@proj-airi/stage-shared/situation'

import { attendIntent } from './attention'
import { refusedAnswer } from './capabilities'
import { moodTouchDose } from './mood'
import { reactionTurnId } from './voice'

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[], refusals?: Refusal[] }

/**
 * One touch gets one response, decided together on the same state and clock:
 * - Posture: every touch gets a touch reaction, a poke at its point or a pet that starts or ends.
 * - Mood: `touchAffect` paces and habituates the dose, in seconds; with mood on it also moves her level.
 * - Face: a poke and a finished pet are moments.
 * - Voice: for a poke or a finished pet with a voice view, `reactionPolicy` decides whether she says a line. The
 *   decision is kept either way. A line takes the line slot unless a reach-out holds it. Without a view nobody could speak the line, so the voice state is untouched.
 * - Body: a poke and a pet start end with `attend`, which opens the director's attend window. A pet end opens none.
 */
export function answerTouch(state: MindState, stimulus: Stimulus<'touch'>, cause: number, nowMs: number, rng: MindRandom): Answer {
  // Cleanup closes only a pet the mind granted, so the hand cannot stay stuck. It draws nothing and speaks nothing.
  if (stimulus.gesture === 'pet-cancel') {
    if (state.touch.affect.pet === null)
      return { state, intents: [] }
    const next = { ...state, touch: { affect: { ...state.touch.affect, pet: null } } }
    const end: MindIntent = { id: `${cause}-touch-reaction`, cause, channel: 'posture', kind: 'touch-reaction', gesture: 'pet', phase: 'end' }
    return { state: next, intents: state.performer.posture ? [end] : [] }
  }
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
  let { mood } = state
  if (affect.dose) {
    intents.push({ id: `${cause}-mood`, cause, channel: 'posture', kind: 'mood', dose: affect.dose })
    if (stimulus.settings.mood)
      mood = moodTouchDose(mood, affect.dose, stimulus.settings, nowMs)
  }

  let { voice } = state
  if (stimulus.gesture !== 'pet-start') {
    intents.push({ id: `${cause}-moment`, cause, channel: 'face', kind: 'moment', moment: stimulus.gesture === 'poke' ? 'poked' : 'petted' })
    if (stimulus.voice) {
      // A reserved line owns the slot before its host has begun generating.
      const view = voice.line === null ? stimulus.voice : { ...stimulus.voice, held: stimulus.voice.held ?? 'generating' as const }
      const { decision, memory } = reactionPolicy({ nowMs, gesture: stimulus.gesture === 'poke' ? 'poke' : 'pet', view }, voice.reaction, rng)
      voice = { ...voice, reaction: memory, lastDecision: decision }
      if (decision.speak) {
        const turnId = reactionTurnId(decision.eventId)
        intents.push({ id: `${cause}-speak`, cause, channel: 'voice', kind: 'speak', turnId, line: { kind: 'reaction', reaction: decision.kind, eventId: decision.eventId } })
        voice = { ...voice, line: { turnId, kind: 'reaction', runId: voice.runId, before: null, speakBy: null } }
      }
    }
  }

  if (stimulus.gesture !== 'pet-end')
    intents.push(attendIntent(cause, 'touch'))

  return { state: { ...state, touch: { affect: affect.memory }, voice, mood }, intents }
}
