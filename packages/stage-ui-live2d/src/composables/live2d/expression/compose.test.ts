import type { ExpressionDefinition } from './compose'

import { describe, expect, it } from 'vitest'

import { ExpressionComposer } from './compose'

function definition(id: string, parameters: ExpressionDefinition['parameters'], fadeIn = 0, fadeOut = 0): ExpressionDefinition {
  return { id, parameters, fadeIn, fadeOut }
}

function core(initial: Record<string, number>) {
  const ids = Object.keys(initial)
  const values = new Float32Array(Object.values(initial))
  const saved = values.slice()
  return {
    read: (id: string) => values[ids.indexOf(id)]!,
    write: (id: string, value: number) => { values[ids.indexOf(id)] = value },
    clampOf: (): [number, number] => [-100, 100],
    save: () => { saved.set(values) },
    load: () => { values.set(saved) },
  }
}

function frame(composer: ExpressionComposer, model: ReturnType<typeof core>, now: number, animate?: () => void) {
  model.load()
  composer.restoreBases(model.write)
  animate?.()
  composer.compose(now, model.read, model.write, model.clampOf)
  model.save()
}

describe('expression composer', () => {
  it('fades to a fractional target and does not reset transitionAt on repeated targets', () => {
    const composer = new ExpressionComposer()
    composer.define([definition('a', [], 1, 2)])
    composer.setTarget('a', 0.5, 0)
    expect(composer.weightOf('a', 0)).toBe(0)
    expect(composer.weightOf('a', 0.5)).toBeCloseTo(0.25)
    composer.setTarget('a', 0.5, 0.5)
    composer.setTarget('a', 0.5, 0.75)
    expect(composer.weightOf('a', 1)).toBeCloseTo(0.5)
    expect(composer.weightOf('a', 1.5)).toBeCloseTo(0.5)
    expect(composer.activeIds()).toEqual(['a'])
  })

  it('uses fadeOut for lower nonzero targets and retires only after a zero target', () => {
    const composer = new ExpressionComposer()
    composer.define([definition('a', [], 1, 2)])
    composer.activate('a', 0)
    composer.setTarget('a', 0.4, 1)
    expect(composer.weightOf('a', 2)).toBeCloseTo(0.7)
    expect(composer.weightOf('a', 3)).toBeCloseTo(0.4)
    expect(composer.activeIds()).toEqual(['a'])
    composer.setTarget('a', 0, 3)
    expect(composer.weightOf('a', 4)).toBeCloseTo(0.2)
    expect(composer.activeIds()).toEqual(['a'])
    expect(composer.weightOf('a', 5)).toBe(0)
    expect(composer.activeIds()).toEqual([])
  })

  it('orders new targets by list order and keeps a reactivated fading instance in place', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 2 })
    composer.define([
      definition('multiply', [{ id: 'x', value: 3, blend: 'Multiply' }], 0, 2),
      definition('add', [{ id: 'x', value: 2, blend: 'Add' }]),
    ])
    composer.setTargets([{ id: 'multiply', weight: 0.5 }, { id: 'add', weight: 0.5 }], 0)
    frame(composer, model, 0)
    expect(model.read('x')).toBe(5)
    composer.setTargets([{ id: 'add', weight: 0.5 }], 1)
    expect(composer.weightOf('multiply', 2)).toBeCloseTo(0.25)
    composer.setTargets([{ id: 'add', weight: 0.5 }, { id: 'multiply', weight: 0.5 }], 2)
    frame(composer, model, 2)
    expect(model.read('x')).toBe(5)
    expect(composer.activeIds()).toEqual(['multiply', 'add'])
  })

  it.each([
    ['Add', 4, 4],
    ['Multiply', 3, 4],
  ] as const)('applies half of the %s effect at weight 0.5', (blend, value, expected) => {
    const composer = new ExpressionComposer()
    const model = core({ x: 2 })
    composer.define([definition('a', [{ id: 'x', value, blend }])])
    composer.setTarget('a', 0.5, 0)
    frame(composer, model, 0)
    expect(model.read('x')).toBe(expected)
  })

  it.each([
    [-1, 0],
    [2, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 0],
  ])('clamps target %s to %s', (target, expected) => {
    const composer = new ExpressionComposer()
    composer.define([definition('a', [])])
    composer.setTarget('a', target, 0)
    expect(composer.weightOf('a', 0)).toBe(expected)
    expect(composer.activeIds()).toEqual(expected === 0 ? [] : ['a'])
  })

  it('(a) keeps separate Add expressions independent on activation and release', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 0.25, y: 0.5 })
    composer.define([
      definition('a', [{ id: 'x', value: 0.5, blend: 'Add' }]),
      definition('b', [{ id: 'y', value: 0.25, blend: 'Add' }]),
    ])
    composer.setActiveSet(['a', 'b'], 0)
    frame(composer, model, 0)
    expect(model.read('x')).toBe(0.75)
    expect(model.read('y')).toBe(0.75)
    composer.deactivate('b', 1)
    frame(composer, model, 1)
    expect(model.read('x')).toBe(0.75)
    expect(model.read('y')).toBe(0.5)
  })

  it('(b) ignores Add zero and Multiply one without acquiring their parameters', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 1 })
    composer.define([
      definition('a', [{ id: 'x', value: 2, blend: 'Add' }]),
      definition('b', [{ id: 'x', value: 0, blend: 'Add' }, { id: 'untouched', value: 1, blend: 'Multiply' }]),
    ])
    composer.setActiveSet(['a', 'b'], 0)
    const reads: string[] = []
    composer.compose(0, (id) => {
      reads.push(id)
      return model.read(id)
    }, model.write, model.clampOf)
    expect(model.read('x')).toBe(3)
    expect(reads).toEqual(['x'])
  })

  it('(c) preserves activation and parameter order with one final clamp', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 2 })
    composer.define([
      definition('second', [{ id: 'x', value: 4, blend: 'Overwrite' }, { id: 'x', value: -3, blend: 'Add' }], 2),
      definition('first', [{ id: 'x', value: 10, blend: 'Add' }, { id: 'x', value: 2, blend: 'Multiply' }], 2),
    ])
    composer.setActiveSet(['first', 'second'], 0)
    composer.compose(1, model.read, model.write, () => [0, 8])
    const afterFirst = (2 + 10 * 0.5) * (1 + (2 - 1) * 0.5)
    expect(model.read('x')).toBeCloseTo(afterFirst + (4 - afterFirst) * 0.5 - 3 * 0.5)
  })

  it('(d) multiplies each fresh blink base', () => {
    const composer = new ExpressionComposer()
    const model = core({ eye: 1 })
    composer.define([definition('a', [{ id: 'eye', value: 0.5, blend: 'Multiply' }])])
    composer.activate('a', 0)
    for (let i = 0; i < 120; i++) {
      const blink = i / 128
      frame(composer, model, i / 120, () => model.write('eye', blink))
      expect(model.read('eye')).toBe(blink * 0.5)
    }
  })

  it('(e) applies Overwrite even when its value is the model default', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 0 })
    composer.define([definition('a', [{ id: 'x', value: 0, blend: 'Overwrite' }])])
    composer.activate('a', 0)
    frame(composer, model, 0, () => model.write('x', 1))
    expect(model.read('x')).toBe(0)
  })

  it('(f) uses cosine fades and reverses continuously without changing order', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 0 })
    composer.define([
      definition('a', [{ id: 'x', value: 2, blend: 'Add' }], 2, 2),
      definition('b', [{ id: 'x', value: 0.5, blend: 'Multiply' }]),
    ])
    composer.setActiveSet(['a', 'b'], 0)
    expect(composer.weightOf('a', 1)).toBeCloseTo(0.5)
    const before = composer.weightOf('a', 0.5)
    composer.deactivate('a', 0.5)
    expect(Math.abs(composer.weightOf('a', 0.5) - before)).toBeLessThanOrEqual(1e-9)
    const releasing = composer.weightOf('a', 0.75)
    composer.activate('a', 0.75)
    expect(Math.abs(composer.weightOf('a', 0.75) - releasing)).toBeLessThanOrEqual(1e-9)
    frame(composer, model, 3)
    expect(model.read('x')).toBe(1)
    expect(composer.activeIds()).toEqual(['a', 'b'])
  })

  it('(g) prevents accumulation across 1,000 Float32 SDK save/load frames', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 0.1 })
    composer.define([definition('a', [{ id: 'x', value: 0.2, blend: 'Add' }])])
    composer.activate('a', 0)
    const expected = Math.fround(Math.fround(0.1) + 0.2)
    for (let i = 0; i < 1000; i++) {
      frame(composer, model, i / 120)
      expect(model.read('x')).toBe(expected)
    }
  })

  it('(h) respects an animation write equal to the previous expression output', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 1 })
    composer.define([definition('a', [{ id: 'x', value: 0.5, blend: 'Multiply' }])])
    composer.activate('a', 0)
    frame(composer, model, 0)
    expect(model.read('x')).toBe(0.5)
    frame(composer, model, 1 / 120, () => model.write('x', 0.5))
    expect(model.read('x')).toBe(0.25)
  })

  it('(i) restores released bases before animation and forgets ownership afterwards', () => {
    const composer = new ExpressionComposer()
    const model = core({ x: 1 })
    composer.define([definition('a', [{ id: 'x', value: 1, blend: 'Add' }], 0, 1)])
    composer.activate('a', 0)
    frame(composer, model, 0)
    composer.deactivate('a', 0)
    frame(composer, model, 1, () => {
      expect(model.read('x')).toBe(1)
      model.write('x', 3)
    })
    expect(model.read('x')).toBe(3)
    expect(composer.activeIds()).toEqual([])
    frame(composer, model, 2)
    expect(model.read('x')).toBe(3)
  })

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('defaults invalid fade %s to one second in both directions', (fade) => {
    const composer = new ExpressionComposer()
    composer.define([{ id: 'a', parameters: [], fadeIn: fade, fadeOut: fade }])
    composer.activate('a', 0)
    expect(composer.weightOf('a', 0.5)).toBeCloseTo(0.5)
    composer.deactivate('a', 1)
    expect(composer.weightOf('a', 1.5)).toBeCloseTo(0.5)
    expect(composer.weightOf('a', 2)).toBe(0)
    expect(composer.activeIds()).toEqual([])
  })

  it('uses the configured default fade only for missing or invalid file fades', () => {
    const composer = new ExpressionComposer()
    composer.setDefaultFadeSeconds(2)
    composer.define([{ id: 'unset', parameters: [], fadeOut: -1 }, definition('explicit', [], 0.5, 0)])
    composer.setActiveSet(['unset', 'explicit'], 0)
    expect(composer.weightOf('unset', 1)).toBeCloseTo(0.5)
    expect(composer.weightOf('explicit', 0.25)).toBeCloseTo(0.5)
    composer.setActiveSet([], 2)
    expect(composer.weightOf('unset', 3)).toBeCloseTo(0.5)
    expect(composer.activeIds()).toEqual(['unset'])
  })

  it('ignores unknown ids and supports empty definitions and immediate transitions', () => {
    const composer = new ExpressionComposer()
    composer.define([])
    composer.activate('unknown', 0)
    composer.deactivate('unknown', 0)
    composer.setActiveSet(['unknown'], 0)
    expect(composer.weightOf('unknown', 1)).toBe(0)
    expect(composer.activeIds()).toEqual([])
    composer.define([definition('empty', [])])
    composer.activate('empty', 0)
    expect(composer.weightOf('empty', 0)).toBe(1)
    composer.deactivate('empty', 0)
    expect(composer.activeIds()).toEqual([])
  })

  it('keeps repeated activation idempotent and releases all omitted ids', () => {
    const composer = new ExpressionComposer()
    composer.define([definition('a', [], 2, 1)])
    composer.activate('a', 0)
    composer.activate('a', 0.5)
    expect(composer.weightOf('a', 1)).toBeCloseTo(0.5)
    composer.setActiveSet([], 1)
    expect(composer.weightOf('a', 2)).toBe(0)
  })

  it('retires an activation cancelled before gaining any weight', () => {
    const composer = new ExpressionComposer()
    composer.define([definition('a', [], 2, 1)])
    composer.activate('a', 0)
    composer.deactivate('a', 0)
    expect(composer.activeIds()).toEqual([])
  })
})
