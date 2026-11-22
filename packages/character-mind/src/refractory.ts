import type { MomentHistory } from '@proj-airi/stage-shared/expression-performance'

import type { MindAnswer, MindState, MindStimulus } from './types'

/** Milliseconds after a full-body action ends before another action is accepted. */
export const ACTION_REFRACTORY_MS = 15_000

/** Milliseconds after a dance ends before another dance is accepted. */
export const DANCE_REFRACTORY_MS = 60_000

/** Milliseconds before the same gesture clip is accepted again. */
export const GESTURE_REPEAT_MS = 4_000

/** Milliseconds after an accepted come-here or go-home tool before either is accepted again. */
export const MOVE_TOOL_REFRACTORY_MS = 60_000

/** Milliseconds after an accepted look-at tool before it is accepted again. */
export const LOOK_TOOL_REFRACTORY_MS = 15_000

/** Milliseconds after a poke's surprise during which another poke only flinches, so repeated pokes do not stack surprise. */
export const POKE_SURPRISE_DEDUPE_MS = 2_000

/** Who asked for a clip: the model's ACT or tool call, the devtools lab, or her own idle policy (`idle`). */
export type PerformerClipSource = 'act' | 'tool' | 'debug' | 'idle'

/**
 * What a performer stamped, for the refractories the mind keeps once per character. The ids are opaque to the mind: it
 * reads no clip or expression catalog.
 */
export type PerformerReport
  /** A clip performance ended and counts: it finished, the watchdog ended it, or a user intent or a stop ended it. A clip that failed to play is not reported. */
  = | { kind: 'clip-ended', clip: 'gesture' | 'action' | 'dance', source: PerformerClipSource }
  /** The body director accepted a gesture clip. */
    | { kind: 'gesture-clip', clipId: string, source: PerformerClipSource }
  /** The body director accepted a model's body tool. */
    | { kind: 'tool-accepted', tool: 'come-here' | 'go-home' | 'look-at' }
  /** A stage marked a moment with the catalog entry `entryId`. */
    | { kind: 'moment-marked', entryId: string }

/**
 * Her refractories, in epoch milliseconds of the mind's clock. Fast state: a model reload, a driver switch, or a stage
 * remount keeps it, and a mind reset clears it. Plain JSON.
 */
export interface MindRefractoryState {
  actionUntilMs: number
  danceUntilMs: number
  /** The gesture clip that may not repeat yet; null when none waits. */
  gesture: { clipId: string, untilMs: number } | null
  moveToolUntilMs: number
  lookToolUntilMs: number
  /** When a poke last surprised her; null before the first. */
  pokeSurpriseAtMs: number | null
  /** When each expression entry last marked a moment; `chooseMomentEntry` rests an entry `MOMENT_SETTINGS.entryRestMs` after it. */
  momentRest: MomentHistory
}

export const initialMindRefractoryState: MindRefractoryState = {
  actionUntilMs: 0,
  danceUntilMs: 0,
  gesture: null,
  moveToolUntilMs: 0,
  lookToolUntilMs: 0,
  pokeSurpriseAtMs: null,
  momentRest: {},
}

/**
 * The director's refractories as durations left from the moment the mind answered. A performer stamps them on its own
 * clock when it takes them; an absolute time of the mind's clock would mix two clocks.
 */
export interface RefractoryRemaining {
  actionMs: number
  danceMs: number
  gesture: { clipId: string, remainingMs: number } | null
  moveToolMs: number
  lookToolMs: number
}

/**
 * The refractories after one report, stamped at `nowMs`. A clip she played unasked never makes a requested one wait, and
 * a gesture clip's end arms nothing: its repeat window starts when the director accepts it.
 */
export function reportRefractory(state: MindRefractoryState, report: PerformerReport, nowMs: number): MindRefractoryState {
  switch (report.kind) {
    case 'clip-ended':
      if (report.source === 'idle' || report.clip === 'gesture')
        return state
      return report.clip === 'dance'
        ? { ...state, danceUntilMs: nowMs + DANCE_REFRACTORY_MS }
        : { ...state, actionUntilMs: nowMs + ACTION_REFRACTORY_MS }
    case 'gesture-clip':
      if (report.source === 'idle')
        return state
      return { ...state, gesture: { clipId: report.clipId, untilMs: nowMs + GESTURE_REPEAT_MS } }
    case 'tool-accepted':
      return report.tool === 'look-at'
        ? { ...state, lookToolUntilMs: nowMs + LOOK_TOOL_REFRACTORY_MS }
        : { ...state, moveToolUntilMs: nowMs + MOVE_TOOL_REFRACTORY_MS }
    case 'moment-marked':
      return { ...state, momentRest: { ...state.momentRest, [report.entryId]: nowMs } }
  }
}

/** The director's refractories left at `nowMs`, each 0 or more; a gesture whose window passed is null. */
export function refractoryRemaining(state: MindRefractoryState, nowMs: number): RefractoryRemaining {
  const left = (untilMs: number) => Math.max(0, untilMs - nowMs)
  const gestureMs = state.gesture === null ? 0 : left(state.gesture.untilMs)
  return {
    actionMs: left(state.actionUntilMs),
    danceMs: left(state.danceUntilMs),
    gesture: state.gesture !== null && gestureMs > 0 ? { clipId: state.gesture.clipId, remainingMs: gestureMs } : null,
    moveToolMs: left(state.moveToolUntilMs),
    lookToolMs: left(state.lookToolUntilMs),
  }
}

/** Whether a poke at `nowMs` surprises her: not within `POKE_SURPRISE_DEDUPE_MS` of the last poke that did. */
export function pokeSurprise(state: MindRefractoryState, nowMs: number): { surprise: boolean, state: MindRefractoryState } {
  if (state.pokeSurpriseAtMs !== null && nowMs - state.pokeSurpriseAtMs < POKE_SURPRISE_DEDUPE_MS)
    return { surprise: false, state }
  return { surprise: true, state: { ...state, pokeSurpriseAtMs: nowMs } }
}

/**
 * Stamps a performer's report. A director report answers with the body `refractory` intent, which every attached stage
 * takes; a moment's rest stays in the mind, where every stage's moments read it.
 */
export function answerPerformerReport(state: MindState, stimulus: Extract<MindStimulus, { kind: 'performer-report' }>, cause: number, nowMs: number): MindAnswer {
  const refractory = reportRefractory(state.refractory, stimulus.report, nowMs)
  const next = { ...state, refractory }
  if (stimulus.report.kind === 'moment-marked')
    return { state: next, intents: [] }
  return { state: next, intents: [{ id: `${cause}-refractory`, cause, channel: 'body', kind: 'refractory', remaining: refractoryRemaining(refractory, nowMs) }] }
}
