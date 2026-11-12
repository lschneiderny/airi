import type { MetricBand, VerdictMetric } from './types'

import { passesBand } from './bands'

/**
 * What a metric's value means, in words, so an out-of-band value is never read in the wrong direction. `below` and
 * `above` are comparatives that end a sentence such as "above upper edge -4.090: smoother than the reference pool";
 * an indicator's statements are absolute and take no comparison.
 */
export interface MetricMeaning {
  readonly larger: string
  readonly below: string
  readonly above: string
  readonly absolute?: true
}

const both = (larger: string, below: string, above: string): MetricMeaning => ({ larger, below, above })

/**
 * One entry per metric family, each read from the metric's code and the g1 design note (sections 3.2, 3.3 and 10.4).
 * A metric whose direction neither states is left out and listed in `UNDESCRIBED_METRICS`.
 */
const MEANINGS: readonly (readonly [RegExp, MetricMeaning])[] = [
  [/^chain\.[^.]+\.zeroLagCorr$/, both('the two joints move more as one curve at zero lag', 'less in lockstep', 'more in lockstep (one signal moving both joints)')],
  [/^chain\.[^.]+\.lagMs$/, both('the two joints are further out of step', 'closer to moving at the same instant', 'further out of step')],
  [/^spectral\.[^.]+\.peakShare$/, both('more of the motion\'s power sits around one frequency', 'more broadband', 'more periodic (power around one frequency)')],
  [/^spectral\.[^.]+\.entropy$/, both('the motion\'s power is spread over more frequencies', 'more periodic (power at few frequencies)', 'more broadband')],
  [/^period\.[^.]+\.acfPeak$/, both('the signal repeats itself more strongly at lags of 1 to 6 s', 'less periodic', 'more periodic at lags of 1 to 6 s')],
  [/^period\.[^.]+\.loopPeak$/, both('the signal repeats itself more strongly at lags of 2 to 30 s', 'less looped', 'more looped (repeating at lags of 2 to 30 s)')],
  [/^coverage\.(?:core|arms|fingers)$/, both('more of the bones move', 'fewer bones moving (frozen bones)', 'more bones moving')],
  [/^fingers\.frozen$/, { larger: '1 when every finger bone stays still in every window', below: 'not every finger bone frozen', above: 'every finger bone frozen in every window', absolute: true }],
  [/^bilateral\.[^.]+\.peakCorr$/, both('left and right move more alike', 'less alike between left and right', 'more alike between left and right (one signal driving both sides)')],
  [/^smooth\.[^.]+\.ldlj$/, both('smoother: less dimensionless jerk, nearer 0', 'jerkier', 'smoother')],
  [/^smooth\.[^.]+\.spikeRate$/, both('more velocity spikes per moving minute', 'fewer velocity spikes', 'more velocity spikes (pops)')],
  [/^inter\.speedCv$/, both('speed varies more relative to its mean', 'steadier in speed (motion that never rests or bursts)', 'more variable in speed')],
  [/^inter\.holdFraction$/, both('more of the time is held still', 'holding still less', 'holding still more')],
  [/^inter\.movesPerMin$/, both('more separate moves per minute', 'fewer moves per minute', 'more moves per minute')],
  [/^inter\.burstCv$/, both('the activity level drifts more between 10 s parts', 'more even in activity over tens of seconds', 'more uneven in activity over tens of seconds')],
  [/^inter\.moveDurationCv$/, both('move durations vary more', 'more uniform in move length', 'more varied in move length')],
  [/^inter\.head\.top10PathShare$/, both('more of the head\'s path is travelled in its fastest tenth of frames', 'head motion spread more evenly over time', 'head motion more concentrated in brief fast moves')],
  [/^dim\.(?:upper|core)$/, both('more independent movement dimensions', 'fewer independent movement dimensions (many bones driven by few signals)', 'more independent movement dimensions')],
  [/^idle\.actsPerMin$/, both('more idle acts per minute', 'fewer idle acts', 'more idle acts')],
  [/^idle\.regionEntropy$/, both('the acts are spread over more body regions', 'acts concentrated in fewer body regions', 'acts spread over more body regions')],
  [/^idle\.intervalCv$/, both('the time between acts varies more', 'more regularly timed acts (timer-like)', 'more irregularly timed acts')],
  [/^gesture\.strokesPerMin$/, both('more arm stroke peaks per minute', 'fewer arm strokes', 'more arm strokes')],
  [/^gesture\.strokeGain$/, both('arm strokes fall on emphasis more often than chance would', 'arm strokes less aligned with emphasis', 'arm strokes more aligned with emphasis')],
  [/^gesture\.headGain$/, both('head nods fall on emphasis more often than chance would', 'head nods less aligned with emphasis', 'head nods more aligned with emphasis')],
  [/^gesture\.strokeP$/, both('the strokes\' alignment with emphasis is more likely to be chance', 'less likely to be chance', 'more likely to be chance (alignment with emphasis not shown)')],
  [/^gesture\.strokeLagMs$/, both('strokes come later after the emphasis', 'strokes earlier relative to emphasis', 'strokes later relative to emphasis')],
  [/^onset\.attackFraction$/, both('motions reach their peak speed later in the movement', 'reaching peak speed sooner (more abrupt starts)', 'reaching peak speed later')],
  [/^onset\.easedOrAnticipated$/, both('more motions start eased or with an anticipation', 'fewer eased or anticipated starts (more abrupt starts)', 'more eased or anticipated starts')],
  [/^onset\.anticipationRate$/, both('more motions start with an anticipatory counter-move', 'fewer anticipations', 'more anticipations')],
  [/^gait\.pelvisTwistDeg$/, both('the pelvis turns more with the legs', 'less pelvis rotation', 'more pelvis rotation')],
  [/^gait\.chestCounter$/, both('the chest twists more with the pelvis and less against it', 'more chest counter-rotation against the pelvis', 'less chest counter-rotation (chest locked to the pelvis)')],
  [/^gait\.armSwingLagMs$/, both('the forearm\'s swing trails the upper arm\'s by more', 'forearm trailing the upper arm less (the arm swinging as one stick)', 'forearm trailing the upper arm more')],
  [/^gait\.heelStrikePitchDeg$/, both('the toes are raised more at heel strike', 'flatter foot at heel strike', 'toes raised more at heel strike')],
  [/^gait\.toeOffPitchDeg$/, both('the foot is tipped down less at toe-off', 'foot tipped down more at toe-off', 'flatter foot at toe-off')],
  [/^gait\.headLeadMs$/, both('the head starts a turn earlier before the body\'s heading', 'head leading the body\'s turn less (the body turning first)', 'head leading the body\'s turn more')],
  [/^gaze\.chestLagMs$/, both('the chest starts later after the head', 'chest starting sooner after the head', 'chest starting later after the head')],
  [/^gaze\.orderRate$/, both('more gaze shifts start eyes, then head, then chest', 'fewer shifts ordered eyes, head, chest', 'more shifts ordered eyes, head, chest')],
  [/^gaze\.overshootPct$/, both('the head overshoots its final angle more', 'less overshoot (stopping dead)', 'more overshoot')],
  [/^gaze\.settleMs$/, both('the head takes longer to settle', 'settling faster', 'settling slower')],
  [/^gaze\.eyeLeadMs$/, both('the eyes start earlier before the head', 'eyes leading the head less (the head moving first below 0)', 'eyes leading the head more')],
  [/^emotion\.(?:minSeparation|medianSeparation|minSeparationFromNeutral)$/, both('emotion postures lie further apart, in pooled SD units', 'less distinct emotion postures', 'more distinct emotion postures')],
  [/^emotion\.armShare$/, both('the arms carry more of the emotion posture difference', 'arms carrying less of the emotion postures', 'arms carrying more of the emotion postures')],
]

/** Metric ids, in the frozen bands, whose direction their code and rules files do not state: no descriptor is printed. */
export const UNDESCRIBED_METRICS: readonly string[] = []

export function metricMeaning(id: string): MetricMeaning | null {
  return MEANINGS.find(([pattern]) => pattern.test(id))?.[1] ?? null
}

/** `edge` is in the value's own units: a Fisher-z edge is given as tanh(edge). */
export type BandSide = NonNullable<VerdictMetric['outside']>

/**
 * The side of the band an out-of-band value is on, or null inside it. Uses the gate's own `passesBand`, so it can never
 * disagree with a verdict; the band's basis picks the comparison: a fitted band compares with the reference pool, a
 * declared band with its declared limit.
 */
export function bandSide(id: string, value: number | null, band: MetricBand | null): BandSide | null {
  if (value === null || !band || !Number.isFinite(value) || passesBand(value, band))
    return null
  const below = band.lo !== null && (band.transform === 'fisher-z' ? Math.atanh(Math.max(-0.9999, Math.min(0.9999, value))) : value) < band.lo
  const edgeRaw = below ? band.lo : band.hi
  if (edgeRaw === null)
    return null
  const edge = band.transform === 'fisher-z' ? Math.tanh(edgeRaw) : edgeRaw
  const meaning = metricMeaning(id)
  const words = meaning ? (below ? meaning.below : meaning.above) : null
  const than = band.basis === 'declared' ? 'than the declared limit' : 'than the reference pool'
  return { side: below ? 'below lower edge' : 'above upper edge', edge, meaning: words && (meaning?.absolute ? words : `${words} ${than}`) }
}

export function formatBandSide(side: BandSide): string {
  return `${side.side} ${side.edge.toFixed(3)}${side.meaning ? `: ${side.meaning}` : ''}`
}

/** `: <side> <edge>: <meaning>` for a value outside its band, empty inside it or without a band; for report text. */
export function describeOutside(id: string, value: number | null, band: MetricBand | undefined): string {
  const side = bandSide(id, value, band ?? null)
  return side ? `: ${formatBandSide(side)}` : ''
}
