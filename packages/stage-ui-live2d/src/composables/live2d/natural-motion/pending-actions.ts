import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { Live2DTouchRegion } from '../touch-gestures'
import type { naturalEmotions } from './emotions'
import type { NaturalPerformanceEnergy } from './energy'
import type { NaturalMotionObserver } from './frame-types'
import type { NaturalGazeLayer } from './gaze'
import type { NaturalGestures } from './gestures'
import type { NaturalImpulses } from './impulses'
import type { NaturalEpisode, NaturalMood } from './mood'
import type { Vec3 } from './posture'

import { pokeDirection, pokeGlanceHold, pokeNudgeTau, pokeStrength, pokeSurpriseDedupeSeconds } from './touch'

// Desktop reactions. Wake lifts the head slightly and glances at the camera; a screen
// change glances at the desk for 0.4 s. The wake nudge stays small: intensity 0.4 gives a
// 0.063 normalized peak, below the smallest emotion impulse at full intensity.
const wakeNudge = { direction: [0, 1, 0] as Vec3, intensity: 0.4 }
const wakeGlanceHold = 1
const screenChangeGlanceHold = 0.4
const glanceTargets = { camera: { x: 0, y: 0 }, desk: { x: 0, y: -0.18 } }

/** Work requested between grid steps; it starts at the next step so grid states stay consistent. */
export type PendingAction
  = | { kind: 'emotion', episode: NaturalEpisode }
    | { kind: 'react', reaction: 'wake' | 'screen-change' }
    | { kind: 'poke', region: Live2DTouchRegion, x: number, y: number }

/** Poke surprise bookkeeping the owner carries between calls. */
export interface PokeSurpriseState {
  /** Gives each poke's surprise its own episode id; reaction ids reject reuse without escalation. */
  pokes: number
  /** Active seconds of the last poke surprise; a repeat within `pokeSurpriseDedupeSeconds` only flinches. */
  lastPokeSurprise: number
}

export interface PendingActionTargets {
  impulses: NaturalImpulses
  gaze: NaturalGazeLayer
  energy: NaturalPerformanceEnergy
  mood: NaturalMood
  gestures: NaturalGestures
  /** Per-emotion performance strength; zero suppresses new episodes while held emotions are enabled. */
  emotionStrengths: Partial<Record<PerformanceEmotion, number>>
  /** The mood, held-emotion, and band switches read when each episode starts. */
  settings: ExpressionPerformanceSettings
  /** The recipe table the controller was built with; it decides which emotions play a gesture. */
  emotions: typeof naturalEmotions
  /** Receives started emotion impulses and gestures; absent while no observer is attached, so no event is built. */
  notify?: NaturalMotionObserver
}

/** Starts emotion impulses and desktop reactions requested since the previous step; returns the updated poke surprise state. */
export function startPending(actions: PendingAction[], at: number, targets: PendingActionTargets, pokeState: PokeSurpriseState): PokeSurpriseState {
  const { impulses, gaze, energy, mood, gestures, emotionStrengths, settings, emotions, notify } = targets
  let { pokes, lastPokeSurprise } = pokeState
  for (const action of actions) {
    if (action.kind === 'poke') {
      const strength = pokeStrength[action.region]
      impulses.nudge(pokeDirection(action.region, action.x, action.y), strength.nudge, at, pokeNudgeTau)
      // Surprise carries no glance of its own; a repeat within its 2 s dedupe only flinches.
      // A poke uses the `clear` band, which is how reactions run with band recruitment disabled.
      if (at - lastPokeSurprise >= pokeSurpriseDedupeSeconds) {
        lastPokeSurprise = at
        impulses.trigger({ id: `poke-${++pokes}`, emotion: 'surprised', nominal: strength.surprise, intensity: strength.surprise, band: 'clear', escalation: false }, at)
      }
      gaze.glance(glanceTargets.camera, pokeGlanceHold, at)
      // The fixed reacting overlay, like a desktop reaction, not the emotion energy settings.
      energy.react(at, 1, true)
      continue
    }
    if (action.kind === 'emotion') {
      const enabled = settings.heldEmotions
      if (enabled && emotionStrengths[action.episode.emotion] === 0)
        continue
      const gesture = enabled ? emotions[action.episode.emotion].gesture : undefined
      const started = impulses.trigger(action.episode, at, { head: gesture === undefined })
      if (!started)
        continue
      notify?.({ kind: 'impulse', at, emotion: action.episode.emotion, band: started.band, intensity: started.intensity, side: started.side })
      if (gesture)
        gestures.trigger(gesture, action.episode.intensity, settings.bands ? action.episode.band : 'clear', at, notify && ((played, side) => notify({ kind: 'gesture', at, gesture: played, side })))
      if (settings.mood)
        mood.add(action.episode)
      if (started.glance)
        gaze.glance(started.glance.point, started.glance.hold, at)
      if (started.energy)
        energy.react(at, action.episode.intensity)
      continue
    }
    if (action.reaction === 'wake') {
      impulses.nudge(wakeNudge.direction, wakeNudge.intensity, at)
      gaze.glance(glanceTargets.camera, wakeGlanceHold, at)
    }
    else {
      gaze.glance(glanceTargets.desk, screenChangeGlanceHold, at)
    }
    energy.react(at, 1, true)
  }
  return { pokes, lastPokeSurprise }
}
