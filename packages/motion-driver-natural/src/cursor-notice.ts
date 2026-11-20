import type { RandomStream } from './random'

import { truncatedLognormal } from './random'

/** Engagement probability for a medium-distance episode. */
export const engageMedium = 0.55
/** Engagement probability for a far-distance episode. */
export const engageFar = 0.2
/** Median interest spans in seconds for non-near episodes. */
export const interestMedian = { medium: 2.5, far: 1.5 }
/** Log-space standard deviation of interest spans. */
export const interestLogSd = 0.5
/** Allowed interest span range in seconds. */
export const interestSpan = { min: 0.8, max: 8 }
/** Seconds between noticing and full attention. */
export const noticeDwell = { min: 0.25, max: 0.5 }
/** Seconds after release or an ignored draw before another same-or-farther episode. */
export const cooldown = { min: 4, max: 10 }

/** How far the cursor is from her face when an episode starts. */
export type CursorBand = 'near' | 'medium' | 'far'

/** One cursor episode: whether she engages, and its interest span, notice dwell, and cooldown in seconds. */
export interface CursorEpisode {
  band: CursorBand
  engaging: boolean
  span: number
  dwell: number
  cooldown: number
}

/**
 * Draws a cursor episode for a band. The draw order is engaging, span, dwell, cooldown; a near episode always
 * engages with an unbounded span and draws no engagement.
 */
export function drawCursorEpisode(band: CursorBand, random: RandomStream): CursorEpisode {
  return {
    band,
    engaging: band === 'near' || random() < (band === 'medium' ? engageMedium : engageFar),
    span: band === 'near' ? Number.POSITIVE_INFINITY : truncatedLognormal(random, interestMedian[band], interestLogSd, interestSpan.min, interestSpan.max),
    dwell: noticeDwell.min + random() * (noticeDwell.max - noticeDwell.min),
    cooldown: cooldown.min + random() * (cooldown.max - cooldown.min),
  }
}
