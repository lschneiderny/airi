import type { Band, ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { ChannelCheck, EmotionTrialRecord, PlaceboRecord, ScorerInput } from './emotion-score'
import type { NaturalTrace, NaturalTraceEvent } from './trace'

import { defaultExpressionPerformanceSettings, parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'
import { describe, expect, it } from 'vitest'

import { fitExponential, holmAdjust, measureEmotionTrial, measurePlacebos, naturalEmotionLifetime, naturalFaceResidue, scoreEmotionGate, signFlipPValue } from './emotion-score'
import { naturalEmotions } from './emotions'
import { buildEmotionChecks, emotionGate } from './gates'
import { gestureLifetimes, NaturalGestures } from './gestures'
import { createRandomStream, gaussian } from './random'

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
  })

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
    // Held-only still plays gesture clips: the full lifetime outlives the hold, so posture is never release-scored.
    expect(naturalEmotionLifetime(heldOnly, 'strong')).toBe(Math.max(...Object.values(gestureLifetimes)))
    expect(naturalEmotionLifetime(heldOnly, 'strong')).toBeGreaterThan(emotionGate.scenario.hold)
  })
})
