import type { ChannelClass } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { ChannelRow } from './cells'

/**
 * Units of everything a trajectory panel can draw. A panel has one y axis in the units of its scored effect `E`
 * (`emotion-score.ts` `eventDelta` / `modulationStatistic`), and an overlay is drawn only when the producer
 * computed it in those units. The table below is the audit; `drawnOverlays` applies it.
 *
 * | overlay      | face        | eyelid           | posture     | modulation |
 * | ------------ | ----------- | ---------------- | ----------- | ---------- |
 * | axis (E)     | half-range  | log-ratio        | half-range  | log-ratio  |
 * | ci           | = E         | = E              | = E         | = E        |
 * | expected     | half-range  | log-ratio        | half-range  | log-ratio  |
 * | null q90     | half-range  | log-ratio        | half-range  | (absent)   |
 * | trajectory   | half-range  | log-ratio        | half-range  | (absent)   |
 * | late, lateCi | half-range  | ratio-minus-one  | (absent)    | (absent)   |
 * | release grid | half-range  | ratio-minus-one  | (absent)    | (absent)   |
 *
 * Eyelid release data (`releaseTrajectory`: `runningLidReference / base - 1`) is not a log ratio, so its late-window
 * mean, its CI and the held-only release grid stay off the eyelid axis. "(absent)" overlays are ones the producer
 * never computes for that class (`scoreFaceRelease` runs for face and eyelid only; modulation has no sample series);
 * a row carrying such data is drawn without it rather than in guessed units.
 */
export type SeriesUnit = 'half-range' | 'log-ratio' | 'ratio-minus-one'

export type OverlayKind = 'effect' | 'ci' | 'expected' | 'null' | 'trajectory' | 'late' | 'lateCi' | 'release'

export const overlayKinds: readonly OverlayKind[] = ['effect', 'ci', 'expected', 'null', 'trajectory', 'late', 'lateCi', 'release']

/** The y axis of a panel: the units the scorer reports `E` in for that channel class. */
export function axisUnit(cls: ChannelClass): SeriesUnit {
  return cls === 'eyelid' || cls === 'modulation' ? 'log-ratio' : 'half-range'
}

/** The units the producer computed an overlay in, independent of whether the panel can show it; `null` when it never computes it for the class. */
export function overlayUnit(kind: OverlayKind, cls: ChannelClass): SeriesUnit | null {
  if (kind === 'late' || kind === 'lateCi' || kind === 'release')
    return cls === 'face' ? 'half-range' : cls === 'eyelid' ? 'ratio-minus-one' : null
  if ((kind === 'null' || kind === 'trajectory') && cls === 'modulation')
    return null
  return axisUnit(cls)
}

/** Whether the row carries data for an overlay at all. */
export function overlayPresent(kind: OverlayKind, row: ChannelRow): boolean {
  const { result } = row
  switch (kind) {
    case 'effect': return typeof result.E === 'number'
    case 'ci': return result.ci !== null && result.ci !== undefined
    case 'expected': return typeof result.expected === 'number'
    case 'null': return row.nullQ !== null && row.nullQ > 0
    case 'trajectory': return row.trajectory !== null
    case 'late': return typeof result.residual?.late === 'number'
    case 'lateCi': return (result.residual?.lateCi ?? null) !== null
    case 'release': return row.release !== null
  }
}

/** Overlays the panel draws: present on the row and in the panel's axis units. */
export function drawnOverlays(row: ChannelRow): OverlayKind[] {
  return overlayKinds.filter(kind => overlayPresent(kind, row) && overlayUnit(kind, row.cls) === axisUnit(row.cls))
}

export function unitLabel(unit: SeriesUnit): string {
  return unit === 'half-range' ? 'half-range' : unit === 'log-ratio' ? 'log ratio' : 'ratio - 1'
}
