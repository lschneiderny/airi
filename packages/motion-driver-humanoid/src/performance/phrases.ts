import type { RandomStream } from '../random'
import type { BodySide } from './channels'
import type { ReadyOffset, SpeechGestureForm } from './gesture-forms'

import { DEG } from './channels'
import { GESTURE_FORMS, NO_OFFSET } from './gesture-forms'

/**
 * Where a gesture phrase holds its hands. A speaker moves each new thought to its own place: `centre` is 4a's ready
 * key in front of the waist; `low` keeps the hand near the hip, the calm speaker's small space; `side` takes the hand
 * out with the elbow away from the body; `high` presents at chest height; `inner` brings two hands in toward the
 * midline, from where they open.
 */
export type GesturePlace = 'centre' | 'low' | 'side' | 'high' | 'inner'

export const GESTURE_PLACES: Readonly<Record<GesturePlace, ReadyOffset>> = {
  centre: NO_OFFSET,
  low: { out: 0.03, up: -0.1, forward: -0.08, swivel: -5 * DEG },
  side: { out: 0.12, up: -0.02, forward: -0.04, swivel: 20 * DEG },
  high: { out: -0.02, up: 0.1, forward: 0.02, swivel: 10 * DEG },
  inner: { out: -0.06, up: 0.03, forward: 0.02, swivel: 0 },
}

/** One gesture phrase: the hands that gesture, where, the form that sets its hand, and how many strokes it plays. */
export interface GesturePhrase {
  readonly sides: readonly BodySide[]
  readonly place: GesturePlace
  /**
   * The phrase's first stroke, which sets the hand for the rest of it: after a palm-up stroke the phrase beats with the
   * palm up, after a press with the palm down. A `beat` theme leaves the hand as 4a's chooser makes it.
   */
  readonly theme: SpeechGestureForm
  readonly length: number
}

/**
 * How lively speech gestures are, 0 calm to 1 excited: the user energy raised by arousal (0.3 per unit) and a little by
 * valence (0.1), so an excited mood at the default energy gestures as an energetic speaker does.
 */
export function gestureDrive(energy: number, mood: { readonly valence: number, readonly arousal: number }): number {
  return Math.max(0, Math.min(1, energy + 0.3 * mood.arousal + 0.1 * mood.valence))
}

/**
 * The weights of each phrase choice at drive `d`. A calm speaker keeps low and central and beats more; an excited one
 * goes to the side and up and presses (plan 3.1: energy raises the press share); two hands open from the centre or
 * frame.
 */
const PLACE_WEIGHTS: Readonly<Record<GesturePlace, (d: number, twoHand: boolean) => number>> = {
  centre: () => 1,
  low: d => Math.max(0, 1.1 - 1.4 * d),
  side: d => 0.3 + 0.9 * d,
  high: d => Math.max(0, 1.6 * (d - 0.35)),
  inner: (_, twoHand) => twoHand ? 1.2 : 0,
}

const THEME_WEIGHTS: Readonly<Record<SpeechGestureForm, (d: number, twoHand: boolean) => number>> = {
  'beat': d => 0.8 - 0.4 * d,
  'palm-up': () => 1,
  'press': d => 0.2 + 1.0 * d,
  // A chop answers two emphases close together (`chooseForm`); it sets no phrase.
  'chop': () => 0,
  'frame': (d, twoHand) => twoHand ? (d > 0.5 ? 1.2 : 0.3) : 0,
  // Pointing follows a sustained gaze stroke by stroke (`chooseForm`); it sets no phrase.
  'point': () => 0,
}

/**
 * At a phrase's end in continuous speech, the share of phrases after which the hands lower instead of going on: 0.4
 * at drive 0.2, none from 0.4, where a calm speaker's strokes are already thinned (`CALM` in `gestures.ts`). A
 * livelier speaker lowers the hands in pauses instead: a lowering mid-utterance costs every onset until the next
 * unit's preparation ends (three of five peaks at drive 0.45 on the speak scenario).
 */
export function retractShare(drive: number): number {
  return Math.max(0, Math.min(0.6, 0.8 - 2 * drive))
}

function weighted<T extends string>(random: RandomStream, weights: readonly (readonly [T, number])[]): T {
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  let pick = random() * total
  for (const [value, w] of weights) {
    pick -= w
    if (pick < 0)
      return value
  }
  return weights[weights.length - 1][0]
}

/**
 * Draws a phrase for `sides` at drive `drive` from the phrase stream: a place and a theme other than the previous
 * phrase's (a beat theme may repeat), and 2 to 4 strokes, more when livelier.
 */
export function drawPhrase(random: RandomStream, drive: number, sides: readonly BodySide[], previous: GesturePhrase | null): GesturePhrase {
  const twoHand = sides.length === 2
  const places = (Object.keys(GESTURE_PLACES) as GesturePlace[])
    .filter(place => place !== previous?.place)
    .map(place => [place, PLACE_WEIGHTS[place](drive, twoHand)] as const)
    .filter(([, w]) => w > 0)
  const themes = (Object.keys(GESTURE_FORMS) as SpeechGestureForm[])
    .filter(theme => theme === 'beat' || theme !== previous?.theme)
    .map(theme => [theme, THEME_WEIGHTS[theme](drive, twoHand)] as const)
    .filter(([, w]) => w > 0)
  const place = weighted(random, places)
  const theme = weighted(random, themes)
  const length = Math.min(4, 2 + Math.floor(random() * (1 + 2 * drive)))
  return { sides, place, theme, length }
}

/**
 * The hands of the next phrase: from one hand, both join (0.1 + 0.3 x drive) or the other hand takes over (0.45);
 * from two, one goes on alone (0.6), the dominant one more often. Only free hands join.
 */
export function nextHands(random: RandomStream, drive: number, previous: readonly BodySide[], free: readonly BodySide[], dominant: BodySide): BodySide[] {
  const other = (side: BodySide): BodySide => side === 'left' ? 'right' : 'left'
  const join = random()
  const pick = random()
  if (previous.length === 2) {
    if (join >= 0.6)
      return [...previous]
    return [pick < 0.6 ? dominant : other(dominant)]
  }
  const current = previous[0]
  if (join < 0.1 + 0.3 * drive && free.includes(other(current)))
    return [dominant, other(dominant)]
  if (pick < 0.45 && free.includes(other(current)))
    return [other(current)]
  return [current]
}
