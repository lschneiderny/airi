const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value))
      deepFreeze(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

/**
 * Every tuning constant of the layered character state (plan Appendix A), grouped by layer. Records never copy these
 * values, so retuning needs no migration. Times are milliseconds; mood deltas are `[valence, energy, tension]` steps
 * on the raw scale before the temperament squash.
 */
export const CHARACTER_STATE_SETTINGS = deepFreeze({
  /** A1, A2: the hours-scale mood layer. */
  mood: {
    /** A contribution whose largest remaining delta falls below this is expired. */
    epsilon: 0.01,
    /** Insertion rail: the summed raw value of one axis never exceeds this magnitude. */
    headroom: 2.5,
    maxContributions: 64,
    /** `atanh` input clamp for valence and energy. */
    atanhClamp: 0.999,
    /** Logistic gain applied to raw tension. */
    tensionGain: 4,
    modelCue: {
      step: 0.08,
      halfLifeMs: 90 * MINUTE_MS,
      budgetWindowMs: 60 * MINUTE_MS,
      /** Sum of accepted cue magnitudes per axis inside the rolling window; the excess is truncated. */
      budgetPerAxis: 0.24,
      maxLogEntries: 64,
    },
    events: {
      'touch-pleasant': { delta: { valence: 0.1, energy: 0.05, tension: -0.03 }, halfLifeMs: 1.5 * HOUR_MS },
      'touch-unwelcome': { delta: { valence: -0.08, energy: 0.05, tension: 0.08 }, halfLifeMs: HOUR_MS },
      'reach-out-unanswered-first': { delta: { valence: -0.06, energy: -0.03, tension: 0.06 }, halfLifeMs: 3 * HOUR_MS },
      'reach-out-unanswered-second': { delta: { valence: -0.12, energy: -0.05, tension: 0.1 }, halfLifeMs: 6 * HOUR_MS },
      'late-reply': { delta: { valence: 0.06, energy: 0, tension: -0.06 }, halfLifeMs: 2 * HOUR_MS },
      'significant-positive': { delta: { valence: 0.25, energy: 0.1, tension: 0 }, halfLifeMs: 9 * HOUR_MS },
      /** Also the mood part of `hurtful`. */
      'significant-negative': { delta: { valence: -0.25, energy: -0.1, tension: 0.15 }, halfLifeMs: 9 * HOUR_MS },
      'ritual-reciprocated': { delta: { valence: 0.05, energy: 0.03, tension: 0 }, halfLifeMs: 2 * HOUR_MS },
    },
    /** Pleasant touch: summed valence magnitude accepted per rolling hour. */
    pleasantTouchBudgetPerHour: 0.3,
    pleasantTouchBudgetWindowMs: HOUR_MS,
    /** Significant contributions (positive, negative, hurtful) accepted per logical day. */
    significantPerDay: 2,
    /** Return after gap g: `f = clamp(log2(g / referenceGapMs) / octaves, 0, 1)` scales `delta`. */
    return: {
      referenceGapMs: 12 * HOUR_MS,
      octaves: 3,
      delta: { valence: 0.15, energy: 0.1, tension: 0.1 },
      halfLifeMs: 4 * HOUR_MS,
    },
  },
  /** A3: the days-scale temperament layer. */
  temperament: {
    /** Half-life of following mood (`k_T = ln2 / followHalfLifeMs`). */
    followHalfLifeMs: 5 * DAY_MS,
    /** Half-life of the pull back to the resting disposition (`k_A = ln2 / anchorHalfLifeMs`). */
    anchorHalfLifeMs: 10 * DAY_MS,
    stepMs: HOUR_MS,
    /** Mood is sampled at this offset inside each completed epoch hour. */
    sampleOffsetMs: 30 * MINUTE_MS,
    /** Largest |temperament - resting| per axis. */
    clamp: { valence: 0.3, energy: 0.25, tension: 0.15 },
    /** One advance processes at most this many hours; older gaps get the closed-form anchor pull only. */
    maxHoursPerCall: 400 * 24,
  },
  /** A5, A6: the weeks-scale relationship layer. */
  relationship: {
    /** Daily ceiling of `E(S) = G (1 - e^-S)` per dimension. */
    dailyGain: { closeness: 0.02, trust: 0.012, familiarity: 0.03 },
    points: {
      'first-real-exchange': { closeness: 0.4, trust: 0.2, familiarity: 0.4 },
      'later-user-turn': { closeness: 0.05, trust: 0, familiarity: 0.05 },
      'reach-out-reply': { closeness: 0.2, trust: 0.2, familiarity: 0 },
      'disclosure': { closeness: 0.3, trust: 0.1, familiarity: 0.4 },
      'kept-promise': { closeness: 0, trust: 0.4, familiarity: 0 },
      'milestone': { closeness: 0.5, trust: 0, familiarity: 0.2 },
      'touch-pleasant': { closeness: 0.1, trust: 0, familiarity: 0 },
      'ritual-reciprocated': { closeness: 0.1, trust: 0, familiarity: 0.1 },
    },
    /** Window within which a reply to a reach-out earns `reach-out-reply` points. */
    reachOutReplyWindowMs: 2 * HOUR_MS,
    /** User turn of the logical day that counts as the first real exchange. */
    firstRealExchangeTurn: 3,
    negatives: {
      'unkind': { trustFactor: 0.95, closenessDrop: 0.01, wound: 0 },
      'hurtful': { trustFactor: 0.85, closenessDrop: 0.03, wound: 0.15 },
      'touch-unwelcome-persistent': { trustFactor: 0.97, closenessDrop: 0, wound: 0 },
    },
    /** The unwelcome touch burst of a logical day that counts as persistent. */
    persistentUnwelcomeTouchBurst: 3,
    maxNegativesPerDay: 2,
    maxMilestonesPerDay: 1,
    maxMilestoneIds: 64,
    woundHalfLifeMs: 5 * DAY_MS,
    absence: {
      graceMs: 3 * DAY_MS,
      /** Share of familiarity that absence never erodes. */
      retained: 0.6,
      halfLifeMs: 60 * DAY_MS,
    },
    /** Logical-day rollover hour, local time. */
    rolloverHour: 4,
    stages: {
      closeness: {
        friendly: { up: 0.15, down: 0.1 },
        close: { up: 0.35, down: 0.28 },
        intimate: { up: 0.6, down: 0.52 },
      },
      trust: {
        open: { up: 0.35, down: 0.3 },
        confiding: { up: 0.45, down: 0.39 },
      },
      familiarity: {
        'knows-you': { up: 0.25, down: 0.2 },
      },
    },
    /** A starting stage maps its level to the stage's up-threshold plus this margin. */
    startingStageMargin: 0.01,
    unlocks: {
      teasing: { closeness: 'friendly', trust: 'open' },
      nicknames: { closeness: 'close', familiarity: 'knows-you' },
      initiative: { closeness: 'close' },
      vulnerability: { closeness: 'close', trust: 'confiding' },
      callbacks: { familiarity: 'knows-you', minMilestones: 3 },
    },
  },
  /** One `DailySummary` per completed logical day, newest kept. */
  history: {
    maxRows: 400,
  },
  /** A4, A6: turning a reading into words. */
  rendering: {
    /** Bucket boundaries, ascending; a value at a boundary belongs to the upper bucket. */
    valence: { boundaries: [-0.45, -0.15, 0.15, 0.45], words: ['upset', 'low', 'even', 'good', 'bright'] },
    energy: { boundaries: [-0.45, -0.15, 0.15, 0.45], words: ['drained', 'tired', 'steady', 'lively', 'buzzing'] },
    tension: { boundaries: [0.22, 0.45], words: ['relaxed', 'a little on edge', 'tense'] },
    exitHysteresis: { valence: 0.05, energy: 0.05, tension: 0.04 },
    /** Local hour from which an event of the previous logical day reads as "last night" rather than "yesterday". */
    nightFromHour: 20,
    reasons: {
      maxShown: 2,
      showWeight: 0.04,
      keepWeight: 0.03,
      /** A shown reason also leaves when its weight drops below this share of the best excluded one. */
      keepShareOfBestExcluded: 0.5,
      modelCueWeightFactor: 0.5,
      maxChars: 60,
    },
    stageSentences: {
      stranger: 'you are still getting to know him; keep it polite and a little reserved',
      friendly: 'you are friendly and at ease with him',
      close: 'you are close and comfortable with him',
      intimate: 'you are very close; you can be openly affectionate and say what you feel',
    },
    /** One sentence per unlock, rendered in this order after the stage sentence whenever `unlocksOf` reports it. */
    unlockSentences: {
      teasing: 'you can tease him a little',
      nicknames: 'you may use a nickname for him if you have one',
      initiative: 'you may start conversations and suggest things yourself',
      callbacks: 'you may bring up things you shared before',
      vulnerability: 'you can admit when something hurts',
    },
  },
  /** A8: how mood scales the reach-out urge. */
  urge: {
    weights: { valence: 0.35, energy: 0.15, tension: 0.2 },
    /** Tension only lowers the urge above this level. */
    tensionFloor: 0.3,
    /** Clamp of the exponent; the factor range is `[e^min, e^max]` = [0.67, 1.35]. */
    exponent: { min: -0.4, max: 0.3 },
    pointed: { maxValence: -0.2, minTension: 0.35 },
  },
  /** A9: the damped resting-face offsets. */
  face: {
    damping: { floor: 0.25, graceMs: 2 * MINUTE_MS, halfLifeMs: 20 * MINUTE_MS },
    gains: { mouthForm: 0.35, eyeOpen: 0.15, blinkRateOffset: -0.25, browAngle: 0.4 },
    blinkRateOffsetClamp: 0.4,
    /** Span of each channel the share applies to: mouth form and brow angle in [-1, 1], eye openness in [0, 1]. */
    channelRanges: { mouthForm: 2, eyeOpen: 1, browAngle: 2 },
    /** Each offset stays within this share of its channel range. */
    channelShare: 0.35,
    filterTauMs: 1_500,
  },
})

export type CharacterStateSettings = typeof CHARACTER_STATE_SETTINGS
