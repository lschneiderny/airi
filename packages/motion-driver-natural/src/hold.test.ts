import type { HeldFaceOffsets } from './hold'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { NaturalHoldLayer } from './hold'

const dt = 1 / 120
const settings = defaultExpressionPerformanceSettings.held
const snapshot = (layer: NaturalHoldLayer) => ({ level: layer.level, face: layer.face(), posture: layer.posture(), modulation: layer.modulation() })

function advance(layer: NaturalHoldLayer, seconds: number) {
  for (let i = 0; i < Math.round(seconds / dt); i++)
    layer.step(dt)
}

function brows(face: HeldFaceOffsets) {
  return [face.browY + Math.max(0, face.oneSidedBrow), face.browY + Math.max(0, -face.oneSidedBrow)]
}

describe('natural held emotion layer', () => {
  it('reaches 95% on onset within three onset time constants', () => {
    const layer = new NaturalHoldLayer()
    layer.set({ emotion: 'happy', strength: 0.6 })

    advance(layer, 3 * settings.onsetTau)

    expect(layer.level).toBeGreaterThanOrEqual(0.95)
    expect(layer.face().eyeSmile).toBeCloseTo(1.6 * 0.6 * (1 - Math.exp(-3)), 12)
  })

  it('releases with the exact configured exponential before settling exactly neutral', () => {
    const layer = new NaturalHoldLayer()
    const neutral = snapshot(layer)
    layer.set({ emotion: 'happy', strength: 0.6 })
    advance(layer, 1)
    const before = layer.face().eyeSmile
    layer.set(null)

    layer.step(4 * settings.releaseTau)

    expect(layer.face().eyeSmile).toBeCloseTo(before * Math.exp(-4), 14)
    expect(layer.face().eyeSmile).toBeGreaterThan(0)
    advance(layer, 30)
    expect(layer.emotion).toBeNull()
    expect(snapshot(layer)).toEqual(neutral)
  })

  it('changes happy to sad without jumping any face or posture channel', () => {
    const layer = new NaturalHoldLayer()
    layer.set({ emotion: 'happy', strength: 1 })
    advance(layer, 2)
    const before = snapshot(layer)

    layer.set({ emotion: 'sad', strength: 1 })

    expect(snapshot(layer)).toEqual(before)
    layer.step(dt)
    const after = snapshot(layer)
    const faceDelta = Object.values(after.face).map((value, index) => Math.abs(value - Object.values(before.face)[index]))
    expect(Math.max(...faceDelta)).toBeLessThanOrEqual(dt / settings.onsetTau * 1.8)
    expect(Math.max(...after.posture.map((value, axis) => Math.abs(value - before.posture[axis])))).toBeLessThanOrEqual(dt / settings.postureTau * 0.28)
  })

  it('keeps actual brow contributions continuous when the deterministic side switches', () => {
    const layer = new NaturalHoldLayer()
    layer.set({ emotion: 'question', strength: 1 })
    advance(layer, 3)
    const before = brows(layer.face())
    layer.set(null)

    layer.set({ emotion: 'question', strength: 1 })

    expect(brows(layer.face())).toEqual(before)
    layer.step(dt)
    const after = brows(layer.face())
    for (const axis of [0, 1])
      expect(Math.abs(after[axis] - before[axis])).toBeLessThanOrEqual(dt / settings.onsetTau * 0.6)
    advance(layer, 5)
    expect(Math.sign(layer.face().oneSidedBrow)).toBe(-Math.sign(before[0] - before[1]))
  })

  it('does not restart or reroll when setters repeat every frame', () => {
    const reference = new NaturalHoldLayer()
    const repeated = new NaturalHoldLayer()
    reference.set({ emotion: 'think', strength: 0.7 })

    for (let i = 0; i < 1000; i++) {
      repeated.set({ emotion: 'think', strength: 0.7 })
      repeated.setSettings({ ...settings })
      repeated.setStrengths({ think: 1 })
      reference.step(dt)
      repeated.step(dt)
    }

    expect(snapshot(repeated)).toEqual(snapshot(reference))
  })

  it.each(['command', 'model'] as const)('is exactly neutral when %s strength is zero', (source) => {
    const layer = new NaturalHoldLayer()
    const neutral = snapshot(layer)
    layer.setStrengths({ happy: source === 'model' ? 0 : 1 })
    layer.set({ emotion: 'happy', strength: source === 'command' ? 0 : 1 })

    advance(layer, 10)

    expect(snapshot(layer)).toEqual(neutral)
  })

  it.each([[0.5, 0.5], [1.5, 1.5], [9, 2], [-1, 0], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]])('scales every target with model strength %s', (input, expected) => {
    const reference = new NaturalHoldLayer()
    const layer = new NaturalHoldLayer()
    reference.set({ emotion: 'sad', strength: 0.6 })
    layer.setStrengths({ sad: input })
    layer.set({ emotion: 'sad', strength: 0.6 })

    advance(reference, 2)
    advance(layer, 2)

    expect(layer.face().mouthForm).toBeCloseTo(reference.face().mouthForm * expected, 12)
    expect(layer.face().eyeOpenMultiplier - 1).toBeCloseTo((reference.face().eyeOpenMultiplier - 1) * expected, 12)
    expect(layer.modulation().cameraFixation).toBeCloseTo(reference.modulation().cameraFixation * expected, 12)
    expect(layer.modulation().blinkInterval - 1).toBeCloseTo((reference.modulation().blinkInterval - 1) * expected, 12)
    expect(layer.posture()[1]).toBeCloseTo(reference.posture()[1] * expected, 12)
  })

  it('defaults malformed persisted strength to one without contaminating other entries', () => {
    const layer = new NaturalHoldLayer()
    layer.setStrengths(JSON.parse('{"happy":"x","sad":0}'))
    layer.set({ emotion: 'happy', strength: 1 })

    advance(layer, 1)

    expect(layer.face().mouthForm).toBeCloseTo(1 - Math.exp(-1 / settings.onsetTau), 12)
  })

  it('ignores NaN commands and invalid steps on a fresh layer', () => {
    const layer = new NaturalHoldLayer()
    const neutral = snapshot(layer)

    layer.set({ emotion: 'happy', strength: Number.NaN })
    for (const step of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, dt])
      layer.step(step)

    expect(layer.emotion).toBeNull()
    expect(snapshot(layer)).toEqual(neutral)
  })

  it('honors zero time constants and independent posture lag', () => {
    const layer = new NaturalHoldLayer()
    layer.setSettings({ ...settings, onsetTau: 0, releaseTau: 0, postureTau: 1 })
    layer.set({ emotion: 'happy', strength: 1 })

    layer.step(1)

    expect(layer.face().mouthForm).toBe(1)
    expect(layer.posture()[1]).toBeCloseTo(0.1 * (1 - Math.exp(-1)), 14)
    layer.set(null)
    layer.step(dt)
    expect(layer.face().mouthForm).toBe(0)
    expect(layer.posture()[1]).toBeGreaterThan(0)
  })
})
