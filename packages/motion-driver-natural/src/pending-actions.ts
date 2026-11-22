import type { ExpressionPerformanceSettings, MoodDose, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { CueGestureKind, NaturalCueGestures } from './cue-gestures'
import type { naturalEmotions } from './emotions'
import type { NaturalPerformanceEnergy } from './energy'
import type { NaturalMotionObserver, NaturalTouchRegion } from './frame-types'
import type { GazePoint, NaturalGazeLayer } from './gaze'
import type { NaturalGestures } from './gestures'
import type { NaturalImpulses } from './impulses'
import type { NaturalEpisode, NaturalMood } from './mood'
import type { Vec3 } from './posture'

import { pokeDirection, pokeGlanceHold, pokeNudgeTau, pokeStrength } from './touch'

// Desktop reactions. Wake lifts the head slightly and glances at the camera; a screen
// change glances at the desk for 0.4 s. The wake nudge stays small: intensity 0.4 gives a
// 0.063 normalized peak, below the smallest emotion impulse at full intensity.
const wakeNudge = { direction: [0, 1, 0] as Vec3, intensity: 0.4 }
const wakeGlanceHold = 1
const screenChangeGlanceHold = 0.4
const glanceTargets = { camera: { x: 0, y: 0 } }

/** Work requested between grid steps; it starts at the next step so grid states stay consistent. */
export type PendingAction
  = | { kind: 'emotion', episode: NaturalEpisode }
    | { kind: 'gesture', gesture: CueGestureKind, count: number }
    | { kind: 'mood', dose: MoodDose }
    | { kind: 'mood-level', level: Omit<MoodDose, 'id'> }
    | { kind: 'react', reaction: 'wake' | 'screen-change' }
    /** Ends a sleep through the gentle wake; the idle layer reads it, and it is ignored while she is awake. */
    | { kind: 'wake' }
    /** `surprise` is the character mind's: false for a poke within its surprise dedupe, which only flinches. */
    | { kind: 'poke', region: NaturalTouchRegion, x: number, y: number, surprise: boolean }
    | { kind: 'chat', cue: 'sent' | 'unfold', words: number }
    | { kind: 'look', target: GazePoint | 'away' | null, holdSeconds: number }

/** Poke surprise bookkeeping the owner carries between calls. */
export interface PokeSurpriseState {
  /** Gives each poke's surprise its own episode id; reaction ids reject reuse without escalation. */
  pokes: number
}

export interface PendingActionTargets {
  impulses: NaturalImpulses
  gaze: NaturalGazeLayer
  energy: NaturalPerformanceEnergy
  mood: NaturalMood
  gestures: NaturalGestures
  cueGestures: NaturalCueGestures
  /** Per-emotion performance strength; zero suppresses new episodes while held emotions are enabled. */
  emotionStrengths: Partial<Record<PerformanceEmotion, number>>
  /** The mood, held-emotion, and band switches read when each action starts. */
  settings: ExpressionPerformanceSettings
  /** The recipe table the controller was built with; an emotion with a recipe gesture leaves the head to the gesture clip. */
  emotions: typeof naturalEmotions
  /** Receives started emotion impulses and gestures; absent while no observer is attached, so no event is built. */
  notify?: NaturalMotionObserver
}

/** Performed physical and desktop actions, independent of observer delivery. */
interface StartedActions extends PokeSurpriseState {
  readonly pokeEvents: readonly { readonly at: number, readonly region: NaturalTouchRegion, readonly x: number, readonly y: number }[]
  readonly reactEvents: readonly { readonly at: number, readonly kind: 'wake' | 'screen-change' }[]
}

/** Starts reactions, gestures, and look requests queued since the previous step; returns the updated poke surprise state. */
export function startPending(actions: Exclude<PendingAction, { kind: 'chat' | 'wake' }>[], at: number, targets: PendingActionTargets, pokeState: PokeSurpriseState): StartedActions {
  const { impulses, gaze, energy, mood, gestures, cueGestures, emotionStrengths, settings, emotions, notify } = targets
  let { pokes } = pokeState
  const pokeEvents: { at: number, region: NaturalTouchRegion, x: number, y: number }[] = []
  const reactEvents: { at: number, kind: 'wake' | 'screen-change' }[] = []
  for (const action of actions) {
    if (action.kind === 'look') {
      gaze.look(action.target, action.holdSeconds, at)
      continue
    }
    if (action.kind === 'gesture') {
      cueGestures.trigger(action.gesture, action.count, at)
      continue
    }
    if (action.kind === 'mood') {
      if (settings.mood)
        mood.addDose(action.dose)
      continue
    }
    if (action.kind === 'mood-level') {
      if (settings.mood)
        mood.set(action.level)
      continue
    }
    if (action.kind === 'poke') {
      const strength = pokeStrength[action.region]
      impulses.nudge(pokeDirection(action.region, action.x, action.y), strength.nudge, at, pokeNudgeTau)
      // Surprise carries no glance of its own; a poke the mind deduplicated only flinches.
      // A poke uses the `clear` band, which is how reactions run with band recruitment disabled.
      if (action.surprise) {
        impulses.trigger({ id: `poke-${++pokes}`, emotion: 'surprised', nominal: strength.surprise, intensity: strength.surprise, band: 'clear', escalation: false }, at)
      }
      gaze.glance({ source: 'poke', point: glanceTargets.camera, hold: pokeGlanceHold }, at)
      // The fixed reacting overlay, like a desktop reaction.
      energy.react(at)
      pokeEvents.push({ at, region: action.region, x: action.x, y: action.y })
      continue
    }
    if (action.kind === 'emotion') {
      const enabled = settings.heldEmotions
      if (enabled && emotionStrengths[action.episode.emotion] === 0)
        continue
      // The head pulse of an emotion whose recipe has a gesture stays off even when the mind ordered no clip (a
      // running cooldown), as before the mind chose the clip: the recipe decides how this impulse is realised.
      const clipOwnsHead = enabled && emotions[action.episode.emotion].gesture !== undefined
      const started = impulses.trigger(action.episode, at, { head: !clipOwnsHead })
      if (!started)
        continue
      notify?.({ kind: 'impulse', at, emotion: action.episode.emotion, band: started.band, intensity: started.intensity, side: started.side })
      // The mind ordered the clip and spent its cooldown; a cue gesture that holds the head still refuses it here, and
      // with held emotions off the facade shows no gesture, so none starts.
      const gesture = action.episode.gesture
      if (enabled && gesture && !cueGestures.headActive(at))
        gestures.trigger(gesture, action.episode.intensity, settings.bands ? action.episode.band : 'clear', at, notify && ((played, side) => notify({ kind: 'gesture', at, gesture: played, side })))
      if (started.glance)
        gaze.glance({ source: 'emotion', point: started.glance.point, hold: started.glance.hold }, at)
      continue
    }
    if (action.reaction === 'wake') {
      impulses.nudge(wakeNudge.direction, wakeNudge.intensity, at)
      gaze.glance({ source: 'desktop-wake', point: glanceTargets.camera, hold: wakeGlanceHold }, at)
    }
    else {
      gaze.glance({ source: 'screen-change', point: gaze.screenPoint(), hold: screenChangeGlanceHold }, at)
    }
    energy.react(at)
    reactEvents.push({ at, kind: action.reaction })
  }
  return { pokes, pokeEvents, reactEvents }
}
