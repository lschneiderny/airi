import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseBands } from './load'
import { bandSide, metricMeaning, UNDESCRIBED_METRICS } from './meaning'

const bands = parseBands(JSON.parse(readFileSync(new URL('../../../fixtures/motion3d/bands-v3.json', import.meta.url), 'utf8')))
const talk = (id: string) => bands.classes.talk?.metrics[id] ?? null

describe('bandSide', () => {
  it('puts a value above the upper edge and one below the lower edge on opposite sides with opposite meanings', () => {
    const band = talk('smooth.armL.ldlj')
    expect(bandSide('smooth.armL.ldlj', -3.8, band)).toEqual({ side: 'above upper edge', edge: band?.hi, meaning: 'smoother than the reference pool' })
    expect(bandSide('smooth.armL.ldlj', -14, band)).toEqual({ side: 'below lower edge', edge: band?.lo, meaning: 'jerkier than the reference pool' })
    expect(bandSide('smooth.armL.ldlj', -9, band)).toBeNull()
  })

  it('gives a Fisher-z edge back in correlation units', () => {
    const band = talk('chain.spine-chest.zeroLagCorr')
    const side = bandSide('chain.spine-chest.zeroLagCorr', 0.9999, band)
    expect(side?.side).toBe('above upper edge')
    expect(side?.edge).toBeCloseTo(Math.tanh(band?.hi ?? Number.NaN), 12)
    expect(bandSide('chain.spine-chest.zeroLagCorr', 0.5, band)).toBeNull()
  })

  it('compares a declared band with its declared limit', () => {
    expect(bandSide('gesture.strokeP', 0.2, talk('gesture.strokeP'))?.meaning).toMatch(/than the declared limit$/)
  })

  it('describes every metric in the frozen bands or lists it as undescribed', () => {
    const ids = new Set(Object.values(bands.classes).flatMap(c => Object.keys(c.metrics)))
    expect([...ids].filter(id => !metricMeaning(id) && !UNDESCRIBED_METRICS.includes(id))).toEqual([])
  })
})
