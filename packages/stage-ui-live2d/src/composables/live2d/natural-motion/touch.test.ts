import { describe, expect, it } from 'vitest'

import { NaturalImpulses } from './impulses'
import { createRandomStream } from './random'
import { NaturalPetLayer, pokeDirection, pokeNudgeTau } from './touch'

const dt = 1 / 60
const hands = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }]

function holdUntilFull(layer: NaturalPetLayer, hand: { x: number, y: number }) {
  layer.set(hand)
  for (let i = 0; i < 1200; i++)
    layer.step(dt)
}

function settle(layer: NaturalPetLayer) {
  layer.set(null)
  for (let i = 0; i < 1200 && layer.level !== 0; i++)
    layer.step(dt)
}

describe('naturalPetLayer', () => {
  it('(a) is exactly neutral at level 0 for every hand', () => {
    for (const hand of hands) {
      const layer = new NaturalPetLayer()
      layer.set(hand)
      // Adding 0 turns -0 into 0, so the comparison is about magnitude, not sign bits.
      expect(layer.headOffset().map(value => value + 0)).toEqual([0, 0, 0])
      expect(layer.face()).toEqual({ eyeOpenMultiplier: 1, eyeSmile: 0, mouthForm: 0, cheek: 0, browY: 0 })
    }
  })

  it('(a2) keeps no hand state after a pet settles', () => {
    const recycled = new NaturalPetLayer()
    holdUntilFull(recycled, { x: 1, y: 1 })
    settle(recycled)
    expect(recycled.level).toBe(0)

    const fresh = new NaturalPetLayer()
    const neutralY = new NaturalPetLayer()
    const hand = { x: -1, y: -1 }
    recycled.set(hand)
    fresh.set(hand)
    neutralY.set({ x: -1, y: 0 })
    for (let i = 0; i < 6; i++) {
      recycled.step(dt)
      fresh.step(dt)
      neutralY.step(dt)
      const offset = recycled.headOffset()
      // petRoll is negative, so a hand at x = -1 rolls the head to a positive value.
      expect(offset[2]).toBeGreaterThan(0)
      expect(offset).toEqual(fresh.headOffset())
      // The stroke-pitch term is -petStrokePitch * level * y, so a hand at the top (y = -1) bows less than a neutral-Y hand.
      expect(offset[1] - neutralY.headOffset()[1]).toBeGreaterThan(0)
    }
  })

  it('(b) bows lower for a hand at the bottom of the head than at the top', () => {
    const bottom = new NaturalPetLayer()
    const top = new NaturalPetLayer()
    holdUntilFull(bottom, { x: 0, y: 1 })
    holdUntilFull(top, { x: 0, y: -1 })
    expect(top.headOffset()[1] - bottom.headOffset()[1]).toBeCloseTo(0.12, 9)
  })
})

describe('pokeDirection', () => {
  it('(c) bonks the head down for a poke at the top and lifts it at the bottom', () => {
    expect(pokeDirection('head', 0, -1)[1]).toBeLessThan(0)
    expect(pokeDirection('head', 0, 1)[1]).toBeGreaterThan(0)
  })

  it('(d) mirrors across x for both regions', () => {
    for (const region of ['head', 'body'] as const) {
      for (const y of [-1, -0.4, 0, 0.7]) {
        const right = pokeDirection(region, 0.8, y)
        const left = pokeDirection(region, -0.8, y)
        expect(left[0]).toBeCloseTo(-right[0], 12)
        expect(left[1]).toBeCloseTo(right[1], 12)
        expect(left[2]).toBeCloseTo(-right[2], 12)
      }
    }
  })
})

describe('naturalImpulses poke nudge', () => {
  it('(e) peaks within 0.2 s of its start', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const impulses = new NaturalImpulses(createRandomStream(seed))
      impulses.nudge([0, 1, 0], 2.5, 10, pokeNudgeTau)
      let peakAt = 0
      let peak = 0
      for (let t = 0; t <= 2; t += 0.005) {
        const magnitude = Math.hypot(...impulses.headOffset(10 + t))
        if (magnitude > peak) {
          peak = magnitude
          peakAt = t
        }
      }
      expect(peak).toBeGreaterThan(0)
      expect(peakAt).toBeLessThanOrEqual(0.2)
    }
  })
})
