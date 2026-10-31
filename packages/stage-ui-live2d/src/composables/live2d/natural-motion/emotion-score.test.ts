import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { ChannelCheck, EmotionGate, EmotionTrialRecord, PlaceboRecord, ScorerInput } from './emotion-score'
import type { NaturalTrace, NaturalTraceEvent } from './trace'

import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { gestureDuckRelease, gestureLifetimes, NaturalGestures } from '@proj-airi/motion-driver-natural/gestures'
import { createRandomStream, gaussian } from '@proj-airi/motion-driver-natural/random'
import { defaultExpressionPerformanceSettings, parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'
import { describe, expect, it } from 'vitest'

import { fitExponential, holmAdjust, measureEmotionTrial, measurePlacebos, naturalEmotionLifetime, naturalFaceResidue, scoreEmotionGate, signFlipPValue, stratifiedUnpairedPValue, unpairedPValue } from './emotion-score'
import { buildEmotionChecks, emotionGate } from './gates'

const pulseAt = emotionGate.scenario.warmup
const ranges = { ParamMouthForm: { min: -1, max: 1, default: 0 } }
const meta: NaturalTrace['meta'] = {
  model: null,
  driver: 'natural',
  energy: 0.5,
  home: 'desk',
  adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 },
  capturedAt: '2026-10-20T00:00:00.000Z',
  durationSeconds: 30,
}

function settingsOf(variant: 'full' | 'held-only'): ExpressionPerformanceSettings {
  return parseExpressionPerformanceSettings(buildEmotionTrial({ emotion: 'angry', band: 'strong', variant, seed: 1 }).settings?.performance ?? {}).value
}

/** Held mouth-form offset: onset 0.25 s for the 4 s hold, then a release with time constant `releaseTau`. */
function heldEffect(relative: number, amplitude: number, releaseTau: number) {
  const { hold } = emotionGate.scenario
  if (relative <= 0)
    return 0
  const onset = (age: number) => 1 - Math.exp(-age / 0.25)
  return relative <= hold ? amplitude * onset(relative) : amplitude * onset(hold) * Math.exp(-(relative - hold) / releaseTau)
}

/** A 30 Hz ParamMouthForm trace with seeded noise (SD 0.05) plus `effect` around the pulse. */
function syntheticTrace(noiseSeed: number, events: NaturalTraceEvent[], effect: (relative: number) => number, seconds = 30, noise = 0.05, times?: number[]): NaturalTrace {
  const random = createRandomStream(noiseSeed)
  const t = times ?? Array.from({ length: seconds * 30 + 1 }, (_, index) => index / 30)
  return { version: 2, t, channels: { ParamMouthForm: t.map(time => noise * gaussian(random) + effect(time - pulseAt)) }, ranges, events, meta }
}

/** Recorder-like timestamps: 0.025, 0.033, and 0.042 s apart in turn (early tolerance), ending at `seconds`. */
function unevenTimes(seconds: number) {
  const steps = [0.025, 0.033, 0.042]
  const times = [0]
  while (times[times.length - 1] < seconds)
    times.push(Math.min(seconds, times[times.length - 1] + steps[times.length % 3]))
  return times
}

function scenario(event: ScenarioEvent): NaturalTraceEvent {
  return { t: event.at, source: 'scenario', event }
}

function trialEvents(trialId: string, emotion: PerformanceEmotion = 'angry', band: Band = 'strong'): NaturalTraceEvent[] {
  return [
    scenario({ kind: 'emotion', at: pulseAt, emotion, band, source: 'devtools', trialId }),
    { t: pulseAt, source: 'natural', event: { kind: 'hold', at: pulseAt, emotion, strength: 0.9, side: 1 } },
  ]
}

/** Paired trials of angry strong: the emotion run carries `amplitude` on ParamMouthForm; `pairedNoise` decides whether the stripped run shares the noise. */
function trials(variant: 'full' | 'held-only', count: number, amplitude: number, pairedNoise: 'same' | 'independent' = 'same', releaseTau = 0.6): EmotionTrialRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1
    const trialId = `angry-strong-${variant}-${seed}`
    const run = syntheticTrace(seed, trialEvents(trialId), relative => heldEffect(relative, amplitude, releaseTau))
    const stripped = syntheticTrace(pairedNoise === 'same' ? seed : seed + 1000, [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })], () => 0)
    return measureEmotionTrial(run, stripped, { trialId, variant, gate: emotionGate, settings: settingsOf(variant) })
  })
}

/**
 * A 110 s long-hold trace with every modulation column: head axes with seeded noise of `headNoise` (half-range
 * units; 0 makes the head stationary), open lids, a 4 s breath, and centered eyes. `marker` picks the scenario event.
 */
function longHoldTrace(trialId: string, seed: number, marker: 'emotion' | 'noop' = 'emotion', headNoise = 0.1): NaturalTrace {
  const random = createRandomStream(seed)
  const t = Array.from({ length: 110 * 30 + 1 }, (_, index) => index / 30)
  const head = () => t.map(() => 30 * headNoise * gaussian(random))
  const unit = { min: -1, max: 1, default: 0 }
  const angle = { min: -30, max: 30, default: 0 }
  return {
    version: 2,
    t,
    channels: {
      ParamAngleX: head(),
      ParamAngleY: head(),
      ParamAngleZ: head(),
      ParamEyeLOpen: t.map(() => 1),
      ParamEyeROpen: t.map(() => 1),
      ParamBreath: t.map(time => 0.5 + 0.5 * Math.sin(2 * Math.PI * time / 4)),
      ParamEyeBallX: t.map(() => 0),
      ParamEyeBallY: t.map(() => 0),
    },
    ranges: { ParamAngleX: angle, ParamAngleY: angle, ParamAngleZ: angle, ParamEyeBallX: unit, ParamEyeBallY: unit, ParamEyeLOpen: { min: 0, max: 1, default: 1 } },
    events: marker === 'emotion' ? trialEvents(trialId) : [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })],
    meta: { ...meta, durationSeconds: 110 },
  }
}

function placebos(): PlaceboRecord[] {
  return [101, 102, 103, 104, 105].flatMap((seed) => {
    const events = Array.from({ length: 10 }, (_, index) => scenario({ kind: 'placebo', at: pulseAt + index * 6, trialId: `placebo-${seed}-${index}` }))
    return measurePlacebos(syntheticTrace(seed, events, () => 0, 90), emotionGate)
  })
}

const mouthFormCheck = buildEmotionChecks().filter(check => check.key === 'angry:strong:mouthForm')
/** The recipe value times the strong nominal: angry mouthForm -0.7 x 0.9. */
const recipeAmplitude = -0.7 * defaultExpressionPerformanceSettings.intensity.strong

function score(input: Partial<ScorerInput> & Pick<ScorerInput, 'trials'>) {
  return scoreEmotionGate({ gate: emotionGate, checks: mouthFormCheck, placebos: placebos(), ranges, ...input })
}

describe('emotion scorer', () => {
  it.each([recipeAmplitude, 0, -recipeAmplitude])('evaluates visibility against a zero-spread null for effect %s', (amplitude) => {
    const nulls: PlaceboRecord[] = Array.from({ length: 10 }, (_, index) => ({ id: `still-${index}`, channels: { mouthForm: 0 } }))
    const stillTrials = trials('full', 12, amplitude).map(trial => ({
      ...trial,
      channels: { mouthForm: { value: amplitude, paired: 0 } },
    }))
    const report = score({ trials: stillTrials, placebos: nulls, criteria: ['visibility'] })
    const result = report.results[0]

    expect(report.nullStats.mouthForm).toEqual({ sigma0: 0, q: 0, n: 10 })
    expect(result.verdict).toBe(amplitude < 0 ? 'pass' : 'fail')
    expect(result.hitRate).toBe(amplitude < 0 ? 1 : 0)
    expect(result.d).toBeNull()
    expect(result.reasons).toContain('visibility: placebo null has zero spread at this level')
    expect(JSON.stringify(report)).not.toContain('Infinity')
  })

  it('measures modulation release when the final sample is within one sample period of the endpoint', () => {
    const trialId = 'angry-strong-long-hold-1'
    const times = Array.from({ length: 110 * 30 + 1 }, (_, index) => Math.max(0, index / 30 - 1 / 120))
    const trace = syntheticTrace(1, trialEvents(trialId), () => 0, 110, 0, times)
    trace.channels.ParamEyeLOpen = times.map(() => 1)
    trace.channels.ParamEyeROpen = times.map(() => 1)
    trace.channels.ParamBreath = times.map(time => Math.sin(2 * Math.PI * time / 4))
    const stripped = { ...trace, events: [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })] }
    const measure = (run: NaturalTrace) => measureEmotionTrial(run, stripped, { trialId, variant: 'long-hold', gate: emotionGate })

    expect(measure(trace).modulationRelease?.breath.paired).not.toBeNull()
    expect(measure(trace).modulationRelease).toBeDefined()
    const short = { ...trace, t: times.slice(0, -2), channels: Object.fromEntries(Object.entries(trace.channels).map(([id, values]) => [id, values.slice(0, -2)])) }
    expect(measure(short).modulationRelease).toBeUndefined()
  })

  it('passes a known effect of the recipe size on every criterion', () => {
    const result = score({ trials: [...trials('full', 12, recipeAmplitude), ...trials('held-only', 8, recipeAmplitude)] }).results[0]
    expect(result.failed).toEqual([])
    expect(result.verdict).toBe('pass')
    expect(result.sizeRatio).toBeGreaterThan(0.95)
    expect(result.sizeRatio).toBeLessThan(1.05)
    expect(result.tau).toBeCloseTo(0.6, 2)
  })

  it('fails significance and sign on a zero effect', () => {
    const result = score({ trials: [...trials('full', 12, 0), ...trials('held-only', 8, 0)] }).results[0]
    expect(result.failed).toEqual(expect.arrayContaining(['significance', 'sign', 'size', 'visibility']))
    expect(result.verdict).toBe('fail')
  })

  it('does not pass pure idle scored as an emotion run', () => {
    const result = score({ trials: [...trials('full', 12, 0, 'independent'), ...trials('held-only', 8, 0, 'independent')] }).results[0]
    expect(result.verdict).toBe('fail')
    expect(result.failed).toEqual(expect.arrayContaining(['size']))
  })

  it('fails sign and size on a sign-flipped recipe', () => {
    const result = score({ trials: [...trials('full', 12, -recipeAmplitude), ...trials('held-only', 8, -recipeAmplitude)] }).results[0]
    expect(result.failed).toEqual(expect.arrayContaining(['sign', 'size']))
    expect(result.E).toBeLessThan(0)
  })

  it('fails the release when the release is three times slower than nominal', () => {
    const result = score({ trials: [...trials('full', 12, recipeAmplitude), ...trials('held-only', 8, recipeAmplitude, 'same', 1.8)] }).results[0]
    expect(result.failed).toContain('release')
  })

  it('generates no checks and passes nothing for a zero recipe table', () => {
    const zero = structuredClone(naturalEmotions)
    for (const spec of Object.values(zero)) {
      if (!spec.held)
        continue
      spec.held.face = { browY: 0, browAngle: 0, oneSidedBrow: 0, eyeSmile: 0, mouthForm: 0, eyeOpenMultiplier: 1, eyeOpenHint: 0, cheek: 0, mouthOpen: 0 }
      spec.held.posture = [0, 0, 0]
      spec.held.modulation = { blinkInterval: 1, breathPeriod: 1, amplitude: 1, cameraFixation: 0, deskWeight: 0, nodSize: 1, nodAcceptance: 0 }
    }
    const checks = buildEmotionChecks(zero)
    expect(checks).toEqual([])
    expect(scoreEmotionGate({ gate: emotionGate, checks, trials: trials('full', 4, 0), placebos: placebos(), ranges }).pass).toBe(false)
  })

  it('applies Holm step-down adjustment in input order', () => {
    expect(holmAdjust([0.01, 0.04, 0.03, 0.005])).toEqual([0.03, 0.06, 0.06, 0.02])
  })

  it('enumerates small sign-flip tests exactly and seeds large ones deterministically', () => {
    expect(signFlipPValue([1, 1, 1], 1e5, createRandomStream(1))).toBe(1 / 8)
    expect(signFlipPValue([0, 0, 0], 1e5, createRandomStream(1))).toBe(1)
    const values = Array.from({ length: 40 }, (_, index) => Math.sin(index) + 0.1)
    expect(signFlipPValue(values, 2000, createRandomStream(7))).toBe(signFlipPValue(values, 2000, createRandomStream(7)))
  })

  it('produces byte-identical results across runs and input orders', () => {
    const records = [...trials('full', 12, recipeAmplitude), ...trials('held-only', 8, recipeAmplitude)]
    const first = JSON.stringify(score({ trials: records }))
    expect(JSON.stringify(score({ trials: records }))).toBe(first)
    expect(JSON.stringify(score({ trials: [...records].reverse() }))).toBe(first)

    const trialId = 'angry-strong-full-1'
    const run = syntheticTrace(1, trialEvents(trialId), relative => heldEffect(relative, recipeAmplitude, 0.6))
    const stripped = syntheticTrace(1, [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })], () => 0)
    const options = { trialId, variant: 'full' as const, gate: emotionGate }
    expect(measureEmotionTrial({ ...run, events: [...run.events].reverse() }, stripped, options)).toEqual(measureEmotionTrial(run, stripped, options))
  }, 20_000)

  it('measures windows by time on unevenly spaced samples', () => {
    const trialId = 'angry-strong-held-only-1'
    const times = unevenTimes(30)
    const run = syntheticTrace(1, trialEvents(trialId), relative => heldEffect(relative, recipeAmplitude, 0.6), 30, 0, times)
    const stripped = syntheticTrace(1, [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })], () => 0, 30, 0, times)
    const record = measureEmotionTrial(run, stripped, { trialId, variant: 'held-only', gate: emotionGate, settings: settingsOf('held-only') })
    const measure = record.channels.mouthForm!
    // Mean held effect over [0.5, 3.5] s: amplitude x (1 - tau / 3 (e^(-0.5/tau) - e^(-3.5/tau))) at tau 0.25.
    expect(measure.value - measure.paired!).toBeCloseTo(recipeAmplitude * (1 - 0.25 / 3 * (Math.exp(-2) - Math.exp(-14))), 2)
    expect(measure.trajectory).toHaveLength(181)
    expect(fitExponential(Array.from({ length: 181 }, (_, index) => 4 + index / 30), measure.trajectory!.map(value => -value), 4).tau).toBeCloseTo(0.6, 2)
  })

  it('recovers tau within 5% from a noise-free exponential', () => {
    const times = Array.from({ length: 181 }, (_, index) => 4 + index / 30)
    const fit = fitExponential(times, times.map(time => 0.5 * Math.exp(-(time - 4) / 0.6) + 0.02), 4)
    expect(Math.abs(fit.tau - 0.6) / 0.6).toBeLessThan(0.05)
    expect(fit.A).toBeCloseTo(0.5, 3)
    expect(fit.c).toBeCloseTo(0.02, 3)
  })

  it('falls back to an unsigned test without hold side metadata', () => {
    const sidedCheck: ChannelCheck[] = buildEmotionChecks().filter(check => check.key === 'question:clear:browAsym')
    const record = (index: number, value: number, variant: 'full' | 'held-only' = 'full'): EmotionTrialRecord => ({
      trialId: `question-clear-${variant}-${index}`,
      emotion: 'question',
      band: 'clear',
      variant,
      side: null,
      rejected: null,
      releaseStart: 4,
      faceResidue: 0,
      channels: { browAsym: { value, paired: null } },
      missing: {},
    })
    const random = createRandomStream(3)
    const records = [
      ...Array.from({ length: 12 }, (_, index) => record(index, (index % 2 ? 1 : -1) * (0.2 + 0.01 * gaussian(random)))),
      ...Array.from({ length: 4 }, (_, index) => record(index, (index % 2 ? 1 : -1) * 0.2, 'held-only')),
    ]
    const nulls = Array.from({ length: 50 }, (_, index) => ({ id: `p-${index}`, channels: { browAsym: 0.02 * gaussian(random) } }))
    const result = scoreEmotionGate({ gate: emotionGate, checks: sidedCheck, trials: records, placebos: nulls, ranges: {} }).results[0]
    expect(result.unsigned).toBe(true)
    expect(result.p).toBeLessThan(0.01)
    expect(result.reasons).toContain('release: needs the hold side')
  })

  it('rejects malformed traces with a reason', () => {
    const trialId = 'angry-strong-full-1'
    const run = syntheticTrace(1, trialEvents(trialId), () => 0)
    expect(() => measureEmotionTrial({ ...run, events: [] }, null, { trialId, variant: 'full', gate: emotionGate })).toThrow(/no events/)
    expect(() => measureEmotionTrial(run, null, { trialId: 'missing', variant: 'full', gate: emotionGate })).toThrow(/no scenario emotion event/)
    // An unknown emotion can only arrive through a trace file, so build it the way a file is read.
    const unknown: NaturalTrace = JSON.parse(JSON.stringify(run).replaceAll('"angry"', '"bored"'))
    expect(() => measureEmotionTrial(unknown, null, { trialId, variant: 'full', gate: emotionGate })).toThrow(/no held recipe/)
    const empty = scoreEmotionGate({ gate: emotionGate, checks: mouthFormCheck, trials: [], placebos: [], ranges }).results[0]
    expect(empty.verdict).toBe('n/a')
    expect(empty.reasons).toContain('significance: no usable full trials')
  })

  it('treats a non-finite window sample as a missing measurement outside the Holm family', () => {
    const trialId = 'angry-strong-full-1'
    const checks = buildEmotionChecks().filter(check => ['angry:strong:mouthForm', 'angry:strong:angleY'].includes(check.key))
    const rangesWithHead = { ...ranges, ParamAngleY: { min: -30, max: 30, default: 0 } }
    const measureTrial = (nanAt: number | null) => {
      const run = syntheticTrace(1, trialEvents(trialId), relative => heldEffect(relative, recipeAmplitude, 0.6))
      const head = run.t.map((time, index) => (index % 7 - 3) * 0.1 + (time > pulseAt ? -3 : 0))
      if (nanAt !== null)
        run.channels.ParamMouthForm[Math.round((pulseAt + nanAt) * 30)] = Number.NaN
      return measureEmotionTrial({ ...run, channels: { ...run.channels, ParamAngleY: head }, ranges: rangesWithHead }, null, { trialId, variant: 'full', gate: emotionGate })
    }
    const scoreOf = (nanAt: number | null) => scoreEmotionGate({ gate: emotionGate, checks, trials: [measureTrial(nanAt)], placebos: [], ranges: rangesWithHead, criteria: ['significance'] })
    const familySize = (results: ReturnType<typeof scoreOf>['results']) => results.filter(result => result.pHolm !== null).length

    const clean = scoreOf(null)
    expect(familySize(clean.results)).toBe(checks.length)

    const record = measureTrial(1)
    expect(record.channels.mouthForm).toBeUndefined()
    expect(record.missing.mouthForm).toContain('non-finite')
    expect(record.channels.angleY).toBeDefined()

    const { results } = scoreOf(1)
    const mouthForm = results.find(result => result.channel === 'mouthForm')!
    expect(mouthForm.verdict).toBe('n/a')
    expect(mouthForm.failed).toEqual([])
    expect(mouthForm.p).toBeNull()
    expect(mouthForm.pHolm).toBeNull()
    expect(mouthForm.reasons).toContain(`${trialId} cannot measure mouthForm: ${record.missing.mouthForm}`)
    expect(familySize(results)).toBe(checks.length - 1)
    // The remaining channel is adjusted alone, so Holm leaves its p-value unchanged.
    const angleY = results.find(result => result.channel === 'angleY')!
    expect(angleY.pHolm).toBe(angleY.p)
  })

  describe('unpaired significance', () => {
    // A skewed idle distribution: -0.01 with probability 0.9, +0.09 with probability 0.1 (mean 0).
    const skewed = (random: () => number) => random() < 0.9 ? -0.01 : 0.09
    const unpairedTrial = (index: number, value: number): EmotionTrialRecord => ({
      trialId: `angry-strong-full-${index}`,
      emotion: 'angry',
      band: 'strong',
      variant: 'full',
      side: null,
      rejected: null,
      releaseStart: 4,
      faceResidue: 0,
      channels: { mouthForm: { value, paired: null } },
      missing: {},
    })
    const nullOf = (values: number[]): PlaceboRecord[] => values.map((value, index) => ({ id: `p-${index}`, channels: { mouthForm: value } }))
    const scoreOf = (trialValues: number[], nullValues: number[], gate: EmotionGate = emotionGate) =>
      scoreEmotionGate({ gate, checks: mouthFormCheck, trials: trialValues.map((value, index) => unpairedTrial(index, value)), placebos: nullOf(nullValues), ranges, criteria: ['significance'] }).results[0]

    it('matches the exact two-sample null on a skewed fixture', () => {
      // Ten ordinary trials against 45 ordinary and 5 large placebo values: the trials look extreme exactly when a
      // random 10-subset of the 60 pooled values holds no large value, C(55, 10) / C(60, 10) = 0.3876.
      const exact = Array.from({ length: 10 }, (_, k) => (55 - k) / (60 - k)).reduce((product, factor) => product * factor, 1)
      const result = scoreOf(Array.from<number>({ length: 10 }).fill(-0.01), [...Array.from<number>({ length: 45 }).fill(-0.01), ...Array.from<number>({ length: 5 }).fill(0.09)])
      expect(Math.abs(result.p! - exact)).toBeLessThan(0.005)
      expect(result.verdict).toBe('fail')
    })

    it('keeps the false-pass rate of same-distribution skewed samples within alpha + 3 sigma', () => {
      const random = createRandomStream(20261020)
      // Fewer permutations than the committed gate keep 2000 scorings fast; the smallest p (1 / 2001) stays below alpha.
      const gate: EmotionGate = { ...emotionGate, family: { ...emotionGate.family, permutations: 2000, bootstrap: 1 } }
      const draws = 2000
      let passes = 0
      for (let draw = 0; draw < draws; draw++) {
        const result = scoreOf(Array.from({ length: 10 }, () => skewed(random)), Array.from({ length: 50 }, () => skewed(random)), gate)
        if (result.pHolm! <= emotionGate.family.alpha)
          passes++
      }
      const alpha = emotionGate.family.alpha
      expect(passes / draws).toBeLessThanOrEqual(alpha + 3 * Math.sqrt(alpha * (1 - alpha) / draws))
    })

    it('recomputes the signed effect per bootstrap draw, so a common shift moves neither E nor the CI', () => {
      const sided = buildEmotionChecks().filter(check => check.key === 'question:clear:browAsym')
      const random = createRandomStream(9)
      const sides = Array.from({ length: 12 }, (_, index) => (index % 3 === 0 ? -1 : 1) as -1 | 1)
      const trialValues = sides.map(side => 0.02 * side + 0.01 * gaussian(random))
      const nullValues = Array.from({ length: 60 }, () => 0.01 * gaussian(random))
      const scoreShifted = (shift: number) => scoreEmotionGate({
        gate: emotionGate,
        checks: sided,
        trials: trialValues.map((value, index) => ({ ...unpairedTrial(index, 0), emotion: 'question' as const, band: 'clear' as const, trialId: `question-clear-full-${index}`, side: sides[index], channels: { browAsym: { value: value + shift, paired: null } } })),
        placebos: nullValues.map((value, index) => ({ id: `p-${index}`, channels: { browAsym: value + shift } })),
        ranges: {},
        criteria: ['significance', 'sign'],
      }).results[0]
      const base = scoreShifted(0)
      const shifted = scoreShifted(0.2)
      expect(shifted.E).toBeCloseTo(base.E!, 12)
      expect(shifted.p).toBe(base.p)
      expect(shifted.ci![0]).toBeCloseTo(base.ci![0], 9)
      expect(shifted.ci![1]).toBeCloseTo(base.ci![1], 9)
      expect(base.ci![0]).toBeLessThanOrEqual(base.E!)
      expect(base.ci![1]).toBeGreaterThanOrEqual(base.E!)
    })

    it('enumerates exactly when the trial sample is larger than the placebo pool', () => {
      // C(15, 12) = 455 relabelings; the single 1 lands among the trials in C(14, 11) = 364 of them.
      const sample = [1, ...Array.from<number>({ length: 11 }).fill(0)]
      expect(unpairedPValue(sample, Array.from<number>({ length: 12 }).fill(1), [0, 0, 0], 1000, createRandomStream(1))).toBeCloseTo(364 / 455, 12)
    })

    it('still passes a clear shift below the placebo pool', () => {
      const random = createRandomStream(5)
      const result = scoreOf(Array.from({ length: 40 }, () => skewed(random) - 0.05), Array.from({ length: 500 }, () => skewed(random)))
      expect(result.pHolm).toBeLessThan(emotionGate.family.alpha)
      expect(result.E).toBeGreaterThan(0.03)
      expect(result.verdict).toBe('pass')
    })
  })

  it('drops one non-finite trial of many from the permutation test and keeps the rest', () => {
    const records = trials('full', 12, recipeAmplitude)
    const trialId = 'angry-strong-full-nan'
    const run = syntheticTrace(99, trialEvents(trialId), relative => heldEffect(relative, recipeAmplitude, 0.6))
    run.channels.ParamMouthForm[Math.round((pulseAt + 1) * 30)] = Number.NaN
    const stripped = syntheticTrace(99, [scenario({ kind: 'noop', at: pulseAt, replaced: 'emotion', trialId })], () => 0)
    const dropped = measureEmotionTrial(run, stripped, { trialId, variant: 'full', gate: emotionGate })
    // A record written elsewhere with a non-finite derived value takes the scorer-side path of the same rule.
    const derived: EmotionTrialRecord = { ...records[0], trialId: 'angry-strong-full-derived', channels: { mouthForm: { value: Number.NaN, paired: 0 } } }
    const scoreOf = (list: EmotionTrialRecord[]) => score({ trials: list, criteria: ['significance'] }).results[0]

    const clean = scoreOf(records)
    const mixed = scoreOf([...records, dropped, derived])
    expect(dropped.missing.mouthForm).toContain('non-finite')
    expect(mixed.n).toBe(12)
    expect(mixed.p).toBe(clean.p)
    expect(mixed.pHolm).toBe(clean.pHolm)
    expect(Number.isFinite(mixed.E)).toBe(true)
    expect(mixed.verdict).toBe('pass')
    expect(mixed.reasons).toContain(`angry-strong-full-derived cannot measure mouthForm: non-finite mouthForm measurement (value NaN)`)
  })

  it.each([
    ['blinkRate', 'ParamEyeLOpen'],
    ['breathPeriod', 'ParamBreath'],
    ['headRms', 'ParamAngleX'],
    ['cameraFixation', 'ParamEyeBallX'],
  ] as const)('treats a non-finite sample in the %s modulation window as missing', (channel, column) => {
    const trialId = 'angry-strong-long-hold-nan'
    const trace = longHoldTrace(trialId, 1)
    trace.channels[column][Math.round((pulseAt + emotionGate.windows.modulation[0] + 1) * 30)] = Number.NaN
    const record = measureEmotionTrial(trace, longHoldTrace(trialId, 1, 'noop'), { trialId, variant: 'long-hold', gate: emotionGate })
    expect(record.channels[channel]).toBeUndefined()
    expect(record.missing[channel]).toContain('non-finite')
  })

  it.each([1, emotionGate.seeds.longHold.count])('keeps identical stationary head traces out of significance at n = %i', (count) => {
    const trialId = 'angry-strong-long-hold-still'
    const still = longHoldTrace(trialId, 1, 'emotion', 0)
    const record = measureEmotionTrial(still, longHoldTrace(trialId, 1, 'noop', 0), { trialId, variant: 'long-hold', gate: emotionGate })
    expect(record.channels.headRms).toBeUndefined()
    expect(record.missing.headRms).toBe('non-finite headRms log ratio (zero RMS)')

    const headRms = buildEmotionChecks().filter(check => check.key === 'angry:strong:headRms')
    const copies = (base: EmotionTrialRecord) => Array.from({ length: count }, (_, index) => ({ ...base, trialId: `${trialId}-${index}` }))
    // The pre-fix record shape (both logs -Infinity) must also stay out, through the scorer-side rule.
    const legacy: EmotionTrialRecord = { ...record, channels: { headRms: { value: Number.NEGATIVE_INFINITY, paired: Number.NEGATIVE_INFINITY } }, missing: {} }
    for (const list of [copies(record), copies(legacy)]) {
      const report = scoreEmotionGate({ gate: emotionGate, checks: headRms, trials: list, placebos: [], ranges: still.ranges, criteria: ['significance'] })
      const result = report.results[0]
      expect(result.verdict).toBe('n/a')
      expect(result.n).toBe(0)
      expect(result.p).toBeNull()
      expect(result.pHolm).toBeNull()
      expect(result.E).toBeNull()
      expect(report.results.filter(entry => entry.pHolm !== null)).toHaveLength(0)
      expect(result.reasons).toContain('significance: no usable long-hold trials')
    }
  })

  it('drops one stationary long-hold trial from the headRms test and keeps the rest', () => {
    const headRms = buildEmotionChecks().filter(check => check.key === 'angry:strong:headRms')
    const measure = (seed: number, amplitude: number) => {
      const trialId = `angry-strong-long-hold-${seed}`
      return measureEmotionTrial(longHoldTrace(trialId, seed, 'emotion', amplitude), longHoldTrace(trialId, seed + 1000, 'noop', amplitude), { trialId, variant: 'long-hold', gate: emotionGate })
    }
    const moving = Array.from({ length: 8 }, (_, index) => measure(index + 1, 0.1))
    const scoreOf = (list: EmotionTrialRecord[]) => scoreEmotionGate({ gate: emotionGate, checks: headRms, trials: list, placebos: [], ranges: longHoldTrace('x', 1).ranges, criteria: ['significance'] })
    const clean = scoreOf(moving)
    const mixed = scoreOf([...moving, measure(50, 0)])
    expect(mixed.results[0].n).toBe(8)
    expect(mixed.results[0].p).toBe(clean.results[0].p)
    expect(Number.isFinite(mixed.results[0].p)).toBe(true)
    expect(mixed.results.filter(entry => entry.pHolm !== null)).toHaveLength(1)
  })

  it('rejects a trial whose window overlaps another emotion within its lifetime', () => {
    const trialId = 'angry-strong-full-1'
    const other = (at: number) => scenario({ kind: 'emotion', at, emotion: 'happy', band: 'clear', source: 'devtools', trialId: 'other' })
    const measure = (at: number, variant: 'full' | 'held-only') => measureEmotionTrial(syntheticTrace(1, [...trialEvents(trialId), other(at)], () => 0), null, { trialId, variant, gate: emotionGate }).rejected
    // An earlier pulse whose lifetime (8.7 s at clear) reaches the baseline contaminates the trial.
    expect(measure(pulseAt - 5, 'full')).toMatch(/overlaps the trial window/)
    // A later pulse falls outside the full window [-1, 4] s but inside the held-only release window [-1, 10] s.
    expect(measure(pulseAt + 8, 'full')).toBeNull()
    expect(measure(pulseAt + 8, 'held-only')).toMatch(/overlaps the trial window/)
  })
})

describe('emotion lifetimes', () => {
  it('bounds every gesture clip the gesture layer can draw', () => {
    for (const kind of ['laugh', 'recoil', 'shake-or-drop', 'sway', 'tilt-in', 'look-away', 'nod-off'] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const gestures = new NaturalGestures(createRandomStream(seed))
        let played: keyof typeof gestureLifetimes | undefined
        expect(gestures.trigger(kind, 1, 'strong', 0, (gesture) => {
          played = gesture
        })).toBe(true)
        expect(gestures.activeUntil()).toBeLessThanOrEqual(gestureLifetimes[played!] + 1e-12)
      }
    }
  })

  it('keeps every held-only face residue clear of the release fit window, and every full one inside it', () => {
    const heldOnly = settingsOf('held-only')
    for (const band of ['slight', 'clear', 'strong'] as const) {
      expect(naturalFaceResidue(heldOnly, band)).toBeLessThanOrEqual(emotionGate.release.window[0])
      expect(naturalFaceResidue(defaultExpressionPerformanceSettings, band)).toBeGreaterThan(emotionGate.release.window[0])
    }
    // The laugh also writes a smile and a mouth opening, so it counts as face residue with held emotions on.
    for (const band of ['clear', 'strong'] as const) {
      const shortGlance = structuredClone(heldOnly)
      shortGlance.naturalBands[band].faceHold = 0
      expect(naturalFaceResidue(shortGlance, band)).toBe(gestureLifetimes.laugh)
      expect(naturalFaceResidue({ ...shortGlance, heldEmotions: false }, band)).toBeLessThan(gestureLifetimes.laugh)
    }
    expect(naturalFaceResidue({ ...heldOnly, heldEmotions: true }, 'slight')).toBeLessThan(gestureLifetimes.laugh)
    // Held-only still plays gesture clips: the full lifetime outlives the hold, so posture is never release-scored.
    expect(naturalEmotionLifetime(heldOnly, 'strong')).toBe(Math.max(...Object.values(gestureLifetimes)) + gestureDuckRelease)
    expect(naturalEmotionLifetime(heldOnly, 'strong')).toBeGreaterThan(emotionGate.scenario.hold)
  })
})

describe('session-stratified unpaired scoring', () => {
  const sign = mouthFormCheck[0].sign
  const trial = (index: number, value: number, stratum: string): EmotionTrialRecord => ({
    trialId: `angry-strong-full-${String(index).padStart(2, '0')}`,
    emotion: 'angry',
    band: 'strong',
    variant: 'full',
    side: null,
    rejected: null,
    releaseStart: 4,
    faceResidue: 0,
    channels: { mouthForm: { value, paired: null } },
    missing: {},
    stratum,
  })
  const placebo = (id: string, value: number, stratum: string): PlaceboRecord => ({ id, channels: { mouthForm: value }, stratum })
  const withoutStrata = <T extends { stratum?: string }>(records: T[]) => records.map(({ stratum: _, ...rest }) => rest as T)
  /** Sessions: trial and placebo values drawn as `level + sd * gaussian`, trials shifted by `effect` in the recipe direction. */
  function sessions(spec: { key: string, level: number, sd: number, trials: number, placebos: number, effect: number }[], seed: number) {
    const random = createRandomStream(seed)
    const trials: EmotionTrialRecord[] = []
    const placebos: PlaceboRecord[] = []
    for (const session of spec) {
      for (let index = 0; index < session.trials; index++)
        trials.push(trial(trials.length, session.level + sign * session.effect + session.sd * gaussian(random), session.key))
      for (let index = 0; index < session.placebos; index++)
        placebos.push(placebo(`${session.key}-p${index}`, session.level + session.sd * gaussian(random), session.key))
    }
    return { trials, placebos }
  }
  const score = (trials: EmotionTrialRecord[], placebos: PlaceboRecord[]) =>
    scoreEmotionGate({ gate: emotionGate, checks: mouthFormCheck, trials, placebos, ranges, criteria: ['significance', 'sign', 'visibility'] })

  it('uses each session\'s own null where the pooled null misleads, in both directions', () => {
    // No effect, but the trials sit in a session whose idle level is shifted in the recipe direction: the pooled null
    // reads that shift as an effect, the session's own null does not.
    const shifted = sessions([
      { key: 'a', level: 0, sd: 0.01, trials: 0, placebos: 24, effect: 0 },
      { key: 'b', level: sign * 0.2, sd: 0.01, trials: 10, placebos: 4, effect: 0 },
      { key: 'c', level: 0, sd: 0.01, trials: 0, placebos: 24, effect: 0 },
    ], 3)
    const pooledShift = score(withoutStrata(shifted.trials), withoutStrata(shifted.placebos)).results[0]
    const stratifiedShift = score(shifted.trials, shifted.placebos).results[0]
    expect(pooledShift.hits!).toBeGreaterThanOrEqual(9)
    expect(stratifiedShift.hits!).toBeLessThan(pooledShift.hits!)
    expect(stratifiedShift.E!).toBeLessThan(pooledShift.E! - 0.1)
    expect(Math.abs(stratifiedShift.E!)).toBeLessThan(0.02)

    // A real effect in a quiet session hides under the wide pooled q90 of two noisy sessions; its own null shows it.
    const quiet = sessions([
      { key: 'a', level: 0, sd: 0.005, trials: 10, placebos: 17, effect: 0.03 },
      { key: 'b', level: 0, sd: 0.15, trials: 0, placebos: 17, effect: 0 },
      { key: 'c', level: 0, sd: 0.15, trials: 0, placebos: 18, effect: 0 },
    ], 4)
    const pooledQuiet = score(withoutStrata(quiet.trials), withoutStrata(quiet.placebos))
    const stratifiedQuiet = score(quiet.trials, quiet.placebos)
    expect(stratifiedQuiet.results[0].hits).toBe(10)
    expect(pooledQuiet.results[0].hits!).toBeLessThan(stratifiedQuiet.results[0].hits!)
    expect(Object.keys(stratifiedQuiet.strataNullStats ?? {})).toEqual(['a', 'b', 'c'])
    expect(pooledQuiet.strataNullStats).toBeUndefined()
  })

  it('keeps the false-pass rate within alpha + 3 sigma when each session holds one distribution', () => {
    const random = createRandomStream(20261021)
    const alpha = emotionGate.family.alpha
    const draws = 2000
    let passes = 0
    for (let draw = 0; draw < draws; draw++) {
      const strata = [0, 0.3, -0.2].map(level => ({
        sample: Array.from({ length: 4 }, () => level + 0.05 * gaussian(random)),
        signs: [1, 1, 1, 1],
        reference: Array.from({ length: 17 }, () => level + 0.05 * gaussian(random)),
      }))
      if (stratifiedUnpairedPValue(strata, 999, random) <= alpha)
        passes++
    }
    expect(passes / draws).toBeLessThanOrEqual(alpha + 3 * Math.sqrt(alpha * (1 - alpha) / draws))
  })

  it('passes a clear shift in every session', () => {
    const { trials, placebos } = sessions([
      { key: 'a', level: 0, sd: 0.02, trials: 4, placebos: 17, effect: 0.2 },
      { key: 'b', level: 0.1, sd: 0.02, trials: 3, placebos: 17, effect: 0.2 },
      { key: 'c', level: -0.1, sd: 0.02, trials: 3, placebos: 18, effect: 0.2 },
    ], 5)
    const result = score(trials, placebos).results[0]
    expect(result.pHolm).toBeLessThan(emotionGate.family.alpha)
    expect(result.hits).toBe(10)
    expect(result.E).toBeCloseTo(0.2, 1)
    expect(result.verdict).not.toBe('fail')
  })

  it('reduces to the unpaired test for one session and enumerates small joint relabelings exactly', () => {
    const sample = [0.3, 0.1, 0.2]
    const reference = [0, 0.05, -0.02, 0.01]
    expect(stratifiedUnpairedPValue([{ sample, signs: [1, 1, 1], reference }], 1000, createRandomStream(2)))
      .toBe(unpairedPValue(sample, [1, 1, 1], reference, 1000, createRandomStream(2)))

    // Two sessions of C(3, 1) relabelings each: 9 joint relabelings, counted by hand below.
    const strata = [{ sample: [1], signs: [1], reference: [0, 0.5] }, { sample: [0.2], signs: [1], reference: [0.1, 0] }]
    const effect = (x: number[], r: number[][]) => x.reduce((sum, value, index) => sum + value - r[index].reduce((a, b) => a + b, 0) / r[index].length, 0) / x.length
    const pools = strata.map(stratum => [...stratum.sample, ...stratum.reference])
    const observed = effect([1, 0.2], [[0, 0.5], [0.1, 0]])
    let hits = 0
    for (const first of [0, 1, 2]) {
      for (const second of [0, 1, 2]) {
        const value = effect([pools[0][first], pools[1][second]], [pools[0].filter((_, index) => index !== first), pools[1].filter((_, index) => index !== second)])
        if (value >= observed - 1e-12)
          hits++
      }
    }
    expect(stratifiedUnpairedPValue(strata, 1000, createRandomStream(3))).toBeCloseTo(hits / 9, 12)
  })

  it('refuses a run that mixes stratified and unstratified records', () => {
    const { trials, placebos } = sessions([{ key: 'a', level: 0, sd: 0.02, trials: 3, placebos: 5, effect: 0 }], 6)
    expect(() => score(withoutStrata(trials), placebos)).toThrow('stratum')
  })
})
