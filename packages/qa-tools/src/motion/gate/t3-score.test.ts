import type { EmotionTrialRecord, PlaceboRecord, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { T3ReleaseRecord } from './t3-score'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { releaseGrid, scoredChannels } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks, emotionGate, naturalEmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, expect, it } from 'vitest'

import { scoreT3Emotion, t3TransferRatio } from './t3-score'

// Fewer permutations keep the test fast; the wiring under test does not depend on the count.
const gate = { ...emotionGate, family: { ...emotionGate.family, permutations: 2000, bootstrap: 200 } }
const settings = defaultExpressionPerformanceSettings
const checks = buildEmotionChecks().filter(check => naturalEmotionT3Gate.cells.some(cell => cell.emotion === check.emotion && cell.band === check.band))
const channels = Object.keys(scoredChannels).filter(channel => scoredChannels[channel as ScoredChannel] !== 'modulation') as ScoredChannel[]

/** Ten unpaired trials per cell over two sessions with a clear effect in each check's direction, fifty placebo windows of small noise. */
function fixture(releaseTau: number) {
  const random = createRandomStream(11)
  const noise = () => (random() - 0.5) * 0.02
  const records: EmotionTrialRecord[] = []
  const release: T3ReleaseRecord[] = []
  const grid = releaseGrid(gate)
  for (const cell of naturalEmotionT3Gate.cells) {
    for (let trial = 1; trial <= naturalEmotionT3Gate.trialsPerCell; trial++) {
      const trialId = `${cell.emotion}-${cell.band}-t3-${trial}`
      const measured: EmotionTrialRecord['channels'] = {}
      const trajectories: T3ReleaseRecord['channels'] = {}
      for (const channel of channels) {
        const check = checks.find(entry => entry.emotion === cell.emotion && entry.band === cell.band && entry.channel === channel)
        measured[channel] = { value: (check ? check.sign * 0.3 : 0) + noise(), paired: null }
        if (check)
          trajectories[channel] = grid.map(time => check.sign * 0.3 * Math.exp(-(time - 4) / releaseTau))
      }
      records.push({ trialId, emotion: cell.emotion, band: cell.band, variant: 'full', side: 1, rejected: null, releaseStart: 4, faceResidue: 0, channels: measured, missing: {}, stratum: trial % 2 === 0 ? 'session-1' : 'session-2' })
      release.push({ trialId, emotion: cell.emotion, band: cell.band, side: 1, channels: trajectories })
    }
  }
  // Session 2 idles 0.05 higher on every channel; stratified scoring must not mistake that for an effect.
  const placebos: PlaceboRecord[] = Array.from({ length: 50 }, (_, index) => ({ id: `placebo-${index}`, stratum: index % 2 === 0 ? 'session-1' : 'session-2', channels: Object.fromEntries(channels.map(channel => [channel, noise() + (index % 2 === 0 ? 0 : 0.05)])) }))
  for (const record of records) {
    if (record.stratum === 'session-2') {
      for (const measure of Object.values(record.channels))
        measure!.value += 0.05
    }
  }
  return { records, placebos, release }
}

function score(releaseTau: number, t1Scale: number) {
  const { records, placebos, release } = fixture(releaseTau)
  const first = scoreT3Emotion({ t3: naturalEmotionT3Gate, gate, records, placebos, release, ranges: {}, settings, t1Effects: new Map() })
  const t1Effects = new Map(first.results.map(result => [result.key, result.E === null ? null : result.E * t1Scale]))
  return { records, placebos, result: scoreT3Emotion({ t3: naturalEmotionT3Gate, gate, records, placebos, release, ranges: {}, settings, t1Effects }) }
}

describe('t3TransferRatio', () => {
  it('divides the T3 effect by the T1 effect and refuses missing or zero inputs', () => {
    expect(t3TransferRatio(0.3, 0.25)).toBeCloseTo(1.2, 12)
    expect(t3TransferRatio(null, 0.25)).toBeNull()
    expect(t3TransferRatio(0.3, null)).toBeNull()
    expect(t3TransferRatio(0.3, 0)).toBeNull()
    expect(t3TransferRatio(Number.NaN, 0.2)).toBeNull()
  })
})

describe('scoreT3Emotion', () => {
  it('scores unpaired through the shared scorer and passes a clean effect that matches T1', () => {
    const { records, placebos, result } = score(settings.held.releaseTau, 1)
    expect(result.pass).toBe(true)
    const browMean = result.results.find(entry => entry.key === 'angry:strong:browMean')!
    // Stratified E: the mean of each trial minus its own session's placebo mean (every trial has paired = null).
    const sign = checks.find(check => check.key === 'angry:strong:browMean')!.sign
    const nullMean = (stratum: string) => {
      const values = placebos.filter(placebo => placebo.stratum === stratum).map(placebo => placebo.channels.browMean!)
      return values.reduce((a, b) => a + b, 0) / values.length
    }
    const differences = records.filter(record => record.emotion === 'angry').map(record => sign * (record.channels.browMean!.value - nullMean(record.stratum!)))
    expect(browMean.E).toBeCloseTo(differences.reduce((a, b) => a + b, 0) / differences.length, 12)
    expect(Object.keys(result.strataNullStats)).toEqual(['session-1', 'session-2'])
    expect(browMean).toMatchObject({ gated: true, verdict: 'pass', hits: 10, transferRatio: 1, failed: [] })
    expect(browMean.tau).toBeCloseTo(settings.held.releaseTau, 2)
  })

  it('reports posture without gating it, and pools it per channel', () => {
    const { result } = score(settings.held.releaseTau, 1)
    const posture = result.results.filter(entry => scoredChannels[entry.channel] === 'posture')
    expect(posture.length).toBeGreaterThan(0)
    expect(posture.every(entry => entry.gated === false && entry.verdict === 'n/a')).toBe(true)
    expect(result.posture.reduce((sum, pool) => sum + pool.checks, 0)).toBe(posture.length)
    expect(result.results.some(entry => scoredChannels[entry.channel] === 'modulation')).toBe(false)
  })

  it('lists a check whose parameter the rig lacks without gating it', () => {
    const { records, placebos, release } = fixture(settings.held.releaseTau)
    const withoutMouthForm = records.map(record => ({ ...record, channels: { ...record.channels, mouthForm: undefined }, missing: { mouthForm: 'trace has no ParamMouthForm column' } }))
    const result = scoreT3Emotion({ t3: naturalEmotionT3Gate, gate, records: withoutMouthForm, placebos, release, ranges: {}, settings, t1Effects: new Map() })
    const mouthForm = result.results.filter(entry => entry.channel === 'mouthForm')
    expect(mouthForm.length).toBeGreaterThan(0)
    expect(mouthForm.every(entry => entry.gated === false && entry.verdict === 'n/a' && entry.reasons.some(reason => reason.startsWith('rig: trace has no ParamMouthForm')))).toBe(true)
  })

  it('fails transfer outside the ratio band and a grossly slow release', () => {
    const transfer = score(settings.held.releaseTau, 2).result
    expect(transfer.pass).toBe(false)
    expect(transfer.results.filter(entry => entry.gated && scoredChannels[entry.channel] === 'face').every(entry => entry.failed.includes('transfer'))).toBe(true)

    const slow = score(settings.held.releaseTau * 5, 1).result
    expect(slow.pass).toBe(false)
    expect(slow.results.find(entry => entry.key === 'angry:strong:browMean')!.failed).toEqual(['release'])
  })
})
