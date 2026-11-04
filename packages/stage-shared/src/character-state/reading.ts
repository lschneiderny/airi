import type { AdvanceContext, CharacterProfile, CharacterReading, CharacterStateRecordV1, MoodContribution } from './types'

import { moodAt, remaining } from './mood'
import { unlocksOf } from './relationship'
import { bucketsOf, characterRenderKey, cleanReason } from './render'
import { CHARACTER_STATE_SETTINGS } from './settings'
import { pointedOf, urgeFactorOf } from './urge'

const REASONS = CHARACTER_STATE_SETTINGS.rendering.reasons

interface Weighted {
  readonly contribution: MoodContribution
  readonly weight: number
}

/** Reason weight (A4): `remaining · (|Δv| + |Δe| + |Δt|)`, halved for model cues. */
function weightOf(contribution: MoodContribution, nowMs: number): number {
  const { delta } = contribution
  const factor = contribution.source === 'model-cue' ? REASONS.modelCueWeightFactor : 1
  return remaining(contribution, nowMs) * (Math.abs(delta.valence) + Math.abs(delta.energy) + Math.abs(delta.tension)) * factor
}

function byTime(a: MoodContribution, b: MoodContribution): number {
  return a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Heaviest first; equal weights fall back to time, so the choice is deterministic. */
function byRank(a: Weighted, b: Weighted): number {
  return b.weight - a.weight || byTime(a.contribution, b.contribution)
}

function sameText(a: Weighted, b: Weighted): boolean {
  return cleanReason(a.contribution.reason) === cleanReason(b.contribution.reason)
}

/**
 * The shown reasons (A4): reasons shown before stay while their weight is at least 0.03 and at least half the best
 * excluded one; free places go to the heaviest others with weight at least 0.04. At most two, ordered by `atMs`, so a
 * ranking change never reorders them. A reason whose rendered text equals a shown one's is skipped, so each text
 * shows once.
 */
function shownReasons(contributions: readonly MoodContribution[], previousIds: ReadonlySet<string>, nowMs: number): MoodContribution[] {
  const weighted = contributions.map(contribution => ({ contribution, weight: weightOf(contribution, nowMs) }))
  let shown = weighted
    .filter(entry => previousIds.has(entry.contribution.id) && entry.weight >= REASONS.keepWeight)
    .sort(byRank)
    .filter((entry, index, kept) => kept.findIndex(other => sameText(other, entry)) === index)
    .slice(0, REASONS.maxShown)
  // Each pass adds a reason or swaps the weakest shown one for a heavier one, so the loop ends.
  while (true) {
    const best = weighted.filter(entry => !shown.some(other => sameText(other, entry)) && entry.weight >= REASONS.showWeight).sort(byRank)[0]
    if (best === undefined)
      break
    if (shown.length < REASONS.maxShown) {
      shown = [...shown, best]
      continue
    }
    const weakest = shown.reduce((low, entry) => byRank(low, entry) < 0 ? entry : low)
    if (weakest.weight >= REASONS.keepShareOfBestExcluded * best.weight)
      break
    shown = [...shown.filter(entry => entry !== weakest), best]
  }
  return shown.map(entry => entry.contribution).sort(byTime)
}

/**
 * What the rest of the app reads from a card's state at `ctx.nowMs`; pass the state already advanced to that instant
 * (`advance`). `previous` is the last reading of the same card, which bucket hysteresis and sticky reasons need;
 * `null` starts fresh. Pure: the same inputs give the same reading.
 */
export function readCharacter(state: CharacterStateRecordV1, profile: CharacterProfile, previous: CharacterReading | null, ctx: AdvanceContext): CharacterReading {
  const mood = moodAt(state.mood.contributions, state.temperament.axes, ctx.nowMs)
  const shown = shownReasons(state.mood.contributions, new Set(previous?.reasons.map(reason => reason.id)), ctx.nowMs)
  const { levels, stages, milestoneIds } = state.relationship
  const reading: Omit<CharacterReading, 'renderKey'> = {
    mood,
    resting: { ...profile.resting },
    temperament: { ...state.temperament.axes },
    // With no reason live, an axis back at its resting value reads its resting bucket despite the hysteresis.
    buckets: bucketsOf(mood, previous?.buckets ?? null, shown.length === 0 ? profile.resting : undefined),
    reasons: shown.map(contribution => ({ id: contribution.id, text: contribution.reason, atMs: contribution.atMs })),
    levels: { ...levels },
    stages: { ...stages },
    unlocks: unlocksOf(stages, milestoneIds.length),
    urgeFactor: urgeFactorOf(mood),
    pointed: pointedOf(mood, shown.map(contribution => contribution.source)),
    lastInteractionAtMs: state.lastInteractionAtMs,
  }
  return { ...reading, renderKey: characterRenderKey(reading, ctx) }
}
