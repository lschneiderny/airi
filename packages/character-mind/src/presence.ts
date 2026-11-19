import type { MindIntent, MindState, MindStimulus } from './types'

/** A screen change within this span of the last stamped reaction gets no new reaction. */
export const SCREEN_CHANGE_REFRACTORY_MS = 10_000

type Stimulus<K extends MindStimulus['kind']> = Extract<MindStimulus, { kind: K }>
interface Answer { state: MindState, intents: MindIntent[] }

/**
 * A presence report gets one response, in the order posture, face, voice:
 * - A desktop wake: a startled `desktop-reaction`, and `observe-wake` with the open span or null.
 * - A return (`away` turns false after it was true): a gentle `wake` unless the wake reaction already rouses her,
 *   the `welcome-back` moment, and `observe-return` with the span, which closes.
 * - `away` turning true opens the span at `nowMs` and yields no intent.
 * A wake while she is still away keeps the span open.
 */
export function answerPresence(state: MindState, stimulus: Stimulus<'presence'>, cause: number, nowMs: number): Answer {
  const { away: wasAway, awaySinceMs } = state.presence
  const { wake } = stimulus
  const returned = wasAway && !stimulus.away
  const posture: MindIntent[] = []
  const face: MindIntent[] = []
  const voice: MindIntent[] = []

  if (wake) {
    posture.push({ id: `${cause}-desktop-reaction`, cause, channel: 'posture', kind: 'desktop-reaction', reaction: 'wake' })
    voice.push({ id: `${cause}-observe-wake`, cause, channel: 'voice', kind: 'observe-wake', wakeCause: wake.cause, atMs: wake.atMs, awayMs: awaySinceMs === null ? null : wake.atMs - awaySinceMs })
  }
  if (returned) {
    if (!wake)
      posture.push({ id: `${cause}-wake`, cause, channel: 'posture', kind: 'wake' })
    face.push({ id: `${cause}-moment`, cause, channel: 'face', kind: 'moment', moment: 'welcome-back' })
    voice.push({ id: `${cause}-observe-return`, cause, channel: 'voice', kind: 'observe-return', atMs: nowMs, awayMs: nowMs - (awaySinceMs ?? nowMs) })
  }

  let presence = state.presence
  if (returned)
    presence = { away: false, awaySinceMs: null }
  else if (!wasAway && stimulus.away)
    presence = { away: true, awaySinceMs: nowMs }

  return { state: presence === state.presence ? state : { ...state, presence }, intents: [...posture, ...face, ...voice] }
}

/**
 * A sharp screen change gets a brief reaction and stamps the refractory, unless a reaction was stamped less than
 * {@link SCREEN_CHANGE_REFRACTORY_MS} ago or a desktop wake arrives in the same `step` call. A wake stamps nothing.
 */
export function answerScreenChange(state: MindState, cause: number, nowMs: number, wakes: boolean): Answer {
  const last = state.desktop.screenReactAtMs
  if (wakes || (last !== null && nowMs - last < SCREEN_CHANGE_REFRACTORY_MS))
    return { state, intents: [] }

  return {
    state: { ...state, desktop: { screenReactAtMs: nowMs } },
    intents: [{ id: `${cause}-desktop-reaction`, cause, channel: 'posture', kind: 'desktop-reaction', reaction: 'screen-change' }],
  }
}
